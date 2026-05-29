import { Router } from "express";
import { EpisodeModel } from "../models/Episode";
import { episodeSchema } from "../schemas/episode";
import { requireAuth } from "../middleware/auth.middleware";

export const episodesRouter = Router();

episodesRouter.get("/", requireAuth, async (_req, res, next) => {
  try {
    const episodes = await EpisodeModel.find().sort({ pubDate: -1, episodeId: -1 }).lean();
    res.json(episodes);
  } catch (error) {
    next(error);
  }
});

episodesRouter.get("/:episodeId", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    const episode = await EpisodeModel.findOne({ episodeId }).lean();
    if (!episode) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }
    res.json(episode);
  } catch (error) {
    next(error);
  }
});

episodesRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const payload = episodeSchema.parse(req.body);
    const created = await EpisodeModel.create(payload);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

episodesRouter.put("/:episodeId", requireAuth, async (req, res, next) => {
  try {
    const routeId = Number(req.params.episodeId);
    const payload = episodeSchema.parse({ ...req.body, episodeId: routeId });
    const updated = await EpisodeModel.findOneAndUpdate(
      { episodeId: routeId },
      payload,
      { new: true, upsert: false }
    ).lean();

    if (!updated) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});
