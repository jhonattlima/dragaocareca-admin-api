import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
import {
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
  getEpisodeMediaStagingPath,
} from "./episode-media-layout.service";

const fileExists = async (filePath: string): Promise<boolean> =>
  fs.promises
    .lstat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);

const temporaryReplacementPath = (finalPath: string, suffix: string): string =>
  path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${suffix}-${randomUUID()}`);

export const replaceEpisodeTrailerVideo = async (
  episodeId: number,
  stagedFilePath: string
): Promise<EpisodeRow | null> => {
  const expectedStagingPath = getEpisodeMediaStagingPath(episodeId, "trailerVideo");
  const finalPath = getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  const preparedPath = temporaryReplacementPath(finalPath, "upload");
  const previousPath = temporaryReplacementPath(finalPath, "previous");
  let previousCopied = false;
  let promoted = false;

  try {
    if (path.resolve(stagedFilePath) !== path.resolve(expectedStagingPath)) {
      throw new Error("Invalid trailer-video upload staging file");
    }

    const episode = episodeRepository.findByEpisodeId(episodeId);
    if (!episode) {
      return null;
    }

    if (!(await fileExists(stagedFilePath))) {
      throw new Error("Trailer-video upload is missing");
    }

    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
    if (await fileExists(finalPath)) {
      await fs.promises.copyFile(finalPath, previousPath);
      previousCopied = true;
    }

    await fs.promises.copyFile(stagedFilePath, preparedPath);
    await fs.promises.rename(preparedPath, finalPath);
    promoted = true;

    const updated = episodeRepository.updateMedia(episodeId, {
      trailerVideoFileName: getEpisodeMediaRelativePath(episodeId, "trailerVideo"),
      trailerVideoSyncStatus:
        episode.trailerVideoFileName || episode.youtube ? "manual-sync-required" : "unpublished",
    });
    if (!updated) {
      throw new Error("Episode not found");
    }

    return updated;
  } catch (error) {
    if (promoted) {
      await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
      if (previousCopied) {
        await fs.promises.rename(previousPath, finalPath).catch(() => undefined);
        previousCopied = false;
      }
    }
    throw error;
  } finally {
    if (path.resolve(stagedFilePath) === path.resolve(expectedStagingPath)) {
      await fs.promises.rm(stagedFilePath, { force: true }).catch(() => undefined);
    }
    await fs.promises.rm(preparedPath, { force: true }).catch(() => undefined);
    if (previousCopied) {
      await fs.promises.rm(previousPath, { force: true }).catch(() => undefined);
    }
  }
};
