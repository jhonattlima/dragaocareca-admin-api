import { Router } from "express";
import { episodeRepository } from "../repositories/episode.repository";
import { requireAuth } from "../middleware/auth.middleware";
import { buildFeedXml } from "../services/feed.service";

export const feedRouter = Router();

feedRouter.get("/", async (_req, res, next) => {
  try {
    const now = new Date();
    const episodes = episodeRepository.listPublished(now);

    const xml = buildFeedXml(episodes as never[]);
    res.type("application/rss+xml").send(xml);
  } catch (error) {
    next(error);
  }
});

feedRouter.get("/preview", requireAuth, async (_req, res, next) => {
  try {
    const episodes = episodeRepository.listPreview();

    const xml = buildFeedXml(episodes as never[]);
    res.type("application/rss+xml").send(xml);
  } catch (error) {
    next(error);
  }
});

feedRouter.get("/status", requireAuth, async (_req, res, next) => {
  try {
    const now = new Date();
    const publishedCount = episodeRepository.countPublished(now);
    const scheduledCount = episodeRepository.countScheduled(now);
    const nextScheduled = episodeRepository.findNextScheduled(now);

    res.json({
      generatedAt: now.toISOString(),
      publishedCount,
      scheduledCount,
      nextScheduled: nextScheduled
        ? {
            episodeId: nextScheduled.episodeId,
            pubDate: nextScheduled.pubDate,
            title: nextScheduled.title,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});
