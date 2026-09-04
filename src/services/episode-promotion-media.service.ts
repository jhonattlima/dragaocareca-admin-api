import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getEpisodeMediaFinalPath } from "./episode-media-layout.service";

export type EpisodePromotionMedia = {
  filePath: string;
  byteCount: number;
  sha256: string;
  mimeType: "video/mp4";
  stream: fs.ReadStream;
};

const execFileAsync = promisify(execFile);
const providerMediaJobs = new Map<string, Promise<string>>();

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

const ensureProviderCompatibleMedia = async (canonicalPath: string): Promise<string> => {
  const providerPath = path.join(path.dirname(canonicalPath), "trailer.provider.mp4");
  const sourceStats = await fs.promises.lstat(canonicalPath);
  const cachedStats = await fs.promises.lstat(providerPath).catch(() => null);
  if (cachedStats?.isFile() && cachedStats.size > 0 && cachedStats.mtimeMs >= sourceStats.mtimeMs) {
    return providerPath;
  }

  const active = providerMediaJobs.get(canonicalPath);
  if (active) return active;

  const job = (async () => {
    const temporaryPath = `${providerPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await execFileAsync("ffmpeg", [
        "-v", "error",
        "-i", canonicalPath,
        "-map", "0",
        "-c", "copy",
        "-movflags", "+faststart",
        "-y", temporaryPath,
      ]);
      const outputStats = await fs.promises.lstat(temporaryPath);
      if (!outputStats.isFile() || outputStats.size <= 0) throw new Error("Provider-compatible trailer is empty.");
      await fs.promises.rename(temporaryPath, providerPath);
      return providerPath;
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  })();
  providerMediaJobs.set(canonicalPath, job);
  try {
    return await job;
  } finally {
    providerMediaJobs.delete(canonicalPath);
  }
};

export const getEpisodeProviderMedia = async (episodeId: number): Promise<EpisodePromotionMedia> => {
  if (!validEpisodeId(episodeId)) {
    throw new EpisodePromotionMediaError("Canonical trailer media is unavailable.");
  }
  const canonicalPath = path.resolve(getEpisodeMediaFinalPath(episodeId, "trailerVideo"));
  const stats = await fs.promises.lstat(canonicalPath).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0) {
    throw new EpisodePromotionMediaError("Canonical trailer media is unavailable.");
  }
  return readEpisodePromotionMedia(await ensureProviderCompatibleMedia(canonicalPath));
};

const readEpisodePromotionMedia = async (filePath: string): Promise<EpisodePromotionMedia> => {
  const stats = await fs.promises.lstat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0) {
    throw new EpisodePromotionMediaError("Canonical trailer media is unavailable.");
  }
  const hash = createHash("sha256");
  let byteCount = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    byteCount += buffer.length;
  }
  const finalStats = await fs.promises.lstat(filePath).catch(() => null);
  if (!finalStats?.isFile() || finalStats.size !== byteCount || finalStats.size !== stats.size) {
    throw new EpisodePromotionMediaError("Canonical trailer media changed during handoff.");
  }
  return { filePath, byteCount, sha256: hash.digest("hex"), mimeType: "video/mp4", stream: fs.createReadStream(filePath) };
};

export const isEpisodePromotionMediaError = (error: unknown): boolean =>
  error instanceof EpisodePromotionMediaError;
