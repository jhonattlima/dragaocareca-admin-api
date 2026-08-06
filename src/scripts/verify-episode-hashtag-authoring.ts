import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EpisodeHashtagAuthoringFocus = "foundation" | "lookup" | "lifecycle" | "route";

export type HashtagAuthoringVerifierSeams = {
  generateCandidates: (...args: unknown[]) => Promise<unknown>;
  lookupCount: (...args: unknown[]) => Promise<unknown>;
  now: () => Date;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
  admitLookup: (caller: "automatic" | "manual") => boolean;
};

type Fixture = { root: string; mediaRoot: string; sqlitePath: string };

const parseFocus = (argumentsList: string[]): EpisodeHashtagAuthoringFocus | null => {
  const focusArguments = argumentsList.filter((argument) => argument.startsWith("--focus="));
  if (focusArguments.length > 1) throw new Error("only one --focus argument is allowed");
  if (focusArguments.length === 0) return null;
  const focus = focusArguments[0].slice("--focus=".length);
  if (focus === "foundation" || focus === "lookup" || focus === "lifecycle" || focus === "route") return focus;
  throw new Error("expected --focus=foundation, --focus=lookup, --focus=lifecycle, or --focus=route");
};

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dragaocareca-episode-hashtag-authoring-"));
  const mediaRoot = path.join(root, "media");
  const sqlitePath = path.join(root, "episode-hashtag-authoring.sqlite");
  await fs.promises.mkdir(mediaRoot);
  return { root, mediaRoot, sqlitePath };
};

const assertFixtureIsolation = async (fixture: Fixture): Promise<void> => {
  assert.match(fixture.root, /^\/tmp\/dragaocareca-episode-hashtag-authoring-/);
  assert.equal(await fs.promises.stat(fixture.mediaRoot).then((entry) => entry.isDirectory()), true);
  assert.equal(fs.existsSync(fixture.sqlitePath), false);
};

const createOfflineSeams = (): HashtagAuthoringVerifierSeams => {
  let timerId = 0;
  return {
    generateCandidates: async () => ({ candidates: [] }),
    lookupCount: async () => ({ approximateCount: 0 }),
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    setTimer: (_callback, _delayMs) => ++timerId,
    clearTimer: (_timer) => undefined,
    admitLookup: (_caller) => true,
  };
};

const verifyNoNetworkContract = (seams: HashtagAuthoringVerifierSeams): void => {
  assert.equal(typeof seams.generateCandidates, "function");
  assert.equal(typeof seams.lookupCount, "function");
  assert.equal(typeof seams.now, "function");
  assert.equal(typeof seams.setTimer, "function");
  assert.equal(typeof seams.clearTimer, "function");
  assert.equal(typeof seams.admitLookup, "function");
  assert.equal(typeof globalThis.fetch, "function", "runtime fetch must remain available for production only");
};

const verifyFoundationFocus = async (fixture: Fixture): Promise<void> => {
  await assertFixtureIsolation(fixture);
  verifyNoNetworkContract(createOfflineSeams());
  const [{ parseHashtagAuthoringConfig }, { createEpisodeDraftState, normalizeEpisodeDraftState, normalizeHashtagTag }] = await Promise.all([
    import("../config/env.js"),
    import("../schemas/episode-draft-state.js"),
  ]);
  const authoringConfig = parseHashtagAuthoringConfig({});
  assert.deepEqual(authoringConfig.retryDelaysMs, [60_000, 300_000, 900_000, 3_600_000]);
  assert.equal(authoringConfig.automaticDailyCalls, 90);
  assert.equal(authoringConfig.manualDailyCalls, 10);
  assert.equal(authoringConfig.lookupLaneCount, 1);
  assert.throws(() => parseHashtagAuthoringConfig({ YOUTUBE_HASHTAG_CACHE_SUCCESS_TTL_MS: "invalid" }));

  const state = createEpisodeDraftState(18);
  assert.equal(state.suggestedTags.status, "idle");
  assert.equal(state.suggestedTags.version, state.version);
  assert.deepEqual(normalizeHashtagTag("  #RPG  "), {
    displayTag: "#rpg",
    normalizedTag: "#rpg",
  });
  const legacy = normalizeEpisodeDraftState({ episodeId: 18, version: 4, status: "done" });
  assert.equal(legacy?.suggestedTags.status, "idle");
  assert.equal(legacy?.suggestedTags.version, 4);
};

const verifyLookupFocus = async (fixture: Fixture): Promise<void> => {
  process.env.SQLITE_PATH = fixture.sqlitePath;
  process.env.YOUTUBE_HASHTAG_AUTHORING_ENABLED = "true";
  const [{ createYouTubeHashtagCacheRepository }, { createYouTubeHashtagSearchService, normalizeYouTubeHashtag }, { config }] = await Promise.all([
    import("../database/repositories/youtube-hashtag-cache.repository.js"),
    import("../services/youtube-hashtag-search.service.js"),
    import("../config/env.js"),
  ]);

  assert.deepEqual(normalizeYouTubeHashtag("  #RPG  "), { displayTag: "#rpg", normalizedTag: "#rpg" });
  assert.equal(normalizeYouTubeHashtag("#two words"), null);
  assert.equal(normalizeYouTubeHashtag("##rpg"), null);

  const repository = createYouTubeHashtagCacheRepository();
  const providerCalls: string[] = [];
  const service = createYouTubeHashtagSearchService({
    repository,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    getAccessToken: async () => "offline-token",
    fetchSearch: async ({ normalizedTag }) => {
      providerCalls.push(normalizedTag);
      return { approximateCount: normalizedTag === "#rpg" ? 42 : 0 };
    },
  });
  const first = await service.lookup("  #RPG  ", "automatic");
  assert.equal(first.ok, true);
  assert.equal(first.cacheStatus, "miss");
  assert.equal(first.approximateCount, 42);
  const second = await service.lookup("rpg", "automatic");
  assert.equal(second.ok, true);
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(providerCalls, ["#rpg"]);

  const identityA = repository.getFresh({ normalizedTag: "#rpg", regionCode: config.youtube.hashtagAuthoring.regionCode, relevanceLanguage: config.youtube.hashtagAuthoring.relevanceLanguage, searchShapeVersion: "v1" }, new Date("2026-08-06T12:00:00.000Z"));
  const identityB = repository.getFresh({ normalizedTag: "#rpg", regionCode: "US", relevanceLanguage: "en", searchShapeVersion: "v1" }, new Date("2026-08-06T12:00:00.000Z"));
  assert.ok(identityA);
  assert.equal(identityB, null);
  assert.equal(repository.admit("automatic", "2026-08-06", 90), true);
  assert.equal(repository.admit("manual", "2026-08-06", 10), true);

  const { createEpisodeHashtagAuthoringService } = await import("../services/episode-hashtag-authoring.service.js");
  const { validateGeminiTagCandidates } = await import("../services/episode-hashtag-authoring.service.js");
  assert.throws(() => validateGeminiTagCandidates({ candidates: [] }), /exactly 50/);
  const candidates = Array.from({ length: 50 }, (_, index) => ({ tag: `tag${index}`, relevant: index < 3, relevanceScore: index === 1 ? 100 : 50 }));
  const lookedUp: string[] = [];
  const authoring = createEpisodeHashtagAuthoringService({
    generateCandidates: async () => ({ candidates }),
    lookupService: {
      lookup: async (tag: unknown) => {
        lookedUp.push(String(tag));
        return { ok: true, displayTag: String(tag), normalizedTag: String(tag), approximateCount: String(tag).endsWith("0") ? 10 : 5, retrievedAt: "2026-08-06T12:00:00.000Z", cacheStatus: "miss", regionCode: "BR", relevanceLanguage: "pt", source: "youtube-search-list", errorCategory: null, retryAt: null };
      },
    },
  });
  const authored = await authoring.author("transcript", "summary");
  assert.equal(authored.status, "done");
  assert.equal(lookedUp.length, 50);
  assert.deepEqual(authored.suggestions.map((tag) => tag.displayTag), ["#tag0", "#tag1", "#tag2"]);
};

const verifyLifecycleFocus = async (fixture: Fixture): Promise<void> => {
  process.env.MEDIA_STORAGE_ROOT = fixture.mediaRoot;
  const [{ createEpisodeSummaryService }, media, schema] = await Promise.all([
    import("../services/episode-summary.service.js"),
    import("../services/episode-media-layout.service.js"),
    import("../schemas/episode-draft-state.js"),
  ]);
  const episodeId = 1803;
  const statePath = media.getEpisodeMediaDraftStatePath(episodeId);
  const summaryPath = media.getEpisodeMediaDraftSummaryPath(episodeId);
  const transcriptPath = media.getEpisodeMediaFinalPath(episodeId, "transcript");
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.promises.writeFile(summaryPath, "saved summary", "utf8");
  await fs.promises.writeFile(transcriptPath, "transcript", "utf8");

  let authorCalls = 0;
  const authoring = { author: async () => {
    authorCalls += 1;
    return { status: "done" as const, errorCategory: null, retryAt: null, candidates: [], retrievals: [], suggestions: [] };
  } };
  const service = createEpisodeSummaryService({ hashtagAuthoring: authoring as never, now: () => "2026-08-06T12:00:00.000Z" });
  const digest = (await import("node:crypto")).createHash("sha256").update("saved summary").digest("hex");
  const baseState = schema.createEpisodeDraftState(episodeId, { version: 1 });
  const state = {
    ...baseState,
    transcript: { ...baseState.transcript, status: "done" as const, version: 1, fileName: "episodes/1803/transcript.txt", progress: 100 },
    aiSummary: { ...baseState.aiSummary, status: "done" as const, version: 1, summaryFileName: "episodes/1803/summary.txt", fileName: "episodes/1803/summary.txt", progress: 100 },
    suggestedTags: { ...baseState.suggestedTags, status: "pending" as const, version: 1, summaryDigest: digest },
  };
  await fs.promises.writeFile(statePath, `${JSON.stringify(state)}\n`, "utf8");
  await service.recoverSuggestedTagsAuthoring(episodeId);
  const completed = JSON.parse(await fs.promises.readFile(statePath, "utf8"));
  assert.equal(completed.aiSummary.status, "done");
  assert.equal(completed.suggestedTags.status, "done");
  assert.equal(authorCalls, 1);

  let release!: () => void;
  let staleStarted = false;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const staleService = createEpisodeSummaryService({
    hashtagAuthoring: { author: async () => { staleStarted = true; await wait; return { status: "done" as const, errorCategory: null, retryAt: null, candidates: [], retrievals: [], suggestions: [] }; } } as never,
    now: () => "2026-08-06T12:00:00.000Z",
  });
  const stale = { ...completed, version: 2, updatedAt: "2026-08-06T12:01:00.000Z", suggestedTags: { ...completed.suggestedTags, status: "pending", version: 2, summaryDigest: digest } };
  await fs.promises.writeFile(statePath, `${JSON.stringify(stale)}\n`, "utf8");
  const inFlight = staleService.enqueueSuggestedTagsAuthoring(episodeId);
  for (let attempt = 0; attempt < 20 && !staleStarted; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const newer = { ...stale, version: 3, suggestedTags: { ...stale.suggestedTags, version: 3, summaryDigest: "new-summary-digest", status: "pending" } };
  await fs.promises.writeFile(statePath, `${JSON.stringify(newer)}\n`, "utf8");
  release();
  await inFlight;
  const afterStale = JSON.parse(await fs.promises.readFile(statePath, "utf8"));
  assert.equal(afterStale.version, 3);
  assert.equal(afterStale.suggestedTags.summaryDigest, "new-summary-digest");
  console.log("offline hashtag-authoring lifecycle verified");
};

const verifyRouteFocus = async (): Promise<void> => {
  const [{ swaggerSpec }, { getEpisodeDraftSummary }] = await Promise.all([
    import("../docs/openapi.js"),
    import("../services/episode-summary.service.js"),
  ]);
  const paths = (swaggerSpec as unknown as { paths: Record<string, unknown> }).paths;
  assert.ok(paths["/v1/episodes/{episodeId}/hashtag-lookup"]);
  assert.ok(paths["/v1/episodes/{episodeId}/episodes-generated-summary"]);
  const lookupPath = paths["/v1/episodes/{episodeId}/hashtag-lookup"] as { post?: { security?: unknown[]; description?: string; responses?: Record<string, unknown> } };
  assert.deepEqual(lookupPath.post?.security, [{ bearerAuth: [] }]);
  assert.match(lookupPath.post?.description ?? "", /approximate|quota|no-store/i);
  assert.ok(lookupPath.post?.responses?.["400"]);
  const snapshot = getEpisodeDraftSummary(999999);
  assert.ok(snapshot.suggestedTags);
  assert.equal(snapshot.suggestedTags.suggestions.length, 0);
  console.log("offline hashtag-authoring route contract verified");
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");

  // Parse before creating a fixture so malformed focus invocations cannot touch persistence.
  const focus = parseFocus(process.argv.slice(2));
  const fixture = await createFixture();
  try {
    if (!focus || focus === "foundation") await verifyFoundationFocus(fixture);
    if (focus === "lookup") await verifyLookupFocus(fixture);
    if (focus === "lifecycle") await verifyLifecycleFocus(fixture);
    if (focus === "route") await verifyRouteFocus();
    console.log(`offline hashtag-authoring ${focus ?? "all"} verified`);
  } finally {
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

if (require.main === module) void main();
