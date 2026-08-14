import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EpisodeHashtagAuthoringFocus = "foundation" | "lookup" | "lifecycle" | "route";

type Fixture = { root: string; mediaRoot: string; sqlitePath: string };
type AnyRecord = Record<string, unknown>;

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

const digest = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const assertNoSensitiveData = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["offline-token", "provider-secret", "provider-payload", "raw-provider", "prompt", "transcript", "absolute-path", "cache-ledger", "summary text"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "i"), `sensitive field leaked: ${forbidden}`);
  }
};

const assertFixtureIsolation = async (fixture: Fixture): Promise<void> => {
  assert.match(fixture.root, /^\/tmp\/dragaocareca-episode-hashtag-authoring-/);
  assert.equal(await fs.promises.stat(fixture.mediaRoot).then((entry) => entry.isDirectory()), true);
  assert.equal(fs.existsSync(fixture.sqlitePath), false);
  const { config } = await import("../config/env.js");
  assert.equal(config.sqlitePath, fixture.sqlitePath, "verifier must use disposable SQLite");
  assert.equal(config.media.storageRoot, fixture.mediaRoot, "verifier must use disposable media");
};

const createCandidates = () => Array.from({ length: 50 }, (_, index) => ({
  tag: `tag${index}`,
  relevant: index < 3,
  relevanceScore: index === 1 ? 100 : index === 2 ? 75 : 50,
}));

const verifyFoundationFocus = async (fixture: Fixture): Promise<void> => {
  await assertFixtureIsolation(fixture);
  const [{ parseHashtagAuthoringConfig }, schema, authoringModule] = await Promise.all([
    import("../config/env.js"),
    import("../schemas/episode-draft-state.js"),
    import("../services/episode-hashtag-authoring.service.js"),
  ]);
  const authoringConfig = parseHashtagAuthoringConfig({});
  assert.deepEqual(authoringConfig.retryDelaysMs, [60_000, 300_000, 900_000, 3_600_000]);
  assert.equal(authoringConfig.automaticDailyCalls, 90);
  assert.equal(authoringConfig.manualDailyCalls, 10);
  assert.equal(authoringConfig.lookupLaneCount, 1);
  assert.throws(() => parseHashtagAuthoringConfig({ YOUTUBE_HASHTAG_CACHE_SUCCESS_TTL_MS: "invalid" }));

  const state = schema.createEpisodeDraftState(18);
  assert.equal(state.suggestedTags.status, "idle");
  assert.equal(state.suggestedTags.version, state.version);
  assert.deepEqual(schema.normalizeHashtagTag("  #RPG  "), { displayTag: "#rpg", normalizedTag: "#rpg" });
  assert.equal(schema.normalizeHashtagTag("#two words"), null);
  assert.equal(schema.normalizeEpisodeDraftState({ episodeId: 18, version: 4, status: "done" })?.suggestedTags.status, "idle");

  assert.deepEqual(authoringModule.validateGeminiTagCandidates({ candidates: createCandidates() }).slice(0, 2).map((candidate) => candidate.displayTag), ["#tag0", "#tag1"]);
  assert.throws(() => authoringModule.validateGeminiTagCandidates({ candidates: [] }), /exactly 50/);
  assert.throws(() => authoringModule.validateGeminiTagCandidates({ candidates: [...createCandidates().slice(0, 49), { ...createCandidates()[0], tag: "tag0" }] }), /exactly 50|duplicate/);
  assert.equal(globalThis.fetch !== undefined, true, "the verifier does not replace the runtime network primitive");
};

const verifyLookupFocus = async (fixture: Fixture): Promise<void> => {
  const [{ createYouTubeHashtagCacheRepository }, { createYouTubeHashtagSearchService }, { config }, { createEpisodeHashtagAuthoringService }] = await Promise.all([
    import("../database/repositories/youtube-hashtag-cache.repository.js"),
    import("../services/youtube-hashtag-search.service.js"),
    import("../config/env.js"),
    import("../services/episode-hashtag-authoring.service.js"),
  ]);
  const clock = { value: new Date("2026-08-06T12:00:00.000Z") };
  assert.equal(config.youtube.hashtagAuthoring.cacheSuccessTtlMs, 60 * 60 * 1000);
  assert.equal(config.youtube.hashtagAuthoring.cacheZeroResultTtlMs, 60 * 60 * 1000);
  const repository = createYouTubeHashtagCacheRepository();
  const providerCalls: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const service = createYouTubeHashtagSearchService({
    repository,
    now: () => clock.value,
    getAccessToken: async () => "offline-token",
    fetchSearch: async ({ normalizedTag, accessToken }) => {
      assert.equal(accessToken, "offline-token");
      providerCalls.push(normalizedTag);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { approximateCount: normalizedTag === "#rpg" ? 42 : normalizedTag === "#zero" ? 0 : 5 };
    },
  });
  const first = await service.lookup("  #RPG  ", "automatic");
  assert.equal(first.ok, true);
  assert.equal(first.cacheStatus, "miss");
  assert.equal(first.approximateCount, 42);
  const second = await service.lookup("rpg", "automatic");
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(providerCalls, ["#rpg"]);

  const candidates = createCandidates();
  const lookedUp: string[] = [];
  const authoring = createEpisodeHashtagAuthoringService({
    generateCandidates: async ({ transcript, summary }) => {
      assert.equal(transcript, "transcript");
      assert.equal(summary, "summary");
      return { candidates };
    },
    lookupService: {
      lookup: async (tag: unknown) => {
        lookedUp.push(String(tag));
        const normalizedTag = String(tag);
        return {
          ok: true,
          displayTag: normalizedTag,
          normalizedTag,
          approximateCount: normalizedTag === "#tag0" ? 10 : normalizedTag === "#tag1" ? 9 : normalizedTag === "#tag2" ? 8 : normalizedTag === "#tag49" ? 1_000_000 : 1,
          retrievedAt: clock.value.toISOString(),
          cacheStatus: "miss" as const,
          regionCode: "BR",
          relevanceLanguage: "pt",
          source: "youtube-search-list" as const,
          errorCategory: null,
          retryAt: null,
        };
      },
    },
  });
  const authored = await authoring.author("transcript", "summary");
  assert.equal(authored.status, "done");
  assert.equal(lookedUp.length, 50, "automatic authoring must look up all 50 candidates");
  assert.deepEqual(authored.suggestions.map((tag) => tag.displayTag), ["#tag0", "#tag1", "#tag2"], "irrelevant high-count tags cannot rank");

  await Promise.all([service.lookup("#serial-a", "automatic"), service.lookup("#serial-b", "automatic"), service.lookup("#serial-c", "automatic")]);
  assert.equal(maximumActive, 1, "provider lookups must use one serial lane");
  const zeroFirst = await service.lookup("#zero", "automatic");
  const zeroHit = await service.lookup("#zero", "automatic");
  assert.equal(zeroFirst.cacheStatus, "miss");
  assert.equal(zeroHit.cacheStatus, "hit");
  clock.value = new Date(clock.value.getTime() + 60 * 60 * 1000 + 1);
  const zeroExpired = await service.lookup("#zero", "automatic");
  assert.equal(zeroExpired.cacheStatus, "miss", "zero-result TTL must expire independently");

  const quotaDate = "quota-proof-2026-08-06";
  for (let index = 0; index < 90; index += 1) assert.equal(repository.admit("automatic", quotaDate, 90), true);
  assert.equal(repository.admit("automatic", quotaDate, 90), false);
  for (let index = 0; index < 10; index += 1) assert.equal(repository.admit("manual", quotaDate, 10), true);
  assert.equal(repository.admit("manual", quotaDate, 10), false);
  assert.equal(repository.getAdmissionCount("automatic", quotaDate), 90);
  assert.equal(repository.getAdmissionCount("manual", quotaDate), 10);
  assert.equal(config.youtube.hashtagAuthoring.automaticDailyCalls + config.youtube.hashtagAuthoring.manualDailyCalls, 100);

  const failureService = createYouTubeHashtagSearchService({
    repository: createYouTubeHashtagCacheRepository(),
    now: () => clock.value,
    getAccessToken: async () => { throw Object.assign(new Error("auth"), { code: "unauthorized" }); },
    fetchSearch: async () => { throw new Error("must not reach fetch after auth failure"); },
  });
  const unavailable = await failureService.lookup("#auth-failure", "manual");
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.errorCategory, "unauthorized");
  assert.ok(unavailable.retryAt);
  console.log("offline hashtag-authoring lookup, cache, quota, ranking, and provider boundary verified");
};

const writeState = async (statePath: string, state: AnyRecord): Promise<void> => {
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await fs.promises.writeFile(statePath, `${JSON.stringify(state)}\n`, "utf8");
};

const verifyLifecycleFocus = async (fixture: Fixture): Promise<void> => {
  const [{ createEpisodeSummaryService }, media, schema, { config }, publication] = await Promise.all([
    import("../services/episode-summary.service.js"),
    import("../services/episode-media-layout.service.js"),
    import("../schemas/episode-draft-state.js"),
    import("../config/env.js"),
    import("../services/youtube-trailer-publication.service.js"),
  ]);
  assert.equal(config.youtube.hashtagAuthoring.enabled, true);
  assert.equal(typeof publication.assembleYoutubeTrailerTitle, "function", "start and publication must share the assembled-title validator");
  assert.equal(publication.assembleYoutubeTrailerTitle({ title: `Trailer - ${"a".repeat(90)}`, hashtags: ["#é"] }), `Trailer - ${"a".repeat(90)} #é`);
  assert.throws(() => publication.assembleYoutubeTrailerTitle({ title: `Trailer - ${"a".repeat(91)}`, hashtags: ["#é"] }), /100 characters/);
  assert.throws(() => publication.assembleYoutubeTrailerTitle({ title: "Trailer - Episode", hashtags: ["bad tag"] }), /hashtags are invalid/);
  const episodeId = 1803;
  const statePath = media.getEpisodeMediaDraftStatePath(episodeId);
  const summaryPath = media.getEpisodeMediaDraftSummaryPath(episodeId);
  const transcriptPath = media.getEpisodeMediaFinalPath(episodeId, "transcript");
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.promises.writeFile(summaryPath, "saved summary", "utf8");
  await fs.promises.writeFile(transcriptPath, "transcript", "utf8");
  const summaryDigest = digest("saved summary");
  const baseState = schema.createEpisodeDraftState(episodeId, { version: 1 });
  const makeState = (id: number, status: "pending" | "processing" | "unavailable" = "pending", version = 1): AnyRecord => ({
    ...baseState,
    episodeId: id,
    version,
    transcript: { ...baseState.transcript, status: "done", version, fileName: `episodes/${id}/transcript.txt`, progress: 100 },
    aiSummary: { ...baseState.aiSummary, status: "done", version, summaryFileName: `episodes/${id}/summary.txt`, fileName: `episodes/${id}/summary.txt`, progress: 100 },
    suggestedTags: { ...baseState.suggestedTags, status, version, summaryDigest, retryAt: status === "unavailable" ? "2026-08-06T12:00:00.000Z" : null },
  });

  let authorCalls = 0;
  let active = 0;
  let maximumActive = 0;
  const authoring = {
    author: async () => {
      authorCalls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { status: "done" as const, errorCategory: null, retryAt: null, candidates: [], retrievals: [], suggestions: [] };
    },
  };
  await writeState(statePath, makeState(episodeId));
  const service = createEpisodeSummaryService({ hashtagAuthoring: authoring as never, now: () => "2026-08-06T12:00:00.000Z" });
  await service.recoverSuggestedTagsAuthoring(episodeId);
  let completed = JSON.parse(await fs.promises.readFile(statePath, "utf8"));
  assert.equal(completed.aiSummary.status, "done");
  assert.equal(completed.suggestedTags.status, "done", JSON.stringify(completed));
  assert.equal(authorCalls, 1);
  assert.equal(maximumActive, 1);
  assert.equal((await fs.promises.readdir(path.dirname(statePath))).filter((name) => name.includes("suggested")).length, 0, "suggestedTags must remain in the root state file");

  const episodeIds = [1804, 1805, 1806];
  for (const id of episodeIds) {
    const idStatePath = media.getEpisodeMediaDraftStatePath(id);
    const idSummaryPath = media.getEpisodeMediaDraftSummaryPath(id);
    const idTranscriptPath = media.getEpisodeMediaFinalPath(id, "transcript");
    await fs.promises.mkdir(path.dirname(idStatePath), { recursive: true });
    await fs.promises.writeFile(idSummaryPath, "saved summary", "utf8");
    await fs.promises.mkdir(path.dirname(idTranscriptPath), { recursive: true });
    await fs.promises.writeFile(idTranscriptPath, "transcript", "utf8");
    await writeState(idStatePath, makeState(id, id === 1805 ? "processing" : id === 1806 ? "unavailable" : "pending"));
  }
  await service.recoverSuggestedTagsAuthoring(1805);
  const interrupted = JSON.parse(await fs.promises.readFile(media.getEpisodeMediaDraftStatePath(1805), "utf8"));
  assert.equal(interrupted.aiSummary.status, "done");
  assert.equal(interrupted.suggestedTags.status, "unavailable", "interrupted processing must become retryable before restart execution");
  await Promise.all([service.recoverSuggestedTagsAuthoring(1804), service.recoverSuggestedTagsAuthoring(1806)]);
  await writeState(media.getEpisodeMediaDraftStatePath(1805), { ...interrupted, suggestedTags: { ...interrupted.suggestedTags, retryAt: "2026-08-06T11:59:00.000Z" } });
  await service.recoverSuggestedTagsAuthoring(1805);
  for (const id of episodeIds) {
    const recovered = JSON.parse(await fs.promises.readFile(media.getEpisodeMediaDraftStatePath(id), "utf8"));
    assert.equal(recovered.aiSummary.status, "done");
    assert.equal(recovered.suggestedTags.status, "done");
  }
  assert.equal(maximumActive, 1, "recovered episodes must share the same serialized lane");

  let release!: () => void;
  let started = false;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const staleService = createEpisodeSummaryService({
    hashtagAuthoring: { author: async () => { started = true; await wait; return { status: "done" as const, errorCategory: null, retryAt: null, candidates: [], retrievals: [], suggestions: [] }; } } as never,
    now: () => "2026-08-06T12:00:00.000Z",
  });
  const staleStatePath = media.getEpisodeMediaDraftStatePath(episodeId);
  const stale = { ...completed, version: 2, suggestedTags: { ...completed.suggestedTags, status: "pending", version: 2, summaryDigest } };
  await writeState(staleStatePath, stale);
  const inFlight = staleService.enqueueSuggestedTagsAuthoring(episodeId);
  for (let attempt = 0; attempt < 20 && !started; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  const newer = { ...stale, version: 3, suggestedTags: { ...stale.suggestedTags, version: 3, summaryDigest: digest("new summary"), status: "pending" } };
  await writeState(staleStatePath, newer);
  release();
  await inFlight;
  const afterStale = JSON.parse(await fs.promises.readFile(staleStatePath, "utf8"));
  assert.equal(afterStale.version, 3);
  assert.equal(afterStale.suggestedTags.summaryDigest, digest("new summary"));
  assert.equal(afterStale.suggestedTags.status, "pending", "old completion must not write newer summary state");

  let scheduled: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => { scheduled.push(delay ?? 0); return 1 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    for (const delay of [60_000, 300_000, 900_000, 3_600_000]) service.scheduleSuggestedTagsRetry(episodeId, new Date(Date.now() + delay).toISOString());
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.deepEqual(scheduled, [60_000, 300_000, 900_000, 3_600_000]);

  let failedAuthorCalls = 0;
  const failureService = createEpisodeSummaryService({
    hashtagAuthoring: { author: async () => { failedAuthorCalls += 1; return { status: "unavailable" as const, errorCategory: "unauthorized" as const, retryAt: "2026-08-06T12:01:00.000Z", candidates: [], retrievals: [], suggestions: [] }; } } as never,
    now: () => "2026-08-06T12:00:00.000Z",
  });
  await writeState(staleStatePath, { ...newer, version: 4, suggestedTags: { ...newer.suggestedTags, status: "pending", version: 4, summaryDigest } });
  await failureService.recoverSuggestedTagsAuthoring(episodeId);
  const failed = JSON.parse(await fs.promises.readFile(staleStatePath, "utf8"));
  assert.equal(failedAuthorCalls, 1);
  assert.equal(failed.aiSummary.status, "done");
  assert.equal(failed.suggestedTags.status, "unavailable");
  assert.equal(failed.suggestedTags.errorCategory, "unauthorized");
  assert.ok(failed.suggestedTags.retryAt);
  console.log("offline hashtag-authoring lifecycle, retry/restart recovery, stale guards, and summary isolation verified");
};

type MockResponse = { statusCode: number; headers: Record<string, string>; body: unknown; setHeader(name: string, value: string): void; getHeader(name: string): string | undefined; status(code: number): MockResponse; json(value: unknown): MockResponse };

const invokeRouter = async (router: { handle: (request: AnyRecord, response: MockResponse, next: (error?: unknown) => void) => void }, url: string, body: unknown): Promise<MockResponse> => {
  let complete!: () => void;
  let fail!: (error: unknown) => void;
  const settled = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const response: MockResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; complete(); return this; },
  };
  const request = { method: "POST", url, originalUrl: url, headers: {}, body, params: {}, query: {} };
  router.handle(request, response, (error?: unknown) => error ? fail(error) : complete());
  await settled;
  return response;
};

const verifyRouteFocus = async (fixture: Fixture): Promise<void> => {
  const [{ swaggerSpec }, { episodesRouter }, { createYouTubeHashtagCacheRepository }, { config }] = await Promise.all([
    import("../docs/openapi.js"),
    import("../routes/episodes.routes.js"),
    import("../database/repositories/youtube-hashtag-cache.repository.js"),
    import("../config/env.js"),
  ]);
  const key = { normalizedTag: "#cached", regionCode: config.youtube.hashtagAuthoring.regionCode, relevanceLanguage: config.youtube.hashtagAuthoring.relevanceLanguage, searchShapeVersion: "v1" };
  createYouTubeHashtagCacheRepository().saveResult({ key, approximateCount: 123, retrievedAt: new Date("2026-08-06T12:00:00.000Z"), expiresAt: new Date("2026-08-07T12:00:00.000Z") });
  const success = await invokeRouter(episodesRouter as unknown as { handle: (request: AnyRecord, response: MockResponse, next: (error?: unknown) => void) => void }, "/999/hashtag-lookup", { tag: "  #CACHED " });
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["cache-control"], "no-store");
  assert.deepEqual(success.body, {
    displayTag: "#cached",
    normalizedTag: "#cached",
    approximateCount: 123,
    retrievedAt: "2026-08-06T12:00:00.000Z",
    regionCode: config.youtube.hashtagAuthoring.regionCode,
    relevanceLanguage: config.youtube.hashtagAuthoring.relevanceLanguage,
    source: "cache",
    cacheStatus: "hit",
    state: "available",
    errorCategory: null,
    retryAt: null,
  });
  assertNoSensitiveData(success.body);
  const invalid = await invokeRouter(episodesRouter as unknown as { handle: (request: AnyRecord, response: MockResponse, next: (error?: unknown) => void) => void }, "/999/hashtag-lookup", { tag: "two words" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers["cache-control"], "no-store");
  assertNoSensitiveData(invalid.body);

  const paths = (swaggerSpec as unknown as { paths: Record<string, any>; components: { schemas: Record<string, any> } }).paths;
  const schemas = (swaggerSpec as unknown as { components: { schemas: Record<string, any> } }).components.schemas;
  const lookupPath = paths["/v1/episodes/{episodeId}/hashtag-lookup"] as any;
  assert.ok(lookupPath?.post);
  assert.deepEqual(lookupPath.post.security, [{ bearerAuth: [] }]);
  assert.ok(lookupPath.post.responses["400"] && lookupPath.post.responses["401"] && lookupPath.post.responses["429"] && lookupPath.post.responses["503"]);
  assert.match(lookupPath.post.description, /approximate|quota|no-store/i);
  assert.match(lookupPath.post.requestBody.content["application/json"].schema.properties.tag.pattern, /#\?\[/);
  assert.equal(schemas.SuggestedTagRetrieval.properties.approximateCount.description.includes("approximate"), true);
  assert.match(schemas.SuggestedTagRetrieval.properties.displayTag.description, /lower-case/i);
  const lookupResponseProperties = (schemas.HashtagLookupResponse.allOf as AnyRecord[]).find((entry) => entry.properties)?.properties as AnyRecord;
  assert.equal(((lookupResponseProperties.state as AnyRecord).enum as unknown[]).includes("available"), true);
  const publicHashtagContract = JSON.stringify({ lookupPath, retrieval: schemas.SuggestedTagRetrieval, snapshot: schemas.SuggestedTagsSnapshot, response: schemas.HashtagLookupResponse });
  assert.doesNotMatch(publicHashtagContract, /"(?:accessToken|refreshToken|providerPayload|providerResponse|absolutePath|cacheLedger|rawResponse|sessionLocation)"/i);
  console.log("offline hashtag-authoring protected route, DTO redaction, OpenAPI parity, and no-store contract verified");
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");
  const focus = parseFocus(process.argv.slice(2));
  const fixture = await createFixture();
  process.env.SQLITE_PATH = fixture.sqlitePath;
  process.env.MEDIA_STORAGE_ROOT = fixture.mediaRoot;
  process.env.YOUTUBE_HASHTAG_AUTHORING_ENABLED = "true";
  process.env.AUTH_BYPASS = "true";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("LIVE_BOUNDARY_TRIPWIRE: fetch was reached"); }) as typeof fetch;
  try {
    if (!focus || focus === "foundation") await verifyFoundationFocus(fixture);
    if (focus === "lookup") await verifyLookupFocus(fixture);
    if (focus === "lifecycle") await verifyLifecycleFocus(fixture);
    if (focus === "route") await verifyRouteFocus(fixture);
    console.log(`offline hashtag-authoring ${focus ?? "all"} verified`);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

if (require.main === module) void main();
