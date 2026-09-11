import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 512 * 1024;
const TIMEOUT_MS = 120_000;

type Probe = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string; duration?: string }>;
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
  const stat = await fs.stat(filePath).catch(() => fail(`${label} is missing`));
  if (!stat.isFile() || stat.size <= 0) fail(`${label} must be a non-empty regular file`);
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
  if (!within(fixtureRoot, cover) || !within(fixtureRoot, audio) || !within(fixtureRoot, outputDir)) fail("paths must remain inside fixture root");
  await regularNonEmpty(cover, "cover");
  await regularNonEmpty(audio, "audio");
  const outputStat = await fs.stat(outputDir).catch(() => fail("output directory is missing"));
  if (!outputStat.isDirectory()) fail("output must be a directory");
  if ((await fs.readdir(outputDir)).length !== 0) fail("output directory must be empty");
  const output = path.join(outputDir, "fixture-waveform.mp4");
  const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-loop", "1", "-i", cover, "-i", audio, "-filter_complex", "[1:a]showwaves=s=1280x360:mode=line:colors=white[wave];[0:v]scale=1280:720,format=yuv420p[cover];[cover][wave]overlay=0:360[v]", "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", output];
  await run("ffmpeg", ffmpegArgs);
  const probeResult = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", output]);
  let probe!: Probe;
  try { probe = JSON.parse(probeResult.stdout) as Probe; } catch { fail("ffprobe returned invalid JSON"); }
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  if (!video || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p") fail("output video stream facts are invalid");
  if (!audioStream || audioStream.codec_name !== "aac") fail("output audio stream facts are invalid");
  const duration = Number(probe.format?.duration ?? audioStream!.duration);
  if (!Number.isFinite(duration) || duration <= 0) fail("output duration is invalid");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", output, "-map", "0", "-f", "null", "-"]);
  const result = { outputSha256: await hashFile(output), outputBytes: (await fs.stat(output)).size, outputDurationSeconds: duration, video: { codec: video!.codec_name, pixelFormat: video!.pix_fmt }, audio: { codec: audioStream!.codec_name }, decoded: true };
  process.stdout.write(JSON.stringify(result) + "\n");
};

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Trailer fixture failed"}\n`); process.exitCode = 1; });
