import { z } from "zod";
import { config } from "../config/env";
import { normalizeHashtagTag, type SuggestedTagCandidate, type SuggestedTagRetrieval, type SuggestedTagSuggestion } from "../schemas/episode-draft-state";
import { createYouTubeHashtagSearchService, type HashtagLookupResult } from "./youtube-hashtag-search.service";
import { GroqRateLimitError, groqRetryAfterMs, runGroqRateLimited } from "./groq-rate-limiter.service";

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
  provider?: "gemini" | "groq" | null;
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
      minItems: 0,
      maxItems: 70,
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

const sampleTranscriptForHashtags = (transcript: string): string => {
  const normalized = transcript.trim();
  const maxCharacters = 9_000;
  if (normalized.length <= maxCharacters) return normalized;
  const firstPart = Math.floor(maxCharacters * 0.65);
  const lastPart = maxCharacters - firstPart;
  return `${normalized.slice(0, firstPart)}\n\n[trecho intermediário omitido para limite de contexto]\n\n${normalized.slice(-lastPart)}`;
};

const buildPrompt = (transcript: string, summary: string): string => [
  "Você sugere hashtags para um vídeo do episódio do podcast.",
  "Responda somente com o objeto JSON solicitado. Gere entre 60 e 70 registros para permitir a remoção de duplicatas.",
  "Use apenas fatos sustentados pelo transcript e pelo summary abaixo. Não invente entidades, eventos ou temas.",
  "Não sugira o nome do programa, da marca, do podcast, nomes recorrentes do canal ou termos que serviriam para qualquer episódio.",
  "Não sugira números ou códigos de episódio, títulos de episódios anteriores, referências negadas, piadas isoladas, chamadas de abertura ou menções incidentais.",
  "Uma palavra ou assunto mencionado uma única vez em uma piada não é tema central: marque relevant=false e não o priorize.",
  "Priorize somente assuntos centrais desta conversa que tenham potencial de busca no YouTube; descarte tags genéricas ou sem relevância de pesquisa.",
  "Marque relevant=false para termos genéricos, desconectados ou não sustentados. Dê relevanceScore inteiro de 0 a 100.",
  "Cada tag deve ser um termo único, sem espaços, com no máximo um # inicial.",
  "<TRANSCRIPT_UNTRUSTED>", sampleTranscriptForHashtags(transcript), "</TRANSCRIPT_UNTRUSTED>",
  "<SUMMARY_UNTRUSTED>", summary, "</SUMMARY_UNTRUSTED>",
].join("\n");

const blockedGenericHashtags = new Set(["#dragaocareca", "#dragãocareca", "#podcast", "#episodio", "#episódio", "#programa", "#youtube"]);

const isBlockedGenericHashtag = (normalizedTag: string): boolean =>
  blockedGenericHashtags.has(normalizedTag) || /^#(?:dc|epis[oó]dio)\d+$/i.test(normalizedTag);

const parseProviderCandidates = (text: string): unknown => {
  let normalized = text.trim();
  const fenced = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) normalized = fenced[1].trim();

  const parsed = JSON.parse(normalized) as unknown;
  return Array.isArray(parsed) ? { candidates: parsed } : parsed;
};

const generateCandidatesWithProvider = async (provider: "gemini" | "groq", prompt: string): Promise<unknown> => {
  if (provider === "gemini") {
    if (!config.summary.geminiApiKey.trim()) throw Object.assign(new Error("Gemini credentials unavailable"), { code: "missing_credentials" });
    const endpoint = `${config.summary.geminiApiBaseUrl}/models/${encodeURIComponent(config.youtube.hashtagAuthoring.geminiModel)}:generateContent?key=${encodeURIComponent(config.summary.geminiApiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: geminiCandidateJsonSchema },
      }),
      signal: AbortSignal.timeout(config.youtube.hashtagAuthoring.requestTimeoutMs),
    });
    if (!response.ok) throw new Error("Gemini hashtag generation failed");
    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned no hashtag candidates");
    return parseProviderCandidates(text);
  }

  if (!config.summary.groqApiKey.trim()) throw Object.assign(new Error("Groq credentials unavailable"), { code: "missing_credentials" });
  const response = await runGroqRateLimited({
    estimatedTokens: Math.ceil(prompt.length / 4) + 4000,
    task: async () => {
      const result = await fetch(`${config.summary.groqApiBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${config.summary.groqApiKey.trim()}` },
        body: JSON.stringify({
          model: config.youtube.hashtagAuthoring.groqModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          reasoning_effort: "low",
          include_reasoning: false,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(config.youtube.hashtagAuthoring.requestTimeoutMs),
      });
      if (result.status === 429) throw new GroqRateLimitError(groqRetryAfterMs(result));
      return result;
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
  if (!response.ok) throw new Error(`Groq hashtag generation failed: ${payload.error?.message ?? response.status}`);
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned no hashtag candidates");
  return parseProviderCandidates(text);
};

const createDefaultGenerateCandidates = (onProvider: (provider: "gemini" | "groq") => void): GenerateCandidates => async ({ transcript, summary }) => {
  const prompt = buildPrompt(transcript, summary);
  const primaryProvider = config.youtube.hashtagAuthoring.primaryProvider;
  const fallbackProvider = config.youtube.hashtagAuthoring.provider;
  try {
    onProvider(primaryProvider);
    return await generateCandidatesWithProvider(primaryProvider, prompt);
  } catch (primaryError) {
    if (fallbackProvider === primaryProvider) throw primaryError;
    console.warn(
      `[hashtags] provider=${primaryProvider} failed; fallback=${fallbackProvider} error=${primaryError instanceof Error ? primaryError.message : String(primaryError)}`
    );
    onProvider(fallbackProvider);
    return generateCandidatesWithProvider(fallbackProvider, prompt);
  }
};

export const validateGeminiTagCandidates = (value: unknown): SuggestedTagCandidate[] => {
  const parsed = responseSchema.parse(value);
  const byNormalized = new Map<string, SuggestedTagCandidate>();
  for (const candidate of parsed.candidates) {
    const normalized = normalizeHashtagTag(candidate.tag);
    if (!normalized) continue;
    if (isBlockedGenericHashtag(normalized.normalizedTag)) continue;
    // Providers occasionally repeat a tag or vary only its casing/# prefix.
    // Deduplicate after normalization instead of discarding the whole result.
    if (byNormalized.has(normalized.normalizedTag)) continue;
    byNormalized.set(normalized.normalizedTag, { ...normalized, relevant: candidate.relevant, relevanceScore: candidate.relevanceScore });
  }
  return [...byNormalized.values()].slice(0, 50);
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
  let providerUsed: HashtagAuthoringOutcome["provider"] = config.youtube.hashtagAuthoring.primaryProvider;
  const generateCandidates = options.generateCandidates ?? createDefaultGenerateCandidates((provider) => {
    providerUsed = provider;
  });
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
        return { status: "unavailable", provider: providerUsed, errorCategory: failure.errorCategory, retryAt: failure.retryAt, candidates, retrievals, suggestions: [] };
      }
      const suggestions = lookupResults
        .filter(({ candidate }) => candidate.relevant)
        // YouTube's totalResults is approximate and capped at 1,000,000. It is
        // useful as an availability signal, but must not outrank semantic fit.
        .sort((a, b) => b.candidate.relevanceScore - a.candidate.relevanceScore || a.candidate.normalizedTag.localeCompare(b.candidate.normalizedTag))
        .slice(0, 3)
        .map(({ candidate, retrieval }) => ({ ...retrieval, relevanceScore: candidate.relevanceScore }));
      return { status: "done", provider: providerUsed, errorCategory: null, retryAt: null, candidates, retrievals, suggestions };
    } catch (error) {
      console.warn(`[hashtags] authoring unavailable provider=${providerUsed} category=${outcomeError(error)} message=${error instanceof Error ? error.message : "unknown error"}`);
      return { status: "unavailable", provider: providerUsed, errorCategory: outcomeError(error), retryAt: new Date(Date.now() + config.youtube.hashtagAuthoring.retryDelaysMs[0]).toISOString(), candidates: [], retrievals: [], suggestions: [] };
    }
  };

  return { author };
};
