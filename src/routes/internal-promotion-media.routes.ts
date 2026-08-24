import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";

import { config } from "../config/env";
import { getEpisodePromotionMedia, isEpisodePromotionMediaError } from "../services/episode-promotion-media.service";

export const internalPromotionMediaRouter = Router();

const expectedAuthorization = (): Buffer => Buffer.from(`Bearer ${config.promotion.sharedSecret}`, "utf8");

const hasServiceAuthorization = (req: Request): boolean => {
  if (!config.promotion.sharedSecretConfigured) return false;
  const received = Buffer.from(req.get("authorization") ?? "", "utf8");
  const expected = expectedAuthorization();
  return received.length === expected.length && timingSafeEqual(received, expected);
};

const parseEpisodeId = (value: string | undefined): number | null => {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const episodeId = Number(value);
  return Number.isSafeInteger(episodeId) && episodeId > 0 ? episodeId : null;
};

internalPromotionMediaRouter.get("/:episodeId/trailer-video", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!config.promotion.sharedSecretConfigured) {
    res.status(503).json({ message: "Promotion media service is unavailable." });
    return;
  }
  if (!hasServiceAuthorization(req)) {
    res.status(401).json({ message: "Promotion media authorization failed." });
    return;
  }

  const episodeId = parseEpisodeId(req.params.episodeId);
  if (episodeId === null) {
    res.status(400).json({ message: "Invalid episode id." });
    return;
  }

  try {
    const media = await getEpisodePromotionMedia(episodeId);
    res.status(200);
    res.setHeader("Content-Type", media.mimeType);
    res.setHeader("Content-Length", String(media.byteCount));
    res.setHeader("X-Content-SHA256", media.sha256);
    res.setHeader("Digest", `sha-256=${Buffer.from(media.sha256, "hex").toString("base64")}`);
    media.stream.once("error", () => res.destroy());
    media.stream.pipe(res);
  } catch (error) {
    if (isEpisodePromotionMediaError(error)) {
      res.status(404).json({ message: "Canonical trailer media is unavailable." });
      return;
    }
    res.status(500).json({ message: "Canonical trailer media could not be served." });
  }
});
