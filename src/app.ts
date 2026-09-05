import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import { config } from "./config/env";
import { swaggerSpec } from "./docs/openapi";
import { authRouter } from "./routes/auth.routes";
import { assetsRouter } from "./routes/assets.routes";
import { episodesRouter } from "./routes/episodes.routes";
import { feedRouter } from "./routes/feed.routes";
import { metricsRouter } from "./routes/metrics.routes";
import { metaConnectionRouter } from "./routes/meta-connection.routes";
import { publicEpisodesRouter } from "./routes/public-episodes.routes";
import { publicSiteRouter } from "./routes/public-site.routes";
import { publicSupportersRouter } from "./routes/public-supporters.routes";
import { internalPromotionMediaRouter } from "./routes/internal-promotion-media.routes";
import { internalEpisodeRouter } from "./routes/internal-episode.routes";
import { internalPublicationRouter } from "./routes/internal-publication.routes";
import { episodeRepository } from "./database/repositories/episode.repository";
import fs from "node:fs";
import { getEpisodeProviderMedia } from "./services/episode-promotion-media.service";
import { getEpisodeMediaFinalPath } from "./services/episode-media-layout.service";

export const app = express();

const isProviderMediaExposed = (episodeId: number): boolean => {
  if (!config.meta.providerMediaExposureEnabled) return false;
  if (config.meta.providerMediaEpisodeId > 0 && episodeId === config.meta.providerMediaEpisodeId) return true;

  // Scheduled episodes remain private. Once an episode is released, expose
  // only its finalized trailer through the provider-specific MP4 route.
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) return false;
  const publicationDate = new Date(episode.pubDate);
  return Number.isFinite(publicationDate.getTime())
    && publicationDate <= new Date()
    && fs.existsSync(getEpisodeMediaFinalPath(episodeId, "trailerVideo"));
};

app.use(helmet());
app.use(
  cors({
    exposedHeaders: ["Content-Disposition", "X-Missing-Artifacts"],
  }),
);
app.use(morgan("[:date[iso]] :method :url :status :response-time ms - :res[content-length]"));
app.use(express.json({ limit: "4mb" }));
app.use("/media/episodes/:episodeId/trailer.mp4", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && isProviderMediaExposed(Number(req.params.episodeId))) {
    void getEpisodeProviderMedia(Number(req.params.episodeId)).then((media) => {
      const range = req.get("range");
      const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      let start = 0;
      let end = media.byteCount - 1;
      if (range && (!match || (!match[1] && !match[2]))) { res.status(416).setHeader("Content-Range", `bytes */${media.byteCount}`).end(); return; }
      if (match?.[1]) start = Number(match[1]);
      if (match?.[2]) end = Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= media.byteCount) { res.status(416).setHeader("Content-Range", `bytes */${media.byteCount}`).end(); return; }
      end = Math.min(end, media.byteCount - 1);
      res.status(range ? 206 : 200).set({ "Content-Type": media.mimeType, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${media.byteCount}` } : {}) });
      fs.createReadStream(media.filePath, { start, end }).on("error", () => res.destroy()).pipe(res);
    }).catch(() => res.status(404).json({ message: "Media resource is unavailable." }));
    return;
  }
  next();
});
app.use("/media/episodes/:episodeId/trailer.mp4", (_req, res) => {
  res.status(404).json({ message: "Media resource is unavailable." });
});
// A low-resolution cover is an optimization, not a publication requirement.
// Keep the stable low-cover URL usable when a derivative is missing during a
// legacy migration or an interrupted upload by serving the canonical cover.
app.get("/media/episodes/:episodeId/cover_low.webp", (req, res, next) => {
  const episodeId = Number(req.params.episodeId);
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    next();
    return;
  }

  const lowPath = getEpisodeMediaFinalPath(episodeId, "coverLow");
  const canonicalPath = getEpisodeMediaFinalPath(episodeId, "cover");
  if (fs.existsSync(lowPath)) {
    next();
    return;
  }
  if (fs.existsSync(canonicalPath)) {
    res.sendFile(canonicalPath, { headers: { "Cache-Control": "no-cache" } });
    return;
  }
  next();
});
app.use(
  "/media",
  express.static(config.media.storageRoot, {
    setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
  }),
);
app.use("/internal/promotion-media", internalPromotionMediaRouter);
app.use("/internal/v1", internalEpisodeRouter);
app.use("/internal/publication", internalPublicationRouter);

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
app.use("/v1/assets", assetsRouter);
app.use("/v1/public/episodes", publicEpisodesRouter);
app.use("/v1/public", publicSiteRouter);
app.use("/v1/public/supporters", publicSupportersRouter);
app.use("/v1/episodes", episodesRouter);
app.use("/v1/feed", feedRouter);
app.use("/v1/metrics", metricsRouter);
app.use("/v1/meta-connection", metaConnectionRouter);

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
