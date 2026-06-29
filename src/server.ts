import { app } from "./app";
import { config } from "./config/env";
import { connectDb } from "./database/connect";
import { refreshCoverMosaicBackground } from "./services/cover-mosaic.service";
import { startLaunchNotificationWorker } from "./workers/launch-notification.worker";
import { startSpotifyMetricsWorker } from "./workers/spotify-metrics.worker";
import { startYouTubeMetricsWorker } from "./workers/youtube-metrics.worker";
import { startTelegramBotWorker } from "./services/telegram-bot.worker";

const bootstrap = async (): Promise<void> => {
  await connectDb();
  await refreshCoverMosaicBackground().catch((error: unknown) => {
    console.warn("Cover mosaic background generation skipped", error instanceof Error ? error.message : String(error));
  });
  await startLaunchNotificationWorker();
  await startSpotifyMetricsWorker();
  await startYouTubeMetricsWorker();
  await startTelegramBotWorker();
  app.listen(config.port, () => {
    console.log(`dragaocareca-admin-api running on port ${config.port}`);
  });
};

bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
