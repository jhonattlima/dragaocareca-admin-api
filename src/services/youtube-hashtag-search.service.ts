import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env";
import {
  createYouTubeHashtagCacheRepository,
  defaultHashtagCacheKey,
  getPacificQuotaDate,
  type HashtagCallerClass,
  type YouTubeHashtagCacheRepository,
} from "../database/repositories/youtube-hashtag-cache.repository";

export type HashtagLookupErrorCategory =
  | "disabled"
  | "missing_credentials"
  | "unauthorized"
  | "quota_exhausted"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_provider_response";

export type HashtagLookupResult = {
  ok: boolean;
  displayTag: string;
  normalizedTag: string;
  approximateCount: number | null;
  retrievedAt: string | null;
  cacheStatus: "hit" | "miss" | "denied" | "error";
  regionCode: string;
  relevanceLanguage: string;
  source: "youtube-search-list" | "cache" | "admission" | "provider";
  errorCategory: HashtagLookupErrorCategory | null;
  retryAt: string | null;
};

type SearchInput = { normalizedTag: string; regionCode: string; relevanceLanguage: string };
type FetchSearch = (input: SearchInput & { accessToken: string }) => Promise<{ approximateCount: number }>;
type GetAccessToken = () => Promise<string>;

const defaultGetAccessToken: GetAccessToken = async (): Promise<string> => {
  const client = new OAuth2Client(config.youtube.clientId, config.youtube.clientSecret);
  client.setCredentials({ refresh_token: config.youtube.refreshToken });
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("YouTube OAuth token unavailable");
  return token.token;
};

const defaultFetchSearch: FetchSearch = async ({ normalizedTag, regionCode, relevanceLanguage, accessToken }) => {
  const params = new URLSearchParams({
    part: "snippet",
    q: normalizedTag,
    type: "video",
    regionCode,
    relevanceLanguage,
    maxResults: "1",
  });
  const response = await fetch(`${config.youtube.dataBaseUrl}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(config.youtube.hashtagAuthoring.requestTimeoutMs),
  });
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("YouTube authorization failed"), { code: "unauthorized" });
  if (response.status === 429) throw Object.assign(new Error("YouTube rate limit"), { code: "rate_limited" });
  if (!response.ok) throw new Error("YouTube hashtag search failed");
  const payload = (await response.json()) as { pageInfo?: { totalResults?: unknown } };
  const count = payload.pageInfo?.totalResults;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 1_000_000) {
    throw new Error("Invalid YouTube hashtag search response");
  }
  return { approximateCount: count };
};

export const normalizeYouTubeHashtag = (value: unknown): { displayTag: string; normalizedTag: string } | null => {
  if (typeof value !== "string") return null;
  const input = value.normalize("NFKC").trim();
  const withoutHash = input.startsWith("#") ? input.slice(1) : input;
  if (!withoutHash || withoutHash.includes("#") || /[\u0000-\u001f\u007f]/u.test(withoutHash) || /\s/u.test(withoutHash)) return null;
  const canonical = withoutHash.toLocaleLowerCase("en-US");
  return { displayTag: `#${canonical}`, normalizedTag: `#${canonical}` };
};

const errorCategory = (error: unknown): HashtagLookupErrorCategory => {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "unauthorized") return "unauthorized";
  if (code === "rate_limited") return "rate_limited";
  if (error instanceof Error && /invalid response/i.test(error.message)) return "invalid_provider_response";
  return "provider_unavailable";
};

const result = (input: Partial<HashtagLookupResult> & Pick<HashtagLookupResult, "displayTag" | "normalizedTag" | "regionCode" | "relevanceLanguage">): HashtagLookupResult => ({
  ok: input.ok ?? false,
  displayTag: input.displayTag,
  normalizedTag: input.normalizedTag,
  approximateCount: input.approximateCount ?? null,
  retrievedAt: input.retrievedAt ?? null,
  cacheStatus: input.cacheStatus ?? "error",
  regionCode: input.regionCode,
  relevanceLanguage: input.relevanceLanguage,
  source: input.source ?? "provider",
  errorCategory: input.errorCategory ?? null,
  retryAt: input.retryAt ?? null,
});

export const createYouTubeHashtagSearchService = (options: {
  repository?: YouTubeHashtagCacheRepository;
  now?: () => Date;
  getAccessToken?: GetAccessToken;
  fetchSearch?: FetchSearch;
} = {}) => {
  const repository = options.repository ?? createYouTubeHashtagCacheRepository();
  const now = options.now ?? (() => new Date());
  const getAccessToken = options.getAccessToken ?? defaultGetAccessToken;
  const fetchSearch = options.fetchSearch ?? defaultFetchSearch;
  let lane: Promise<void> = Promise.resolve();

  const lookup = (value: unknown, callerClass: HashtagCallerClass): Promise<HashtagLookupResult> => {
    const normalized = normalizeYouTubeHashtag(value);
    const settings = config.youtube.hashtagAuthoring;
    if (!normalized) {
      return Promise.resolve(result({ displayTag: "", normalizedTag: "", regionCode: settings.regionCode, relevanceLanguage: settings.relevanceLanguage, errorCategory: "invalid_provider_response" }));
    }
    if (!settings.enabled) {
      return Promise.resolve(result({ ...normalized, cacheStatus: "denied", source: "admission", errorCategory: "disabled", retryAt: null, regionCode: settings.regionCode, relevanceLanguage: settings.relevanceLanguage }));
    }
    const key = defaultHashtagCacheKey(normalized.normalizedTag);
    const cached = repository.getFresh(key, now());
    if (cached) {
      return Promise.resolve(result({ ...normalized, ok: true, approximateCount: cached.approximateCount, retrievedAt: cached.retrievedAt, cacheStatus: "hit", source: "cache", regionCode: key.regionCode, relevanceLanguage: key.relevanceLanguage }));
    }

    let resolveResult!: (value: HashtagLookupResult) => void;
    const pending = new Promise<HashtagLookupResult>((resolve) => { resolveResult = resolve; });
    lane = lane.then(async () => {
      try {
        const fresh = repository.getFresh(key, now());
        if (fresh) {
          resolveResult(result({ ...normalized, ok: true, approximateCount: fresh.approximateCount, retrievedAt: fresh.retrievedAt, cacheStatus: "hit", source: "cache", regionCode: key.regionCode, relevanceLanguage: key.relevanceLanguage }));
          return;
        }
        const limit = callerClass === "automatic" ? settings.automaticDailyCalls : settings.manualDailyCalls;
        if (!repository.admit(callerClass, getPacificQuotaDate(now()), limit)) {
          resolveResult(result({ ...normalized, cacheStatus: "denied", source: "admission", errorCategory: "quota_exhausted", retryAt: new Date(now().getTime() + settings.retryDelaysMs[0]).toISOString(), regionCode: key.regionCode, relevanceLanguage: key.relevanceLanguage }));
          return;
        }
        const accessToken = await getAccessToken();
        const found = await fetchSearch({ ...key, accessToken });
        const retrievedAt = now();
        const ttl = found.approximateCount === 0 ? settings.cacheZeroResultTtlMs : settings.cacheSuccessTtlMs;
        const stored = repository.saveResult({ key, approximateCount: found.approximateCount, retrievedAt, expiresAt: new Date(retrievedAt.getTime() + ttl) });
        resolveResult(result({ ...normalized, ok: true, approximateCount: stored.approximateCount, retrievedAt: stored.retrievedAt, cacheStatus: "miss", source: "youtube-search-list", regionCode: key.regionCode, relevanceLanguage: key.relevanceLanguage }));
      } catch (error) {
        const category = errorCategory(error);
        const retrievedAt = now();
        repository.saveError({ key, errorCategory: category, retrievedAt, expiresAt: new Date(retrievedAt.getTime() + settings.retryDelaysMs[0]) });
        resolveResult(result({ ...normalized, cacheStatus: "error", source: "provider", errorCategory: category, retryAt: new Date(retrievedAt.getTime() + settings.retryDelaysMs[0]).toISOString(), regionCode: key.regionCode, relevanceLanguage: key.relevanceLanguage }));
      }
    }).catch(() => undefined);
    return pending;
  };

  return { lookup };
};
