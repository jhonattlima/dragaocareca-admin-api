import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
import {
  getEpisodeMediaDraftTranscriptPath,
  getEpisodeMediaDraftStatePath,
  getEpisodeMediaLegacyDraftTranscriptionStatePath,
  getEpisodeMediaStagingPath,
  findExistingEpisodeMediaPath,
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
} from "./episode-media-layout.service";
import {
  abortDraftEpisodeSummary,
  queueDraftEpisodeSummary,
} from "./episode-summary.service";
import {
  createAiSummaryDraftState,
  createSuggestedTagsDraftState,
  createTranscriptDraftState,
  normalizeEpisodeDraftState,
  type EpisodeDraftState,
  type EpisodeDraftStepStatus,
} from "../schemas/episode-draft-state";
import {
  assertTranscriptTimestampQuality,
  formatTranscriptSegments,
} from "./transcript-quality.service";

const execFileAsync = promisify(execFile);
const tempRoot = path.resolve(os.tmpdir(), "dragaocareca-episode-transcription");
const chunkDurationSeconds = 60;

type DraftTranscriptionStatus = EpisodeDraftStepStatus;

type GeminiFile = {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string;
};

type GeminiResponse = {
  file?: GeminiFile;
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type GroqTranscriptionResponse = {
  text?: string;
  segments?: Array<{ start?: number; text?: string }>;
  error?: { message?: string };
};

export type EpisodeTranscriptionStatusSnapshot = {
  status: DraftTranscriptionStatus;
  transcriptFileName: string | null;
  transcriptUpdatedAt: string | null;
  transcriptStartedAt: string | null;
  progress: number | null;
  transcriptError: string | null;
  provider: string | null;
};

const ensureTempRoot = (): void => {
  fs.mkdirSync(tempRoot, { recursive: true });
};

const transcriptFileName = (episodeId: number): string => getEpisodeMediaRelativePath(episodeId, "transcript");
const transcriptSummaryFileName = (episodeId: number): string => path.posix.join("episodes", String(episodeId), "summary.txt");
const buildAudioPath = async (episode: EpisodeRow): Promise<string> => {
  const resolved = await findExistingEpisodeMediaPath(episode.episodeId, "audio", episode.fileName ?? null);
  if (resolved) {
    return resolved;
  }

  return getEpisodeMediaFinalPath(episode.episodeId, "audio");
};
const buildTranscriptPath = (episodeId: number): string => getEpisodeMediaFinalPath(episodeId, "transcript");
const buildDraftTranscriptPath = (episodeId: number): string => getEpisodeMediaDraftTranscriptPath(episodeId);
const buildDraftStatePath = (episodeId: number): string => getEpisodeMediaDraftStatePath(episodeId);
const buildLegacyDraftStatePath = (episodeId: number): string => getEpisodeMediaLegacyDraftTranscriptionStatePath(episodeId);

const readDraftStateFromPath = (statePath: string, episodeId: number): EpisodeDraftState | null => {
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as unknown;
    const normalized = normalizeEpisodeDraftState(parsed, episodeId);
    if (!normalized) {
      return null;
    }

    return {
      ...normalized,
      transcript: {
        ...normalized.transcript,
        fileName: normalized.transcript.fileName ?? transcriptFileName(episodeId),
      },
      aiSummary: {
        ...normalized.aiSummary,
        summaryFileName: normalized.aiSummary.summaryFileName ?? transcriptSummaryFileName(episodeId),
      },
    };
  } catch {
    return null;
  }
};

const readDraftState = (episodeId: number): EpisodeDraftState | null =>
  readDraftStateFromPath(buildDraftStatePath(episodeId), episodeId) ?? readDraftStateFromPath(buildLegacyDraftStatePath(episodeId), episodeId);

const writeDraftState = (episodeId: number, state: EpisodeDraftState): void => {
  fs.mkdirSync(path.dirname(buildDraftStatePath(episodeId)), { recursive: true });
  fs.writeFileSync(buildDraftStatePath(episodeId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const writeDraftStateAsync = async (episodeId: number, state: EpisodeDraftState): Promise<void> => {
  await fs.promises.mkdir(path.dirname(buildDraftStatePath(episodeId)), { recursive: true });
  await fs.promises.writeFile(buildDraftStatePath(episodeId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const nextDraftState = (
  episodeId: number,
  status: DraftTranscriptionStatus,
  version?: number,
  error?: string | null
): EpisodeDraftState => {
  const current = readDraftState(episodeId);
  const nextVersion = version ?? (current?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const transcript = current?.transcript ?? createTranscriptDraftState();

  return {
    episodeId,
    version: nextVersion,
    updatedAt: now,
    transcript: {
      ...transcript,
      status,
      version: nextVersion,
      updatedAt: now,
      startedAt: status === "processing" ? transcript.startedAt ?? now : status === "pending" ? null : transcript.startedAt ?? null,
      finishedAt: status === "done" ? now : status === "error" ? now : transcript.finishedAt ?? null,
      progress: status === "done" ? 100 : status === "processing" ? transcript.progress ?? 0 : null,
      promptVersion: transcript.promptVersion ?? null,
      fileName: transcriptFileName(episodeId),
      error: error ?? null,
    },
    aiSummary: current?.aiSummary
      ? {
          ...current.aiSummary,
          summaryFileName: current.aiSummary.summaryFileName ?? transcriptSummaryFileName(episodeId),
        }
      : createAiSummaryDraftState({
          summaryFileName: transcriptSummaryFileName(episodeId),
        }),
    suggestedTags: current?.suggestedTags
      ? { ...current.suggestedTags, version: nextVersion, updatedAt: now }
      : createSuggestedTagsDraftState({ version: nextVersion, updatedAt: now }),
  };
};

const getCurrentDraftState = (episodeId: number): EpisodeDraftState | null => readDraftState(episodeId);

const isDraftStateCurrent = (episodeId: number, version: number): boolean => {
  const current = getCurrentDraftState(episodeId);
  return Boolean(current && current.version === version);
};

type TranscriptionProvider = "gemini" | "groq" | "internal" | "faster-whisper";

const getConfiguredTranscriptionProvider = (): TranscriptionProvider => {
  const provider = config.transcription.provider.trim().toLowerCase();
  return provider === "gemini" || provider === "groq" || provider === "faster-whisper" ? provider : "internal";
};

const getTranscriptionConfigurationError = (provider: TranscriptionProvider = getConfiguredTranscriptionProvider()): string | null => {
  if (!config.transcription.enabled) {
    return "Transcription is disabled";
  }

  if (provider === "gemini") {
    if (!config.summary.geminiApiKey.trim()) {
      return "GEMINI_API_KEY is not configured";
    }
    if (!config.transcription.geminiModel.trim()) {
      return "EPISODE_TRANSCRIPTION_GEMINI_MODEL is not configured";
    }
    return null;
  }

  if (provider === "groq") {
    if (!config.summary.groqApiKey.trim()) return "GROQ_API_KEY is not configured";
    if (!config.transcription.groqModel.trim()) return "EPISODE_TRANSCRIPTION_GROQ_MODEL is not configured";
    return null;
  }

  if (provider === "faster-whisper") {
    if (!config.transcription.fasterWhisperPython.trim()) {
      return "EPISODE_TRANSCRIPTION_FASTER_WHISPER_PYTHON is not configured";
    }
    if (!fs.existsSync(config.transcription.fasterWhisperScript.trim())) {
      return `faster-whisper script not found: ${config.transcription.fasterWhisperScript.trim()}`;
    }
    const pythonCheck = spawnSync(config.transcription.fasterWhisperPython.trim(), ["--version"], { stdio: "ignore" });
    if (pythonCheck.error && (pythonCheck.error as NodeJS.ErrnoException).code === "ENOENT") {
      return `Python command not found: ${config.transcription.fasterWhisperPython.trim()}`;
    }
    return null;
  }

  if (provider !== "internal") {
    return `Unsupported EPISODE_TRANSCRIPTION_PROVIDER: ${provider}`;
  }

  if (!config.transcription.command.trim()) {
    return "EPISODE_TRANSCRIPTION_COMMAND is not configured";
  }

  if (!config.transcription.modelPath.trim()) {
    return "EPISODE_TRANSCRIPTION_MODEL_PATH is not configured";
  }

  const commandCheck = spawnSync(config.transcription.command.trim(), ["--version"], {
    stdio: "ignore",
  });

  if (commandCheck.error && (commandCheck.error as NodeJS.ErrnoException).code === "ENOENT") {
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

const readGeminiResponse = async (response: Response): Promise<GeminiResponse> => {
  const body = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
  }
  return body;
};

const transcribeAudioWithGemini = async (
  audioPath: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${path.basename(audioPath)}`);
  }

  const apiKey = config.summary.geminiApiKey.trim();
  const baseUrl = config.summary.geminiApiBaseUrl.replace(/\/+$/, "");
  const uploadBaseUrl = new URL(baseUrl).origin;
  const audioBytes = await fs.promises.readFile(audioPath);
  const mimeType = "audio/mpeg";
  let remoteFileName: string | null = null;

  try {
    onProgress?.(5);
    console.info(`[transcription] provider=gemini upload started audioBytes=${audioBytes.length}`);
    const uploadStart = await fetch(`${uploadBaseUrl}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-upload-protocol": "resumable",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": String(audioBytes.length),
        "x-goog-upload-header-content-type": mimeType,
      },
      body: JSON.stringify({ file: { displayName: `episode-transcription-${Date.now()}.mp3` } }),
      signal: AbortSignal.timeout(config.transcription.timeoutMs),
    });
    const uploadUrl = uploadStart.headers.get("x-goog-upload-url");
    if (!uploadStart.ok || !uploadUrl) {
      throw new Error(`Gemini upload initialization failed (${uploadStart.status})`);
    }

    let uploaded = await readGeminiResponse(
      await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "content-length": String(audioBytes.length),
          "x-goog-upload-command": "upload, finalize",
          "x-goog-upload-offset": "0",
        },
        body: audioBytes,
        signal: AbortSignal.timeout(config.transcription.timeoutMs),
      })
    );
    remoteFileName = uploaded.file?.name ?? null;
    onProgress?.(30);
    console.info(`[transcription] provider=gemini upload finalized state=${uploaded.file?.state ?? "unknown"}`);

    for (let attempt = 0; uploaded.file?.state === "PROCESSING" && attempt < 30; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      uploaded = await readGeminiResponse(
        await fetch(`${baseUrl}/${uploaded.file.name}`, {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(config.transcription.timeoutMs),
        })
      );
      onProgress?.(clampProgress(30 + ((attempt + 1) / 30) * 25));
    }

    if (uploaded.file?.state && uploaded.file.state !== "ACTIVE") {
      throw new Error(`Gemini audio file is not active: ${uploaded.file.state}`);
    }
    if (!uploaded.file?.uri || !uploaded.file.mimeType) {
      throw new Error("Gemini upload did not return an audio file URI");
    }

    onProgress?.(60);
    console.info(`[transcription] provider=gemini generation started model=${config.transcription.geminiModel}`);
    const generated = await readGeminiResponse(
      await fetch(`${baseUrl}/models/${encodeURIComponent(config.transcription.geminiModel.trim())}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              {
                text:
                  `Transcreva integralmente o áudio em ${config.transcription.language === "pt" ? "pt-BR" : config.transcription.language}. ` +
                  "Preserve nomes próprios, interrupções relevantes e linguagem coloquial. Não resuma, não explique e não adicione título. " +
                  "Comece cada bloco de fala com um timestamp absoluto no formato M:SS (ou H:MM:SS), em ordem crescente, " +
                  "e crie blocos frequentes, sem deixar intervalos maiores que 120 segundos entre timestamps. Não invente timestamps.",
              },
              { fileData: { mimeType: uploaded.file.mimeType, fileUri: uploaded.file.uri } },
            ],
          }],
          generationConfig: {
            thinkingConfig: { thinkingLevel: config.transcription.geminiThinkingLevel.trim().toLowerCase() },
            maxOutputTokens: config.transcription.geminiMaxOutputTokens,
          },
        }),
        signal: AbortSignal.timeout(config.transcription.timeoutMs),
      })
    );
    const candidate = generated.candidates?.[0];
    const rawTranscript = candidate?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    console.info(
      `[transcription] provider=gemini generation finished finishReason=${candidate?.finishReason ?? "unknown"} chars=${rawTranscript?.length ?? 0}`
    );
    const transcript = normalizeTranscriptText(rawTranscript ?? "");
    if (!transcript) {
      throw new Error("Gemini transcription completed without output");
    }

    const durationSeconds = await getAudioDurationSeconds(audioPath);
    assertTranscriptTimestampQuality(rawTranscript ?? "", durationSeconds);

    onProgress?.(95);
    return transcript;
  } finally {
    if (remoteFileName) {
      await fetch(`${baseUrl}/${remoteFileName}`, {
        method: "DELETE",
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(config.transcription.timeoutMs),
      }).catch(() => undefined);
      console.info("[transcription] provider=gemini temporary audio deleted");
    }
  }
};

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

const runTranscriptionCommand = async (
  wavPath: string,
  outputBase: string,
  provider: TranscriptionProvider,
  timestampOffsetSeconds = 0,
): Promise<string> => {
  if (provider === "groq") {
    const audioBytes = await fs.promises.readFile(wavPath);
    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: "audio/wav" }), path.basename(wavPath));
    form.append("model", config.transcription.groqModel);
    form.append("language", config.transcription.language);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    const response = await fetch(`${config.summary.groqApiBaseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.summary.groqApiKey.trim()}` },
      body: form,
      signal: AbortSignal.timeout(config.transcription.timeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as GroqTranscriptionResponse;
    if (!response.ok) throw new Error(`Groq transcription failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
    console.info(`[transcription] provider=groq chunk=${path.basename(wavPath)} chars=${body.text?.length ?? 0}`);
    if (body.segments?.length) {
      return formatTranscriptSegments(
        body.segments.map((segment) => ({ start: segment.start ?? 0, text: segment.text ?? "" })),
        timestampOffsetSeconds,
      );
    }
    return body.text ?? "";
  }

  if (provider === "faster-whisper") {
    const { stdout } = await execFileAsync(
      config.transcription.fasterWhisperPython,
      [
        config.transcription.fasterWhisperScript,
        "--audio", wavPath,
        "--model", config.transcription.fasterWhisperModel,
        "--language", config.transcription.language,
        "--device", config.transcription.fasterWhisperDevice,
        "--compute-type", config.transcription.fasterWhisperComputeType,
        "--cpu-threads", String(Math.max(1, Math.floor(config.transcription.whisperThreads))),
      ],
      { maxBuffer: 20 * 1024 * 1024, timeout: config.transcription.timeoutMs }
    );
    return stdout.toString();
  }

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
      "-t",
      String(Math.max(1, Math.floor(config.transcription.whisperThreads))),
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
  onProgress?: (progress: number) => void,
  provider: TranscriptionProvider = "internal"
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

      const rawTranscript = await runTranscriptionCommand(chunkPath, chunkBase, provider, chunkStart);
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

const transcribeAudioWithGroq = async (audioPath: string, onProgress?: (progress: number) => void): Promise<string> => {
  ensureTempRoot();
  const workingDir = fs.mkdtempSync(path.join(tempRoot, "groq-episode-"));
  const durationSeconds = await getAudioDurationSeconds(audioPath).catch(() => 0);
  const groqChunkDurationSeconds = 300;
  const totalChunks = Math.max(1, Math.ceil((durationSeconds || groqChunkDurationSeconds) / groqChunkDurationSeconds));
  const chunkTexts: string[] = [];

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkPath = path.join(workingDir, `chunk_${String(index + 1).padStart(4, "0")}.wav`);
      const chunkStart = index * groqChunkDurationSeconds;
      const remainingSeconds = durationSeconds > 0 ? Math.max(durationSeconds - chunkStart, 0) : groqChunkDurationSeconds;
      await execFileAsync("ffmpeg", [
        "-y", "-ss", String(chunkStart), "-i", audioPath, "-t", String(Math.max(1, Math.min(groqChunkDurationSeconds, remainingSeconds))),
        "-ac", "1", "-ar", "16000", "-vn", "-f", "wav", chunkPath,
      ], { maxBuffer: 20 * 1024 * 1024 });

      const text = normalizeTranscriptText(await runTranscriptionCommand(chunkPath, chunkPath, "groq", chunkStart));
      if (text) chunkTexts.push(text);
      onProgress?.(clampProgress(((index + 1) / totalChunks) * 100));
    }
    const transcript = normalizeTranscriptText(chunkTexts.join("\n\n"));
    if (!transcript) throw new Error("Groq transcription completed without output");
    assertTranscriptTimestampQuality(transcript, durationSeconds);
    return transcript;
  } finally {
    await fs.promises.rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const transcribeAudio = async (
  audioPath: string,
  onProgress?: (progress: number) => void,
  provider: TranscriptionProvider = getConfiguredTranscriptionProvider(),
  onProvider?: (provider: TranscriptionProvider) => void
): Promise<string> => {
  if (provider === "gemini") {
    try {
      return await transcribeAudioWithGemini(audioPath, onProgress);
    } catch (geminiError) {
      const geminiMessage = geminiError instanceof Error ? geminiError.message : String(geminiError);
      console.warn(`[transcription] provider=gemini failed; fallback=groq error=${geminiMessage}`);

      const groqConfigurationError = getTranscriptionConfigurationError("groq");
      if (groqConfigurationError) {
        throw new Error(`Gemini transcription failed: ${geminiMessage}; Groq fallback unavailable: ${groqConfigurationError}`);
      }

      onProvider?.("groq");
      onProgress?.(0);
      try {
        return await transcribeAudioWithGroq(audioPath, onProgress);
      } catch (groqError) {
        const groqMessage = groqError instanceof Error ? groqError.message : String(groqError);
        throw new Error(`Gemini transcription failed: ${geminiMessage}; Groq transcription failed: ${groqMessage}`);
      }
    }
  }

  if (provider === "groq") {
    return transcribeAudioWithGroq(audioPath, onProgress);
  }

  return transcribeAudioInChunks(audioPath, onProgress, provider);
};

const transcribeEpisode = async (episode: EpisodeRow): Promise<string> => {
  const audioPath = await buildAudioPath(episode);
  const transcript = await transcribeAudio(audioPath);
  const transcriptPath = buildTranscriptPath(episode.episodeId);
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");
  return transcriptPath;
};

const transcribeDraftEpisode = async (episodeId: number, version: number, provider: TranscriptionProvider): Promise<void> => {
  const stagedAudioPath = getEpisodeMediaStagingPath(episodeId, "audio");
  const audioPath = fs.existsSync(stagedAudioPath)
    ? stagedAudioPath
    : await findExistingEpisodeMediaPath(episodeId, "audio");
  if (!audioPath) {
    console.info(`[transcription] draft episode=${episodeId} version=${version} audio not found`);
    return;
  }

  if (!isDraftStateCurrent(episodeId, version)) {
    console.info(`[transcription] draft episode=${episodeId} version=${version} aborted before start`);
    return;
  }

  const startedAt = Date.now();
  console.info(`[transcription] started episode=${episodeId} version=${version} at=${new Date().toISOString()}`);

  const processingState = nextDraftState(episodeId, "processing", version);
  processingState.transcript.provider = provider;
  writeDraftState(episodeId, processingState);
  let activeProvider = provider;

  try {
    const transcript = await transcribeAudio(audioPath, (progress) => {
      if (!isDraftStateCurrent(episodeId, version)) {
        return;
      }

      const progressState = nextDraftState(episodeId, "processing", version);
      progressState.transcript.provider = activeProvider;
      writeDraftState(episodeId, {
        ...progressState,
        transcript: {
          ...progressState.transcript,
          progress,
        },
      });
    }, provider, (nextProvider) => {
      if (!isDraftStateCurrent(episodeId, version)) {
        return;
      }

      activeProvider = nextProvider;
      const providerState = nextDraftState(episodeId, "processing", version);
      providerState.transcript.provider = nextProvider;
      providerState.transcript.progress = 0;
      writeDraftState(episodeId, providerState);
    });

    if (!isDraftStateCurrent(episodeId, version)) {
      return;
    }

    const episodeExists = Boolean(episodeRepository.findByEpisodeId(episodeId));
    const transcriptPath = episodeExists ? buildTranscriptPath(episodeId) : buildDraftTranscriptPath(episodeId);
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, `${transcript}\n`, "utf8");

    const doneState = nextDraftState(episodeId, "done", version);
    doneState.transcript.provider = activeProvider;
    await writeDraftStateAsync(episodeId, {
      ...doneState,
      transcript: {
        ...doneState.transcript,
        progress: 100,
      },
    });
    console.info(
      `[transcription] finished episode=${episodeId} version=${version} durationMs=${Date.now() - startedAt} at=${new Date().toISOString()}`
    );

    if (episodeExists) {
      episodeRepository.markTranscriptionDone(episodeId, getEpisodeMediaRelativePath(episodeId, "transcript"));
    }

    await queueDraftEpisodeSummary(episodeId);
  } catch (error) {
    if (isDraftStateCurrent(episodeId, version)) {
      const message = error instanceof Error ? error.message : "Unknown transcription error";
      const errorState = nextDraftState(episodeId, "error", version, message);
      errorState.transcript.provider = activeProvider;
      await writeDraftStateAsync(episodeId, {
        ...errorState,
        transcript: {
          ...errorState.transcript,
          progress: null,
        },
      });
      if (episodeRepository.findByEpisodeId(episodeId)) {
        episodeRepository.markTranscriptionError(episodeId, message);
      }
      console.warn(
        `[transcription] failed episode=${episodeId} version=${version} durationMs=${Date.now() - startedAt} at=${new Date().toISOString()} error=${message}`
      );
    }
  }
};

const isTranscriptionReady = (): boolean => getTranscriptionConfigurationError() === null;

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
  episodeId: number,
  provider: TranscriptionProvider = getConfiguredTranscriptionProvider()
): Promise<{ queued: boolean; version: number; status: DraftTranscriptionStatus; progress: number | null; error?: string | null }> => {
  const configurationError = getTranscriptionConfigurationError(provider);
  if (configurationError) {
    const current = getCurrentDraftState(episodeId);
    const next = nextDraftState(episodeId, "error", (current?.version ?? 0) + 1, configurationError);
    writeDraftState(episodeId, next);
    return {
      queued: false,
      version: next.version,
      status: next.transcript.status,
      progress: next.transcript.progress ?? null,
      error: next.transcript.error,
    };
  }

  const current = getCurrentDraftState(episodeId);
  const next = nextDraftState(episodeId, "pending", (current?.version ?? 0) + 1);
  next.transcript.provider = provider;
  writeDraftState(episodeId, next);
  console.info(`[transcription] queued episode=${episodeId} version=${next.version} at=${new Date().toISOString()}`);

  void transcribeDraftEpisode(episodeId, next.version, provider);

  return {
    queued: true,
    version: next.version,
    status: next.transcript.status,
    progress: next.transcript.progress ?? null,
    error: next.transcript.error,
  };
};

export const abortDraftEpisodeTranscription = async (episodeId: number): Promise<void> => {
  const current = getCurrentDraftState(episodeId);
  const next = nextDraftState(episodeId, "idle", (current?.version ?? 0) + 1);
  next.transcript.progress = null;
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

  if (current.transcript.status === "done" && fs.existsSync(draftTranscriptPath)) {
    fs.mkdirSync(path.dirname(finalTranscriptPath), { recursive: true });
    fs.copyFileSync(draftTranscriptPath, finalTranscriptPath);
    await fs.promises.rm(draftTranscriptPath, { force: true }).catch(() => undefined);
    return {
      status: "done",
      transcriptFileName,
      transcriptStartedAt: current.transcript.startedAt ?? null,
      progress: 100,
    };
  }

  return {
    status: current.transcript.status,
    transcriptFileName: current.transcript.status === "done" ? transcriptFileName : null,
    transcriptStartedAt: current.transcript.startedAt ?? null,
    progress: current.transcript.progress ?? (current.transcript.status === "done" ? 100 : null),
  };
};

export const getEpisodeTranscriptionStatus = (episodeId: number): EpisodeTranscriptionStatusSnapshot => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  const draft = getCurrentDraftState(episodeId);

  if (draft && draft.transcript.status !== "idle") {
    return {
      status: draft.transcript.status,
      transcriptFileName: draft.transcript.status === "done" ? getEpisodeMediaRelativePath(episodeId, "transcript") : null,
      transcriptUpdatedAt: draft.transcript.updatedAt,
      transcriptStartedAt: draft.transcript.startedAt ?? null,
      progress: draft.transcript.progress ?? (draft.transcript.status === "done" ? 100 : null),
      transcriptError: draft.transcript.error ?? null,
      provider: draft.transcript.provider ?? null,
    };
  }

  if (episode) {
    return {
      status: episode.transcriptStatus ?? "idle",
      transcriptFileName: episode.transcriptFileName ?? null,
      transcriptUpdatedAt: episode.transcriptUpdatedAt ?? null,
      transcriptStartedAt: null,
      progress: episode.transcriptStatus === "done" ? 100 : null,
      transcriptError: episode.transcriptError ?? null,
      provider: draft?.transcript.provider ?? null,
    };
  }

  if (!draft) {
    return {
      status: "idle",
      transcriptFileName: null,
      transcriptUpdatedAt: null,
      transcriptStartedAt: null,
      progress: null,
      transcriptError: null,
      provider: null,
    };
  }

  return {
    status: draft.transcript.status,
    transcriptFileName: draft.transcript.status === "done" ? getEpisodeMediaRelativePath(episodeId, "transcript") : null,
    transcriptUpdatedAt: draft.transcript.updatedAt,
    transcriptStartedAt: draft.transcript.startedAt ?? null,
    progress: draft.transcript.progress ?? (draft.transcript.status === "done" ? 100 : null),
    transcriptError: draft.transcript.error ?? null,
    provider: draft.transcript.provider ?? null,
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
    await queueDraftEpisodeSummary(episodeId);
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
  await abortDraftEpisodeSummary(episodeId);
  const current = getCurrentDraftState(episodeId);
  if (current) {
    await writeDraftStateAsync(episodeId, {
      ...current,
      version: (current.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      transcript: {
        ...current.transcript,
        status: "idle",
        version: (current.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        progress: null,
        error: null,
        fileName: null,
      },
    });
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
