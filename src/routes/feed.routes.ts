import { Router } from "express";
import { EpisodeModel } from "../models/Episode";
import { requireAuth } from "../middleware/auth.middleware";
import { buildFeedXml } from "../services/feed.service";

export const feedRouter = Router();

feedRouter.get("/", async (_req, res, next) => {
  try {
    const now = new Date();
    const episodes = await EpisodeModel.find({ pubDate: { $lte: now } })
      .sort({ pubDate: -1, episodeId: -1 })
      .lean();

    const xml = buildFeedXml(episodes as never[]);
    res.type("application/rss+xml").send(xml);
  } catch (error) {
    next(error);
  }
});

feedRouter.get("/preview", requireAuth, async (_req, res, next) => {
  try {
    const episodes = await EpisodeModel.find()
      .sort({ pubDate: -1, episodeId: -1 })
      .lean();

    const xml = buildFeedXml(episodes as never[]);
    res.type("application/rss+xml").send(xml);
  } catch (error) {
    next(error);
  }
});

feedRouter.get("/status", requireAuth, async (_req, res, next) => {
  try {
    const now = new Date();
    const [publishedCount, scheduledCount, nextScheduled] = await Promise.all([
      EpisodeModel.countDocuments({ pubDate: { $lte: now } }),
      EpisodeModel.countDocuments({ pubDate: { $gt: now } }),
      EpisodeModel.findOne({ pubDate: { $gt: now } }).sort({ pubDate: 1, episodeId: 1 }).lean(),
    ]);

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
