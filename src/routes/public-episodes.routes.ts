import { type Request, Router } from "express";
import { episodeRepository } from "../database/repositories/episode.repository";
import { mapEpisodeToPublicDetail, mapEpisodesToPublicCatalog } from "../services/public-episode-catalog.service";

export const publicEpisodesRouter = Router();

const requestOrigin = (protocol: string, host: string): string => `${protocol}://${host}`;
const isPublished = (pubDate: string, now: Date): boolean => Date.parse(pubDate) <= now.getTime();
const parseEpisodeId = (value: string): number | null => {
  const episodeId = Number(value);
  return Number.isInteger(episodeId) && episodeId > 0 ? episodeId : null;
};
const resolveRequestOrigin = (req: Request): string => {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get("host");

  if (!host) {
    throw new Error("Could not determine request host for public episode URLs");
  }

  return requestOrigin(protocol, host);
};

publicEpisodesRouter.get("/", async (req, res, next) => {
  try {
    const episodes = episodeRepository.listPublished(new Date());
    const items = mapEpisodesToPublicCatalog(episodes, {
      requestOrigin: resolveRequestOrigin(req),
    });

    res.json(items);
  } catch (error) {
    next(error);
  }
});

publicEpisodesRouter.get("/:episodeId", async (req, res, next) => {
  try {
    const episodeId = parseEpisodeId(req.params.episodeId);
    if (episodeId === null) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    const episode = episodeRepository.findByEpisodeId(episodeId);
    const now = new Date();

    if (!episode || !isPublished(episode.pubDate, now)) {
      res.status(404).json({ message: "Episode not found" });
      return;
    }

    const item = mapEpisodeToPublicDetail(episode, {
      requestOrigin: resolveRequestOrigin(req),
    });

    res.json(item);
  } catch (error) {
    next(error);
  }
});
