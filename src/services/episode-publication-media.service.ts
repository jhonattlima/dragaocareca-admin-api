import { createHash } from "node:crypto";
import fs from "node:fs";
import { getEpisodeMediaFinalPath } from "./episode-media-layout.service";
import type { PublicationPreflight, PublicationSource } from "../schemas/episode-publication";

export const preflightEpisodePublicationMedia = async (episodeId: number): Promise<{ source: PublicationSource; preflight: PublicationPreflight }> => {
  const filePath = getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  const stats = await fs.promises.lstat(filePath).catch(() => null);
  const checkedAt = new Date().toISOString();
  if (!stats?.isFile() || stats.size <= 0) {
    throw Object.assign(new Error("Finalized trailer media is missing or not a regular file."), { category: "missing_media" as const });
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
  }
  const finalStats = await fs.promises.lstat(filePath).catch(() => null);
  if (!finalStats?.isFile() || finalStats.size !== bytes || finalStats.size !== stats.size) {
    throw Object.assign(new Error("Finalized trailer media changed during preflight."), { category: "digest_mismatch" as const });
  }
  const source = { mediaReference: `episodes/${episodeId}/trailer.mp4`, sha256: hash.digest("hex"), byteCount: bytes, mimeType: "video/mp4" as const };
  return { source, preflight: { status: "ready", checkedAt, providerReachability: "ready", contentType: "video/mp4", contentLength: bytes, rangeSupported: true, failureCategory: null } };
};
