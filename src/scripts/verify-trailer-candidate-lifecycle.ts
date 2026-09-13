import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

type Fixture = {
  root: string;
  media: string;
  generated: string;
  database: string;
  rootIdentity: { dev: number; ino: number };
  protectedRoots: string[];
};

type FixtureManifest = {
  root: string;
  database: string;
  media: string;
  generated: string;
  episodes: Array<{ episodeId: number; title: string }>;
  drafts: string[];
  candidates: Array<Record<string, unknown> & { candidateId: string; episodeId: number; version: number; createdAt: string; snapshotRelativePath: string; outputRelativePath: string | null; outputSha256: string | null }>;
  files: Array<{ relativePath: string; bytes: number; sha256: string }>;
  databaseRows?: Record<string, Array<Record<string, unknown>>>;
};

const manifestFileName = "fixture-manifest.json";

const resolved = (value: string): string => path.resolve(value);
const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

const configuredDataRoots = (): string[] => [
  process.env.SQLITE_PATH ?? path.resolve(process.cwd(), "data", "dragaocareca-admin.sqlite"),
  process.env.MEDIA_STORAGE_ROOT ?? path.resolve(process.cwd(), "data", "media"),
  process.env.TRAILER_CANDIDATES_ROOT ?? path.resolve(process.cwd(), "data", "generated", "trailer-candidates"),
  process.env.MEDIA_EPISODES_DIR ?? path.resolve(process.cwd(), "data", "media", "episodes"),
  process.env.MEDIA_EPISODES_STAGING_DIR ?? path.resolve(process.cwd(), "data", "media", "staging"),
];

const createSyntheticMedia = async (root: string, color: string, frequency: number): Promise<{ cover: string; audio: string }> => {
  const cover = path.join(root, `cover-${color}.jpeg`);
  const audio = path.join(root, `audio-${frequency}.mp3`);
  await import("../services/trailer-candidate-renderer.service.js").then(({ runTrailerProcess }) => Promise.all([
    runTrailerProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=400x400`, "-frames:v", "1", "-threads", "1", "-y", cover], 60_000),
    runTrailerProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=44100:duration=1.4`, "-c:a", "libmp3lame", "-b:a", "64k", "-y", audio], 60_000),
  ]));
  return { cover, audio };
};

const createFixture = async (): Promise<Fixture> => {
  const protectedRoots = configuredDataRoots().map(resolved);
  const temporaryRoot = await fs.promises.realpath(os.tmpdir());
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-trailer-candidate-"));
  const actualRoot = await fs.promises.realpath(root);
  const rootStat = await fs.promises.lstat(root);
  if (!isWithin(temporaryRoot, actualRoot) || rootStat.isSymbolicLink() || !root.startsWith(path.join(os.tmpdir(), "dc-trailer-candidate-"))) {
    throw new Error("candidate lifecycle fixture root is not an owned temporary directory");
  }
  for (const protectedRoot of protectedRoots) {
    if (isWithin(protectedRoot, actualRoot) || isWithin(actualRoot, protectedRoot)) {
      throw new Error("candidate lifecycle fixture overlaps a configured service data root");
    }
  }
  const media = path.join(root, "media");
  const generated = path.join(root, "generated");
  await fs.promises.mkdir(media, { recursive: true });
  process.env.NODE_ENV = "development";
  process.env.SQLITE_PATH = path.join(root, "candidate.sqlite");
  process.env.SQLITE_RESET = "true";
  process.env.MEDIA_STORAGE_ROOT = media;
  process.env.MEDIA_EPISODES_DIR = path.join(media, "episodes");
  process.env.MEDIA_EPISODES_STAGING_DIR = path.join(media, "staging");
  process.env.MEDIA_BACKUP_ROOT = path.join(media, "backups");
  process.env.MEDIA_BACKUP_EPISODES_DIR = path.join(media, "backups", "episodes");
  process.env.TRAILER_CANDIDATES_ROOT = path.join(generated, "trailer-candidates");
  process.env.TRAILER_CANDIDATE_RENDER_ENABLED = "false";
  process.env.PROMOTION_ENABLED = "false";
  process.env.PROMOTION_LEGACY_LAUNCH_ENABLED = "false";
  const database = resolved(process.env.SQLITE_PATH);
  for (const fixtureRoot of [media, generated, path.dirname(database)]) {
    if (!isWithin(actualRoot, resolved(fixtureRoot))) throw new Error("candidate lifecycle fixture data root escaped its temporary directory");
  }
  return { root: actualRoot, media, generated, database, rootIdentity: { dev: rootStat.dev, ino: rootStat.ino }, protectedRoots };
};

const walkFiles = async (directory: string, root: string): Promise<Array<{ relativePath: string; bytes: number; sha256: string }>> => {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files: Array<{ relativePath: string; bytes: number; sha256: string }> = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const stat = await fs.promises.lstat(absolutePath);
    if (stat.isSymbolicLink()) throw new Error("candidate lifecycle fixture contains an unexpected symbolic link");
    if (stat.isDirectory()) files.push(...await walkFiles(absolutePath, root));
    else if (stat.isFile()) {
      files.push({ relativePath: path.relative(root, absolutePath), bytes: stat.size, sha256: createHash("sha256").update(await fs.promises.readFile(absolutePath)).digest("hex") });
    } else throw new Error("candidate lifecycle fixture contains an unexpected filesystem object");
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const removeFixtureAfterIdentityCheck = async (fixture: Fixture, manifest: FixtureManifest): Promise<void> => {
  const rootStat = await fs.promises.lstat(fixture.root);
  const actualRoot = await fs.promises.realpath(fixture.root);
  if (rootStat.isSymbolicLink() || actualRoot !== fixture.root || rootStat.dev !== fixture.rootIdentity.dev || rootStat.ino !== fixture.rootIdentity.ino) {
    throw new Error("candidate lifecycle fixture root identity changed; refusing cleanup");
  }
  if (resolved(manifest.database) !== fixture.database || resolved(manifest.media) !== fixture.media || resolved(manifest.generated) !== fixture.generated) {
    throw new Error("candidate lifecycle manifest root mismatch; refusing cleanup");
  }
  const manifestPath = path.join(fixture.root, manifestFileName);
  const writtenManifest = await fs.promises.readFile(manifestPath, "utf8");
  if (writtenManifest !== JSON.stringify(manifest, null, 2)) throw new Error("candidate lifecycle manifest changed; refusing cleanup");
  const currentFiles = (await walkFiles(fixture.root, fixture.root)).filter((file) => file.relativePath !== manifestFileName);
  if (JSON.stringify(currentFiles) !== JSON.stringify(manifest.files)) {
    throw new Error("candidate lifecycle fixture files changed after manifest; refusing cleanup");
  }
  for (const protectedRoot of fixture.protectedRoots) {
    if (isWithin(protectedRoot, actualRoot) || isWithin(actualRoot, protectedRoot)) {
      throw new Error("candidate lifecycle cleanup overlaps a configured service data root");
    }
  }
  await fs.promises.rm(fixture.root, { recursive: true, force: false });
  if (await fs.promises.access(fixture.root).then(() => true).catch(() => false)) {
    throw new Error("candidate lifecycle temporary root remains after cleanup");
  }
};

const persistManifest = async (fixture: Fixture, manifest: FixtureManifest): Promise<void> => {
  await fs.promises.writeFile(path.join(fixture.root, manifestFileName), JSON.stringify(manifest, null, 2), { flag: "w" });
};

const persistManifestSync = (fixture: Fixture, manifest: FixtureManifest): void => {
  fs.writeFileSync(path.join(fixture.root, manifestFileName), JSON.stringify(manifest, null, 2));
};

const captureFixtureRows = (getDb: () => any): Record<string, Array<Record<string, unknown>>> => {
  const tables = ["episodes", "episode_trailer_video_drafts", "trailer_candidate_versions", "trailer_candidate_attempts", "trailer_candidate_file_cleanup"];
  return Object.fromEntries(tables.map((table) => [table,
    getDb().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Array<Record<string, unknown>>,
  ]));
};

const sealManifestAndCleanup = async (fixture: Fixture, manifest: FixtureManifest, getDb: () => any): Promise<void> => {
  const rows = captureFixtureRows(getDb);
  const episodeIds = new Set(manifest.episodes.map((episode) => episode.episodeId));
  const candidateIds = new Set(manifest.candidates.map((candidate) => candidate.candidateId));
  assert.ok(rows.episodes.every((row) => episodeIds.has(Number(row.episode_id))), "cleanup refused: SQLite contains an episode outside the fixture manifest");
  assert.deepEqual(rows.episode_trailer_video_drafts.map((row) => row.draft_id).sort(), [...manifest.drafts].sort(), "cleanup refused: draft identities do not match the fixture manifest");
  assert.ok(rows.trailer_candidate_versions.every((row) => candidateIds.has(String(row.candidate_id))), "cleanup refused: candidate rows do not match the fixture manifest");
  assert.ok(rows.trailer_candidate_attempts.every((row) => candidateIds.has(String(row.candidate_id))), "cleanup refused: attempt rows are outside the fixture manifest");
  assert.ok(rows.trailer_candidate_file_cleanup.every((row) => candidateIds.has(String(row.candidate_id))), "cleanup refused: cleanup intents are outside the fixture manifest");
  manifest.databaseRows = rows;
  manifest.files = (await walkFiles(fixture.root, fixture.root)).filter((file) => file.relativePath !== manifestFileName);
  await persistManifest(fixture, manifest);
  assert.deepEqual(captureFixtureRows(getDb), manifest.databaseRows, "cleanup refused: database rows changed after manifest capture");
  await removeFixtureAfterIdentityCheck(fixture, manifest);
};

class MultipartRequest extends Readable {
  params: { episodeId: string };
  body: Record<string, unknown> = {};
  headers: Record<string, string>;
  constructor(episodeId: number, bytes: Buffer, fileName: string, mimeType: string) {
    super();
    this.params = { episodeId: String(episodeId) };
    const boundary = "----candidate-lifecycle-boundary";
    this.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    this.headers["content-length"] = String(payload.length);
    this.push(payload);
    this.push(null);
  }
}

class MemoryResponse extends Writable {
  statusCode = 200;
  jsonBody: unknown;
  _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
}

type Handler = (req: any, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type Layer = { route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: Handler }> } };
type Router = { stack?: Layer[] };

const loadRouter = (): Router => {
  const modulePath = require.resolve("../routes/episodes.routes");
  delete require.cache[modulePath];
  return (require("../routes/episodes.routes") as { episodesRouter: Router }).episodesRouter;
};

const episodeCreateBody = (episodeId: number): Record<string, unknown> => ({
  episodeId,
  title: "Candidate fixture episode",
  summary: "",
  pubDate: "2026-01-01T00:00:00.000Z",
  explicit: "no",
  authors: [], guests: [], tags: [], citations: [],
  musicCredits: [JSON.stringify({ name: "Offline candidate fixture music", links: [{ url: "https://example.test/music" }] })],
  coverCredits: [],
});

const invoke = async (router: Router, routePath: string, req: any): Promise<{ response: MemoryResponse; error?: unknown }> => {
  const route = router.stack?.find((layer) => layer.route?.path === routePath && layer.route.methods?.post)?.route;
  if (!route?.stack) throw new Error(`route not found: ${routePath}`);
  const response = new MemoryResponse();
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { resolve({ response, error }); return; }
      const handler = route.stack?.[index++]?.handle;
      if (!handler) { resolve({ response }); return; }
      Promise.resolve(handler(req, response, next)).catch(reject);
    };
    response.once("finish", () => resolve({ response }));
    response.once("error", reject);
    next();
  });
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") throw new Error("candidate lifecycle verifier is development-only");
  const fixture = await createFixture();
  const manifest: FixtureManifest = {
    root: fixture.root,
    database: fixture.database,
    media: fixture.media,
    generated: fixture.generated,
    episodes: [{ episodeId: 987654301, title: "Candidate fixture episode" }],
    drafts: [],
    candidates: [],
    files: [],
  };
  await persistManifest(fixture, manifest);
  const originalFetch = globalThis.fetch;
  let fixtureDbReader: (() => any) | null = null;
  let fetchCalls = 0;
  const blockedFetchCallSites: string[] = [];
  const blockedFetch = (async () => {
    fetchCalls += 1;
    blockedFetchCallSites.push(new Error().stack?.split("\n").slice(2, 5).join("\n") ?? "unknown caller");
    throw new Error("network access is prohibited by candidate verifier");
  }) as typeof fetch;
  globalThis.fetch = blockedFetch;
  try {
    const [{ connectDb }, { getDb }, { episodeRepository }, { trailerCandidateRepository }, mediaLayout, candidateService, candidateCleanup, draftService, { config }, renderer, candidateWorker] = await Promise.all([
      import("../database/connect.js"),
      import("../database/sqlite.js"),
      import("../database/repositories/episode.repository.js"),
      import("../database/repositories/trailer-candidate.repository.js"),
      import("../services/episode-media-layout.service.js"),
      import("../services/trailer-candidate.service.js"),
      import("../services/trailer-candidate-file-cleanup.service.js"),
      import("../services/episode-draft-reservation.service.js"),
      import("../config/env.js"),
      import("../services/trailer-candidate-renderer.service.js"),
      import("../workers/trailer-candidate.worker.js"),
    ]);
    fixtureDbReader = getDb;
    const originalWorkingDirectory = process.cwd();
    process.chdir(fixture.root);
    try {
      const temporaryLegacyDatabase = path.resolve(process.cwd(), "data", "dragaocareca-admin.sqlite");
      assert.equal(await fs.promises.access(temporaryLegacyDatabase).then(() => true).catch(() => false), false, "temporary bootstrap cwd must not contain a legacy database to copy");
      await connectDb();
    } finally {
      process.chdir(originalWorkingDirectory);
    }
    assert.equal(resolved(config.sqlitePath), fixture.database, "candidate verifier must use only its temporary SQLite root");
    assert.equal(resolved(config.media.storageRoot), resolved(fixture.media), "candidate verifier must use only its temporary media root");
    assert.equal(resolved(config.media.trailerCandidatesRoot), resolved(path.join(fixture.generated, "trailer-candidates")), "candidate verifier must use only its temporary generated-media root");
    const originalCreateOrReuse = trailerCandidateRepository.createOrReuse.bind(trailerCandidateRepository);
    trailerCandidateRepository.createOrReuse = (input) => {
      const current = trailerCandidateRepository.findCurrentByEpisode(input.episodeId);
      const reusable = current
        && current.sourceFingerprint === input.sourceFingerprint
        && current.captionMode === (input.captionMode ?? "automatic")
        && (current.trailerTranscriptSha256 ?? null) === (input.trailerTranscriptSha256 ?? null);
      if (reusable) return originalCreateOrReuse(input);
      const nextVersion = current?.sourceFingerprint === input.sourceFingerprint
        ? current.version
        : Number(getDb().prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM trailer_candidate_versions WHERE episode_id = ?").get(input.episodeId)?.next_version ?? 1);
      const entry: FixtureManifest["candidates"][number] = {
        candidateId: input.candidateId,
        episodeId: input.episodeId,
        title: manifest.episodes.find((episode) => episode.episodeId === input.episodeId)?.title ?? "Synthetic fixture episode",
        version: nextVersion,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        snapshotRelativePath: input.snapshotRelativePath,
        outputRelativePath: null,
        outputSha256: null,
        sourceFingerprint: input.sourceFingerprint,
        coverSha256: input.coverSha256,
        audioSha256: input.audioSha256,
      };
      const existing = manifest.candidates.findIndex((candidate) => candidate.candidateId === entry.candidateId);
      if (existing < 0) manifest.candidates.push(entry);
      else manifest.candidates[existing] = entry;
      persistManifestSync(fixture, manifest);
      const result = originalCreateOrReuse(input);
      const row = trailerCandidateRepository.findById(input.candidateId);
      if (row) {
        manifest.candidates[manifest.candidates.findIndex((candidate) => candidate.candidateId === row.candidateId)] = {
          ...entry,
          version: row.version,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          outputRelativePath: row.outputRelativePath,
          outputSha256: row.outputSha256,
        };
        persistManifestSync(fixture, manifest);
      }
      return result;
    };
    const recordDraftFixture = (episodeId: number): void => {
      const reservation = episodeRepository.findTrailerVideoDraftByEpisodeId(episodeId);
      const episode = episodeRepository.findByEpisodeId(episodeId);
      if (reservation && !manifest.drafts.includes(reservation.draftId)) manifest.drafts.push(reservation.draftId);
      if (episode) {
        const existingEpisode = manifest.episodes.findIndex((entry) => entry.episodeId === episode.episodeId);
        const identity = { episodeId: episode.episodeId, title: episode.title };
        if (existingEpisode < 0) manifest.episodes.push(identity);
        else manifest.episodes[existingEpisode] = identity;
      }
      persistManifestSync(fixture, manifest);
    };
    const fixtureTableCounts = ["episodes", "episode_trailer_video_drafts", "trailer_candidate_versions", "trailer_candidate_attempts", "trailer_candidate_file_cleanup"]
      .map((table) => ({ table, count: Number(getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0) }));
    assert.ok(fixtureTableCounts.every((table) => table.count === 0), "temporary SQLite fixture database must start empty before fixture rows are created");
    persistManifestSync(fixture, manifest);
    assert.equal(config.trailerCandidateRenderEnabled, false, "candidate rendering must be disabled by default");
    const router = loadRouter();
    config.auth.bypassInDev = true;

    const foreignDraftId = await draftService.reserveTrailerVideoDraft(987654300, "another-owner@example.com");
    recordDraftFixture(987654300);
    const crossOwnerUpload = await invoke(router, "/:episodeId/cover", new MultipartRequest(987654300, Buffer.from("must-not-write"), "cover.jpeg", "image/jpeg"));
    assert.equal(crossOwnerUpload.response.statusCode, 409);
    assert.equal(await fs.promises.access(mediaLayout.getEpisodeMediaStagingPath(987654300, "cover")).then(() => true).catch(() => false), false);
    assert.ok(episodeRepository.findTrailerVideoDraft(foreignDraftId.draftId));

    const priorCandidateRoot = config.media.trailerCandidatesRoot;
    config.media.trailerCandidatesRoot = path.join(fixture.media, "private-candidate-root");
    await assert.rejects(() => candidateService.assertPrivateTrailerCandidateRoot(), /outside the public media storage root/);
    config.media.trailerCandidatesRoot = priorCandidateRoot;

    const routeEpisodeId = 987654301;
    const coverOnly = await invoke(router, "/:episodeId/cover", new MultipartRequest(routeEpisodeId, Buffer.from("cover-one"), "cover.jpeg", "image/jpeg"));
    recordDraftFixture(routeEpisodeId);
    assert.equal(coverOnly.response.statusCode, 200);
    assert.equal((coverOnly.response.jsonBody as any).trailerCandidate, undefined, "single input must wait without a candidate job");
    assert.equal((coverOnly.response.jsonBody as any).trailerCandidateEnqueue.status, "waiting_for_input");
    const secondInput = await invoke(router, "/:episodeId/trailer", new MultipartRequest(routeEpisodeId, Buffer.from("trailer-one"), "trailer.mp3", "audio/mpeg"));
    recordDraftFixture(routeEpisodeId);
    assert.equal(secondInput.response.statusCode, 200);
    const routeBody = secondInput.response.jsonBody as Record<string, any>;
    assert.equal(routeBody.trailerCandidate.status, "pending", "second upload must enqueue a durable candidate");
    assert.deepEqual(Object.keys(routeBody.trailerCandidate).sort(), ["candidateId", "captionMode", "captionReasonCode", "captionStatus", "createdAt", "episodeId", "errorCategory", "progress", "status", "updatedAt", "version"].sort());
    assert.equal(JSON.stringify(routeBody).includes("sha256"), false);
    assert.equal(JSON.stringify(routeBody).includes("generated"), false);
    const firstId = routeBody.trailerCandidate.candidateId as string;
    const firstCandidate = trailerCandidateRepository.findById(firstId);
    assert.ok(firstCandidate);
    assert.equal("candidateId" in (episodeRepository.findByEpisodeId(routeEpisodeId) ?? {}), false, "candidate state must not join episode/public response data");
    assert.equal(firstCandidate?.version, 1);
    assert.equal(firstCandidate?.status, "pending");
    const privateSnapshot = await candidateService.trailerCandidateStoragePath(`${firstId}/cover.jpeg`);
    assert.equal(await fs.promises.readFile(privateSnapshot, "utf8"), "cover-one");
    assert.equal(candidateService.trailerCandidatePublicMediaBoundary(), true);

    const repeat = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(repeat.waitingForInput, false);
    if (!repeat.waitingForInput) {
      assert.equal(repeat.candidate.candidateId, firstId);
      assert.equal(repeat.reused, true);
    }
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM trailer_candidate_versions WHERE episode_id = ?").get(routeEpisodeId)?.count, 1);

    const reservation = episodeRepository.findActiveTrailerVideoDraftByEpisodeId(routeEpisodeId);
    assert.ok(reservation);
    const wrongOwner = draftService.checkTrailerVideoDraft(reservation?.draftId, routeEpisodeId, "other@example.com", { allowStaged: true });
    assert.equal(wrongOwner.ok, false);
    if (!wrongOwner.ok) assert.equal(wrongOwner.status, 403);
    getDb().prepare("UPDATE episode_trailer_video_drafts SET expires_at = ? WHERE draft_id = ?").run(new Date(Date.now() - 60_000).toISOString(), reservation?.draftId);
    await draftService.cleanupExpiredTrailerVideoDrafts();
    assert.equal(episodeRepository.findTrailerVideoDraft(reservation?.draftId)?.state, "reserved", "active candidate must pin draft reservation past TTL");
    assert.equal(await fs.promises.readFile(mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"), "utf8"), "cover-one");
    getDb().prepare("UPDATE episode_trailer_video_drafts SET expires_at = ? WHERE draft_id = ?").run(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), reservation?.draftId);

    const claim = trailerCandidateRepository.claim(firstId, "attempt-1");
    assert.equal(claim?.status, "processing");
    const recovered = trailerCandidateRepository.recoverProcessing();
    assert.equal(recovered.length, 1);
    assert.equal(trailerCandidateRepository.findById(firstId)?.status, "pending");
    assert.equal(trailerCandidateRepository.listAttempts(firstId)[0]?.status, "interrupted");
    assert.equal(trailerCandidateRepository.claim(firstId, "attempt-2")?.attemptCount, 2);
    assert.equal(trailerCandidateRepository.markReady(firstId, {
      relativePath: `${firstId}/candidate.mp4`, sha256: "a".repeat(64), bytes: 123, durationSeconds: 8,
      probeJson: JSON.stringify({ width: 1280, height: 1280, videoCodec: "h264", audioCodec: "aac" }),
    }), true);
    const readyVideo = await candidateService.trailerCandidateStoragePath(`${firstId}/candidate.mp4`);
    await fs.promises.mkdir(path.dirname(readyVideo), { recursive: true });
    await fs.promises.writeFile(readyVideo, "prior-ready-video");

    await fs.promises.writeFile(mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"), "trailer-two");
    assert.equal(episodeRepository.findByEpisodeId(routeEpisodeId)?.isDraft, true);
    assert.equal(await fs.promises.access(mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover")).then(() => true).catch(() => false), true);
    assert.equal(await fs.promises.access(mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer")).then(() => true).catch(() => false), true);
    const changed = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(changed.waitingForInput, false);
    if (changed.waitingForInput) throw new Error("changed source unexpectedly waited for input");
    assert.notEqual(changed.candidate.candidateId, firstId);
    assert.equal(changed.candidate.version, 2);
    assert.equal(trailerCandidateRepository.findById(firstId)?.status, "ready");
    assert.equal(await fs.promises.readFile(readyVideo, "utf8"), "prior-ready-video", "replacement enqueue must preserve prior ready bytes");
    trailerCandidateRepository.claim(changed.candidate.candidateId, "replacement-attempt");
    trailerCandidateRepository.markRetryable(changed.candidate.candidateId, "render_failed", "synthetic render failure");
    assert.equal(await fs.promises.readFile(readyVideo, "utf8"), "prior-ready-video", "failed replacement must preserve prior ready bytes");
    assert.equal(trailerCandidateRepository.findPreviousReady(routeEpisodeId, changed.candidate.candidateId)?.candidateId, firstId);

    const fixtureMedia = await createSyntheticMedia(path.join(fixture.root), "blue", 440);
    await fs.promises.copyFile(fixtureMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.copyFile(fixtureMedia.audio, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"));
    const staleResult = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(staleResult.waitingForInput, false);
    if (staleResult.waitingForInput) throw new Error("synthetic source unexpectedly waited for input");
    const staleCandidate = trailerCandidateRepository.findById(staleResult.candidate.candidateId);
    assert.ok(staleCandidate);
    await fs.promises.copyFile(fixtureMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.appendFile(mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"), Buffer.from("changed after snapshot"));
    await candidateWorker.processTrailerCandidate(staleCandidate as NonNullable<typeof staleCandidate>, { availableBytes: async () => 20 * 1024 ** 3 });
    assert.equal(trailerCandidateRepository.findById(staleResult.candidate.candidateId)?.status, "stale", "mutable source changes must invalidate review readiness");

    const stableMedia = await createSyntheticMedia(path.join(fixture.root), "green", 550);
    await fs.promises.copyFile(stableMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.copyFile(stableMedia.audio, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"));
    const renderResult = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(renderResult.waitingForInput, false);
    if (renderResult.waitingForInput) throw new Error("valid synthetic source unexpectedly waited for input");
    const renderCandidate = trailerCandidateRepository.findById(renderResult.candidate.candidateId);
    assert.ok(renderCandidate);
    assert.equal(candidateWorker.requiredTrailerCandidateFreeBytes(100, 10), 1024 ** 3 + 100 + 10 * 200 * 1024);
    assert.equal(renderer.trailerRenderTimeoutMs(10), 300_000);
    assert.equal(renderer.trailerRenderTimeoutMs(70), 330_000);
    await candidateWorker.processTrailerCandidate(renderCandidate as NonNullable<typeof renderCandidate>, { availableBytes: async () => 0 });
    assert.equal(trailerCandidateRepository.findById(renderResult.candidate.candidateId)?.status, "waiting_capacity");
    assert.equal(trailerCandidateRepository.findById(renderResult.candidate.candidateId)?.attemptCount, 0, "capacity waits must not consume render attempts");
    await candidateWorker.processTrailerCandidate(renderCandidate as NonNullable<typeof renderCandidate>, { availableBytes: async () => { throw new Error("statfs unavailable"); } });
    assert.equal(trailerCandidateRepository.findById(renderResult.candidate.candidateId)?.errorCategory, "capacity_unavailable");
    assert.equal(trailerCandidateRepository.findById(renderResult.candidate.candidateId)?.attemptCount, 0, "unknown free space must also avoid render attempts");
    await candidateWorker.processTrailerCandidate(renderCandidate as NonNullable<typeof renderCandidate>, { availableBytes: async () => 20 * 1024 ** 3 });
    const rendered = trailerCandidateRepository.findById(renderResult.candidate.candidateId);
    assert.equal(rendered?.status, "ready", "real FFmpeg output should become ready only after validation");
    assert.ok(rendered?.outputRelativePath);
    assert.equal(rendered?.outputBytes && rendered.outputBytes > 0, true);
    assert.match(rendered?.outputSha256 ?? "", /^[a-f0-9]{64}$/);
    const renderedPath = await candidateService.trailerCandidateStoragePath(rendered?.outputRelativePath as string);
    assert.equal(rendered?.outputSha256, createHash("sha256").update(await fs.promises.readFile(renderedPath)).digest("hex"));
    const decodedProbe = await renderer.probeTrailerMedia(renderedPath);
    assert.equal(decodedProbe.streams?.find((stream: any) => stream.codec_type === "video")?.width, 1280);
    assert.equal(decodedProbe.streams?.find((stream: any) => stream.codec_type === "video")?.height, 1280);
    assert.ok(decodedProbe.streams?.some((stream: any) => stream.codec_type === "audio" && stream.codec_name === "aac"));
    await assert.rejects(() => renderer.validateTrailerCandidateOutput(renderedPath, (rendered?.durationSeconds ?? 1) + 1), /duration/);
    const historicalReady = trailerCandidateRepository.findById(firstId);
    assert.equal(historicalReady?.status, "superseded");
    assert.equal(historicalReady?.outputRelativePath, null);
    assert.equal(historicalReady?.outputSha256, "a".repeat(64), "history retains the old output hash");
    assert.equal(await fs.promises.access(readyVideo).then(() => true).catch(() => false), false, "validated replacement should reclaim old ready bytes");
    assert.equal(await fs.promises.access(await candidateService.trailerCandidateStoragePath(`${firstId}/cover.jpeg`)).then(() => true).catch(() => false), false, "supersession should reclaim the complete prior candidate directory");

    const retryMedia = await createSyntheticMedia(path.join(fixture.root), "yellow", 660);
    await fs.promises.copyFile(retryMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.copyFile(retryMedia.audio, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"));
    const retryResult = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(retryResult.waitingForInput, false);
    if (retryResult.waitingForInput) throw new Error("retry fixture unexpectedly waited for input");
    const retryCandidate = trailerCandidateRepository.findById(retryResult.candidate.candidateId);
    assert.ok(retryCandidate);
    const fakeTimeoutRunner = async (command: string, args: string[]) => {
      if (command === "ffprobe") return { stdout: JSON.stringify({ format: { duration: "1.4" }, streams: [{ codec_type: "audio", codec_name: "mp3", duration: "1.4" }] }), stderr: "" };
      const partialPath = args[args.length - 1];
      await fs.promises.writeFile(partialPath, "partial interrupted output");
      throw new Error("synthetic timeout");
    };
    await candidateWorker.processTrailerCandidate(retryCandidate as NonNullable<typeof retryCandidate>, {
      availableBytes: async () => 20 * 1024 ** 3,
      processRunner: fakeTimeoutRunner,
    });
    const retryable = trailerCandidateRepository.findById(retryResult.candidate.candidateId);
    assert.equal(retryable?.status, "retryable");
    assert.equal(retryable?.attemptCount, 1);
    assert.equal(await fs.promises.access(await candidateService.trailerCandidateStoragePath(path.posix.join(retryCandidate?.snapshotRelativePath ?? "", "attempts", "1", "candidate.partial.mp4"))).then(() => true).catch(() => false), false, "failed render must clean its partial bytes");
    assert.equal(await fs.promises.access(renderedPath).then(() => true).catch(() => false), true, "failed replacement must preserve the last ready bytes");
    const retrySnapshotCover = await candidateService.trailerCandidateStoragePath(path.posix.join(retryCandidate?.snapshotRelativePath ?? "", "cover.jpeg"));
    const newerMedia = await createSyntheticMedia(path.join(fixture.root), "orange", 700);
    await fs.promises.copyFile(newerMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.copyFile(newerMedia.audio, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"));
    const newerResult = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(newerResult.waitingForInput, false);
    if (newerResult.waitingForInput) throw new Error("newer replacement unexpectedly waited for input");
    const newerCandidate = trailerCandidateRepository.findById(newerResult.candidate.candidateId);
    assert.ok(newerCandidate);
    await candidateWorker.processTrailerCandidate(newerCandidate as NonNullable<typeof newerCandidate>, { availableBytes: async () => 20 * 1024 ** 3 });
    const newerReady = trailerCandidateRepository.findById(newerResult.candidate.candidateId);
    assert.equal(newerReady?.status, "ready");
    const newerReadyPath = await candidateService.trailerCandidateStoragePath(newerReady?.outputRelativePath as string);
    assert.equal(await fs.promises.access(retrySnapshotCover).then(() => true).catch(() => false), true, "retryable candidate snapshots must survive cleanup after a newer candidate becomes ready");
    assert.equal(await fs.promises.access(newerReadyPath).then(() => true).catch(() => false), true, "current ready candidate bytes must remain available");
    await fs.promises.copyFile(retryMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.copyFile(retryMedia.audio, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"));
    trailerCandidateRepository.retry(retryResult.candidate.candidateId);
    await candidateWorker.processTrailerCandidate(retryCandidate as NonNullable<typeof retryCandidate>, { availableBytes: async () => 20 * 1024 ** 3 });
    const retried = trailerCandidateRepository.findById(retryResult.candidate.candidateId);
    assert.equal(retried?.status, "ready");
    assert.equal(retried?.attemptCount, 2, "explicit retry must append a second attempt");
    assert.deepEqual(trailerCandidateRepository.listAttempts(retryResult.candidate.candidateId).map((attempt: any) => attempt.status), ["failed", "ready"]);
    assert.equal(await fs.promises.access(renderedPath).then(() => true).catch(() => false), false, "old bytes are removed only after successful replacement validation");
    assert.equal(trailerCandidateRepository.findById(renderResult.candidate.candidateId)?.outputSha256, rendered?.outputSha256, "superseded candidate keeps its output hash");
    assert.equal(await fs.promises.access(newerReadyPath).then(() => true).catch(() => false), false, "previous ready candidate directory should be reclaimed only after replacement validation");

    const wrongSizePath = path.join(fixture.root, "wrong-size.mp4");
    await renderer.runTrailerProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", wrongSizePath], 60_000);
    await assert.rejects(() => renderer.validateTrailerCandidateOutput(wrongSizePath, 1), /dimensions/);
    const wrongCodecPath = path.join(fixture.root, "wrong-codec.mp4");
    await renderer.runTrailerProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x320:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", wrongCodecPath], 60_000);
    await assert.rejects(() => renderer.validateTrailerCandidateOutput(wrongCodecPath, 1), /H\.264 Main/);
    const corruptPath = path.join(fixture.root, "corrupt.mp4");
    await fs.promises.writeFile(corruptPath, "not a media file");
    await assert.rejects(() => renderer.validateTrailerCandidateOutput(corruptPath, 1), /ffprobe|process failed/);

    const interruptedMedia = await createSyntheticMedia(path.join(fixture.root), "red", 770);
    await fs.promises.copyFile(interruptedMedia.cover, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"));
    await fs.promises.copyFile(interruptedMedia.audio, mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "trailer"));
    const interruptedResult = await candidateService.enqueueTrailerCandidate(routeEpisodeId, "dev-bypass@local");
    assert.equal(interruptedResult.waitingForInput, false);
    if (interruptedResult.waitingForInput) throw new Error("restart fixture unexpectedly waited for input");
    const interruptedCandidate = trailerCandidateRepository.findById(interruptedResult.candidate.candidateId);
    assert.ok(interruptedCandidate);
    trailerCandidateRepository.claim(interruptedResult.candidate.candidateId, "restart-test");
    const interruptedRelativePath = path.posix.join(interruptedCandidate?.snapshotRelativePath.replace(/[\\/]+$/, "") ?? "", "attempts", "1", "candidate.partial.mp4");
    const interruptedPartial = await candidateService.trailerCandidateStoragePath(interruptedRelativePath);
    await fs.promises.mkdir(path.dirname(interruptedPartial), { recursive: true });
    await fs.promises.writeFile(interruptedPartial, "interrupted partial");
    trailerCandidateRepository.setAttemptPartialPath(interruptedResult.candidate.candidateId, 1, interruptedRelativePath);
    const recoveredJobs = await candidateWorker.recoverTrailerCandidateJobs();
    assert.equal(recoveredJobs.length, 1);
    assert.equal(trailerCandidateRepository.findById(interruptedResult.candidate.candidateId)?.status, "pending");
    assert.equal(trailerCandidateRepository.findById(interruptedResult.candidate.candidateId)?.sourceFingerprint, interruptedCandidate?.sourceFingerprint);
    assert.equal(trailerCandidateRepository.listAttempts(interruptedResult.candidate.candidateId)[0]?.status, "interrupted");
    assert.equal(await fs.promises.access(interruptedPartial).then(() => true).catch(() => false), false, "restart must remove only the known partial file");

    const saved = await invoke(router, "/", { body: episodeCreateBody(routeEpisodeId), headers: { "content-type": "application/json" }, params: {} });
    assert.equal(saved.response.statusCode, 201, saved.error instanceof Error ? saved.error.message : "draft-backed save failed");
    assert.equal(episodeRepository.findByEpisodeId(routeEpisodeId)?.isDraft, false);
    assert.equal(episodeRepository.findTrailerVideoDraft(reservation?.draftId)?.state, "consumed", "save must consume API-created owner reservation even if client did not supply draftId");

    const finalCoverPath = mediaLayout.getEpisodeMediaFinalPath(routeEpisodeId, "cover");
    const finalTrailerPath = mediaLayout.getEpisodeMediaFinalPath(routeEpisodeId, "trailer");
    await fs.promises.mkdir(path.dirname(finalCoverPath), { recursive: true });
    await fs.promises.writeFile(finalCoverPath, "old-final-cover");
    await fs.promises.writeFile(finalTrailerPath, "old-final-trailer");
    const uploadedCover = Buffer.from("new-staged-cover");
    const uploadedTrailer = Buffer.from("new-staged-trailer");
    await invoke(router, "/:episodeId/cover", new MultipartRequest(routeEpisodeId, uploadedCover, "cover.jpeg", "image/jpeg"));
    const savedUpload = await invoke(router, "/:episodeId/trailer", new MultipartRequest(routeEpisodeId, uploadedTrailer, "trailer.mp3", "audio/mpeg"));
    assert.equal(savedUpload.response.statusCode, 200);
    const savedUploadCandidateId = (savedUpload.response.jsonBody as any).trailerCandidate.candidateId as string;
    const savedUploadCandidate = trailerCandidateRepository.findById(savedUploadCandidateId);
    assert.ok(savedUploadCandidate);
    assert.equal(savedUploadCandidate?.coverSha256, createHash("sha256").update(uploadedCover).digest("hex"));
    assert.equal(savedUploadCandidate?.audioSha256, createHash("sha256").update(uploadedTrailer).digest("hex"));
    assert.equal(await fs.promises.readFile(await candidateService.trailerCandidateStoragePath(`${savedUploadCandidateId}/cover.jpeg`), "utf8"), "new-staged-cover");
    assert.equal(await fs.promises.readFile(await candidateService.trailerCandidateStoragePath(`${savedUploadCandidateId}/trailer.mp3`), "utf8"), "new-staged-trailer");

    const priorCandidateRootForFailure = config.media.trailerCandidatesRoot;
    config.media.trailerCandidatesRoot = path.join(fixture.media, "public-invalid-candidate-root");
    const failedUploadBytes = Buffer.from("stored-even-when-enqueue-fails");
    const failedUpload = await invoke(router, "/:episodeId/cover", new MultipartRequest(routeEpisodeId, failedUploadBytes, "cover.jpeg", "image/jpeg"));
    config.media.trailerCandidatesRoot = priorCandidateRootForFailure;
    assert.equal(failedUpload.response.statusCode, 503, "candidate enqueue failure must not look like successful upload processing");
    const failedUploadBody = failedUpload.response.jsonBody as any;
    assert.deepEqual(failedUploadBody.trailerCandidateEnqueue, {
      status: "failed", code: "trailer_candidate_enqueue_failed", retryable: true, mediaStored: true,
    });
    assert.equal(failedUploadBody.message, "Media was stored, but trailer generation could not be queued. The staged files are retained; after correcting the issue, re-upload the cover or trailer to retry.");
    assert.equal(failedUploadBody.coverFileName, "episodes/987654301/cover.jpeg");
    assert.equal(JSON.stringify(failedUploadBody).includes(fixture.root), false, "failure response must redact filesystem paths");
    assert.equal(await fs.promises.readFile(mediaLayout.getEpisodeMediaStagingPath(routeEpisodeId, "cover"), "utf8"), failedUploadBytes.toString(), "failed enqueue must preserve uploaded staging bytes for retry");

    const deletingCandidateDirectory = await candidateService.trailerCandidateStoragePath(interruptedCandidate?.snapshotRelativePath.replace(/[\\/]+$/, "") ?? "");
    assert.equal(await fs.promises.access(deletingCandidateDirectory).then(() => true).catch(() => false), true);
    const releaseActiveFiles = candidateCleanup.acquireTrailerCandidateFileUse(interruptedCandidate?.candidateId as string);
    episodeRepository.delete(routeEpisodeId);
    assert.equal(episodeRepository.findByEpisodeId(routeEpisodeId), null, "episode deletion should remove its record");
    assert.ok(trailerCandidateRepository.listFileCleanup(500).some((item: any) => item.candidateId === interruptedCandidate?.candidateId), "episode deletion must durably queue its candidate directory before cascading metadata");
    const queuedCleanupBeforeFailure = trailerCandidateRepository.listFileCleanup(500);
    assert.ok(queuedCleanupBeforeFailure.length > 0 && queuedCleanupBeforeFailure.every((item: any) => manifest.candidates.some((candidate) => candidate.candidateId === item.candidateId)), "all cleanup intents must be manifest-bound fixture candidates");
    const configuredCandidateRoot = config.media.trailerCandidatesRoot;
    config.media.trailerCandidatesRoot = path.join(fixture.media, "invalid-public-candidate-root");
    const failedCleanup = await candidateCleanup.cleanupTrailerCandidateFiles();
    config.media.trailerCandidatesRoot = configuredCandidateRoot;
    assert.equal(failedCleanup.removed, 0, "invalid private-root proof must fail cleanup closed");
    assert.equal(trailerCandidateRepository.listFileCleanup(500).length, queuedCleanupBeforeFailure.length, "failed candidate cleanup must remain durably queued for retry");
    const failedCleanupIdentity = queuedCleanupBeforeFailure.find((item: any) => item.candidateId !== interruptedCandidate?.candidateId)?.candidateId;
    assert.ok(failedCleanupIdentity, "at least one non-leased manifest candidate should exercise failed cleanup retry");
    assert.equal(getDb().prepare("SELECT attempts FROM trailer_candidate_file_cleanup WHERE candidate_id = ?").get(failedCleanupIdentity)?.attempts, 1, "failed cleanup records one retryable attempt");
    const deferredCleanup = await candidateCleanup.cleanupTrailerCandidateFiles();
    assert.equal(deferredCleanup.deferred, 1, "cleanup must defer a directory still leased by an active renderer");
    assert.equal(await fs.promises.access(deletingCandidateDirectory).then(() => true).catch(() => false), true, "active candidate files must remain untouched");
    releaseActiveFiles();
    await candidateCleanup.cleanupTrailerCandidateFiles();
    assert.equal(await fs.promises.access(deletingCandidateDirectory).then(() => true).catch(() => false), false, "episode deletion cleanup should remove private candidate files");
    assert.equal(trailerCandidateRepository.listFileCleanup(500).length, 0, "successful cleanup should consume durable intents");

    const restartSnapshotHash = firstCandidate?.sourceFingerprint;
    assert.match(restartSnapshotHash ?? "", /^[a-f0-9]{64}$/);
    const foreignFixtureEpisode = episodeRepository.findByEpisodeId(987654300);
    assert.equal(foreignFixtureEpisode?.title, "[Draft episode 987654300]", "foreign-owner fixture must still have its exact synthetic draft identity before deletion");
    episodeRepository.delete(987654300);
    assert.equal(episodeRepository.findByEpisodeId(987654300), null, "foreign-owner fixture episode must be removed from the temporary database");
    assert.equal(globalThis.fetch, blockedFetch, "all provider requests must remain bound to the throwing network stub");
    assert.equal(blockedFetchCallSites.length, fetchCalls, "every blocked network attempt must be captured by the verifier");
    const databaseRows = captureFixtureRows(getDb);
    assert.equal(databaseRows.episodes.length, 0, "fixture episode must be deleted before fixture cleanup");
    assert.deepEqual(databaseRows.episode_trailer_video_drafts.map((row) => row.draft_id).sort(), [...manifest.drafts].sort(), "all remaining draft identities must belong to the manifest");
    assert.ok(databaseRows.trailer_candidate_versions.every((row) => Number(row.episode_id) === routeEpisodeId && manifest.candidates.some((candidate) => candidate.candidateId === row.candidate_id)), "all candidate rows must be manifest-bound synthetic fixture rows");
    assert.ok(databaseRows.trailer_candidate_attempts.every((row) => manifest.candidates.some((candidate) => candidate.candidateId === row.candidate_id)), "all attempt rows must belong to a manifest candidate");
    assert.equal(databaseRows.trailer_candidate_file_cleanup.length, 0, "all fixture cleanup intents must be drained before cleanup");
    assert.deepEqual(captureFixtureRows(getDb), databaseRows, "temporary SQLite row identities must remain stable through the end of verification");
    console.log(`trailer candidate lifecycle passed: draft and saved staged-source enqueue, retryable cleanup, restart recovery, exact fixture cleanup, and ${fetchCalls} blocked network attempts`);
  } finally {
    globalThis.fetch = originalFetch;
    if (fixtureDbReader) await sealManifestAndCleanup(fixture, manifest, fixtureDbReader);
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
