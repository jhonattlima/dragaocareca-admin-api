import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildTrailerCaptionRenderArgs,
  buildTrailerRenderArgs,
  TRAILER_RENDER_VISUAL_PROFILE,
} from "../services/trailer-render-profile.service";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 512 * 1024;
const TIMEOUT_MS = 120_000;

type Probe = {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    codec_tag_string?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    sample_aspect_ratio?: string;
    duration?: string;
  }>;
};

const fail = (message: string): never => { throw new Error(`Trailer fixture rejected: ${message}`); };
const hashFile = async (filePath: string): Promise<string> => {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
};
const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== "..");
};
const regularNonEmpty = async (filePath: string, label: string): Promise<void> => {
  const linkStat = await fs.lstat(filePath).catch(() => fail(`${label} is missing`));
  if (!linkStat.isFile()) fail(`${label} must be a non-empty regular file`);
  const stat = await fs.stat(filePath).catch(() => fail(`${label} is missing`));
  if (stat.size <= 0) fail(`${label} must be a non-empty regular file`);
};
const run = async (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
  try {
    return await execFileAsync(file, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true });
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    const detail = String(result.stderr ?? result.stdout ?? "").slice(-1_000).replace(/\s+/g, " ");
    return fail(`${path.basename(file)} failed${result.killed || result.signal ? " by timeout" : ""}${detail ? `: ${detail}` : ""}`);
  }
};
const arg = (args: string[], name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) fail(`missing ${name}`);
  return args[index + 1];
};

const main = async (): Promise<void> => {
  const fixtureRoot = path.resolve(arg(process.argv.slice(2), "--fixture-root"));
  const cover = path.resolve(arg(process.argv.slice(2), "--cover"));
  const audio = path.resolve(arg(process.argv.slice(2), "--audio"));
  const outputDir = path.resolve(arg(process.argv.slice(2), "--output"));
  const captionArgPresent = process.argv.slice(2).includes("--captions");
  const captions = captionArgPresent ? path.resolve(arg(process.argv.slice(2), "--captions")) : null;
  if (!within(fixtureRoot, cover) || !within(fixtureRoot, audio) || !within(fixtureRoot, outputDir) || (captions && !within(fixtureRoot, captions))) {
    fail("paths must remain inside fixture root");
  }
  await regularNonEmpty(cover, "cover");
  await regularNonEmpty(audio, "audio");
  if (captions) {
    await regularNonEmpty(captions, "captions");
    await regularNonEmpty(TRAILER_RENDER_VISUAL_PROFILE.captions.fontFile, "Montserrat font asset");
  }
  const outputLinkStat = await fs.lstat(outputDir).catch(() => fail("output directory is missing"));
  if (outputLinkStat.isSymbolicLink()) fail("output directory must not be a symlink");
  const outputStat = await fs.stat(outputDir).catch(() => fail("output directory is missing"));
  if (!outputStat.isDirectory()) fail("output must be a directory");
  if ((await fs.readdir(outputDir)).length !== 0) fail("output directory must be empty");
  const output = path.join(outputDir, "fixture-waveform.mp4");
  const baseOutput = captions ? path.join(outputDir, ".fixture-waveform-base.mp4") : output;
  try {
    const sourceProbeResult = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", audio]);
    let sourceProbe!: Probe;
    try { sourceProbe = JSON.parse(sourceProbeResult.stdout) as Probe; } catch { fail("source ffprobe returned invalid JSON"); }
    const sourceAudio = (sourceProbe.streams ?? []).find((stream) => stream.codec_type === "audio");
    const sourceDuration = Number(sourceProbe.format?.duration ?? sourceAudio?.duration);
    if (!sourceAudio || !Number.isFinite(sourceDuration) || sourceDuration <= 0) fail("source audio duration is invalid");
    await run("ffmpeg", buildTrailerRenderArgs({ coverPath: cover, audioPath: audio, outputPath: baseOutput, durationSeconds: sourceDuration }));
    if (captions) {
      await run("ffmpeg", buildTrailerCaptionRenderArgs({ inputVideoPath: baseOutput, assPath: captions, outputPath: output }));
      await fs.rm(baseOutput, { force: true });
    }
    const probeResult = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", output]);
    let probe!: Probe;
    try { probe = JSON.parse(probeResult.stdout) as Probe; } catch { fail("ffprobe returned invalid JSON"); }
    const streams = probe.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audioStream = streams.find((stream) => stream.codec_type === "audio");
    if (
      !video || video.codec_name !== "h264" || video.codec_tag_string !== "avc1" || video.pix_fmt !== "yuv420p" ||
      video.width !== TRAILER_RENDER_VISUAL_PROFILE.width || video.height !== TRAILER_RENDER_VISUAL_PROFILE.height ||
      video.sample_aspect_ratio !== "1:1"
    ) fail("output video stream facts are invalid");
    if (!audioStream || audioStream.codec_name !== "aac") fail("output audio stream facts are invalid");
    const duration = Number(probe.format?.duration ?? audioStream!.duration);
    if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - sourceDuration) > 0.1) fail("source and output duration facts do not match");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", output, "-map", "0", "-f", "null", "-"]);
    const result = {
      sourceSha256: await hashFile(audio),
      sourceBytes: (await fs.stat(audio)).size,
      sourceDurationSeconds: sourceDuration,
      outputSha256: await hashFile(output),
      outputBytes: (await fs.stat(output)).size,
      outputDurationSeconds: duration,
      video: {
        codec: video!.codec_name,
        profile: video!.profile,
        pixelFormat: video!.pix_fmt,
        width: video!.width,
        height: video!.height,
        sampleAspectRatio: video!.sample_aspect_ratio,
      },
      audio: { codec: audioStream!.codec_name },
      decoded: true,
    };
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    if (baseOutput !== output) await fs.rm(baseOutput, { force: true }).catch(() => undefined);
    throw error;
  }
};

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Trailer fixture failed"}\n`); process.exitCode = 1; });
