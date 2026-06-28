import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { config } from "../config/env";
import { episodeSchema } from "../schemas/episode";
import { requireAuth } from "../middleware/auth.middleware";
import { queueLaunchNotification } from "../services/launch-notification.service";
import { episodeRepository } from "../repositories/episode.repository";

export const episodesRouter = Router();

const mediaDirectories = {
  audio: config.media.episodesDir,
  trailer: config.media.trailersDir,
  cover: config.media.coversDir,
  coverLow: config.media.coversLowDir,
};

const stagingDirectories = {
  audio: config.media.episodesStagingDir,
  trailer: config.media.trailersStagingDir,
  cover: config.media.coversStagingDir,
  coverLow: config.media.coversLowStagingDir,
};

const backupDirectories = {
  episodes: config.media.backupEpisodesDir,
  audio: config.media.backupEpisodesAudioDir,
  trailer: config.media.backupEpisodesTrailersDir,
  cover: config.media.backupEpisodesCoversDir,
  coverLow: config.media.backupEpisodesCoversLowDir,
};

for (const directory of [...Object.values(mediaDirectories), ...Object.values(stagingDirectories), ...Object.values(backupDirectories)]) {
  fs.mkdirSync(directory, { recursive: true });
}

type UploadKind = "audio" | "trailer" | "cover" | "coverLow";

type UploadSpec = {
  kind: UploadKind;
  field: "fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName";
  directory: string;
  stagingDirectory: string;
  buildFileName: (episodeId: number) => string;
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxBytes: number;
};

const uploadSpecs: Record<UploadKind, UploadSpec> = {
  audio: {
    kind: "audio",
    field: "fileName",
    directory: mediaDirectories.audio,
    stagingDirectory: stagingDirectories.audio,
    buildFileName: (episodeId) => `episode_${episodeId}.mp3`,
    allowedExtensions: [".mp3"],
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
    maxBytes: 500 * 1024 * 1024,
  },
  trailer: {
    kind: "trailer",
    field: "trailerFileName",
    directory: mediaDirectories.trailer,
    stagingDirectory: stagingDirectories.trailer,
    buildFileName: (episodeId) => `trailer_${episodeId}.mp3`,
    allowedExtensions: [".mp3"],
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
    maxBytes: 250 * 1024 * 1024,
  },
  cover: {
    kind: "cover",
    field: "coverFileName",
    directory: mediaDirectories.cover,
    stagingDirectory: stagingDirectories.cover,
    buildFileName: (episodeId) => `episode_${episodeId}.jpeg`,
    allowedExtensions: [".jpg", ".jpeg"],
    allowedMimeTypes: ["image/jpeg", "image/jpg"],
    maxBytes: 20 * 1024 * 1024,
  },
  coverLow: {
    kind: "coverLow",
    field: "coverLowFileName",
    directory: mediaDirectories.coverLow,
    stagingDirectory: stagingDirectories.coverLow,
    buildFileName: (episodeId) => `episode_${episodeId}.webp`,
    allowedExtensions: [".webp"],
    allowedMimeTypes: ["image/webp"],
    maxBytes: 10 * 1024 * 1024,
  },
};

const moveFile = async (sourcePath: string, targetPath: string): Promise<void> => {
  await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);

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
      destination: (_req, _file, callback) => callback(null, spec.stagingDirectory),
      filename: (req, _file, callback) => {
        const episodeId = Number(req.params.episodeId);
        const fileName =
          Number.isInteger(episodeId) && episodeId > 0
            ? spec.buildFileName(episodeId)
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
        res.json({ episodeId, [spec.field]: fileName });
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
      const currentFileName = (currentEpisode as any)?.[spec.field] || spec.buildFileName(episodeId);
      const finalPath = path.join(spec.directory, currentFileName);
      const stagingPath = path.join(spec.stagingDirectory, currentFileName);
      const backupPath = path.join(
        spec.kind === "audio"
          ? backupDirectories.audio
          : spec.kind === "trailer"
            ? backupDirectories.trailer
            : spec.kind === "cover"
              ? backupDirectories.cover
              : backupDirectories.coverLow,
        currentFileName
      );

      if (!currentEpisode && !(await findExistingFile([finalPath, stagingPath]))) {
        res.status(404).json({ message: "Episode not found" });
        return;
      }

      const movedToBackup = await moveExistingFileToBackup(finalPath, stagingPath, backupPath);

      if (!currentEpisode) {
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
    const stagingPath = path.join(spec.stagingDirectory, fileName);
    const finalPath = path.join(spec.directory, fileName);
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
    await queueLaunchNotification(created.episodeId);
    const finalDoc = Object.keys(mediaUpdates).length === 0
      ? episodeRepository.findByEpisodeId(created.episodeId)
      : episodeRepository.updateMedia(created.episodeId, mediaUpdates);
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
    const finalDoc = Object.keys(mediaUpdates).length === 0
      ? episodeRepository.findByEpisodeId(routeId)
      : episodeRepository.updateMedia(routeId, mediaUpdates);
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

    const snapshotPath = path.join(backupDirectories.episodes, `episode_${episodeId}.json`);
    await fs.promises.writeFile(snapshotPath, JSON.stringify(episode, null, 2), "utf8");

    for (const spec of Object.values(uploadSpecs)) {
      const currentFileName = (episode as any)[spec.field] || spec.buildFileName(episodeId);
      const finalPath = path.join(spec.directory, currentFileName);
      const stagingPath = path.join(spec.stagingDirectory, currentFileName);
      const backupDir =
        spec.kind === "audio"
          ? backupDirectories.audio
          : spec.kind === "trailer"
            ? backupDirectories.trailer
            : spec.kind === "cover"
              ? backupDirectories.cover
              : backupDirectories.coverLow;
      const backupPath = path.join(backupDir, currentFileName);
      await moveExistingFileToBackup(finalPath, stagingPath, backupPath);
    }

    episodeRepository.delete(episodeId);
    res.json({ episodeId, message: "Episode deleted" });
  } catch (error) {
    next(error);
  }
});
