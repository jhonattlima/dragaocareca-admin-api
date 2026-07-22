import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
import {
  getEpisodeMediaDraftTranscriptPath,
  getEpisodeMediaDraftTranscriptionStatePath,
  findExistingEpisodeMediaPath,
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
} from "./episode-media-layout.service";

const execFileAsync = promisify(execFile);
const tempRoot = path.resolve(os.tmpdir(), "dragaocareca-episode-transcription");
const chunkDurationSeconds = 60;

type DraftTranscriptionStatus = "idle" | "pending" | "processing" | "done" | "error";

type DraftTranscriptionState = {
  episodeId: number;
  version: number;
  status: DraftTranscriptionStatus;
  updatedAt: string;
  startedAt?: string | null;
  progress?: number | null;
  error?: string | null;
};

export type EpisodeTranscriptionStatusSnapshot = {
  status: DraftTranscriptionStatus;
  transcriptFileName: string | null;
  transcriptUpdatedAt: string | null;
  transcriptStartedAt: string | null;
  progress: number | null;
  transcriptError: string | null;
};

const ensureTempRoot = (): void => {
  fs.mkdirSync(tempRoot, { recursive: true });
};

const transcriptFileName = (episodeId: number): string => getEpisodeMediaRelativePath(episodeId, "transcript");
const buildAudioPath = async (episode: EpisodeRow): Promise<string> => {
  const resolved = await findExistingEpisodeMediaPath(episode.episodeId, "audio", episode.fileName ?? null);
  if (resolved) {
    return resolved;
  }

  return getEpisodeMediaFinalPath(episode.episodeId, "audio");
};
const buildTranscriptPath = (episodeId: number): string => getEpisodeMediaFinalPath(episodeId, "transcript");
const buildDraftTranscriptPath = (episodeId: number): string => getEpisodeMediaDraftTranscriptPath(episodeId);
const buildDraftStatePath = (episodeId: number): string => getEpisodeMediaDraftTranscriptionStatePath(episodeId);

const readDraftState = (episodeId: number): DraftTranscriptionState | null => {
  const statePath = buildDraftStatePath(episodeId);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as DraftTranscriptionState;
    if (
      !parsed ||
      parsed.episodeId !== episodeId ||
      typeof parsed.version !== "number" ||
      typeof parsed.status !== "string"
    ) {
      return null;
    }

    return {
      episodeId,
      version: parsed.version,
      status: parsed.status,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      progress: typeof parsed.progress === "number" && Number.isFinite(parsed.progress) ? parsed.progress : null,
      error: typeof parsed.error === "string" ? parsed.error : null,
    };
  } catch {
    return null;
  }
};

const writeDraftState = (episodeId: number, state: DraftTranscriptionState): void => {
  fs.mkdirSync(path.dirname(buildDraftStatePath(episodeId)), { recursive: true });
  fs.writeFileSync(buildDraftStatePath(episodeId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const nextDraftState = (episodeId: number, status: DraftTranscriptionStatus, version?: number, error?: string | null): DraftTranscriptionState => ({
  episodeId,
  version: version ?? (readDraftState(episodeId)?.version ?? 0) + 1,
  status,
  updatedAt: new Date().toISOString(),
  startedAt: status === "processing" ? readDraftState(episodeId)?.startedAt ?? new Date().toISOString() : null,
  progress: status === "done" ? 100 : status === "processing" ? readDraftState(episodeId)?.progress ?? 0 : null,
  error: error ?? null,
});

const getCurrentDraftState = (episodeId: number): DraftTranscriptionState | null => readDraftState(episodeId);

const isDraftStateCurrent = (episodeId: number, version: number): boolean => {
  const current = getCurrentDraftState(episodeId);
  return Boolean(current && current.version === version);
};

const getTranscriptionConfigurationError = (): string | null => {
  if (!config.transcription.enabled) {
    return "Transcription is disabled";
  }

  if (!config.transcription.command.trim()) {
    return "EPISODE_TRANSCRIPTION_COMMAND is not configured";
  }

  if (!config.transcription.modelPath.trim()) {
    return "EPISODE_TRANSCRIPTION_MODEL_PATH is not configured";
  }

  const commandCheck = spawnSync("bash", ["-lc", `command -v ${config.transcription.command.trim()} >/dev/null 2>&1`], {
    stdio: "ignore",
  });

  if (commandCheck.status !== 0) {
    return `Transcription command not found: ${config.transcription.command.trim()}`;
  }

  if (!fs.existsSync(config.transcription.modelPath.trim())) {
    return `Transcription model not found: ${config.transcription.modelPath.trim()}`;
  }

  return null;
};

const normalizeTranscriptText = (raw: string): string => {
  const cleanedLines: string[] = [];

  for (const originalLine of raw.split(/\r?\n/)) {
    let line = originalLine.trim();
    if (!line) {
      if (cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      continue;
    }

    line = line
      .replace(/^\[[0-9:.]+\s*-->\s*[0-9:.]+\]\s*/i, "")
      .replace(/^\([0-9:.]+\)\s*/i, "")
      .replace(/^\[(?:music|silence|noise|applause|laughter|inaudible)\]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!line) {
      continue;
    }

    if (/^(ffmpeg|whisper|whisper\.cpp|main|log):/i.test(line)) {
      continue;
    }

    if (cleanedLines[cleanedLines.length - 1] === line) {
      continue;
    }

    cleanedLines.push(line);
  }

  while (cleanedLines.length > 0 && cleanedLines[0] === "") {
    cleanedLines.shift();
  }

  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] === "") {
    cleanedLines.pop();
  }

  return cleanedLines.join("\n").trim();
};

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const convertToWav = async (inputPath: string, outputPath: string): Promise<void> => {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-vn",
      "-f",
      "wav",
      outputPath,
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
};

const getAudioDurationSeconds = async (wavPath: string): Promise<number> => {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      wavPath,
    ],
    { maxBuffer: 4 * 1024 * 1024 }
  );

  const duration = Number.parseFloat(stdout.toString().trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
};

const runTranscriptionCommand = async (wavPath: string, outputBase: string): Promise<string> => {
  const transcriptPath = `${outputBase}.txt`;
  const { stdout } = await execFileAsync(
    config.transcription.command,
    [
      "-m",
      config.transcription.modelPath,
      "-f",
      wavPath,
      "-l",
      config.transcription.language,
      "-otxt",
      "-of",
      outputBase,
      "-nt",
      "-np",
    ],
    {
      maxBuffer: 20 * 1024 * 1024,
      timeout: config.transcription.timeoutMs,
    }
  );

  if (fs.existsSync(transcriptPath)) {
    return fs.readFileSync(transcriptPath, "utf8");
  }

  return stdout.toString();
};

const transcribeAudioInChunks = async (
  audioPath: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  ensureTempRoot();
  const workingDir = fs.mkdtempSync(path.join(tempRoot, "episode-"));
  const tempWavPath = path.join(workingDir, "source.wav");
  const chunksDir = path.join(workingDir, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });

  try {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${path.basename(audioPath)}`);
    }

    await convertToWav(audioPath, tempWavPath);
    const durationSeconds = await getAudioDurationSeconds(tempWavPath);
    const totalChunks = Math.max(
      1,
      Math.ceil((durationSeconds > 0 ? durationSeconds : chunkDurationSeconds) / chunkDurationSeconds)
    );
    const chunkTexts: string[] = [];

    onProgress?.(0);

    for (let index = 0; index < totalChunks; index += 1) {
      const chunkStart = index * chunkDurationSeconds;
      const remainingSeconds = durationSeconds > 0 ? Math.max(durationSeconds - chunkStart, 0) : chunkDurationSeconds;
      const chunkLength = index === totalChunks - 1 ? Math.max(1, remainingSeconds) : chunkDurationSeconds;
      const chunkBase = path.join(chunksDir, `chunk_${String(index + 1).padStart(4, "0")}`);
      const chunkPath = `${chunkBase}.wav`;

      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-ss",
          String(chunkStart),
          "-i",
          tempWavPath,
          "-t",
          String(chunkLength),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-vn",
          "-f",
          "wav",
          chunkPath,
        ],
        { maxBuffer: 20 * 1024 * 1024 }
      );

      const rawTranscript = await runTranscriptionCommand(chunkPath, chunkBase);
      const transcript = normalizeTranscriptText(rawTranscript);
      if (transcript) {
        chunkTexts.push(transcript);
      }

      onProgress?.(clampProgress(((index + 1) / totalChunks) * 100));
    }

    const transcript = normalizeTranscriptText(chunkTexts.join("\n\n"));
    if (!transcript) {
      throw new Error("Transcription completed without output");
    }

    onProgress?.(100);
    return transcript;
  } finally {
    await fs.promises.rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const transcribeEpisode = async (episode: EpisodeRow): Promise<string> => {
  const audioPath = await buildAudioPath(episode);
  const transcript = await transcribeAudioInChunks(audioPath);
  const transcriptPath = buildTranscriptPath(episode.episodeId);
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");
  return transcriptPath;
};

const transcribeDraftEpisode = async (episodeId: number, version: number): Promise<void> => {
  const audioPath = await findExistingEpisodeMediaPath(episodeId, "audio");
  if (!audioPath) {
    console.info(`[transcription] draft episode=${episodeId} version=${version} audio not found`);
    return;
  }

  if (!isDraftStateCurrent(episodeId, version)) {
    console.info(`[transcription] draft episode=${episodeId} version=${version} aborted before start`);
    return;
  }

  console.info(`[transcription] draft episode=${episodeId} version=${version} started`);

  writeDraftState(episodeId, nextDraftState(episodeId, "processing", version));

  try {
    const transcript = await transcribeAudioInChunks(audioPath, (progress) => {
      if (!isDraftStateCurrent(episodeId, version)) {
        return;
      }

      writeDraftState(episodeId, {
        ...nextDraftState(episodeId, "processing", version),
        progress,
      });
    });

    if (!isDraftStateCurrent(episodeId, version)) {
      return;
    }

    const episodeExists = Boolean(episodeRepository.findByEpisodeId(episodeId));
    const transcriptPath = episodeExists ? buildTranscriptPath(episodeId) : buildDraftTranscriptPath(episodeId);
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");

    writeDraftState(episodeId, {
      ...nextDraftState(episodeId, "done", version),
      progress: 100,
    });
    console.info(`[transcription] draft episode=${episodeId} version=${version} done`);

    if (episodeExists) {
      episodeRepository.markTranscriptionDone(episodeId, getEpisodeMediaRelativePath(episodeId, "transcript"));
    }
  } catch (error) {
    if (isDraftStateCurrent(episodeId, version)) {
      writeDraftState(episodeId, {
        ...nextDraftState(episodeId, "error", version, error instanceof Error ? error.message : "Unknown transcription error"),
        progress: null,
      });
      console.warn(
        `[transcription] draft episode=${episodeId} version=${version} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
};

const isTranscriptionReady = (): boolean => config.transcription.enabled && Boolean(config.transcription.command.trim()) && Boolean(config.transcription.modelPath.trim());

export const queueEpisodeTranscription = async (
  episodeId: number
): Promise<{ queued: boolean; alreadyQueued: boolean }> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) {
    return { queued: false, alreadyQueued: false };
  }

  if (!isTranscriptionReady()) {
    return { queued: false, alreadyQueued: false };
  }

  if (episode.transcriptStatus === "pending" || episode.transcriptStatus === "processing") {
    return { queued: false, alreadyQueued: true };
  }

  episodeRepository.queueTranscription(episodeId);
  return { queued: true, alreadyQueued: false };
};

export const queueDraftEpisodeTranscription = async (
  episodeId: number
): Promise<{ queued: boolean; version: number; status: DraftTranscriptionStatus; progress: number | null; error?: string | null }> => {
  const configurationError = getTranscriptionConfigurationError();
  if (configurationError) {
    const current = getCurrentDraftState(episodeId);
    const next = nextDraftState(episodeId, "error", (current?.version ?? 0) + 1, configurationError);
    writeDraftState(episodeId, next);
    return {
      queued: false,
      version: next.version,
      status: next.status,
      progress: next.progress ?? null,
      error: next.error,
    };
  }

  const current = getCurrentDraftState(episodeId);
  const next = nextDraftState(episodeId, "pending", (current?.version ?? 0) + 1);
  writeDraftState(episodeId, next);
  console.info(`[transcription] draft queued episode=${episodeId} version=${next.version}`);

  void transcribeDraftEpisode(episodeId, next.version);

  return {
    queued: true,
    version: next.version,
    status: next.status,
    progress: next.progress ?? null,
    error: next.error,
  };
};

export const abortDraftEpisodeTranscription = async (episodeId: number): Promise<void> => {
  const current = getCurrentDraftState(episodeId);
  const next = nextDraftState(episodeId, "idle", (current?.version ?? 0) + 1);
  next.progress = null;
  writeDraftState(episodeId, next);
  console.info(`[transcription] draft aborted episode=${episodeId} version=${next.version}`);
  await fs.promises.rm(buildDraftTranscriptPath(episodeId), { force: true }).catch(() => undefined);
};

export const syncDraftEpisodeTranscription = async (episodeId: number): Promise<{
  status: DraftTranscriptionStatus;
  transcriptFileName: string | null;
  transcriptStartedAt: string | null;
  progress: number | null;
}> => {
  const current = getCurrentDraftState(episodeId);
  if (!current) {
    return { status: "idle", transcriptFileName: null, transcriptStartedAt: null, progress: null };
  }

  const draftTranscriptPath = buildDraftTranscriptPath(episodeId);
  const finalTranscriptPath = buildTranscriptPath(episodeId);
  const transcriptFileName = getEpisodeMediaRelativePath(episodeId, "transcript");

  if (current.status === "done" && fs.existsSync(draftTranscriptPath)) {
    fs.mkdirSync(path.dirname(finalTranscriptPath), { recursive: true });
    fs.copyFileSync(draftTranscriptPath, finalTranscriptPath);
    await fs.promises.rm(draftTranscriptPath, { force: true }).catch(() => undefined);
    return { status: "done", transcriptFileName, transcriptStartedAt: current.startedAt ?? null, progress: 100 };
  }

  return {
    status: current.status,
    transcriptFileName: current.status === "done" ? transcriptFileName : null,
    transcriptStartedAt: current.startedAt ?? null,
    progress: current.progress ?? (current.status === "done" ? 100 : null),
  };
};

export const getEpisodeTranscriptionStatus = (episodeId: number): EpisodeTranscriptionStatusSnapshot => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (episode) {
    return {
      status: episode.transcriptStatus ?? "idle",
      transcriptFileName: episode.transcriptFileName ?? null,
      transcriptUpdatedAt: episode.transcriptUpdatedAt ?? null,
      transcriptStartedAt: null,
      progress: episode.transcriptStatus === "done" ? 100 : null,
      transcriptError: episode.transcriptError ?? null,
    };
  }

  const draft = getCurrentDraftState(episodeId);
  if (!draft) {
    return {
      status: "idle",
      transcriptFileName: null,
      transcriptUpdatedAt: null,
      transcriptStartedAt: null,
      progress: null,
      transcriptError: null,
    };
  }

  return {
    status: draft.status,
    transcriptFileName: draft.status === "done" ? getEpisodeMediaRelativePath(episodeId, "transcript") : null,
    transcriptUpdatedAt: draft.updatedAt,
    transcriptStartedAt: draft.startedAt ?? null,
    progress: draft.progress ?? (draft.status === "done" ? 100 : null),
    transcriptError: draft.error ?? null,
  };
};

export const deliverEpisodeTranscription = async (
  episodeId: number
): Promise<{ delivered: boolean; alreadyDone: boolean }> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) {
    return { delivered: false, alreadyDone: false };
  }

  if (episode.transcriptStatus === "done") {
    return { delivered: false, alreadyDone: true };
  }

  if (episode.transcriptStatus !== "pending") {
    return { delivered: false, alreadyDone: false };
  }

  try {
    episodeRepository.markTranscriptionProcessing(episodeId);
    const transcriptPath = await transcribeEpisode(episode);
    episodeRepository.markTranscriptionDone(episodeId, path.basename(transcriptPath));
    return { delivered: true, alreadyDone: false };
  } catch (error) {
    episodeRepository.markTranscriptionError(episodeId, error instanceof Error ? error.message : "Unknown transcription error");
    throw error;
  }
};

export const processPendingEpisodeTranscriptions = async (): Promise<{
  processed: number;
  delivered: number;
  failed: number;
}> => {
  const pending = episodeRepository.getPendingTranscriptions();
  let delivered = 0;
  let failed = 0;

  for (const episode of pending) {
    try {
      const result = await deliverEpisodeTranscription(episode.episodeId);
      if (result.delivered) {
        delivered += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    processed: pending.length,
    delivered,
    failed,
  };
};

export const clearEpisodeTranscription = async (episodeId: number): Promise<void> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) {
    return;
  }

  const transcriptPath = await findExistingEpisodeMediaPath(episodeId, "transcript", episode.transcriptFileName ?? null);
  if (transcriptPath) {
    await fs.promises.rm(transcriptPath, { force: true }).catch(() => undefined);
  }
  episodeRepository.clearTranscription(episodeId);
};

export const startEpisodeTranscriptionWorker = async (): Promise<() => void> => {
  const configurationError = getTranscriptionConfigurationError();
  if (configurationError) {
    console.log(`Episode transcription worker disabled because transcription settings are incomplete: ${configurationError}`);
    return () => undefined;
  }

  let pollTimer: NodeJS.Timeout | undefined;
  let activeRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (activeRun) {
      return activeRun;
    }

    activeRun = (async () => {
      const result = await processPendingEpisodeTranscriptions();
      if (result.processed > 0) {
        console.log(
          `Episode transcription worker processed ${result.processed} pending episode(s); delivered=${result.delivered}; failed=${result.failed}`
        );
      }
    })().finally(() => {
      activeRun = null;
    });

    return activeRun;
  };

  await runOnce();
  pollTimer = setInterval(() => {
    void runOnce().catch((error: unknown) => {
      console.error("Episode transcription worker failed", error);
    });
  }, config.transcription.pollIntervalMs);

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
