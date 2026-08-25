import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { mapEpisodeToPublicDetail } from "../services/public-episode-catalog.service";

const CONTRACT_VERSION = "v1";

const hasServiceAuthorization = (req: Request): boolean => {
  if (!config.promotion.sharedSecretConfigured) return false;

  const received = Buffer.from(req.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${config.promotion.sharedSecret}`, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
};

const publicRequestOrigin = (): string => {
  try {
    return new URL(config.feed.site).origin;
  } catch {
    return "https://invalid.local";
  }
};

export const internalEpisodeRouter = Router();

internalEpisodeRouter.get("/episodes/latest", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!config.promotion.sharedSecretConfigured) {
    res.status(503).json({ contract_version: CONTRACT_VERSION, status: "unavailable", error_code: "service_not_configured" });
    return;
  }

  if (!hasServiceAuthorization(req)) {
    res.status(401).json({ message: "Service authentication failed." });
    return;
  }

  try {
    const episode = episodeRepository.listPublished(new Date())[0];
    if (!episode) {
      res.json({ contract_version: CONTRACT_VERSION, status: "empty" });
      return;
    }

    const publicDetail = mapEpisodeToPublicDetail(episode, { requestOrigin: publicRequestOrigin() });
    if (!publicDetail.audioUrl) {
      res.json({ contract_version: CONTRACT_VERSION, status: "unavailable", error_code: "missing_audio" });
      return;
    }

    res.json({
      contract_version: CONTRACT_VERSION,
      status: "available",
      episode: {
        episode_id: String(publicDetail.episodeId),
        title: publicDetail.title,
        summary: publicDetail.summary,
        published_at: publicDetail.pubDate,
        web_url: publicDetail.pageUrl,
        audio_url: publicDetail.audioUrl,
        image_url: publicDetail.coverUrl,
      },
    });
  } catch {
    res.status(503).json({ contract_version: CONTRACT_VERSION, status: "unavailable", error_code: "temporary_unavailable" });
  }
});
