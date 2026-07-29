import {
  cleanupExpiredEpisodeArtifactPreparations,
  initializeEpisodeArtifactPreparations,
  processNextEpisodeArtifactPreparation,
} from "../services/episode-artifact-preparation.service";

const pollIntervalMs = 30 * 1000;

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;
let recoveredAtStartup = false;

const runOnce = async (): Promise<void> => {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    try {
      // D-05 through D-07: polling cleans completed TTL rows before taking the FIFO job.
      await cleanupExpiredEpisodeArtifactPreparations();
      await initializeEpisodeArtifactPreparations({ recoverInterrupted: !recoveredAtStartup });
      recoveredAtStartup = true;
      await processNextEpisodeArtifactPreparation();
    } catch (_error) {
      console.error("Episode artifact preparation worker failed");
    }
  })().finally(() => {
    activeRun = null;
  });

  return activeRun;
};

export const startEpisodeArtifactPreparationWorker = async (): Promise<() => void> => {
  recoveredAtStartup = false;
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
