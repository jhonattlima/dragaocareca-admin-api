import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { recoverSuggestedTagsAuthoring } from "../services/episode-summary.service";

const pollIntervalMs = 30 * 1000;

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

export const runEpisodeHashtagAuthoringWorkerOnce = async (): Promise<void> => {
  for (const episode of episodeRepository.listAll()) {
    await recoverSuggestedTagsAuthoring(episode.episodeId);
  }
};

export const startEpisodeHashtagAuthoringWorker = async (): Promise<() => void> => {
  if (!config.youtube.hashtagAuthoring.enabled) {
    console.info("Episode hashtag authoring worker disabled by YOUTUBE_HASHTAG_AUTHORING_ENABLED=false");
    return () => undefined;
  }

  const runOnce = async (): Promise<void> => {
    if (activeRun) return activeRun;
    activeRun = runEpisodeHashtagAuthoringWorkerOnce()
      .catch((error: unknown) => {
        console.error("Episode hashtag authoring worker failed", error);
      })
      .finally(() => {
        activeRun = null;
      });
    return activeRun;
  };

  await runOnce();
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void runOnce();
    }, pollIntervalMs);
    pollTimer.unref();
  }

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
