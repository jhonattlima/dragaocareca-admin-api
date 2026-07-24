import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import {
  findExistingEpisodeMediaPath,
  getEpisodeMediaDraftStatePath,
  getEpisodeMediaDraftSummaryPath,
  getEpisodeMediaLegacyDraftTranscriptionStatePath,
  getEpisodeMediaRelativePath,
  getEpisodeMediaSummaryPath,
  getEpisodeMediaSummaryRelativePath,
} from "./episode-media-layout.service";
import {
  createAiSummaryDraftState,
  createTranscriptDraftState,
  normalizeEpisodeDraftState,
  type EpisodeDraftState,
  type EpisodeDraftStepStatus,
  type TranscriptDraftState,
} from "../schemas/episode-draft-state";

const execFileAsync = promisify(execFile);

type SummaryRuntimeConfig = typeof config.summary;

type SummaryRuntimeRequest = {
  command: string;
  args: string[];
  timeoutMs: number;
};

type SummaryRuntimeAdapter = {
  execute(request: SummaryRuntimeRequest): Promise<string>;
};

type EpisodeSummaryRequestPayload = {
  episodeId: number;
  promptVersion: string;
  contextSize: number;
  maxTokens: number;
  prompt: string;
  transcript: string;
};

type EpisodeSummaryServiceDeps = {
  summaryConfig?: SummaryRuntimeConfig;
  runtime?: SummaryRuntimeAdapter;
  now?: () => string;
};

export type EpisodeDraftSummaryStatusSnapshot = {
  status: EpisodeDraftStepStatus;
  summaryFileName: string | null;
  summaryUpdatedAt: string | null;
  summaryStartedAt: string | null;
  progress: number | null;
  error: string | null;
  version: number | null;
  promptVersion: string | null;
};

export type EpisodeDraftSummarySnapshot = EpisodeDraftSummaryStatusSnapshot & {
  summaryText: string | null;
};

const tempRoot = path.resolve(os.tmpdir(), "dragaocareca-episode-summary");

const defaultNow = (): string => new Date().toISOString();

const defaultSummaryRuntime: SummaryRuntimeAdapter = {
  async execute(request: SummaryRuntimeRequest): Promise<string> {
    const { stdout } = await execFileAsync(request.command, request.args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: request.timeoutMs,
    });

    return stdout.toString();
  },
};

const ensureTempRoot = (): void => {
  fs.mkdirSync(tempRoot, { recursive: true });
};

const buildDraftStatePath = (episodeId: number): string => getEpisodeMediaDraftStatePath(episodeId);
const buildLegacyDraftStatePath = (episodeId: number): string => getEpisodeMediaLegacyDraftTranscriptionStatePath(episodeId);
const buildDraftSummaryPath = (episodeId: number): string => getEpisodeMediaDraftSummaryPath(episodeId);
const buildFinalSummaryPath = (episodeId: number): string => getEpisodeMediaSummaryPath(episodeId);
const buildSummaryFileName = (episodeId: number): string => getEpisodeMediaSummaryRelativePath(episodeId);
const buildTranscriptFileName = (episodeId: number): string => getEpisodeMediaRelativePath(episodeId, "transcript");

const createRuntimeError = (message: string): Error => new Error(message);

const writeTextAtomic = async (filePath: string, contents: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tempPath, contents, "utf8");
  await fs.promises.rename(tempPath, filePath);
};

const writeJsonAtomic = async (filePath: string, value: unknown): Promise<void> => {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

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
        fileName: normalized.transcript.fileName ?? buildTranscriptFileName(episodeId),
      },
      aiSummary: {
        ...normalized.aiSummary,
        fileName: normalized.aiSummary.fileName ?? buildSummaryFileName(episodeId),
        summaryFileName: normalized.aiSummary.summaryFileName ?? buildSummaryFileName(episodeId),
      },
    };
  } catch {
    return null;
  }
};

const readDraftState = (episodeId: number): EpisodeDraftState | null =>
  readDraftStateFromPath(buildDraftStatePath(episodeId), episodeId) ?? readDraftStateFromPath(buildLegacyDraftStatePath(episodeId), episodeId);

const writeDraftState = async (episodeId: number, state: EpisodeDraftState): Promise<void> => {
  await writeJsonAtomic(buildDraftStatePath(episodeId), state);
};

const nextEpisodeVersion = (current: EpisodeDraftState | null): number => (current?.version ?? 0) + 1;

const normalizeSummaryDraftText = (raw: string): string => {
  let text = raw.trim();
  if (!text) {
    return "";
  }

  const fencedMatch = text.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    text = fencedMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") {
      text = parsed;
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.summary === "string") {
        text = record.summary;
      } else if (typeof record.text === "string") {
        text = record.text;
      }
    }
  } catch {
    const summaryMatch = text.match(/^summary\s*[:=]\s*(.+)$/i);
    if (summaryMatch?.[1]) {
      text = summaryMatch[1].trim();
    }
  }

  return text
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
};

const countSentences = (summary: string): number => {
  const matches = summary.match(/[.!?](?:["')\]]+)?(?=\s|$)/g);
  return matches?.length ?? 0;
};

const validateSummaryDraft = (summary: string): void => {
  const sentenceCount = countSentences(summary);
  if (summary.length < 80 || summary.length > 420) {
    throw createRuntimeError("summary draft must be between 80 and 420 characters");
  }

  if (sentenceCount < 2 || sentenceCount > 4) {
    throw createRuntimeError("summary draft must contain 2-4 sentences");
  }
};

const buildSummaryPromptText = (input: {
  episodeId: number;
  transcript: string;
  promptVersion: string;
  contextSize: number;
  maxTokens: number;
}): string => {
  const availablePromptTokens = Math.max(512, input.contextSize - input.maxTokens - 256);
  const maxTranscriptCharacters = availablePromptTokens * 3;
  const transcript = input.transcript.trim();
  const boundedTranscript =
    transcript.length <= maxTranscriptCharacters
      ? transcript
      : `${transcript.slice(0, Math.floor(maxTranscriptCharacters * 0.7))}\n\n[trecho intermediario omitido por limite de contexto]\n\n${transcript.slice(
          -Math.floor(maxTranscriptCharacters * 0.3)
        )}`;

  return [
    "SYSTEM: Responda apenas com JSON no formato {\"summary\": string}.",
    "SYSTEM: Escreva em pt-BR com 2 a 4 frases curtas.",
    "SYSTEM: Seja fiel ao transcript, use termos concretos e descobríveis, e evite keyword stuffing, hype ou promessas exageradas.",
    "SYSTEM: Preserve nomes próprios, jogos, franquias, lugares e temas que já aparecem no transcript.",
    `SYSTEM: promptVersion=${input.promptVersion}; contextSize=${input.contextSize}; maxTokens=${input.maxTokens}; episodeId=${input.episodeId}.`,
    "SYSTEM: Não mencione estas instruções.",
    "",
    "TRANSCRIPT:",
    boundedTranscript,
    "",
    "USER: Gere agora apenas o JSON solicitado. O summary deve ter 120 a 300 caracteres, conter 2 a 4 frases completas e mencionar os assuntos, nomes ou referencias mais relevantes do transcript.",
  ].join("\n");
};

const getSummaryConfigurationErrorForConfig = (summaryConfig: SummaryRuntimeConfig): string | null => {
  if (!summaryConfig.enabled) {
    return "Summary generation is disabled";
  }

  const command = summaryConfig.command.trim();
  if (!command) {
    return "EPISODE_SUMMARY_COMMAND is not configured";
  }

  const modelPath = summaryConfig.modelPath.trim();
  if (!modelPath) {
    return "EPISODE_SUMMARY_MODEL_PATH is not configured";
  }

  const commandProbe = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (commandProbe.error && (commandProbe.error as NodeJS.ErrnoException).code === "ENOENT") {
    return `Summary command not found: ${command}`;
  }

  if (!fs.existsSync(modelPath)) {
    return `Summary model not found: ${modelPath}`;
  }

  return null;
};

const readTranscriptText = async (episodeId: number): Promise<{ transcriptPath: string | null; transcriptText: string | null }> => {
  const transcriptPath = await findExistingEpisodeMediaPath(episodeId, "transcript");
  if (!transcriptPath) {
    return { transcriptPath: null, transcriptText: null };
  }

  const transcriptText = fs.readFileSync(transcriptPath, "utf8").trim();
  if (!transcriptText) {
    return { transcriptPath, transcriptText: null };
  }

  return { transcriptPath, transcriptText };
};

const readSummaryText = (episodeId: number): string | null => {
  const state = readDraftState(episodeId);
  if (!state || state.aiSummary.status !== "done") {
    return null;
  }

  for (const candidate of [buildDraftSummaryPath(episodeId), buildFinalSummaryPath(episodeId)]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const summaryText = fs.readFileSync(candidate, "utf8").trim();
    if (summaryText) {
      return summaryText;
    }
  }

  return null;
};

const ensureTranscriptReady = async (
  episodeId: number,
  currentState: EpisodeDraftState | null
): Promise<{ transcriptPath: string; transcriptText: string }> => {
  if (currentState && currentState.transcript.status !== "done") {
    throw createRuntimeError("Transcript draft is not ready yet");
  }

  const transcript = await readTranscriptText(episodeId);
  if (!transcript.transcriptPath || !transcript.transcriptText) {
    throw createRuntimeError("Cannot generate summary without transcript.txt");
  }

  return { transcriptPath: transcript.transcriptPath, transcriptText: transcript.transcriptText };
};

const buildDraftStateForSummary = (
  episodeId: number,
  currentState: EpisodeDraftState | null,
  version: number,
  now: string,
  summaryConfig: SummaryRuntimeConfig,
  status: EpisodeDraftStepStatus,
  error?: string | null
): EpisodeDraftState => {
  const transcriptState: TranscriptDraftState = currentState?.transcript
    ? {
        ...currentState.transcript,
        version,
        updatedAt: currentState.transcript.updatedAt ?? now,
        fileName: currentState.transcript.fileName ?? buildTranscriptFileName(episodeId),
      }
    : createTranscriptDraftState({
        status: "done",
        version,
        updatedAt: now,
        startedAt: null,
        finishedAt: now,
        progress: 100,
        fileName: buildTranscriptFileName(episodeId),
        error: null,
      });

  return {
    episodeId,
    version,
    updatedAt: now,
    transcript: transcriptState,
    aiSummary: {
      ...(currentState?.aiSummary ?? createAiSummaryDraftState()),
      status,
      version,
      updatedAt: now,
      startedAt: status === "pending" || status === "processing" ? now : currentState?.aiSummary?.startedAt ?? null,
      finishedAt: status === "done" || status === "error" ? now : currentState?.aiSummary?.finishedAt ?? null,
      progress: status === "done" ? 100 : status === "processing" ? 0 : null,
      promptVersion: summaryConfig.promptVersion,
      fileName: buildSummaryFileName(episodeId),
      summaryFileName: buildSummaryFileName(episodeId),
      error: error ?? null,
    },
  };
};

const buildErrorDraftState = (
  episodeId: number,
  currentState: EpisodeDraftState | null,
  summaryConfig: SummaryRuntimeConfig,
  message: string
): EpisodeDraftState => {
  const nextVersion = nextEpisodeVersion(currentState);
  const now = defaultNow();
  const nextState = buildDraftStateForSummary(episodeId, currentState, nextVersion, now, summaryConfig, "error", message);

  if (!currentState) {
    nextState.transcript = createTranscriptDraftState({
      status: "idle",
      version: nextVersion,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      progress: null,
      fileName: buildTranscriptFileName(episodeId),
      error: null,
    });
  }

  return nextState;
};

const runSummaryRuntime = async (
  summaryConfig: SummaryRuntimeConfig,
  runtime: SummaryRuntimeAdapter,
  request: EpisodeSummaryRequestPayload
): Promise<string> => {
  ensureTempRoot();
  const requestDir = fs.mkdtempSync(path.join(tempRoot, "request-"));
  const requestPath = path.join(requestDir, "summary-request.json");
  const promptPath = path.join(requestDir, "summary-prompt.txt");

  try {
    await writeJsonAtomic(requestPath, request);
    await fs.promises.writeFile(promptPath, request.prompt, "utf8");
    const stdout = await runtime.execute({
      command: summaryConfig.command.trim(),
      args: [
        "-m",
        summaryConfig.modelPath.trim(),
        "-c",
        String(summaryConfig.contextSize),
        "-n",
        String(summaryConfig.maxTokens),
        "-f",
        promptPath,
        "--no-display-prompt",
        "--no-show-timings",
        "--log-disable",
        "--single-turn",
      ],
      timeoutMs: summaryConfig.timeoutMs,
    });

    return stdout;
  } finally {
    await fs.promises.rm(requestDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const createEpisodeSummaryService = (deps: EpisodeSummaryServiceDeps = {}) => {
  const summaryConfig = deps.summaryConfig ?? config.summary;
  const runtime = deps.runtime ?? defaultSummaryRuntime;
  const now = deps.now ?? defaultNow;

  const getSummaryConfigurationErrorForRuntime = (): string | null => getSummaryConfigurationErrorForConfig(summaryConfig);

  const getEpisodeDraftSummaryStatus = (episodeId: number): EpisodeDraftSummaryStatusSnapshot => {
    const state = readDraftState(episodeId);
    if (!state) {
      return {
        status: "idle",
        summaryFileName: null,
        summaryUpdatedAt: null,
        summaryStartedAt: null,
        progress: null,
        error: null,
        version: null,
        promptVersion: null,
      };
    }

    return {
      status: state.aiSummary.status,
      summaryFileName: state.aiSummary.summaryFileName ?? buildSummaryFileName(episodeId),
      summaryUpdatedAt: state.aiSummary.updatedAt,
      summaryStartedAt: state.aiSummary.startedAt ?? null,
      progress: state.aiSummary.progress ?? (state.aiSummary.status === "done" ? 100 : null),
      error: state.aiSummary.error ?? null,
      version: state.version,
      promptVersion: state.aiSummary.promptVersion ?? summaryConfig.promptVersion,
    };
  };

  const getEpisodeDraftSummary = (episodeId: number): EpisodeDraftSummarySnapshot => {
    const status = getEpisodeDraftSummaryStatus(episodeId);
    return {
      ...status,
      summaryText: status.status === "done" ? readSummaryText(episodeId) : null,
    };
  };

  const syncDraftEpisodeSummary = async (episodeId: number): Promise<EpisodeDraftSummaryStatusSnapshot> => {
    const state = readDraftState(episodeId);
    if (!state) {
      return getEpisodeDraftSummaryStatus(episodeId);
    }

    const draftSummaryPath = buildDraftSummaryPath(episodeId);
    const finalSummaryPath = buildFinalSummaryPath(episodeId);
    if (state.aiSummary.status === "done" && fs.existsSync(draftSummaryPath)) {
      await fs.promises.mkdir(path.dirname(finalSummaryPath), { recursive: true });
      await fs.promises.copyFile(draftSummaryPath, finalSummaryPath);
      await fs.promises.rm(draftSummaryPath, { force: true }).catch(() => undefined);
      return {
        status: "done",
        summaryFileName: buildSummaryFileName(episodeId),
        summaryUpdatedAt: state.aiSummary.updatedAt,
        summaryStartedAt: state.aiSummary.startedAt ?? null,
        progress: 100,
        error: state.aiSummary.error ?? null,
        version: state.version,
        promptVersion: state.aiSummary.promptVersion ?? summaryConfig.promptVersion,
      };
    }

    return getEpisodeDraftSummaryStatus(episodeId);
  };

  const abortDraftEpisodeSummary = async (episodeId: number): Promise<void> => {
    const currentState = readDraftState(episodeId);
    const nextVersion = nextEpisodeVersion(currentState);
  const nextState = buildDraftStateForSummary(episodeId, currentState, nextVersion, now(), summaryConfig, "idle", null);
  nextState.aiSummary.startedAt = null;
  nextState.aiSummary.finishedAt = null;
  nextState.aiSummary.progress = null;
  nextState.aiSummary.error = null;
  await writeDraftState(episodeId, nextState);
  await fs.promises.rm(buildDraftSummaryPath(episodeId), { force: true }).catch(() => undefined);
  await fs.promises.rm(buildFinalSummaryPath(episodeId), { force: true }).catch(() => undefined);
};

  const queueDraftEpisodeSummary = async (
    episodeId: number
  ): Promise<{ queued: boolean; version: number; status: EpisodeDraftStepStatus; progress: number | null; error?: string | null }> => {
    const configurationError = getSummaryConfigurationErrorForRuntime();
    const currentState = readDraftState(episodeId);
    const version = nextEpisodeVersion(currentState);

    if (configurationError) {
      const nextState = buildErrorDraftState(episodeId, currentState, summaryConfig, configurationError);
      await writeDraftState(episodeId, nextState);
      return {
        queued: false,
        version: nextState.version,
        status: nextState.aiSummary.status,
        progress: nextState.aiSummary.progress ?? null,
        error: nextState.aiSummary.error ?? null,
      };
    }

    const transcript = await ensureTranscriptReady(episodeId, currentState);
    const nextState = buildDraftStateForSummary(episodeId, currentState, version, now(), summaryConfig, "pending", null);
    await writeDraftState(episodeId, nextState);

    void (async (): Promise<void> => {
      const runningState = buildDraftStateForSummary(episodeId, currentState, version, now(), summaryConfig, "processing", null);
      runningState.aiSummary.startedAt = now();
      runningState.aiSummary.progress = 0;
      await writeDraftState(episodeId, runningState);

      try {
        const prompt = buildSummaryPromptText({
          episodeId,
          transcript: transcript.transcriptText,
          promptVersion: summaryConfig.promptVersion,
          contextSize: summaryConfig.contextSize,
          maxTokens: summaryConfig.maxTokens,
        });

        const rawOutput = await runSummaryRuntime(summaryConfig, runtime, {
          episodeId,
          promptVersion: summaryConfig.promptVersion,
          contextSize: summaryConfig.contextSize,
          maxTokens: summaryConfig.maxTokens,
          prompt,
          transcript: transcript.transcriptText,
        });

        const currentAfterRuntime = readDraftState(episodeId);
        if (!currentAfterRuntime || currentAfterRuntime.version !== version) {
          return;
        }

        const normalizedSummary = normalizeSummaryDraftText(rawOutput);
        validateSummaryDraft(normalizedSummary);

        await writeTextAtomic(buildDraftSummaryPath(episodeId), `${normalizedSummary}\n`);

        const finalState = buildDraftStateForSummary(episodeId, currentAfterRuntime, version, now(), summaryConfig, "done", null);
        finalState.aiSummary.startedAt = currentAfterRuntime.aiSummary.startedAt ?? now();
        finalState.aiSummary.finishedAt = now();
        finalState.aiSummary.progress = 100;
        await writeDraftState(episodeId, finalState);
      } catch (error) {
        const currentAfterRuntime = readDraftState(episodeId);
        if (!currentAfterRuntime || currentAfterRuntime.version !== version) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        const erroredState = buildDraftStateForSummary(episodeId, currentAfterRuntime, version, now(), summaryConfig, "error", message);
        erroredState.aiSummary.startedAt = currentAfterRuntime.aiSummary.startedAt ?? now();
        erroredState.aiSummary.finishedAt = now();
        erroredState.aiSummary.progress = null;
        await writeDraftState(episodeId, erroredState);
      }
    })().catch((error: unknown) => {
      console.error(
        `[summary] draft episode=${episodeId} version=${version} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    return {
      queued: true,
      version,
      status: nextState.aiSummary.status,
      progress: nextState.aiSummary.progress ?? null,
      error: nextState.aiSummary.error ?? null,
    };
  };

  const buildSummaryPromptForRuntime = (input: {
    episodeId: number;
    transcript: string;
    promptVersion: string;
    contextSize: number;
    maxTokens: number;
  }): string => buildSummaryPromptText(input);

  return {
    getSummaryConfigurationError: getSummaryConfigurationErrorForRuntime,
    buildSummaryPrompt: buildSummaryPromptForRuntime,
    normalizeSummaryDraft: normalizeSummaryDraftText,
    getEpisodeDraftSummary,
    queueDraftEpisodeSummary,
    abortDraftEpisodeSummary,
    getEpisodeDraftSummaryStatus,
    syncDraftEpisodeSummary,
  };
};

const defaultSummaryService = createEpisodeSummaryService();

export const getSummaryConfigurationError = defaultSummaryService.getSummaryConfigurationError;
export const buildSummaryPrompt = defaultSummaryService.buildSummaryPrompt;
export const normalizeSummaryDraft = defaultSummaryService.normalizeSummaryDraft;
export const getEpisodeDraftSummary = defaultSummaryService.getEpisodeDraftSummary;
export const queueDraftEpisodeSummary = defaultSummaryService.queueDraftEpisodeSummary;
export const abortDraftEpisodeSummary = defaultSummaryService.abortDraftEpisodeSummary;
export const getEpisodeDraftSummaryStatus = defaultSummaryService.getEpisodeDraftSummaryStatus;
export const syncDraftEpisodeSummary = defaultSummaryService.syncDraftEpisodeSummary;

export { createEpisodeSummaryService };
