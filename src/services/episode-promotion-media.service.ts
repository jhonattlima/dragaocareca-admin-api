import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getEpisodeMediaFinalPath } from "./episode-media-layout.service";

export type EpisodePromotionMedia = {
  filePath: string;
  byteCount: number;
  sha256: string;
  mimeType: "video/mp4";
  stream: fs.ReadStream;
};

class EpisodePromotionMediaError extends Error {
  readonly code = "missing_media" as const;
}

const validEpisodeId = (episodeId: number): boolean =>
  Number.isSafeInteger(episodeId) && episodeId > 0;

export const getEpisodePromotionMedia = async (episodeId: number): Promise<EpisodePromotionMedia> => {
  if (!validEpisodeId(episodeId)) {
    throw new EpisodePromotionMediaError("Canonical trailer media is unavailable.");
  }

  const filePath = path.resolve(getEpisodeMediaFinalPath(episodeId, "trailerVideo"));
  const stats = await fs.promises.lstat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0) {
    throw new EpisodePromotionMediaError("Canonical trailer media is unavailable.");
  }

  const hash = createHash("sha256");
  let byteCount = 0;
  try {
    for await (const chunk of fs.createReadStream(filePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      byteCount += buffer.length;
    }
  } catch {
    throw new EpisodePromotionMediaError("Canonical trailer media is unavailable.");
  }

  const finalStats = await fs.promises.lstat(filePath).catch(() => null);
  if (!finalStats?.isFile() || finalStats.size !== byteCount || finalStats.size !== stats.size) {
    throw new EpisodePromotionMediaError("Canonical trailer media changed during handoff.");
  }

  return {
    filePath,
    byteCount,
    sha256: hash.digest("hex"),
    mimeType: "video/mp4",
    stream: fs.createReadStream(filePath),
  };
};

export const isEpisodePromotionMediaError = (error: unknown): boolean =>
  error instanceof EpisodePromotionMediaError;
