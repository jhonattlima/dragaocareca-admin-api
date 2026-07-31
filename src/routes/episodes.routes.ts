import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../config/env";
import { episodeSchema } from "../schemas/episode";
import { requireAuth } from "../middleware/auth.middleware";
import { queueLaunchNotification } from "../services/launch-notification.service";
import { refreshCoverMosaicBackground } from "../services/cover-mosaic.service";
import { episodeRepository } from "../database/repositories/episode.repository";
import {
  abortDraftEpisodeTranscription,
  clearEpisodeTranscription,
  getEpisodeTranscriptionStatus,
  queueEpisodeTranscription,
  queueDraftEpisodeTranscription,
  syncDraftEpisodeTranscription,
} from "../services/episode-transcription.service";
import { getEpisodeDraftSummary } from "../services/episode-summary.service";
import {
  EpisodeArtifactSelectorValidationError,
  parseEpisodeArtifactSelectors,
  preflightEpisodeArtifactDownloads,
} from "../services/episode-artifact-download.service";
import {
  getEpisodeArtifactPreparationStatus,
  getValidatedEpisodeArtifactPreparationDownload,
  prepareEpisodeArtifactArchive,
} from "../services/episode-artifact-preparation.service";
import {
  getEpisodeMediaBackupPath,
  findExistingEpisodeMediaPath,
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
  getEpisodeMediaStagingDirectory,
  getEpisodeMediaStagingPath,
} from "../services/episode-media-layout.service";

export const episodesRouter = Router();

const queueCoverMosaicRefresh = (): void => {
  void refreshCoverMosaicBackground().catch((error: unknown) => {
    console.warn("Cover mosaic refresh failed", error instanceof Error ? error.message : String(error));
  });
};

const logArtifactPreparation = (details: {
  event: "queued" | "cache-hit" | "downloaded" | "not-ready" | "expired" | "not-found";
  episodeId: number;
  selectors: string[];
}): void => {
  console.info("Episode artifact preparation", details);
};

const noStoreArtifactPreparation: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

const artifactJobRequestSchema = z.object({
  artifacts: z.array(z.enum(["episode", "trailer", "transcript", "image", "image-low"])).min(1).optional(),
}).strict().optional();

// D-01/D-02/D-03/D-08/D-09/D-10/D-11: the route boundary owns auth, canonical
// selector validation, preflight availability, opaque job lookup, and safe delivery.

for (const directory of [config.media.episodesDir, config.media.episodesStagingDir, config.media.backupEpisodesDir]) {
  fs.mkdirSync(directory, { recursive: true });
}

type UploadKind = "audio" | "trailer" | "cover" | "coverLow";

type UploadSpec = {
  kind: UploadKind;
  field: "fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName";
  buildStagingDirectory: (episodeId: number) => string;
  buildFileName: (episodeId: number) => string;
  buildStagingFileName: (episodeId: number) => string;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxBytes: number;
};

const uploadSpecs: Record<UploadKind, UploadSpec> = {
  audio: {
    kind: "audio",
    field: "fileName",
    buildFileName: (episodeId) => getEpisodeMediaRelativePath(episodeId, "audio"),
    buildStagingDirectory: (episodeId) => getEpisodeMediaStagingDirectory(episodeId),
    buildStagingFileName: () => "audio.mp3",
    allowedExtensions: [".mp3"],
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
    maxBytes: 500 * 1024 * 1024,
  },
  trailer: {
    kind: "trailer",
    field: "trailerFileName",
    buildFileName: (episodeId) => getEpisodeMediaRelativePath(episodeId, "trailer"),
    buildStagingDirectory: (episodeId) => getEpisodeMediaStagingDirectory(episodeId),
    buildStagingFileName: () => "trailer.mp3",
    allowedExtensions: [".mp3"],
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
    maxBytes: 250 * 1024 * 1024,
  },
  cover: {
    kind: "cover",
    field: "coverFileName",
    buildFileName: (episodeId) => getEpisodeMediaRelativePath(episodeId, "cover"),
    buildStagingDirectory: (episodeId) => getEpisodeMediaStagingDirectory(episodeId),
    buildStagingFileName: () => "cover.jpeg",
    allowedExtensions: [".jpg", ".jpeg"],
    allowedMimeTypes: ["image/jpeg", "image/jpg"],
    maxBytes: 20 * 1024 * 1024,
  },
  coverLow: {
    kind: "coverLow",
    field: "coverLowFileName",
    buildFileName: (episodeId) => getEpisodeMediaRelativePath(episodeId, "coverLow"),
    buildStagingDirectory: (episodeId) => getEpisodeMediaStagingDirectory(episodeId),
    buildStagingFileName: () => "cover.webp",
    allowedExtensions: [".webp"],
    allowedMimeTypes: ["image/webp"],
    maxBytes: 10 * 1024 * 1024,
  },
};

const moveFile = async (sourcePath: string, targetPath: string): Promise<void> => {
  await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      await fs.promises.copyFile(sourcePath, targetPath);
      await fs.promises.unlink(sourcePath).catch(() => undefined);
      return;
    }
    throw error;
  }
};

const findExistingFile = async (paths: string[]): Promise<string | null> => {
  for (const candidate of paths) {
    const exists = await fs.promises
      .access(candidate)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return candidate;
    }
  }

  return null;
};

const moveExistingFileToBackup = async (primaryPath: string, stagingPath: string, backupPath: string): Promise<boolean> => {
  const existingPath = await findExistingFile([primaryPath, stagingPath]);
  if (!existingPath) {
    return false;
  }

  await moveFile(existingPath, backupPath);
  return true;
};

const buildUploader = (spec: UploadSpec) =>
  multer({
    storage: multer.diskStorage({
      destination: (req, _file, callback) => {
        const episodeId = Number(req.params.episodeId);
        const stagingDirectory =
          Number.isInteger(episodeId) && episodeId > 0
            ? spec.buildStagingDirectory(episodeId)
            : config.media.episodesStagingDir;
        fs.mkdirSync(stagingDirectory, { recursive: true });
        callback(null, stagingDirectory);
      },
      filename: (req, _file, callback) => {
        const episodeId = Number(req.params.episodeId);
        const fileName =
          Number.isInteger(episodeId) && episodeId > 0
            ? spec.buildStagingFileName(episodeId)
            : _file.originalname;
        callback(null, fileName);
      },
    }),
    limits: {
      fileSize: spec.maxBytes,
    },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const mimetype = file.mimetype.toLowerCase();
      const extensionAllowed = spec.allowedExtensions.includes(extension);
      const mimeAllowed = spec.allowedMimeTypes.includes(mimetype);

      if (!extensionAllowed || !mimeAllowed) {
        callback(
          new Error(
            `Invalid file type for ${spec.kind}. Allowed extensions: ${spec.allowedExtensions.join(", ")}`
          )
        );
        return;
      }

      callback(null, true);
    },
  }).single("file");

const makeUploadRoute = (pathSuffix: string, spec: UploadSpec) => {
  const upload = buildUploader(spec);

  episodesRouter.post(`/:episodeId/${pathSuffix}`, requireAuth, (req, res, next) => {
    upload(req, res, async (error) => {
      if (error) {
        next(error);
        return;
      }

      const file = req.file;
      const episodeId = Number(req.params.episodeId);

      try {
        if (!Number.isInteger(episodeId) || episodeId <= 0) {
          if (file) await fs.promises.unlink(file.path).catch(() => undefined);
          res.status(400).json({ message: "Invalid episodeId" });
          return;
        }

        if (!file) {
          res.status(400).json({ message: "File upload is required" });
          return;
        }

        const fileName = spec.buildFileName(episodeId);
        const currentEpisode = episodeRepository.findByEpisodeId(episodeId);
        console.info(`[episodes] upload ${spec.kind} episode=${episodeId} current=${Boolean(currentEpisode)}`);
        if (!currentEpisode) {
          if (spec.kind === "audio") {
            await abortDraftEpisodeTranscription(episodeId);
            const draftState = await queueDraftEpisodeTranscription(episodeId);
            console.info(
              `[transcription] draft queued episode=${episodeId} version=${draftState.version} status=${draftState.status}`
            );
            const transcriptionMessage =
              draftState.status === "error"
                ? `Audio staged, but transcription could not start: ${draftState.error ?? "unknown error"}`
                : "Audio staged and transcription started.";
            res.json({
              episodeId,
              [spec.field]: fileName,
              transcriptStatus: draftState.status,
              transcriptUpdatedAt: new Date().toISOString(),
              transcriptStartedAt: draftState.progress !== null && draftState.status === "processing" ? new Date().toISOString() : undefined,
              transcriptProgress: draftState.progress ?? (draftState.status === "done" ? 100 : 0),
              transcriptError: draftState.error ?? undefined,
              message: transcriptionMessage,
            });
            return;
          }

          res.json({
            episodeId,
            [spec.field]: fileName,
            message: "File staged.",
          });
          return;
        }

        const updated = episodeRepository.updateMedia(episodeId, { [spec.field]: fileName });

        if (spec.kind === "audio") {
          await clearEpisodeTranscription(episodeId);
          const draftState = await queueDraftEpisodeTranscription(episodeId);
          console.info(
            `[transcription] queued episode=${episodeId} version=${draftState.version} status=${draftState.status} at=${new Date().toISOString()}`
          );
          const refreshed = episodeRepository.findByEpisodeId(episodeId);
          res.json({
            ...(refreshed ?? updated ?? currentEpisode),
            [spec.field]: fileName,
            transcriptStatus: draftState.status,
            transcriptUpdatedAt: new Date().toISOString(),
            transcriptStartedAt: draftState.status === "processing" ? new Date().toISOString() : undefined,
            transcriptProgress: draftState.progress ?? (draftState.status === "done" ? 100 : 0),
            transcriptError: draftState.error ?? undefined,
            message:
              draftState.status === "error"
                ? `Audio staged, but transcription could not start: ${draftState.error ?? "unknown error"}`
                : "Audio staged and transcription started.",
          });
          return;
        }
        const refreshed = episodeRepository.findByEpisodeId(episodeId);
        res.json({
          ...(refreshed ?? updated ?? currentEpisode),
          [spec.field]: fileName,
          message: "File staged.",
        });
      } catch (error) {
        if (file) {
          await fs.promises.unlink(file.path).catch(() => undefined);
        }
        next(error);
      }
    });
  });
};

const makeDeleteRoute = (pathSuffix: string, spec: UploadSpec) => {
  episodesRouter.delete(`/:episodeId/${pathSuffix}`, requireAuth, async (req, res, next) => {
    try {
      const episodeId = Number(req.params.episodeId);
      if (!Number.isInteger(episodeId) || episodeId <= 0) {
        res.status(400).json({ message: "Invalid episodeId" });
        return;
      }

      const currentEpisode = episodeRepository.findByEpisodeId(episodeId);
      const backupPath = getEpisodeMediaBackupPath(episodeId, spec.kind);

      const existingPath = await findExistingEpisodeMediaPath(
        episodeId,
        spec.kind as "audio" | "trailer" | "cover" | "coverLow",
        (currentEpisode as any)?.[spec.field] ?? null
      );

      if (!currentEpisode && !existingPath) {
        res.status(404).json({ message: "Episode not found" });
        return;
      }

      const movedToBackup = existingPath ? (await moveFile(existingPath, backupPath), true) : false;

      if (!currentEpisode) {
        if (spec.kind === "audio" && movedToBackup) {
          await clearEpisodeTranscription(episodeId);
        }
        res.json({ episodeId, [spec.field]: movedToBackup ? "" : undefined });
        return;
      }

      const updated = episodeRepository.updateMedia(episodeId, {
        [spec.field]: null,
      });
      if (!updated) {
        res.status(404).json({ message: "Episode not found" });
        return;
      }

      if (spec.kind === "audio") {
        await clearEpisodeTranscription(episodeId);
      }
      queueCoverMosaicRefresh();
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });
};

const promoteStagedMedia = async (episodeId: number) => {
  const updates: Partial<Record<"fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName", string>> = {};

  for (const spec of Object.values(uploadSpecs)) {
    const fileName = spec.buildFileName(episodeId);
    const stagingPath = getEpisodeMediaStagingPath(episodeId, spec.kind);
    const finalPath = getEpisodeMediaFinalPath(episodeId, spec.kind);
    const stagedExists = await fs.promises
      .access(stagingPath)
      .then(() => true)
      .catch(() => false);

    if (!stagedExists) {
      continue;
    }

    await moveFile(stagingPath, finalPath);
    updates[spec.field] = fileName;
  }

  return updates;
};

makeUploadRoute("audio", uploadSpecs.audio);
makeUploadRoute("trailer", uploadSpecs.trailer);
makeUploadRoute("cover", uploadSpecs.cover);
makeUploadRoute("cover-webp", uploadSpecs.coverLow);
makeDeleteRoute("audio", uploadSpecs.audio);
makeDeleteRoute("trailer", uploadSpecs.trailer);
makeDeleteRoute("cover", uploadSpecs.cover);
makeDeleteRoute("cover-webp", uploadSpecs.coverLow);

episodesRouter.get("/", requireAuth, async (_req, res, next) => {
  try {
    const episodes = episodeRepository.listAll();
    res.json(episodes);
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/references", requireAuth, async (_req, res, next) => {
  try {
    const catalog = episodeRepository.listStructuredEntryCatalog();
    res.json(catalog);
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/:episodeId/transcription", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(getEpisodeTranscriptionStatus(episodeId));
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/:episodeId/episodes-generated-summary", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(getEpisodeDraftSummary(episodeId));
  } catch (error) {
    next(error);
  }
});

episodesRouter.post("/:episodeId/artifacts/jobs", noStoreArtifactPreparation, requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    const body = artifactJobRequestSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: "artifacts must be a nonempty array of canonical selectors when supplied" });
      return;
    }

    let selectedArtifacts;
    try {
      selectedArtifacts = parseEpisodeArtifactSelectors(body.data?.artifacts?.join(","));
    } catch (error) {
      if (error instanceof EpisodeArtifactSelectorValidationError) {
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }

    const episode = episodeRepository.findByEpisodeId(episodeId);
    if (!episode) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }

    const preflight = await preflightEpisodeArtifactDownloads(episodeId, selectedArtifacts);
    if (preflight.available.length === 0) {
      res.status(404).json({ message: "No requested artifacts found" });
      return;
    }

    const status = await prepareEpisodeArtifactArchive(episodeId, selectedArtifacts);
    logArtifactPreparation({
      event: status.state === "completed" ? "cache-hit" : "queued",
      episodeId,
      selectors: status.requested,
    });
    res.setHeader("Location", `/v1/episodes/${episodeId}/artifacts/jobs/${status.jobId}`);
    res.status(status.state === "completed" ? 200 : 202).json(status);
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/:episodeId/artifacts/jobs/:jobId", noStoreArtifactPreparation, requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    const jobId = req.params.jobId;
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }
    if (typeof jobId !== "string" || jobId.length === 0) {
      res.status(404).json({ message: "Artifact job not found" });
      return;
    }

    const status = await getEpisodeArtifactPreparationStatus(episodeId, jobId);
    if (!status) {
      logArtifactPreparation({ event: "not-found", episodeId, selectors: [] });
      res.status(404).json({ message: "Artifact job not found" });
      return;
    }

    res.json(status);
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/:episodeId/artifacts/jobs/:jobId/download", noStoreArtifactPreparation, requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    const jobId = req.params.jobId;
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }
    if (typeof jobId !== "string" || jobId.length === 0) {
      res.status(404).json({ message: "Artifact job not found" });
      return;
    }

    const status = await getEpisodeArtifactPreparationStatus(episodeId, jobId);
    if (!status) {
      logArtifactPreparation({ event: "not-found", episodeId, selectors: [] });
      res.status(404).json({ message: "Artifact job not found" });
      return;
    }
    if (status.state !== "completed") {
      logArtifactPreparation({ event: "not-ready", episodeId, selectors: status.requested });
      res.status(409).json({ message: "Artifact archive is not ready" });
      return;
    }

    const download = await getValidatedEpisodeArtifactPreparationDownload(episodeId, jobId);
    if (!download) {
      logArtifactPreparation({ event: "not-found", episodeId, selectors: status.requested });
      res.status(404).json({ message: "Artifact job not found" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="episode-${episodeId}-artifacts.zip"`);
    if (download.status.missing.length > 0) {
      res.setHeader("X-Missing-Artifacts", download.status.missing.join(","));
    }
    download.stream.on("error", () => {
      console.error("Episode artifact preparation download failed", {
        episodeId,
        selectors: download.status.requested,
      });
      if (!res.destroyed) res.destroy();
    });
    logArtifactPreparation({ event: "downloaded", episodeId, selectors: download.status.requested });
    download.stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/:episodeId", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    const episode = episodeRepository.findByEpisodeId(episodeId);
    if (!episode) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }
    res.json(episode);
  } catch (error) {
    next(error);
  }
});

episodesRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const payload = episodeSchema.parse(req.body);
    const created = episodeRepository.create(payload);
    const mediaUpdates = await promoteStagedMedia(created.episodeId);
    const transcriptState = await syncDraftEpisodeTranscription(created.episodeId);

    if (transcriptState.status === "done" && transcriptState.transcriptFileName) {
      episodeRepository.markTranscriptionDone(created.episodeId, transcriptState.transcriptFileName);
    } else if (transcriptState.status === "pending" || transcriptState.status === "processing") {
      episodeRepository.queueTranscription(created.episodeId);
    } else if (transcriptState.status === "error") {
      episodeRepository.markTranscriptionError(created.episodeId, "Draft transcription failed");
    }

    await queueLaunchNotification(created.episodeId);

    const finalDoc = Object.keys(mediaUpdates).length === 0
      ? episodeRepository.findByEpisodeId(created.episodeId)
      : episodeRepository.updateMedia(created.episodeId, mediaUpdates);
    queueCoverMosaicRefresh();
    res.status(201).json(finalDoc ?? created);
  } catch (error) {
    next(error);
  }
});

episodesRouter.put("/:episodeId", requireAuth, async (req, res, next) => {
  try {
    const routeId = Number(req.params.episodeId);
    const payload = episodeSchema.parse({ ...req.body, episodeId: routeId });
    const updated = episodeRepository.update(routeId, payload);

    if (!updated) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }

    const mediaUpdates = await promoteStagedMedia(routeId);
    await queueLaunchNotification(routeId);
    if (mediaUpdates.fileName) {
      await clearEpisodeTranscription(routeId);
      await queueEpisodeTranscription(routeId);
    }
    const finalDoc = Object.keys(mediaUpdates).length === 0
      ? episodeRepository.findByEpisodeId(routeId)
      : episodeRepository.updateMedia(routeId, mediaUpdates);
    queueCoverMosaicRefresh();
    res.json(finalDoc ?? updated);
  } catch (error) {
    next(error);
  }
});

episodesRouter.delete("/:episodeId", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    const episode = episodeRepository.findByEpisodeId(episodeId);
    if (!episode) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }

    const snapshotPath = path.join(config.media.backupEpisodesDir, String(episodeId), "episode.json");
    await fs.promises.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.promises.writeFile(snapshotPath, JSON.stringify(episode, null, 2), "utf8");

    for (const spec of Object.values(uploadSpecs)) {
      const currentFileName = (episode as any)[spec.field] || spec.buildFileName(episodeId);
      const finalPath = getEpisodeMediaFinalPath(episodeId, spec.kind);
      const stagingPath = getEpisodeMediaStagingPath(episodeId, spec.kind);
      const backupPath = getEpisodeMediaBackupPath(episodeId, spec.kind);
      await moveExistingFileToBackup(finalPath, stagingPath, backupPath);
    }

    episodeRepository.delete(episodeId);
    queueCoverMosaicRefresh();
    res.json({ episodeId, message: "Episode deleted" });
  } catch (error) {
    next(error);
  }
});
