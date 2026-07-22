import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";

export type EpisodeMediaKind = "audio" | "trailer" | "cover" | "coverLow" | "transcript";

const kindFileName = (episodeId: number, kind: EpisodeMediaKind): string => {
  switch (kind) {
    case "audio":
      return "audio.mp3";
    case "trailer":
      return "trailer.mp3";
    case "cover":
      return "cover.jpeg";
    case "coverLow":
      return "cover.webp";
    case "transcript":
      return "transcript.txt";
  }
};

const legacyMediaDirectories: Record<Exclude<EpisodeMediaKind, "transcript">, string> = {
  audio: path.resolve(config.media.storageRoot, "episodes"),
  trailer: path.resolve(config.media.storageRoot, "trailers"),
  cover: path.resolve(config.media.storageRoot, "images"),
  coverLow: path.resolve(config.media.storageRoot, "images", "low"),
};

const legacyFileName = (episodeId: number, kind: Exclude<EpisodeMediaKind, "transcript">): string => {
  switch (kind) {
    case "audio":
      return `episode_${episodeId}.mp3`;
    case "trailer":
      return `trailer_${episodeId}.mp3`;
    case "cover":
      return `episode_${episodeId}.jpeg`;
    case "coverLow":
      return `episode_${episodeId}.webp`;
  }
};

export const getEpisodeMediaRelativePath = (episodeId: number, kind: EpisodeMediaKind): string =>
  path.posix.join("episodes", String(episodeId), kindFileName(episodeId, kind));

export const getEpisodeMediaDirectory = (episodeId: number): string =>
  path.resolve(config.media.storageRoot, "episodes", String(episodeId));

export const getEpisodeMediaStagingDirectory = (episodeId: number): string =>
  path.resolve(config.media.episodesStagingDir, String(episodeId));

export const getEpisodeMediaBackupDirectory = (episodeId: number): string =>
  path.resolve(config.media.backupEpisodesDir, String(episodeId));

export const getEpisodeMediaDraftTranscriptPath = (episodeId: number): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), "transcript.txt");

export const getEpisodeMediaDraftTranscriptionStatePath = (episodeId: number): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), "transcript.state.json");

export const getEpisodeMediaFinalPath = (episodeId: number, kind: EpisodeMediaKind): string =>
  path.resolve(getEpisodeMediaDirectory(episodeId), kindFileName(episodeId, kind));

export const getEpisodeMediaStagingPath = (episodeId: number, kind: Exclude<EpisodeMediaKind, "transcript">): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), kindFileName(episodeId, kind));

export const getEpisodeMediaBackupPath = (episodeId: number, kind: Exclude<EpisodeMediaKind, "transcript">): string =>
  path.join(getEpisodeMediaBackupDirectory(episodeId), kindFileName(episodeId, kind));

const ensureParentDir = async (filePath: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

export const moveFile = async (sourcePath: string, targetPath: string): Promise<void> => {
  await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
  await ensureParentDir(targetPath);

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

export const findExistingEpisodeMediaPath = async (
  episodeId: number,
  kind: EpisodeMediaKind,
  currentFileName?: string | null
): Promise<string | null> => {
  const candidates: string[] = [];

  if (currentFileName) {
    candidates.push(path.isAbsolute(currentFileName) ? currentFileName : path.resolve(config.media.storageRoot, currentFileName));
  }

  if (kind !== "transcript") {
    candidates.push(getEpisodeMediaFinalPath(episodeId, kind));
    if (kind === "audio") {
      candidates.push(getEpisodeMediaStagingPath(episodeId, kind));
    }
    candidates.push(path.join(legacyMediaDirectories[kind], legacyFileName(episodeId, kind)));
  } else {
    candidates.push(getEpisodeMediaFinalPath(episodeId, kind));
    candidates.push(path.join(config.media.episodesDir, `episode_${episodeId}.txt`));
    candidates.push(path.join(config.media.episodesDir, `${episodeId}.txt`));
  }

  for (const candidate of candidates) {
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

export const episodeMediaFieldForKind = (kind: Exclude<EpisodeMediaKind, "transcript">): "fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName" => {
  switch (kind) {
    case "audio":
      return "fileName";
    case "trailer":
      return "trailerFileName";
    case "cover":
      return "coverFileName";
    case "coverLow":
      return "coverLowFileName";
  }
};

export const migrateEpisodeMediaLayout = async (): Promise<{ episodesProcessed: number; filesMoved: number }> => {
  const episodes = episodeRepository.listAll();
  let filesMoved = 0;

  for (const episode of episodes) {
    const updates: Partial<Record<"fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName" | "transcriptFileName", string | null>> = {};

    const mediaKinds: Array<{ kind: Exclude<EpisodeMediaKind, "transcript">; field: "fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName" }> = [
      { kind: "audio", field: "fileName" },
      { kind: "trailer", field: "trailerFileName" },
      { kind: "cover", field: "coverFileName" },
      { kind: "coverLow", field: "coverLowFileName" },
    ];

    for (const { kind, field } of mediaKinds) {
      const finalPath = getEpisodeMediaFinalPath(episode.episodeId, kind);
      const storedFileName = (episode as any)[field] as string | undefined;
      const currentPath = await findExistingEpisodeMediaPath(episode.episodeId, kind, storedFileName);

      if (!currentPath) {
        continue;
      }

      if (currentPath !== finalPath) {
        await moveFile(currentPath, finalPath);
        filesMoved += 1;
      }

      const nextFileName = getEpisodeMediaRelativePath(episode.episodeId, kind);
      if (storedFileName !== nextFileName) {
        updates[field] = nextFileName;
      }
    }

    const transcriptCurrent = await findExistingEpisodeMediaPath(episode.episodeId, "transcript", episode.transcriptFileName ?? null);
    if (transcriptCurrent) {
      const transcriptFinal = getEpisodeMediaFinalPath(episode.episodeId, "transcript");
      if (transcriptCurrent !== transcriptFinal) {
        await moveFile(transcriptCurrent, transcriptFinal);
        filesMoved += 1;
      }

      const nextTranscriptName = getEpisodeMediaRelativePath(episode.episodeId, "transcript");
      if (episode.transcriptFileName !== nextTranscriptName) {
        updates.transcriptFileName = nextTranscriptName;
      }
    }

    if (Object.keys(updates).length > 0) {
      episodeRepository.updateMedia(episode.episodeId, {
        fileName: updates.fileName ?? undefined,
        trailerFileName: updates.trailerFileName ?? undefined,
        coverFileName: updates.coverFileName ?? undefined,
        coverLowFileName: updates.coverLowFileName ?? undefined,
      });

      if (updates.transcriptFileName) {
        episodeRepository.markTranscriptionDone(episode.episodeId, updates.transcriptFileName);
      }
    }
  }

  return {
    episodesProcessed: episodes.length,
    filesMoved,
  };
};
