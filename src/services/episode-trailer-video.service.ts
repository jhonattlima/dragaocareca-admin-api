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
    if (trailerPromotionJournalRepository.listUnfinished().some((journal) => journal.episodeId === episodeId && journal.candidateId === null)) {
      if (error && typeof error === "object") Object.assign(error, { preserveTrailerVideoStaging: true });
    }
    throw error;
  }
  return episodeRepository.findByEpisodeId(episodeId);
};
