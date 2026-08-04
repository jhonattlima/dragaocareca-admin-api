import { config } from "../config/env";
import {
  initializeYoutubeTrailerJobs,
  processNextYoutubeTrailerJob,
} from "../services/youtube-trailer-job.service";
import { createLiveYoutubeTrailerUploadProvider, type YoutubeTrailerUploadProvider } from "../services/youtube-trailer-upload.provider";

type WorkerRunOptions = {
  provider?: YoutubeTrailerUploadProvider;
  recoverInterrupted: boolean;
};

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;
let recoveredAtStartup = false;

export const runYoutubeTrailerJobWorkerOnce = async ({
  provider = createLiveYoutubeTrailerUploadProvider(),
  recoverInterrupted,
}: WorkerRunOptions): Promise<void> => {
  if (recoverInterrupted) await initializeYoutubeTrailerJobs();
  await processNextYoutubeTrailerJob({ provider });
};

const runOnce = async (provider: YoutubeTrailerUploadProvider): Promise<void> => {
  if (activeRun) return activeRun;
  activeRun = (async () => {
    try {
      await runYoutubeTrailerJobWorkerOnce({ provider, recoverInterrupted: !recoveredAtStartup });
      recoveredAtStartup = true;
    } catch (_error) {
      console.error("YouTube trailer job worker failed");
    }
  })().finally(() => {
    activeRun = null;
  });
  return activeRun;
};

export const startYoutubeTrailerJobWorker = async (
  provider: YoutubeTrailerUploadProvider = createLiveYoutubeTrailerUploadProvider()
): Promise<() => void> => {
  recoveredAtStartup = false;
  await runOnce(provider);
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void runOnce(provider);
    }, config.youtube.trailerJob.processingPollIntervalMs);
    pollTimer.unref();
  }
  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
