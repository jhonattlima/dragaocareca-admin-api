import { z } from "zod";
import { config } from "../config/env";
import { normalizeHashtagTag, type SuggestedTagCandidate, type SuggestedTagRetrieval, type SuggestedTagSuggestion } from "../schemas/episode-draft-state";
import { createYouTubeHashtagSearchService, type HashtagLookupResult } from "./youtube-hashtag-search.service";

const candidateSchema = z.object({
  tag: z.string().min(1).max(100),
  relevant: z.boolean(),
  relevanceScore: z.number().int().min(0).max(100),
});

const responseSchema = z.object({ candidates: z.array(candidateSchema) });
export type GeminiTagCandidate = z.infer<typeof candidateSchema>;
export type GeminiTagResponse = z.infer<typeof responseSchema>;

export type HashtagAuthoringOutcome = {
  status: "done" | "unavailable";
  errorCategory: "disabled" | "provider_unavailable" | "invalid_provider_response" | "quota_exhausted" | "rate_limited" | "unauthorized" | "missing_credentials" | null;
  retryAt: string | null;
  candidates: SuggestedTagCandidate[];
  retrievals: SuggestedTagRetrieval[];
  suggestions: SuggestedTagSuggestion[];
};

export type GenerateCandidates = (input: { transcript: string; summary: string }) => Promise<unknown>;

const geminiCandidateJsonSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      minItems: 50,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          tag: { type: "string" },
          relevant: { type: "boolean" },
          relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["tag", "relevant", "relevanceScore"],
      },
    },
  },
  required: ["candidates"],
};

const buildPrompt = (transcript: string, summary: string): string => [
  "Você sugere hashtags para um vídeo do episódio do podcast.",
  "Responda somente com o objeto JSON solicitado. Gere exatamente 50 registros.",
  "Use apenas fatos sustentados pelo transcript e pelo summary abaixo. Não invente entidades, eventos ou temas.",
  "Marque relevant=false para termos genéricos, desconectados ou não sustentados. Dê relevanceScore inteiro de 0 a 100.",
  "Cada tag deve ser um termo único, sem espaços, com no máximo um # inicial.",
  "<TRANSCRIPT_UNTRUSTED>", transcript, "</TRANSCRIPT_UNTRUSTED>",
  "<SUMMARY_UNTRUSTED>", summary, "</SUMMARY_UNTRUSTED>",
].join("\n");

const defaultGenerateCandidates: GenerateCandidates = async ({ transcript, summary }) => {
  if (!config.summary.geminiApiKey.trim()) throw Object.assign(new Error("Gemini credentials unavailable"), { code: "missing_credentials" });
  const endpoint = `${config.summary.geminiApiBaseUrl}/models/${encodeURIComponent(config.youtube.hashtagAuthoring.geminiModel)}:generateContent?key=${encodeURIComponent(config.summary.geminiApiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(transcript, summary) }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: geminiCandidateJsonSchema },
    }),
    signal: AbortSignal.timeout(config.youtube.hashtagAuthoring.requestTimeoutMs),
  });
  if (!response.ok) throw new Error("Gemini hashtag generation failed");
  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no hashtag candidates");
  return JSON.parse(text) as unknown;
};

export const validateGeminiTagCandidates = (value: unknown): SuggestedTagCandidate[] => {
  const parsed = responseSchema.parse(value);
  if (parsed.candidates.length !== 50) throw new Error("Gemini must return exactly 50 hashtag candidates");
  const byNormalized = new Map<string, SuggestedTagCandidate>();
  for (const candidate of parsed.candidates) {
    const normalized = normalizeHashtagTag(candidate.tag);
    if (!normalized) throw new Error("Gemini returned an invalid hashtag candidate");
    if (byNormalized.has(normalized.normalizedTag)) throw new Error("Gemini returned duplicate hashtag candidates");
    byNormalized.set(normalized.normalizedTag, { ...normalized, relevant: candidate.relevant, relevanceScore: candidate.relevanceScore });
  }
  if (byNormalized.size !== 50) throw new Error("Gemini must return 50 unique normalized hashtag candidates");
  return [...byNormalized.values()];
};

const lookupToRetrieval = (lookup: HashtagLookupResult): SuggestedTagRetrieval | null =>
  lookup.ok && lookup.approximateCount != null && lookup.retrievedAt
    ? {
        displayTag: lookup.displayTag,
        normalizedTag: lookup.normalizedTag,
        approximateCount: lookup.approximateCount,
        retrievedAt: lookup.retrievedAt,
        cacheStatus: lookup.cacheStatus === "hit" ? "hit" : "miss",
        regionCode: lookup.regionCode,
        relevanceLanguage: lookup.relevanceLanguage,
      }
    : null;

const outcomeError = (error: unknown): HashtagAuthoringOutcome["errorCategory"] => {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "missing_credentials") return "missing_credentials";
  return error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && /exactly 50|invalid hashtag|duplicate/i.test(error.message)
    ? "invalid_provider_response"
    : "provider_unavailable";
};

export const createEpisodeHashtagAuthoringService = (options: { generateCandidates?: GenerateCandidates; lookupService?: ReturnType<typeof createYouTubeHashtagSearchService> } = {}) => {
  const generateCandidates = options.generateCandidates ?? defaultGenerateCandidates;
  const lookupService = options.lookupService ?? createYouTubeHashtagSearchService();

  const author = async (transcript: string, summary: string): Promise<HashtagAuthoringOutcome> => {
    try {
      const candidates = validateGeminiTagCandidates(await generateCandidates({ transcript, summary }));
      const retrievals: SuggestedTagRetrieval[] = [];
      const lookupResults: Array<{ candidate: SuggestedTagCandidate; retrieval: SuggestedTagRetrieval }> = [];
      let failure: HashtagLookupResult | null = null;
      for (const candidate of candidates) {
        const lookup = await lookupService.lookup(candidate.normalizedTag, "automatic");
        const retrieval = lookupToRetrieval(lookup);
        if (!retrieval) {
          failure = lookup;
          continue;
        }
        retrievals.push(retrieval);
        lookupResults.push({ candidate, retrieval });
      }
      if (failure) {
        return { status: "unavailable", errorCategory: failure.errorCategory, retryAt: failure.retryAt, candidates, retrievals, suggestions: [] };
      }
      const suggestions = lookupResults
        .filter(({ candidate }) => candidate.relevant)
        // YouTube's totalResults is approximate and capped at 1,000,000. It is
        // useful as an availability signal, but must not outrank semantic fit.
        .sort((a, b) => b.candidate.relevanceScore - a.candidate.relevanceScore || a.candidate.normalizedTag.localeCompare(b.candidate.normalizedTag))
        .slice(0, 3)
        .map(({ candidate, retrieval }) => ({ ...retrieval, relevanceScore: candidate.relevanceScore }));
      return { status: "done", errorCategory: null, retryAt: null, candidates, retrievals, suggestions };
    } catch (error) {
      return { status: "unavailable", errorCategory: outcomeError(error), retryAt: new Date(Date.now() + config.youtube.hashtagAuthoring.retryDelaysMs[0]).toISOString(), candidates: [], retrievals: [], suggestions: [] };
    }
  };

  return { author };
};
