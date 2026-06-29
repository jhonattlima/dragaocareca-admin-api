import { config } from "../config/env";
import { getYouTubeMetricsSnapshot } from "../services/youtube-metrics.service";

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (): Promise<void> => {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    const snapshot = await getYouTubeMetricsSnapshot(1);
    const sample = snapshot.series[snapshot.series.length - 1];
    if (sample) {
      console.log(
        `YouTube metrics sample stored for ${sample.date}; views=${sample.views}; watchTime=${sample.estimatedMinutesWatched}; netSubscribers=${sample.subscribersGained - sample.subscribersLost}`
      );
    }
  })().finally(() => {
    activeRun = null;
  });

  return activeRun;
};

export const startYouTubeMetricsWorker = async (): Promise<() => void> => {
  if (!config.youtube.enabled) {
    console.log("YouTube metrics worker disabled because YOUTUBE_METRICS_ENABLED is false");
    return () => undefined;
  }

  if (config.youtube.sampleIntervalMs <= 0) {
    console.log("YouTube metrics worker disabled by YOUTUBE_METRICS_SAMPLE_INTERVAL_MS");
    return () => undefined;
  }

  if (!config.youtube.clientId || !config.youtube.clientSecret || !config.youtube.refreshToken) {
    console.log("YouTube metrics worker disabled because YouTube credentials are missing");
    return () => undefined;
  }

  await runOnce().catch((error: unknown) => {
    console.error("YouTube metrics worker initial run failed", error);
  });
  pollTimer = setInterval(() => {
    void runOnce().catch((error: unknown) => {
      console.error("YouTube metrics worker failed", error);
    });
  }, config.youtube.sampleIntervalMs);

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
