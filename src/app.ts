import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import { config } from "./config/env";
import { swaggerSpec } from "./docs/openapi";
import { authRouter } from "./routes/auth.routes";
import { episodesRouter } from "./routes/episodes.routes";
import { feedRouter } from "./routes/feed.routes";
import { metricsRouter } from "./routes/metrics.routes";
import { episodeRepository } from "./repositories/episode.repository";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "4mb" }));

app.get("/health", async (_req, res, next) => {
  try {
    const missingTelegramConfig: string[] = [];
    if (!config.telegram.botToken) missingTelegramConfig.push("TELEGRAM_BOT_TOKEN");
    if (!config.telegram.chatId) missingTelegramConfig.push("TELEGRAM_CHAT_ID");
    if (config.telegram.pollIntervalMs <= 0) missingTelegramConfig.push("TELEGRAM_POLL_INTERVAL_MS");
    const botEnabled = missingTelegramConfig.length === 0;
    const now = new Date();
    const nextPendingEpisode = episodeRepository.findNextScheduled(now);

    res.json({
      status: "ok",
      uptime: process.uptime(),
      bot: {
        enabled: botEnabled,
        running: botEnabled,
        reason: botEnabled ? null : `Missing or disabled Telegram config: ${missingTelegramConfig.join(", ")}`,
        pendingLaunchNotifications: episodeRepository.getPendingLaunchNotifications().length,
        lastQueuedAt: null,
        nextPendingEpisode: nextPendingEpisode
          ? {
              episodeId: nextPendingEpisode.episodeId,
              title: nextPendingEpisode.title,
              pubDate: nextPendingEpisode.pubDate,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get("/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});

app.use("/v1/auth", authRouter);
app.use("/v1/episodes", episodesRouter);
app.use("/v1/feed", feedRouter);
app.use("/v1/metrics", metricsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Validation failed", issues: error.issues });
    return;
  }

  if (error instanceof Error) {
    const authConfigError =
      error.message.includes("GOOGLE_CLIENT_ID") || error.message.includes("JWT_SECRET");
    res.status(authConfigError ? 500 : 400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected error" });
});
