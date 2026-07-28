export type EpisodeDraftStepStatus = "idle" | "pending" | "processing" | "done" | "error";

export type EpisodeDraftStepState = {
  status: EpisodeDraftStepStatus;
  version: number;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: number | null;
  promptVersion: string | null;
  fileName: string | null;
  error: string | null;
};

export type TranscriptDraftState = EpisodeDraftStepState;

export type AiSummaryDraftState = EpisodeDraftStepState & {
  summaryFileName: string | null;
};

export type EpisodeDraftState = {
  episodeId: number;
  version: number;
  updatedAt: string;
  transcript: TranscriptDraftState;
  aiSummary: AiSummaryDraftState;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isStatus = (value: unknown): value is EpisodeDraftStepStatus =>
  value === "idle" || value === "pending" || value === "processing" || value === "done" || value === "error";

const toIsoString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const toNullableString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const toNullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeStepState = (
  value: unknown,
  fallback: {
    status?: EpisodeDraftStepStatus;
    version?: number;
    updatedAt?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    progress?: number | null;
    promptVersion?: string | null;
    fileName?: string | null;
    error?: string | null;
  } = {}
): EpisodeDraftStepState => {
  const now = new Date().toISOString();
  const record = isRecord(value) ? value : {};
  return {
    status: isStatus(record.status) ? record.status : fallback.status ?? "idle",
    version: typeof record.version === "number" && Number.isFinite(record.version) ? record.version : fallback.version ?? 0,
    updatedAt: toIsoString(record.updatedAt, fallback.updatedAt ?? now),
    startedAt: toNullableString(record.startedAt) ?? fallback.startedAt ?? null,
    finishedAt: toNullableString(record.finishedAt) ?? fallback.finishedAt ?? null,
    progress: toNullableNumber(record.progress) ?? fallback.progress ?? null,
    promptVersion: toNullableString(record.promptVersion) ?? fallback.promptVersion ?? null,
    fileName: toNullableString(record.fileName) ?? fallback.fileName ?? null,
    error: toNullableString(record.error) ?? fallback.error ?? null,
  };
};

const normalizeSummaryStepState = (
  value: unknown,
  fallback: {
    status?: EpisodeDraftStepStatus;
    version?: number;
    updatedAt?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    progress?: number | null;
    promptVersion?: string | null;
    fileName?: string | null;
    summaryFileName?: string | null;
    error?: string | null;
  } = {}
): AiSummaryDraftState => {
  const step = normalizeStepState(value, fallback);
  const record = isRecord(value) ? value : {};
  return {
    ...step,
    fileName: step.fileName ?? fallback.fileName ?? null,
    summaryFileName: toNullableString(record.summaryFileName) ?? fallback.summaryFileName ?? null,
  };
};

export const createTranscriptDraftState = (overrides: Partial<TranscriptDraftState> = {}): TranscriptDraftState => ({
  status: overrides.status ?? "idle",
  version: overrides.version ?? 0,
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  startedAt: overrides.startedAt ?? null,
  finishedAt: overrides.finishedAt ?? null,
  progress: overrides.progress ?? null,
  promptVersion: overrides.promptVersion ?? null,
  fileName: overrides.fileName ?? null,
  error: overrides.error ?? null,
});

export const createAiSummaryDraftState = (overrides: Partial<AiSummaryDraftState> = {}): AiSummaryDraftState => ({
  status: overrides.status ?? "idle",
  version: overrides.version ?? 0,
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  startedAt: overrides.startedAt ?? null,
  finishedAt: overrides.finishedAt ?? null,
  progress: overrides.progress ?? null,
  promptVersion: overrides.promptVersion ?? null,
  fileName: overrides.fileName ?? null,
  error: overrides.error ?? null,
  summaryFileName: overrides.summaryFileName ?? null,
});

export const createEpisodeDraftState = (episodeId: number, overrides: Partial<EpisodeDraftState> = {}): EpisodeDraftState => ({
  episodeId,
  version: overrides.version ?? 0,
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  transcript: createTranscriptDraftState(overrides.transcript ?? {}),
  aiSummary: createAiSummaryDraftState(overrides.aiSummary ?? {}),
});

export const normalizeEpisodeDraftState = (value: unknown, episodeId?: number): EpisodeDraftState | null => {
  if (!isRecord(value)) {
    return null;
  }

  const parsedEpisodeId = typeof value.episodeId === "number" && Number.isFinite(value.episodeId) ? value.episodeId : null;
  if (episodeId != null && parsedEpisodeId != null && parsedEpisodeId !== episodeId) {
    return null;
  }

  const resolvedEpisodeId = episodeId ?? parsedEpisodeId;
  if (resolvedEpisodeId == null) {
    return null;
  }

  if ("transcript" in value || "aiSummary" in value) {
    const version = typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 0;
    const updatedAt = toIsoString(value.updatedAt, new Date().toISOString());
    return {
      episodeId: resolvedEpisodeId,
      version,
      updatedAt,
      transcript: createTranscriptDraftState({
        ...normalizeStepState(value.transcript, {
          version,
          updatedAt,
          fileName: null,
        }),
        fileName: toNullableString(isRecord(value.transcript) ? value.transcript.fileName : null),
      }),
      aiSummary: normalizeSummaryStepState(value.aiSummary, {
        version,
        updatedAt,
        fileName: null,
        summaryFileName: null,
      }),
    };
  }

  if (isStatus(value.status)) {
    const version = typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 0;
    const updatedAt = toIsoString(value.updatedAt, new Date().toISOString());
    return {
      episodeId: resolvedEpisodeId,
      version,
      updatedAt,
      transcript: createTranscriptDraftState({
        status: value.status,
        version,
        updatedAt,
        startedAt: toNullableString(value.startedAt),
        finishedAt: null,
        progress: toNullableNumber(value.progress),
        promptVersion: toNullableString(value.promptVersion),
        fileName: toNullableString(value.fileName),
        error: toNullableString(value.error),
      }),
      aiSummary: createAiSummaryDraftState({
        status: "idle",
        version,
        updatedAt,
        fileName: null,
        summaryFileName: null,
      }),
    };
  }

  return {
    episodeId: resolvedEpisodeId,
    version: typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 0,
    updatedAt: toIsoString(value.updatedAt, new Date().toISOString()),
    transcript: createTranscriptDraftState(),
    aiSummary: createAiSummaryDraftState(),
  };
};
