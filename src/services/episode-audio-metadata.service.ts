import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type EpisodeAudioMetadata = {
  durationSeconds: number;
  bytes: number;
};

export type NormalizedEpisodeAudioMetadata = {
  duration: string;
  bytes: number;
};

const normalizeSeconds = (seconds: number): string => {
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
};

export const normalizeEpisodeAudioMetadata = (
  metadata: EpisodeAudioMetadata,
): NormalizedEpisodeAudioMetadata => {
  if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
    throw new Error("Episode audio duration metadata is missing or invalid");
  }
  if (!Number.isInteger(metadata.bytes) || metadata.bytes < 0) {
    throw new Error("Episode audio bytes metadata is missing or invalid");
  }
  return { duration: normalizeSeconds(metadata.durationSeconds), bytes: metadata.bytes };
};

export const extractEpisodeAudioMetadata = async (
  filePath: string,
): Promise<NormalizedEpisodeAudioMetadata> => {
  const stat = await fs.stat(filePath);
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
  const durationSeconds = Number(String(stdout).trim());
  return normalizeEpisodeAudioMetadata({ durationSeconds, bytes: stat.size });
};
