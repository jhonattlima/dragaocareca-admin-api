import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

type Fixture = { root: string; media: string; generated: string; database: string };

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-trailer-candidate-"));
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
  process.env.PROMOTION_ENABLED = "false";
  process.env.PROMOTION_LEGACY_LAUNCH_ENABLED = "false";
  return { root, media, generated, database: process.env.SQLITE_PATH };
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
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network access is prohibited by candidate verifier"); }) as typeof fetch;
  try {
    const [{ connectDb }, { getDb }, { episodeRepository }, { trailerCandidateRepository }, mediaLayout, candidateService, draftService, { config }] = await Promise.all([
      import("../database/connect.js"),
      import("../database/sqlite.js"),
      import("../database/repositories/episode.repository.js"),
      import("../database/repositories/trailer-candidate.repository.js"),
      import("../services/episode-media-layout.service.js"),
      import("../services/trailer-candidate.service.js"),
      import("../services/episode-draft-reservation.service.js"),
      import("../config/env.js"),
    ]);
    await connectDb();
    const router = loadRouter();
    config.auth.bypassInDev = true;

    const foreignDraftId = await draftService.reserveTrailerVideoDraft(987654300, "another-owner@example.com");
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
    assert.equal(coverOnly.response.statusCode, 200);
    assert.equal((coverOnly.response.jsonBody as any).trailerCandidate, undefined, "single input must wait without a candidate job");
    const secondInput = await invoke(router, "/:episodeId/trailer", new MultipartRequest(routeEpisodeId, Buffer.from("trailer-one"), "trailer.mp3", "audio/mpeg"));
    assert.equal(secondInput.response.statusCode, 200);
    const routeBody = secondInput.response.jsonBody as Record<string, any>;
    assert.equal(routeBody.trailerCandidate.status, "pending", "second upload must enqueue a durable candidate");
    assert.deepEqual(Object.keys(routeBody.trailerCandidate).sort(), ["candidateId", "createdAt", "episodeId", "errorCategory", "progress", "status", "updatedAt", "version"].sort());
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

    const saved = await invoke(router, "/", { body: episodeCreateBody(routeEpisodeId), headers: { "content-type": "application/json" }, params: {} });
    assert.equal(saved.response.statusCode, 201, saved.error instanceof Error ? saved.error.message : "draft-backed save failed");
    assert.equal(episodeRepository.findByEpisodeId(routeEpisodeId)?.isDraft, false);
    assert.equal(episodeRepository.findTrailerVideoDraft(reservation?.draftId)?.state, "consumed", "save must consume API-created owner reservation even if client did not supply draftId");

    const restartSnapshotHash = firstCandidate?.sourceFingerprint;
    assert.match(restartSnapshotHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(fetchCalls, 0, "candidate enqueue must not call external providers or services");
    console.log("trailer candidate lifecycle passed: automatic second-input enqueue, private snapshot, idempotency, versioning, draft pinning, restart, retention, and no network side effects");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
