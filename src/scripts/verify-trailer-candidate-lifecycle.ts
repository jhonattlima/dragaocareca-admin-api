import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

type Fixture = { root: string; media: string; generated: string; database: string };

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
    const [{ connectDb }, { getDb }, { episodeRepository }, { trailerCandidateRepository }, mediaLayout, candidateService, draftService, { config }, renderer, candidateWorker] = await Promise.all([
      import("../database/connect.js"),
      import("../database/sqlite.js"),
      import("../database/repositories/episode.repository.js"),
      import("../database/repositories/trailer-candidate.repository.js"),
      import("../services/episode-media-layout.service.js"),
      import("../services/trailer-candidate.service.js"),
      import("../services/episode-draft-reservation.service.js"),
      import("../config/env.js"),
      import("../services/trailer-candidate-renderer.service.js"),
      import("../workers/trailer-candidate.worker.js"),
    ]);
    await connectDb();
    assert.equal(config.trailerCandidateRenderEnabled, false, "candidate rendering must be disabled by default");
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
    assert.equal(await fs.promises.access(await candidateService.trailerCandidateStoragePath(`${retryCandidate?.snapshotRelativePath}attempts/1/candidate.partial.mp4`)).then(() => true).catch(() => false), false, "failed render must clean its partial bytes");
    assert.equal(await fs.promises.access(renderedPath).then(() => true).catch(() => false), true, "failed replacement must preserve the last ready bytes");
    trailerCandidateRepository.retry(retryResult.candidate.candidateId);
    await candidateWorker.processTrailerCandidate(retryCandidate as NonNullable<typeof retryCandidate>, { availableBytes: async () => 20 * 1024 ** 3 });
    const retried = trailerCandidateRepository.findById(retryResult.candidate.candidateId);
    assert.equal(retried?.status, "ready");
    assert.equal(retried?.attemptCount, 2, "explicit retry must append a second attempt");
    assert.deepEqual(trailerCandidateRepository.listAttempts(retryResult.candidate.candidateId).map((attempt: any) => attempt.status), ["failed", "ready"]);
    assert.equal(await fs.promises.access(renderedPath).then(() => true).catch(() => false), false, "old bytes are removed only after successful replacement validation");
    assert.equal(trailerCandidateRepository.findById(renderResult.candidate.candidateId)?.outputSha256, rendered?.outputSha256, "superseded candidate keeps its output hash");

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
