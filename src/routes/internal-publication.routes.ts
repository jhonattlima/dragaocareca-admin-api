import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { getEpisodePublicationStatus, getRegisteredPublicationGroups } from "../services/episode-publication.service";

export const internalPublicationRouter = Router();

internalPublicationRouter.get("/groups", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ contractVersion: "episode-publication.v1", groups: getRegisteredPublicationGroups() });
});

internalPublicationRouter.get("/:episodeId", requireAuth, (req, res) => {
  const episodeId = Number(req.params.episodeId);
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    res.status(400).json({ message: "Invalid episode id." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ contractVersion: "episode-publication.v1", episodeId, effects: getEpisodePublicationStatus(episodeId) });
});
