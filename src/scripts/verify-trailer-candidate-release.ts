import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { DatabaseSync } from "node:sqlite";

type RouteHandler = (req: any, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type Router = { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } }> };

class MemoryResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  jsonBody: any;
  headersSent = false;
  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
  setHeader(name: string, value: string): this { this.headers[name.toLowerCase()] = value; return this; }
  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this {
    this.jsonBody = body;
    this.setHeader("content-type", "application/json; charset=utf-8");
    this.end(JSON.stringify(body));
    return this;
  }
  get body(): Buffer { return Buffer.concat(this.chunks); }
}

class Request extends Readable {
  headers: Record<string, string>;
  query: Record<string, string | string[]>;
  constructor(readonly params: Record<string, string>, readonly body: unknown = {}, headers: Record<string, string> = {}, query: Record<string, string | string[]> = {}) {
    super();
    this.headers = headers;
    this.query = query;
    this.push(null);
  }
  _read(): void {}
  get(name: string): string | undefined { return this.headers[name.toLowerCase()]; }
}

const invoke = async (router: Router, method: "get" | "post", routePath: string, req: Request): Promise<MemoryResponse> => {
  const route = router.stack?.find((layer) => layer.route?.path === routePath && layer.route.methods?.[method])?.route;
  if (!route?.stack) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  const response = new MemoryResponse();
  await new Promise<void>((resolve, reject) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { reject(error); return; }
      const handler = route.stack?.[index++]?.handle;
      if (!handler) { resolve(); return; }
      Promise.resolve(handler(req, response, next)).then(() => {
        if (response.writableEnded) resolve();
      }).catch(reject);
    };
    response.once("finish", resolve);
    response.once("error", reject);
    next();
  });
  return response;
};

const hash = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const assertNoSymlinks = async (directory: string): Promise<void> => {
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink()) throw new Error("Refusing fixture cleanup because a synthetic root contains a symlink");
    if (stat.isDirectory()) await assertNoSymlinks(target);
  }
};
const episodeIds = [991731, 991732] as const;
const candidateIds = ["b4bb3ee0-0f72-4dc0-85f8-839aef1c1a01", "b4bb3ee0-0f72-4dc0-85f8-839aef1c1a02"] as const;
const operatorEmail = "synthetic-operator@example.test";
const sourceBytes = ["fixture-cover-approval", "fixture-audio-approval", "fixture-cover-review", "fixture-audio-review"] as const;
const reviewVideoFixtureRelativePath = "src/scripts/fixtures/unapproved-review-preview.mp4";
const reviewVideoFixtureBytes = fs.readFileSync(path.resolve(process.cwd(), reviewVideoFixtureRelativePath));
const outputBytes = [Buffer.from("FAKE-MP4-APPROVAL-CANDIDATE-V1"), reviewVideoFixtureBytes];
const sourceFingerprints = [
  hash(JSON.stringify({ cover: hash(sourceBytes[0]), audio: hash(sourceBytes[1]), transcript: "missing", profileId: "square-reels-karaoke-v2", profileRevision: 2 })),
  hash(JSON.stringify({ cover: hash(sourceBytes[2]), audio: hash(sourceBytes[3]), transcript: "missing", profileId: "square-reels-karaoke-v2", profileRevision: 2 })),
];
const approvedSourceRevision = `episode:${episodeIds[0]}:${hash(JSON.stringify({
  mediaReference: `episodes/${episodeIds[0]}/trailer.mp4`, sha256: hash(outputBytes[0]), byteCount: outputBytes[0].byteLength, mimeType: "video/mp4",
}))}`;
const attemptIds = episodeIds.map((episodeId) => `synthetic-attempt-${episodeId}`);
const journalId = "b4bb3ee0-0f72-4dc0-85f8-839aef1c1a03";

const cleanupManifestFixture = async (manifestPath: string, expectedMode: "hold-for-admin-smoke" | "default-cleanup", remove = true): Promise<void> => {
  const resolvedManifestPath = path.resolve(manifestPath);
  const root = path.dirname(resolvedManifestPath);
  const realRoot = await fs.promises.realpath(root);
  const stat = await fs.promises.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(realRoot) !== path.resolve(os.tmpdir())
    || path.basename(realRoot).startsWith("dc-trailer-release-") === false
    || path.resolve(resolvedManifestPath) !== path.join(realRoot, "fixture-manifest.json")) {
    throw new Error("Refusing cleanup: manifest does not identify an exact release fixture temp root");
  }
  const manifest = JSON.parse(await fs.promises.readFile(resolvedManifestPath, "utf8"));
  await assertNoSymlinks(realRoot);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.mode, expectedMode);
  assert.equal(manifest.fixtureRoot, realRoot);
  assert.deepEqual(manifest.episodes.map((entry: any) => entry.episodeId), [...episodeIds]);
  assert.deepEqual(manifest.episodes.map((entry: any) => entry.candidate.candidateId), [...candidateIds]);
  assert.equal(manifest.syntheticOperator.email, operatorEmail);
  assert.deepEqual(manifest.sourceFixtures, [{
    path: reviewVideoFixtureRelativePath,
    sha256: hash(reviewVideoFixtureBytes),
    bytes: reviewVideoFixtureBytes.byteLength,
  }]);
  const strict = true;
  const dbPath = path.join(realRoot, manifest.database);
  assert.equal(dbPath, path.join(realRoot, "release.sqlite"));
  if (await fs.promises.access(dbPath).then(() => true).catch(() => false)) {
    const database = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const episodes = database.prepare("SELECT episode_id, created_at FROM episodes ORDER BY episode_id").all() as Array<{ episode_id: number; created_at: string }>;
      assert.equal(episodes.every((row) => episodeIds.includes(row.episode_id as typeof episodeIds[number])), true);
      const episodeTitles = database.prepare("SELECT episode_id, title FROM episodes ORDER BY episode_id").all() as Array<{ episode_id: number; title: string }>;
      assert.equal(episodeTitles.every((row) => manifest.episodes.some((entry: any) => entry.episodeId === row.episode_id && entry.title === row.title)), true);
      if (strict) assert.deepEqual(episodes.map((row) => row.episode_id), [...episodeIds]);
      assert.deepEqual(JSON.parse(JSON.stringify(episodes)), manifest.relatedRows.find((row: any) => row.table === "episodes").keys);
      const candidates = database.prepare("SELECT candidate_id, episode_id, version, status FROM trailer_candidate_versions ORDER BY episode_id").all() as Array<{ candidate_id: string; episode_id: number; version: number; status: string }>;
      assert.equal(candidates.every((row) => candidateIds.includes(row.candidate_id as typeof candidateIds[number]) && episodeIds[candidateIds.indexOf(row.candidate_id as typeof candidateIds[number])] === row.episode_id && row.version === 1), true);
      if (strict) assert.deepEqual(candidates.map((row) => ({ candidate_id: row.candidate_id, status: row.status })), candidateIds.map((candidate_id) => ({ candidate_id, status: "ready" })));
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare("SELECT candidate_id, episode_id, version, status, source_fingerprint, output_relative_path, output_sha256, output_bytes FROM trailer_candidate_versions ORDER BY episode_id").all())), manifest.relatedRows.find((row: any) => row.table === "trailer_candidate_versions").keys);
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare("SELECT attempt_id, candidate_id, attempt_number, status FROM trailer_candidate_attempts ORDER BY candidate_id").all())), manifest.relatedRows.find((row: any) => row.table === "trailer_candidate_attempts").keys);
      const decisions = database.prepare("SELECT candidate_id, decision FROM trailer_candidate_decisions").all() as Array<{ candidate_id: string; decision: string }>;
      assert.equal(decisions.every((row) => row.candidate_id === candidateIds[0] && row.decision === "approved"), true);
      if (strict) assert.deepEqual(decisions.map(({ candidate_id, decision }) => ({ candidate_id, decision })), [{ candidate_id: candidateIds[0], decision: "approved" }]);
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare("SELECT candidate_id, episode_id, decision, expected_version, expected_source_fingerprint FROM trailer_candidate_decisions ORDER BY candidate_id").all())), manifest.relatedRows.find((row: any) => row.table === "trailer_candidate_decisions").keys);
      const journals = database.prepare("SELECT journal_id, episode_id, candidate_id, phase FROM trailer_promotion_journals").all() as Array<{ journal_id: string; episode_id: number; candidate_id: string; phase: string }>;
      assert.equal(journals.every((row) => row.episode_id === episodeIds[0] && row.candidate_id === candidateIds[0]), true);
      if (strict) {
        assert.deepEqual(journals.map(({ episode_id, candidate_id, phase }) => ({ episode_id, candidate_id, phase })), [{ episode_id: episodeIds[0], candidate_id: candidateIds[0], phase: "committed" }]);
        assert.equal(manifest.relatedRows.find((row: any) => row.table === "trailer_promotion_journals").keys[0].journal_id, journals[0].journal_id);
      }
      const effects = database.prepare("SELECT episode_id, destination FROM episode_publication_effects ORDER BY destination").all() as Array<{ episode_id: number; destination: string }>;
      assert.equal(effects.every((row) => row.episode_id === episodeIds[0] && ["facebook_native_video", "instagram_reel"].includes(row.destination)), true);
      if (strict) assert.deepEqual(effects.map(({ episode_id, destination }) => ({ episode_id, destination })), [{ episode_id: episodeIds[0], destination: "facebook_native_video" }, { episode_id: episodeIds[0], destination: "instagram_reel" }]);
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare("SELECT journal_id, episode_id, candidate_id, phase, new_sha256 FROM trailer_promotion_journals ORDER BY journal_id").all())), manifest.relatedRows.find((row: any) => row.table === "trailer_promotion_journals").keys);
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare("SELECT intent_id, episode_id, source_revision FROM episode_publication_intents ORDER BY intent_id").all())), manifest.relatedRows.find((row: any) => row.table === "episode_publication_intents").keys);
      assert.deepEqual(JSON.parse(JSON.stringify(database.prepare("SELECT effect_key, intent_id, episode_id, destination, source_revision, lifecycle FROM episode_publication_effects ORDER BY destination").all())), manifest.relatedRows.find((row: any) => row.table === "episode_publication_effects").keys);
    } finally {
      database.close();
    }
  } else {
    assert.equal(strict, false, "a completed held fixture must have its manifest-bound SQLite database");
  }
  for (const entry of manifest.episodes) {
    for (const file of entry.sourceFiles) {
      const filePath = path.join(realRoot, file.path);
      if (await fs.promises.access(filePath).then(() => true).catch(() => false)) assert.equal(hash(await fs.promises.readFile(filePath)), file.sha256);
      else assert.equal(strict, false, "a completed fixture must retain every source file");
    }
    const outputPath = path.join(realRoot, "private/trailer-candidates", entry.candidate.outputRelativePath);
    if (await fs.promises.access(outputPath).then(() => true).catch(() => false)) assert.equal(hash(await fs.promises.readFile(outputPath)), entry.candidate.outputSha256);
    else assert.equal(strict, false, "a completed fixture must retain every candidate output");
    const index = candidateIds.indexOf(entry.candidate.candidateId as typeof candidateIds[number]);
    const expectedSnapshotFiles = entry.candidate.snapshotFiles ?? [
      { path: `${entry.candidate.candidateId}/cover.jpeg`, sha256: hash(sourceBytes[index === 0 ? 0 : 2]) },
      { path: `${entry.candidate.candidateId}/trailer.mp3`, sha256: hash(sourceBytes[index === 0 ? 1 : 3]) },
      { path: `${entry.candidate.candidateId}/trailer-transcript.txt`, sha256: hash("Synthetic private transcript") },
    ];
    for (const file of expectedSnapshotFiles) assert.equal(hash(await fs.promises.readFile(path.join(realRoot, "private/trailer-candidates", file.path))), file.sha256);
  }
  const canonicalPath = path.join(realRoot, "media/episodes", String(episodeIds[0]), "trailer.mp4");
  if (await fs.promises.access(canonicalPath).then(() => true).catch(() => false)) assert.equal(hash(await fs.promises.readFile(canonicalPath)), manifest.episodes[0].candidate.outputSha256);
  else assert.equal(strict, false, "a completed fixture must retain its canonical handoff file");
  if (remove) {
    await fs.promises.rm(realRoot, { recursive: true, force: false });
    assert.equal(await fs.promises.access(realRoot).then(() => true).catch(() => false), false, "manifest-bound fixture root must be absent after cleanup");
  }
};

const main = async (): Promise<void> => {
  const cleanupIndex = process.argv.indexOf("--cleanup-held");
  const cleanupManifestIndex = process.argv.indexOf("--cleanup-manifest");
  const inspectManifestIndex = process.argv.indexOf("--inspect-manifest");
  if (cleanupIndex >= 0 || cleanupManifestIndex >= 0 || inspectManifestIndex >= 0) {
    const selectedIndex = inspectManifestIndex >= 0 ? inspectManifestIndex : cleanupManifestIndex >= 0 ? cleanupManifestIndex : cleanupIndex;
    const actualManifestPath = process.argv[selectedIndex + 1];
    if (!actualManifestPath || process.argv.length !== selectedIndex + 2) throw new Error("manifest mode requires exactly one manifest path");
    const mode = JSON.parse(await fs.promises.readFile(actualManifestPath, "utf8")).mode;
    if (mode !== "hold-for-admin-smoke" && mode !== "default-cleanup") throw new Error("cleanup manifest has an unsupported mode");
    const inspectOnly = inspectManifestIndex >= 0;
    await cleanupManifestFixture(actualManifestPath, mode, !inspectOnly);
    console.log(inspectOnly ? "manifest-bound fixture identity validated" : "manifest-bound fixture verified and removed");
    return;
  }
  const hold = process.argv.includes("--hold-for-admin-smoke");
  if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--hold-for-admin-smoke")) throw new Error("Unknown release verifier option");
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") throw new Error("Release verification is development-only");

  const originalWorkingDirectory = process.cwd();
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-trailer-release-"));
  const rootRealPath = await fs.promises.realpath(root);
  const manifestPath = path.join(root, "fixture-manifest.json");
  const mediaRoot = path.join(root, "media");
  const privateRoot = path.join(root, "private", "trailer-candidates");
  const databasePath = path.join(root, "release.sqlite");
  const fixtureTime = new Date().toISOString();
  const manifest: any = {
    manifestVersion: 1,
    purpose: "synthetic fake-only trailer release proof",
    createdAt: fixtureTime,
    fixtureRoot: rootRealPath,
    syntheticOperator: { email: operatorEmail, auth: "normal signed local JWT; secret/token never persisted" },
    sourceFixtures: [{ path: reviewVideoFixtureRelativePath, sha256: hash(reviewVideoFixtureBytes), bytes: reviewVideoFixtureBytes.byteLength }],
    database: "release.sqlite",
    mediaRoot: "media/",
    privateRoot: "private/trailer-candidates/",
    timestamps: { episodeCreatedAt: fixtureTime, candidateCreatedAt: fixtureTime, candidateReadyAt: fixtureTime, decisionAt: fixtureTime, journalAt: fixtureTime },
    canonicalFile: { path: `media/episodes/${episodeIds[0]}/trailer.mp4`, sha256: hash(outputBytes[0]), bytes: outputBytes[0].byteLength },
    episodes: episodeIds.map((episodeId, index) => ({
      episodeId,
      title: `Synthetic release proof ${index + 1}`,
      createdAt: fixtureTime,
      sourceFiles: index === 0
        ? [{ path: `media/staging/${episodeId}/cover.jpeg`, sha256: hash(sourceBytes[0]) }, { path: `media/staging/${episodeId}/trailer.mp3`, sha256: hash(sourceBytes[1]) }]
        : [{ path: `media/staging/${episodeId}/cover.jpeg`, sha256: hash(sourceBytes[2]) }, { path: `media/staging/${episodeId}/trailer.mp3`, sha256: hash(sourceBytes[3]) }],
      candidate: {
        candidateId: candidateIds[index], version: 1, status: "ready",
        sourceFingerprint: sourceFingerprints[index],
        snapshotFiles: index === 0
          ? [{ path: `${candidateIds[index]}/cover.jpeg`, sha256: hash(sourceBytes[0]) }, { path: `${candidateIds[index]}/trailer.mp3`, sha256: hash(sourceBytes[1]) }, { path: `${candidateIds[index]}/trailer-transcript.txt`, sha256: hash("Synthetic private transcript") }]
          : [{ path: `${candidateIds[index]}/cover.jpeg`, sha256: hash(sourceBytes[2]) }, { path: `${candidateIds[index]}/trailer.mp3`, sha256: hash(sourceBytes[3]) }, { path: `${candidateIds[index]}/trailer-transcript.txt`, sha256: hash("Synthetic private transcript") }],
        outputRelativePath: `${candidateIds[index]}/attempts/1/candidate.mp4`,
        outputSha256: hash(outputBytes[index]), outputBytes: outputBytes[index].byteLength,
        decision: index === 0 ? "approve once" : "remain unapproved for operator review",
      },
    })),
    relatedRows: [
      { table: "episodes", keys: episodeIds.map((episode_id) => ({ episode_id, created_at: fixtureTime })) },
      { table: "trailer_candidate_versions", keys: candidateIds.map((candidate_id, index) => ({ candidate_id, episode_id: episodeIds[index], version: 1, status: "ready", source_fingerprint: sourceFingerprints[index], output_relative_path: `${candidate_id}/attempts/1/candidate.mp4`, output_sha256: hash(outputBytes[index]), output_bytes: outputBytes[index].byteLength })) },
      { table: "trailer_candidate_attempts", keys: candidateIds.map((candidate_id, index) => ({ attempt_id: attemptIds[index], candidate_id, attempt_number: 1, status: "ready" })) },
      { table: "trailer_candidate_decisions", keys: [{ candidate_id: candidateIds[0], episode_id: episodeIds[0], decision: "approved", expected_version: 1, expected_source_fingerprint: sourceFingerprints[0] }] },
      { table: "trailer_promotion_journals", keys: [{ journal_id: journalId, episode_id: episodeIds[0], candidate_id: candidateIds[0], phase: "committed", new_sha256: hash(outputBytes[0]) }] },
      { table: "episode_publication_intents", keys: [{ intent_id: `episode:${episodeIds[0]}:${approvedSourceRevision}`, episode_id: episodeIds[0], source_revision: approvedSourceRevision }] },
      { table: "episode_publication_effects", keys: ["facebook_native_video", "instagram_reel"].map((destination) => ({ effect_key: `episode:${episodeIds[0]}:${approvedSourceRevision}:${destination}`, intent_id: `episode:${episodeIds[0]}:${approvedSourceRevision}`, episode_id: episodeIds[0], destination, source_revision: approvedSourceRevision, lifecycle: "published" })) },
    ],
    mode: hold ? "hold-for-admin-smoke" : "default-cleanup",
  };
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });

  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  const originalConsoleLog = console.log;
  const originalDate = globalThis.Date;
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const originalRandomUUID = crypto.randomUUID;
  let uuidIndex = 0;
  const uuidQueue = [...candidateIds, "b4bb3ee0-0f72-4dc0-85f8-839aef1c1a03"];
  let networkCalls = 0;
  let fakeProviderCalls = 0;
  let holdReady = false;
  try {
    process.chdir(root);
    const fixedTimeMs = originalDate.parse(fixtureTime);
    class FixtureDate extends originalDate {
      constructor(...args: any[]) { if (args.length === 0) super(fixtureTime); else super(args[0]); }
      static now(): number { return fixedTimeMs; }
    }
    globalThis.Date = FixtureDate as DateConstructor;
    process.env.NODE_ENV = "development";
    process.env.SQLITE_PATH = databasePath;
    process.env.SQLITE_RESET = "true";
    process.env.MEDIA_STORAGE_ROOT = mediaRoot;
    process.env.MEDIA_EPISODES_DIR = path.join(mediaRoot, "episodes");
    process.env.MEDIA_EPISODES_STAGING_DIR = path.join(mediaRoot, "staging");
    process.env.MEDIA_BACKUP_ROOT = path.join(mediaRoot, "backups");
    process.env.MEDIA_BACKUP_EPISODES_DIR = path.join(mediaRoot, "backups", "episodes");
    process.env.TRAILER_CANDIDATES_ROOT = privateRoot;
    process.env.TRAILER_CANDIDATE_RENDER_ENABLED = "true";
    process.env.DISABLE_BACKGROUND_WORKERS = "true";
    process.env.AUTH_BYPASS = "false";
    process.env.GOOGLE_CLIENT_ID = "synthetic-client-id.example.test";
    process.env.JWT_SECRET = randomBytes(32).toString("hex");
    process.env.FEED_BASE_LINK = "https://example.test/episodes";
    process.env.FEED_AUDIO_BASE = "https://example.test/media";
    process.env.FEED_IMAGE_BASE = "https://example.test/images/";
    process.env.FEED_TITLE = "Synthetic release proof";
    process.env.FEED_DESCRIPTION = "Offline fixture";
    process.env.FEED_SITE = "https://example.test";
    process.env.PROMOTION_ENABLED = "false";
    process.env.PROMOTION_LEGACY_LAUNCH_ENABLED = "false";
    process.env.META_INSTAGRAM_ENABLED = "true";
    process.env.META_FACEBOOK_REEL_ENABLED = "true";
    process.env.META_USER_ACCESS_TOKEN = "";
    process.env.META_PAGE_ACCESS_TOKEN = "";
    process.env.META_SYSTEM_USER_ACCESS_TOKEN = "";
    process.env.META_APP_ID = "";
    process.env.META_APP_SECRET = "";
    process.env.META_PAGE_ID = "";
    process.env.META_INSTAGRAM_ACCOUNT_ID = "";
    process.env.TELEGRAM_BOT_TOKEN = "";
    process.env.YOUTUBE_CLIENT_SECRET = "";
    process.env.YOUTUBE_REFRESH_TOKEN = "";
    globalThis.fetch = (async () => { networkCalls += 1; throw new Error("Outbound network is blocked in composite fake-only verification"); }) as typeof fetch;
    crypto.randomUUID = (() => uuidQueue[uuidIndex++] ?? originalRandomUUID()) as typeof crypto.randomUUID;
    console.log = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.startsWith("SQLite database ready at ")) originalConsoleLog("Synthetic fixture database ready (path redacted)");
      else originalConsoleLog(...args);
    };

    const [{ config }, { connectDb }, { episodeRepository }, { episodeSchema }, media, candidateService, candidateRepoModule, { episodesRouter }, publicCatalog, { buildFeedXml }, { signAccessToken }, { getDb }, promotionRepoModule, publicationRepoModule] = await Promise.all([
      import("../config/env.js"), import("../database/connect.js"), import("../database/repositories/episode.repository.js"),
      import("../schemas/episode.js"), import("../services/episode-media-layout.service.js"), import("../services/trailer-candidate.service.js"),
      import("../database/repositories/trailer-candidate.repository.js"), import("../routes/episodes.routes.js"),
      import("../services/public-episode-catalog.service.js"), import("../services/feed.service.js"), import("../auth/auth.service.js"),
      import("../database/sqlite.js"),
      import("../database/repositories/episode-promotion.repository.js"), import("../database/repositories/episode-publication.repository.js"),
    ]);
    const publication = require("../services/episode-publication.service.js") as {
      dispatchEpisodeReplacementPublication: typeof import("../services/episode-publication.service.js").dispatchEpisodeReplacementPublication;
    };
    assert.equal(config.auth.bypassInDev, false, "the verifier must exercise normal bearer-token authentication");
    assert.deepEqual([
      config.meta.userAccessToken, config.meta.pageAccessToken, config.meta.systemUserAccessToken,
      config.meta.appId, config.meta.appSecret, config.meta.pageId, config.meta.instagramAccountId,
    ], ["", "", "", "", "", "", ""], "real provider credentials are unavailable to the composite fixture");
    config.trailerCandidateRenderEnabled = true;
    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = true;
    config.promotion.enabled = false;
    config.promotion.legacyLaunchEnabled = false;

    const originalDispatch = publication.dispatchEpisodeReplacementPublication;
    const fakeProvider = {
      async createInstagramContainer() { fakeProviderCalls += 1; return { id: "fixture-instagram-container", status: "IN_PROGRESS" }; },
      async getInstagramContainer() { fakeProviderCalls += 1; return { id: "fixture-instagram-container", status: "FINISHED" }; },
      async publishInstagramContainer() { fakeProviderCalls += 1; return { id: "fixture-instagram-media", status: "FINISHED", permalink: "https://example.test/fake/instagram" }; },
      async uploadFacebookVideo() { fakeProviderCalls += 1; return { id: "fixture-facebook-video", status: "PROCESSING" }; },
      async getFacebookVideo() { fakeProviderCalls += 1; return { id: "fixture-facebook-video", status: "ready" }; },
      async publishFacebookVideo() { fakeProviderCalls += 1; return { id: "fixture-facebook-video", status: "FINISHED", permalink: "https://example.test/fake/facebook" }; },
    };
    publication.dispatchEpisodeReplacementPublication = async (episodeId: number, sourceRevision: string) =>
      originalDispatch(episodeId, sourceRevision, fakeProvider as any);
    const router = episodesRouter as unknown as Router;
    const token = signAccessToken({ email: operatorEmail });
    const authHeaders = { authorization: `Bearer ${token}` };
    const { trailerCandidateRepository } = candidateRepoModule;
    const createEpisode = async (episodeId: number, title: string, cover: string, audio: string): Promise<string> => {
      episodeRepository.create(episodeSchema.parse({
        episodeId, title, summary: "Synthetic only", pubDate: new Date(fixtureTime), explicit: "no",
        authors: [], guests: [], tags: [], citations: [], musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
        coverCredits: [], launchNotificationState: "idle",
      }));
      const coverPath = media.getEpisodeMediaStagingPath(episodeId, "cover");
      const audioPath = media.getEpisodeMediaStagingPath(episodeId, "trailer");
      await fs.promises.mkdir(path.dirname(coverPath), { recursive: true });
      await fs.promises.mkdir(path.dirname(audioPath), { recursive: true });
      await fs.promises.writeFile(coverPath, cover, { flag: "wx", mode: 0o600 });
      await fs.promises.writeFile(audioPath, audio, { flag: "wx", mode: 0o600 });
      const fingerprint = await candidateService.getCurrentTrailerCandidateSourceFingerprint(episodeId);
      assert.ok(fingerprint);
      const denied = await invoke(router, "post", "/:episodeId/trailer-candidates", new Request({ episodeId: String(episodeId) }, {
        transcriptText: "Synthetic private transcript", expectedSourceFingerprint: fingerprint,
      }));
      assert.equal(denied.statusCode, 401, "candidate requests require normal bearer authentication");
      const response = await invoke(router, "post", "/:episodeId/trailer-candidates", new Request({ episodeId: String(episodeId) }, {
        transcriptText: "Synthetic private transcript", expectedSourceFingerprint: fingerprint,
      }, authHeaders));
      assert.equal(response.statusCode, 202);
      const episodeIndex = episodeIds.indexOf(episodeId as never);
      assert.equal(response.jsonBody.candidateId, candidateIds[episodeIndex]);
      assert.equal(response.jsonBody.sourceFingerprint, sourceFingerprints[episodeIndex]);
      const candidateId = response.jsonBody.candidateId as string;
      const candidate = trailerCandidateRepository.findById(candidateId);
      assert.ok(candidate);
      const attempt = trailerCandidateRepository.claim(candidateId, attemptIds[episodeIndex]);
      assert.ok(attempt);
      const candidateIndex = episodeIds.indexOf(episodeId as never);
      const bytes = outputBytes[candidateIndex];
      const outputRelativePath = manifest.episodes[candidateIndex].candidate.outputRelativePath as string;
      const outputPath = path.join(privateRoot, outputRelativePath);
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
      assert.equal(trailerCandidateRepository.markReady(candidateId, {
        relativePath: outputRelativePath, sha256: hash(bytes), bytes: bytes.byteLength, durationSeconds: 7.25,
        probeJson: JSON.stringify({ streams: [{ codec_type: "video", width: 1280, height: 1280 }] }),
      }), true);
      return fingerprint;
    };

    await createEpisode(episodeIds[0], manifest.episodes[0].title, sourceBytes[0], sourceBytes[1]);
    await createEpisode(episodeIds[1], manifest.episodes[1].title, sourceBytes[2], sourceBytes[3]);
    assert.equal(uuidIndex, 2, "candidate UUIDs must match the prewritten manifest");
    const approvedEntry = manifest.episodes[0];
    const reviewGrantResponse = await invoke(router, "post", "/:episodeId/trailer-candidates/:candidateId/preview-grant", new Request({
      episodeId: String(episodeIds[1]), candidateId: candidateIds[1],
    }, {}, authHeaders));
    assert.equal(reviewGrantResponse.statusCode, 201);
    const reviewGrant = new URL(reviewGrantResponse.jsonBody.previewUrl, "https://example.test").searchParams.get("grant");
    assert.ok(reviewGrant);
    const reviewPreview = await invoke(router, "get", "/:episodeId/trailer-candidates/:candidateId/preview", new Request({
      episodeId: String(episodeIds[1]), candidateId: candidateIds[1],
    }, {}, {}, { grant: reviewGrant as string }));
    assert.equal(reviewPreview.statusCode, 200);
    assert.equal(reviewPreview.headers["content-type"], "video/mp4");
    assert.deepEqual(reviewPreview.body, outputBytes[1]);

    const candidateStatus = await invoke(router, "get", "/:episodeId/trailer-candidates/current", new Request({ episodeId: String(episodeIds[0]) }, {}, authHeaders));
    assert.equal(candidateStatus.statusCode, 200);
    assert.equal(candidateStatus.jsonBody.candidateId, candidateIds[0]);
    const approvalGrantResponse = await invoke(router, "post", "/:episodeId/trailer-candidates/:candidateId/preview-grant", new Request({
      episodeId: String(episodeIds[0]), candidateId: candidateIds[0],
    }, {}, authHeaders));
    assert.equal(approvalGrantResponse.statusCode, 201);
    const approvalGrant = new URL(approvalGrantResponse.jsonBody.previewUrl, "https://example.test").searchParams.get("grant");
    assert.ok(approvalGrant);
    const approvalPreview = await invoke(router, "get", "/:episodeId/trailer-candidates/:candidateId/preview", new Request({
      episodeId: String(episodeIds[0]), candidateId: candidateIds[0],
    }, {}, {}, { grant: approvalGrant as string }));
    assert.deepEqual(approvalPreview.body, outputBytes[0]);

    const publicEpisode = episodeRepository.findByEpisodeId(episodeIds[0])!;
    const publicDto = publicCatalog.mapEpisodeToPublicDetail(publicEpisode, { requestOrigin: "https://example.test" });
    const catalogDto = publicCatalog.mapEpisodesToPublicCatalog([publicEpisode], { requestOrigin: "https://example.test" });
    const feed = buildFeedXml([publicEpisode]);
    for (const projection of [JSON.stringify(publicDto), JSON.stringify(catalogDto), feed, JSON.stringify(publicEpisode)]) {
      for (const entry of manifest.episodes) {
        assert.equal(projection.includes(entry.candidate.candidateId), false, "candidate identity must not leak through public/feed/bot-safe projections");
        assert.equal(projection.includes(entry.candidate.outputRelativePath), false, "private path must not leak through public/feed/bot-safe projections");
        assert.equal(projection.includes(entry.candidate.outputSha256), false, "private output hash must not leak through public/feed/bot-safe projections");
      }
      for (const bytes of outputBytes) assert.equal(projection.includes(bytes.toString("utf8")), false, "candidate bytes must not leak through public/feed/bot-safe projections");
      assert.equal(projection.includes("Synthetic private transcript"), false, "private transcript must not leak through public/feed/bot-safe projections");
    }
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM trailer_candidate_decisions WHERE candidate_id = ?").get(candidateIds[0])?.count ?? 0, 0,
      "approval candidate remains unapproved until explicit operator action");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM episode_publication_effects WHERE episode_id IN (?, ?)").get(...episodeIds)?.count ?? 0, 0,
      "preview and review do not create delivery effects");

    const approvalBody = { decision: "approve", expectedSourceFingerprint: candidateStatus.jsonBody.sourceFingerprint, expectedVersion: candidateStatus.jsonBody.version };
    const decisionResponse = await invoke(router, "post", "/:episodeId/trailer-candidates/:candidateId/decision", new Request({
      episodeId: String(episodeIds[0]), candidateId: candidateIds[0],
    }, approvalBody, authHeaders));
    assert.equal(decisionResponse.statusCode, 200);
    assert.equal(decisionResponse.jsonBody.status, "approved");
    assert.equal(decisionResponse.jsonBody.candidateId, candidateIds[0]);
    assert.equal(decisionResponse.jsonBody.version, 1);
    assert.equal(decisionResponse.jsonBody.sourceFingerprint, approvalBody.expectedSourceFingerprint);
    assert.equal(decisionResponse.jsonBody.sourceRevision, approvedSourceRevision, "the revision must match the prewritten manifest identity");
    assert.equal(uuidIndex, 3, "promotion journal UUID must match the prewritten manifest identity");
    const canonicalPath = media.getEpisodeMediaFinalPath(episodeIds[0], "trailerVideo");
    assert.deepEqual(await fs.promises.readFile(canonicalPath), outputBytes[0], "canonical file must exactly match the approved manifest candidate");
    assert.equal(hash(await fs.promises.readFile(canonicalPath)), approvedEntry.candidate.outputSha256);
    assert.equal(fakeProviderCalls > 0, true, "approved replacement must reach fake-only destination adapters");
    assert.equal(networkCalls, 0, "the composite verifier makes no outbound network calls");
    const effects = publicationRepoModule.episodePublicationRepository.list(episodeIds[0]);
    assert.equal(effects.length, 2);
    assert.deepEqual(effects.map((effect: any) => effect.destination).sort(), ["facebook_native_video", "instagram_reel"]);
    assert.equal(fakeProviderCalls > 0, true, "real provider adapters are not available to this fixture");
    const promotionEffectsBeforeReplay = promotionRepoModule.episodePromotionRepository.findPromotionIntent(`episode:${episodeIds[0]}`)?.effects.length ?? 0;
    const fakeProviderCallsBeforeReplay = fakeProviderCalls;
    const replay = await invoke(router, "post", "/:episodeId/trailer-candidates/:candidateId/decision", new Request({
      episodeId: String(episodeIds[0]), candidateId: candidateIds[0],
    }, approvalBody, authHeaders));
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.jsonBody.status, "replayed");
    assert.equal(publicationRepoModule.episodePublicationRepository.list(episodeIds[0]).length, 2, "replay must not duplicate destination effects");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM trailer_candidate_decisions WHERE candidate_id = ?").get(candidateIds[0])?.count ?? 0, 1,
      "exactly one approval decision row must exist");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM trailer_candidate_decisions WHERE candidate_id = ?").get(candidateIds[1])?.count ?? 0, 0,
      "operator review entry must remain unapproved");
    assert.equal(promotionRepoModule.episodePromotionRepository.findPromotionIntent(`episode:${episodeIds[0]}`)?.effects.length ?? 0, promotionEffectsBeforeReplay,
      "approval replay must not create a second episode launch event");
    assert.equal(fakeProviderCallsBeforeReplay, fakeProviderCalls, "replay must not dispatch another provider effect");
    assert.equal(networkCalls, 0);

    manifest.completedAt = new Date().toISOString();
    manifest.runtime = { databaseSha256: hash(await fs.promises.readFile(databasePath)), approvedSourceRevision: decisionResponse.jsonBody.sourceRevision };
    const exactRows = [
      ["episodes", getDb().prepare("SELECT episode_id, created_at FROM episodes ORDER BY episode_id").all()],
      ["trailer_candidate_versions", getDb().prepare("SELECT candidate_id, episode_id, version, status, source_fingerprint, output_relative_path, output_sha256, output_bytes FROM trailer_candidate_versions ORDER BY episode_id").all()],
      ["trailer_candidate_attempts", getDb().prepare("SELECT attempt_id, candidate_id, attempt_number, status FROM trailer_candidate_attempts ORDER BY candidate_id").all()],
      ["trailer_candidate_decisions", getDb().prepare("SELECT candidate_id, episode_id, decision, expected_version, expected_source_fingerprint FROM trailer_candidate_decisions ORDER BY candidate_id").all()],
      ["trailer_promotion_journals", getDb().prepare("SELECT journal_id, episode_id, candidate_id, phase, new_sha256 FROM trailer_promotion_journals ORDER BY journal_id").all()],
      ["episode_publication_intents", getDb().prepare("SELECT intent_id, episode_id, source_revision FROM episode_publication_intents ORDER BY intent_id").all()],
      ["episode_publication_effects", getDb().prepare("SELECT effect_key, intent_id, episode_id, destination, source_revision, lifecycle FROM episode_publication_effects ORDER BY destination").all()],
    ] as Array<[string, unknown[]]>;
    for (const [table, rows] of exactRows) {
      const expected = manifest.relatedRows.find((row: any) => row.table === table)?.keys;
      assert.deepEqual(JSON.parse(JSON.stringify(rows)), expected, `prewritten manifest identity must exactly match ${table}`);
    }
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const savedManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    assert.deepEqual(savedManifest.episodes.map((entry: any) => entry.candidate.candidateId), [...candidateIds]);
    assert.equal(savedManifest.episodes[1].candidate.decision, "remain unapproved for operator review");
    if (hold) {
      holdReady = true;
      console.log("hold-for-admin-smoke fixture verified (synthetic; manifest path withheld from logs)");
      return;
    }
    console.log("composite trailer release proof passed: normal auth, exact private preview, no public leakage, one fake-only approval, canonical handoff, and idempotent replay");
  } finally {
    globalThis.fetch = originalFetch;
    crypto.randomUUID = originalRandomUUID;
    globalThis.Date = originalDate;
    process.chdir(originalCwd);
    console.log = originalConsoleLog;
    if (holdReady) return;
    await cleanupManifestFixture(manifestPath, "default-cleanup");
  }
};

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "composite release proof failed"); process.exitCode = 1; });
