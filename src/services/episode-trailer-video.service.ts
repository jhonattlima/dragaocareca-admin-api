import fs from "node:fs";
import path from "node:path";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
import { trailerPromotionJournalRepository } from "../database/repositories/trailer-promotion-journal.repository";
import { getEpisodeMediaStagingPath } from "./episode-media-layout.service";
import { finalizeManualTrailerVideo } from "./trailer-candidate-approval.service";

export const replaceEpisodeTrailerVideo = async (
  episodeId: number,
  stagedFilePath: string,
): Promise<EpisodeRow | null> => {
  const expectedStagingPath = getEpisodeMediaStagingPath(episodeId, "trailerVideo");
  if (path.resolve(stagedFilePath) !== path.resolve(expectedStagingPath)) {
    throw new Error("Invalid trailer-video upload staging file");
  }
  if (!episodeRepository.findByEpisodeId(episodeId)) return null;

  try {
    await finalizeManualTrailerVideo(episodeId, stagedFilePath);
  } catch (error) {
    const pending = trailerPromotionJournalRepository.listUnfinished().some((journal) => journal.episodeId === episodeId && journal.candidateId === null);
    if (pending) {
      if (error && typeof error === "object") Object.assign(error, { preserveTrailerVideoStaging: true });
    } else {
      await fs.promises.rm(stagedFilePath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
  return episodeRepository.findByEpisodeId(episodeId);
};
