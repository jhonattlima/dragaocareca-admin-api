import { app } from "./app";
import { config } from "./config/env";
import { connectDb } from "./database/connect";
import { refreshCoverMosaicBackground } from "./services/cover-mosaic.service";
import { migrateEpisodeMediaLayout } from "./services/episode-media-layout.service";
import { startEpisodeTranscriptionWorker } from "./services/episode-transcription.service";
import { startEpisodeArtifactPreparationWorker } from "./workers/episode-artifact-preparation.worker";
import { startLaunchNotificationWorker } from "./workers/launch-notification.worker";
import { startSpotifyMetricsWorker } from "./workers/spotify-metrics.worker";
import { startYouTubeMetricsWorker } from "./workers/youtube-metrics.worker";
import { startTelegramBotWorker } from "./services/telegram-bot.worker";

const backgroundWorkersDisabled =
  (process.env.DISABLE_BACKGROUND_WORKERS ?? "false").toLowerCase() === "true";
const metricsWorkersEnabled =
  (process.env.ENABLE_METRICS_WORKERS ?? "false").toLowerCase() === "true";
const telegramWorkersEnabled =
  (process.env.ENABLE_TELEGRAM_WORKERS ?? "false").toLowerCase() === "true";
const transcriptionWorkerEnabled =
  (process.env.ENABLE_TRANSCRIPTION_WORKER ?? "false").toLowerCase() === "true";

const bootstrap = async (): Promise<void> => {
  await connectDb();
  await migrateEpisodeMediaLayout().catch((error: unknown) => {
    console.warn("Episode media layout migration skipped", error instanceof Error ? error.message : String(error));
  });
  await refreshCoverMosaicBackground().catch((error: unknown) => {
    console.warn("Cover mosaic background generation skipped", error instanceof Error ? error.message : String(error));
  });

  // Artifact jobs only prepare local episode files. Keep this worker available even when
  // integrations that depend on external credentials are intentionally disabled.
  await startEpisodeArtifactPreparationWorker();

  if (backgroundWorkersDisabled) {
    console.info("External background workers disabled by DISABLE_BACKGROUND_WORKERS=true");

    if (metricsWorkersEnabled) {
      console.info("Metrics workers enabled explicitly while other external workers remain disabled");
      await startSpotifyMetricsWorker();
      await startYouTubeMetricsWorker();
    }

    if (telegramWorkersEnabled) {
      console.info("Telegram workers enabled explicitly while other external workers remain disabled");
      await startLaunchNotificationWorker();
      await startTelegramBotWorker();
    }

    if (transcriptionWorkerEnabled) {
      console.info("Transcription worker enabled explicitly while other external workers remain disabled");
      await startEpisodeTranscriptionWorker();
    }
  } else {
    await startEpisodeTranscriptionWorker();
    await startLaunchNotificationWorker();
    await startSpotifyMetricsWorker();
    await startYouTubeMetricsWorker();
    await startTelegramBotWorker();
  }

  app.listen(config.port, () => {
    console.log(`dragaocareca-admin-api running on port ${config.port}`);
  });
};

bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
