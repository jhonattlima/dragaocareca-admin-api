export type EpisodeDraftStepStatus = "idle" | "pending" | "processing" | "done" | "error";

// Trailer-video draft reservations are intentionally separate from the AI/transcription
// draft state below: the opaque token is an authenticated capability, not browser state.
export type EpisodeTrailerVideoDraftLifecycle = "reserved" | "staged" | "consumed" | "expired";

export type EpisodeTrailerVideoDraftReservation = {
  draftId: string;
  episodeId: number;
  ownerEmail: string;
  createdAt: string;
  expiresAt: string;
  state: EpisodeTrailerVideoDraftLifecycle;
};

export type EpisodeTrailerVideoDraftDto = Omit<EpisodeTrailerVideoDraftReservation, "ownerEmail" | "createdAt"> & {
  state: "reserved";
};

export type EpisodeTrailerVideoUploadResponse = {
  episodeId: number;
  draftId: string | null;
  state: "staged" | "finalized";
  trailerVideoFileName: string | null;
  trailerVideoSyncStatus?: "unpublished" | "manual-sync-required" | "synced";
  message: string;
};

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
  provider?: string | null;
};

export type TranscriptDraftState = EpisodeDraftStepState;

export type AiSummaryDraftState = EpisodeDraftStepState & {
  summaryFileName: string | null;
};

export type SafeTagErrorCategory =
  | "disabled"
  | "missing_credentials"
  | "unauthorized"
  | "quota_exhausted"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_provider_response";

export type SuggestedTagCandidate = {
  displayTag: string;
  normalizedTag: string;
  relevant: boolean;
  relevanceScore: number;
};

export type SuggestedTagRetrieval = {
  displayTag: string;
  normalizedTag: string;
  approximateCount: number;
  retrievedAt: string;
  cacheStatus: "hit" | "miss";
  regionCode: string;
  relevanceLanguage: string;
};

export type SuggestedTagSuggestion = SuggestedTagRetrieval & {
  relevanceScore: number;
};

export type SuggestedTagsDraftState = {
  status: "idle" | "pending" | "processing" | "done" | "unavailable";
  version: number;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryAt: string | null;
  errorCategory: SafeTagErrorCategory | null;
  promptVersion: string | null;
  summaryDigest: string | null;
  attemptCount: number;
  candidates: SuggestedTagCandidate[];
  retrievals: SuggestedTagRetrieval[];
  suggestions: SuggestedTagSuggestion[];
  provider?: string | null;
};

export type EpisodeDraftState = {
  episodeId: number;
  version: number;
  updatedAt: string;
  transcript: TranscriptDraftState;
  aiSummary: AiSummaryDraftState;
  suggestedTags: SuggestedTagsDraftState;
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

const safeTagErrorCategories: SafeTagErrorCategory[] = [
  "disabled",
  "missing_credentials",
  "unauthorized",
  "quota_exhausted",
  "rate_limited",
  "provider_unavailable",
  "invalid_provider_response",
];

const isSafeTagErrorCategory = (value: unknown): value is SafeTagErrorCategory =>
  typeof value === "string" && safeTagErrorCategories.includes(value as SafeTagErrorCategory);

const boundedAttemptCount = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) ? Math.min(20, Math.max(0, value)) : 0;

const boundedScore = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;

const boundedApproximateCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;

export const normalizeHashtagTag = (value: unknown): { displayTag: string; normalizedTag: string } | null => {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  const withoutHash = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (!withoutHash || /[\u0000-\u001f\u007f]/u.test(withoutHash) || /\s/u.test(withoutHash)) return null;
  const canonical = withoutHash.toLowerCase();
  return { displayTag: `#${canonical}`, normalizedTag: `#${canonical}` };
};

const normalizeSuggestedTags = (value: unknown, version: number, updatedAt: string): SuggestedTagsDraftState => {
  const record = isRecord(value) ? value : {};
  const status = record.status === "pending" || record.status === "processing" || record.status === "done" || record.status === "unavailable" ? record.status : "idle";
  const candidates = Array.isArray(record.candidates)
    ? record.candidates.flatMap((candidate): SuggestedTagCandidate[] => {
        if (!isRecord(candidate)) return [];
        const tag = normalizeHashtagTag(candidate.displayTag ?? candidate.normalizedTag);
        const relevanceScore = boundedScore(candidate.relevanceScore);
        if (!tag || typeof candidate.relevant !== "boolean" || relevanceScore == null) return [];
        return [{ ...tag, relevant: candidate.relevant, relevanceScore }];
      })
    : [];
  const normalizeRetrievals = (retrievals: unknown): SuggestedTagRetrieval[] =>
    Array.isArray(retrievals)
      ? retrievals.flatMap((retrieval): SuggestedTagRetrieval[] => {
          if (!isRecord(retrieval)) return [];
          const tag = normalizeHashtagTag(retrieval.displayTag ?? retrieval.normalizedTag);
          const approximateCount = boundedApproximateCount(retrieval.approximateCount);
          if (!tag || approximateCount == null || typeof retrieval.retrievedAt !== "string" || !retrieval.retrievedAt.trim()) return [];
          const cacheStatus = retrieval.cacheStatus === "hit" || retrieval.cacheStatus === "miss" ? retrieval.cacheStatus : null;
          if (!cacheStatus || typeof retrieval.regionCode !== "string" || typeof retrieval.relevanceLanguage !== "string") return [];
          return [{ ...tag, approximateCount, retrievedAt: retrieval.retrievedAt, cacheStatus, regionCode: retrieval.regionCode, relevanceLanguage: retrieval.relevanceLanguage }];
        })
      : [];
  const retrievals = normalizeRetrievals(record.retrievals);
  const suggestions = Array.isArray(record.suggestions)
    ? record.suggestions.flatMap((suggestion): SuggestedTagSuggestion[] => {
        const normalized = normalizeRetrievals([suggestion])[0];
        const relevanceScore = isRecord(suggestion) ? boundedScore(suggestion.relevanceScore) : null;
        return normalized && relevanceScore != null ? [{ ...normalized, relevanceScore }] : [];
      })
    : [];
  return {
    status,
    version,
    updatedAt: toIsoString(record.updatedAt, updatedAt),
    startedAt: toNullableString(record.startedAt),
    finishedAt: toNullableString(record.finishedAt),
    retryAt: toNullableString(record.retryAt),
    errorCategory: isSafeTagErrorCategory(record.errorCategory) ? record.errorCategory : null,
    promptVersion: toNullableString(record.promptVersion),
    summaryDigest: toNullableString(record.summaryDigest),
    attemptCount: boundedAttemptCount(record.attemptCount),
    candidates,
    retrievals,
    suggestions,
    provider: toNullableString(record.provider),
  };
};

export const createSuggestedTagsDraftState = (overrides: Partial<SuggestedTagsDraftState> = {}): SuggestedTagsDraftState => ({
  status: overrides.status ?? "idle",
  version: overrides.version ?? 0,
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  startedAt: overrides.startedAt ?? null,
  finishedAt: overrides.finishedAt ?? null,
  retryAt: overrides.retryAt ?? null,
  errorCategory: overrides.errorCategory ?? null,
  promptVersion: overrides.promptVersion ?? null,
  summaryDigest: overrides.summaryDigest ?? null,
  attemptCount: boundedAttemptCount(overrides.attemptCount),
  candidates: overrides.candidates ?? [],
  retrievals: overrides.retrievals ?? [],
  suggestions: overrides.suggestions ?? [],
  provider: overrides.provider ?? null,
});

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
    provider?: string | null;
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
    provider: toNullableString(record.provider) ?? fallback.provider ?? null,
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
  provider: overrides.provider ?? null,
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
  provider: overrides.provider ?? null,
  summaryFileName: overrides.summaryFileName ?? null,
});

export const createEpisodeDraftState = (episodeId: number, overrides: Partial<EpisodeDraftState> = {}): EpisodeDraftState => ({
  episodeId,
  version: overrides.version ?? 0,
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  transcript: createTranscriptDraftState(overrides.transcript ?? {}),
  aiSummary: createAiSummaryDraftState(overrides.aiSummary ?? {}),
  suggestedTags: createSuggestedTagsDraftState({ ...(overrides.suggestedTags ?? {}), version: overrides.suggestedTags?.version ?? overrides.version ?? 0 }),
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
      suggestedTags: normalizeSuggestedTags(value.suggestedTags, version, updatedAt),
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
      suggestedTags: createSuggestedTagsDraftState({ version, updatedAt }),
    };
  }

  return {
    episodeId: resolvedEpisodeId,
    version: typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 0,
    updatedAt: toIsoString(value.updatedAt, new Date().toISOString()),
    transcript: createTranscriptDraftState(),
    aiSummary: createAiSummaryDraftState(),
    suggestedTags: createSuggestedTagsDraftState(),
  };
};
