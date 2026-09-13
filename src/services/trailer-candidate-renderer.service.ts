import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildTrailerAssCaptions, buildTrailerCaptionRenderArgs, buildTrailerRenderArgs, TRAILER_RENDER_VISUAL_PROFILE, type TrailerCaptionCue } from "./trailer-render-profile.service";

const STDERR_LIMIT = 64 * 1024;
const PROCESS_KILL_GRACE_MS = 2_000;
const MAX_PROBE_BYTES = 4 * 1024 * 1024;

export type TrailerProcessResult = { stdout: string; stderr: string };
export type TrailerProcessRunner = (command: string, args: string[], timeoutMs: number) => Promise<TrailerProcessResult>;
export type TrailerProbe = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string; codec_name?: string; profile?: string; width?: number; height?: number;
    pix_fmt?: string; sample_aspect_ratio?: string; duration?: string;
  }>;
};
export type TrailerCandidateOutputEvidence = {
  durationSeconds: number; outputBytes: number; outputSha256: string; probeJson: string; probe: TrailerProbe;
};

const appendBounded = (current: string, chunk: Buffer, limit: number): string =>
  current.length >= limit ? current : (current + chunk.toString("utf8")).slice(-limit);

export const runTrailerProcess: TrailerProcessRunner = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  let child: ChildProcess;
  try {
    child = spawn(command, args, { shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) { reject(error); return; }
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { /* process already exited */ }
    forceKillTimer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* process already exited */ }
    }, PROCESS_KILL_GRACE_MS);
    forceKillTimer.unref();
  }, timeoutMs);
  timeout.unref();
  child.stdout?.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk, MAX_PROBE_BYTES); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk, STDERR_LIMIT); });
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    reject(error);
  });
  child.once("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (timedOut) reject(new Error(`Trailer process exceeded ${timeoutMs} ms timeout`));
    else if (code !== 0) reject(new Error(`Trailer process failed (${signal ?? code}): ${stderr.slice(-2_000)}`));
    else resolve({ stdout, stderr });
  });
});

const parseProbe = (stdout: string): TrailerProbe => {
  try {
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== "object") throw new Error("invalid probe JSON");
    return value as TrailerProbe;
  } catch { throw new Error("ffprobe returned invalid media metadata"); }
};

export const probeTrailerMedia = async (filePath: string, runner: TrailerProcessRunner = runTrailerProcess): Promise<TrailerProbe> => {
  const result = await runner("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], 60_000);
  return parseProbe(result.stdout);
};

export const readTrailerDurationSeconds = async (filePath: string, runner: TrailerProcessRunner = runTrailerProcess): Promise<number> => {
  const probe = await probeTrailerMedia(filePath, runner);
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(audio?.duration ?? probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Trailer audio has no positive duration");
  return duration;
};

export const trailerRenderTimeoutMs = (durationSeconds: number): number => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Trailer source duration must be positive");
  return Math.max(300, Math.ceil(3 * durationSeconds + 120)) * 1000;
};

const fileEvidence = async (filePath: string): Promise<{ outputBytes: number; outputSha256: string }> => {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error("Trailer renderer produced no regular output file");
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return { outputBytes: stat.size, outputSha256: hash.digest("hex") };
};

export const validateTrailerCandidateOutput = async (
  outputPath: string,
  expectedDurationSeconds: number,
  runner: TrailerProcessRunner = runTrailerProcess,
): Promise<TrailerCandidateOutputEvidence> => {
  const probe = await probeTrailerMedia(outputPath, runner);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(video?.duration ?? probe.format?.duration);
  if (!video || !audio) throw new Error("Trailer output must contain video and audio streams");
  if (video.codec_name !== "h264" || video.profile?.toLowerCase() !== "main") throw new Error("Trailer output video must be H.264 Main");
  if (video.width !== TRAILER_RENDER_VISUAL_PROFILE.width || video.height !== TRAILER_RENDER_VISUAL_PROFILE.height) {
    throw new Error("Trailer output dimensions do not match the square render profile");
  }
  if (video.pix_fmt !== "yuv420p" || !["1:1", "1/1"].includes(video.sample_aspect_ratio ?? "")) {
    throw new Error("Trailer output pixel or sample aspect ratio does not match the render profile");
  }
  if (audio.codec_name !== "aac") throw new Error("Trailer output audio must be AAC");
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDurationSeconds) > 0.1) {
    throw new Error("Trailer output duration differs from source audio by more than 0.1 seconds");
  }
  await runner("ffmpeg", ["-hide_banner", "-loglevel", "error", "-xerror", "-i", outputPath, "-map", "0", "-f", "null", "-"], trailerRenderTimeoutMs(expectedDurationSeconds));
  const evidence = await fileEvidence(outputPath);
  return { durationSeconds: duration, ...evidence, probeJson: JSON.stringify(probe), probe };
};

export const renderTrailerCandidateOutput = async (input: {
  coverPath: string; audioPath: string; outputPath: string; durationSeconds: number;
}, runner: TrailerProcessRunner = runTrailerProcess): Promise<void> => {
  await runner("ffmpeg", buildTrailerRenderArgs(input), trailerRenderTimeoutMs(input.durationSeconds));
};

export const renderTrailerCandidateCaptions = async (input: {
  inputVideoPath: string; assPath: string; outputPath: string; durationSeconds: number; cues: TrailerCaptionCue[];
}, runner: TrailerProcessRunner = runTrailerProcess): Promise<void> => {
  await fs.promises.writeFile(input.assPath, buildTrailerAssCaptions(input.cues), { flag: "wx", mode: 0o600 });
  await runner("ffmpeg", buildTrailerCaptionRenderArgs(input), trailerRenderTimeoutMs(input.durationSeconds));
};

export const resolveAttemptOutputPaths = (candidateDirectory: string, attemptNumber: number): { directory: string; partial: string; ready: string } => {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) throw new Error("Invalid trailer candidate attempt number");
  const directory = path.join(candidateDirectory, "attempts", String(attemptNumber));
  return { directory, partial: path.join(directory, "candidate.partial.mp4"), ready: path.join(directory, "candidate.mp4") };
};
