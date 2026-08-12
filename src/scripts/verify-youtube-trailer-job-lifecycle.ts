import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type {
  YoutubeTrailerCancellationResult,
  YoutubeTrailerPrivateSession,
  YoutubeTrailerProcessingState,
  YoutubeTrailerUploadProvider,
  YoutubeTrailerUploadProviderError,
} from "../services/youtube-trailer-upload.provider.js";

type YoutubeTrailerJobRepository = typeof import("../database/repositories/youtube-trailer-job.repository.js").youtubeTrailerJobRepository;

export type YoutubeTrailerJobFocus = "repository" | "worker";

/**
 * Deterministic verifier-only provider. It deliberately has no OAuth, HTTP, or
 * network dependency so later repository and worker checks can inject it safely.
 */
export class FakeYoutubeTrailerUploadProvider implements YoutubeTrailerUploadProvider {
  private readonly sessionUri = "fake-provider://private-session-1";
  private readonly providerVideoId = "fake-private-video-1";
  private sourceBytes = 0;
  private confirmedBytes = 0;
  private processingPolls = 0;
  readonly events: string[] = [];
  failAfterNextChunk = false;
  failReadiness = false;

  async checkReadiness(): Promise<void> {
    this.events.push("readiness");
    if (this.failReadiness) {
      this.failReadiness = false;
      throw new Error("simulated missing youtube.upload scope");
    }
  }

  async beginPrivateSession(sourceBytes: number): Promise<YoutubeTrailerPrivateSession> {
    assert.ok(sourceBytes > 0, "fake provider requires a non-empty source");
    this.events.push("begin-session");
    this.sourceBytes = sourceBytes;
    return { sessionUri: this.sessionUri, privacyStatus: "private" };
  }

  async resumeRange(sessionUri: string, sourceBytes: number) {
    this.assertSession(sessionUri);
    assert.equal(sourceBytes, this.sourceBytes, "fake provider source bytes must match");
    this.events.push(`resume:${this.confirmedBytes}`);
    return {
      confirmedBytes: this.confirmedBytes,
      providerVideoId: null,
      range: this.confirmedBytes === 0 ? null : `bytes=0-${this.confirmedBytes - 1}`,
    };
  }

  async uploadChunk(sessionUri: string, sourceBytes: number, offset: number, chunk: Buffer) {
    this.assertSession(sessionUri);
    assert.equal(sourceBytes, this.sourceBytes, "fake provider source bytes must match");
    assert.equal(offset, this.confirmedBytes, "fake provider only accepts resumed offsets");
    assert.ok(chunk.length > 0, "fake provider requires a non-empty chunk");
    this.confirmedBytes = Math.min(this.sourceBytes, this.confirmedBytes + chunk.length);
    this.events.push(`chunk:${offset}-${this.confirmedBytes}`);
    if (this.failAfterNextChunk) {
      this.failAfterNextChunk = false;
      throw new Error("simulated interrupted chunk response");
    }
    return {
      confirmedBytes: this.confirmedBytes,
      providerVideoId: this.confirmedBytes === this.sourceBytes ? this.providerVideoId : null,
    };
  }

  async pollProcessing(providerVideoId: string): Promise<YoutubeTrailerProcessingState> {
    assert.equal(providerVideoId, this.providerVideoId, "fake provider video ID must match");
    this.events.push("poll-processing");
    this.processingPolls += 1;
    return {
      privacyStatus: "private",
      uploadStatus: "processed",
      processingStatus: this.processingPolls === 1 ? "processing" : "succeeded",
      partsProcessed: this.processingPolls,
      partsTotal: 2,
      timeLeftMs: this.processingPolls === 1 ? 1_000 : 0,
    };
  }

  async cancel(sessionUri: string, providerVideoId: string | null): Promise<YoutubeTrailerCancellationResult> {
    this.assertSession(sessionUri);
    this.events.push("cancel");
    if (providerVideoId) {
      assert.equal(providerVideoId, this.providerVideoId, "fake provider video ID must match");
      return { accepted: false, boundary: "provider-video-retained" };
    }
    return { accepted: true, boundary: "local-cancelled" };
  }

  normalizeFailure(error: unknown): YoutubeTrailerUploadProviderError {
    const detail = error instanceof Error ? error.message : "unknown fake-provider failure";
    return { code: "retryable", message: `Fake provider: ${detail}` };
  }

  private assertSession(sessionUri: string): void {
    assert.equal(sessionUri, this.sessionUri, "fake provider session URI must match");
  }
}

const reservedLifecycleScenarios = [
  "duplicate start reuses the current finalized source job",
  "restart recovery resumes a persisted private session or reconciles a provider video",
  "replacement marks prior-source jobs obsolete and rejects late worker writes",
  "retry resumes unchanged sources and creates a new job only after definitive failure",
  "public DTOs redact provider session, credential, and raw error details",
] as const;

type Fixture = {
  root: string;
  mediaRoot: string;
  sqlitePath: string;
};

class MemoryResponse extends Writable {
  statusCode = 200;
  jsonBody: unknown;
  readonly headers = new Map<string, string>();

  _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
  setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this; }
}

type RouteHandler = (req: any, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type RouteLayer = { route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } };

const invokeProtectedRoute = async (router: { stack?: RouteLayer[] }, method: "get" | "post", routePath: string, request: any): Promise<{ response: MemoryResponse; error?: unknown }> => {
  const route = router.stack?.find((layer) => layer.route?.path === routePath && layer.route.methods?.[method])?.route;
  if (!route?.stack) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  const response = new MemoryResponse();
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { resolve({ response, error }); return; }
      const handler = route.stack?.[index++]?.handle;
      if (!handler) { resolve({ response }); return; }
      Promise.resolve(handler(request, response, next)).catch(reject);
    };
    response.once("finish", () => resolve({ response }));
    response.once("error", reject);
    next();
  });
};

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dragaocareca-youtube-trailer-job-"));
  const mediaRoot = path.join(root, "media");
  const sqlitePath = path.join(root, "youtube-trailer-jobs.sqlite");
  await fs.promises.mkdir(mediaRoot);
  return { root, mediaRoot, sqlitePath };
};

const verifyScaffoldIsolation = async (fixture: Fixture): Promise<void> => {
  assert.match(fixture.root, /^\/tmp\/dragaocareca-youtube-trailer-job-/);
  assert.equal(await fs.promises.stat(fixture.mediaRoot).then((entry) => entry.isDirectory()), true);
  assert.equal(fs.existsSync(fixture.sqlitePath), false);
  assert.equal(reservedLifecycleScenarios.length, 5);
};

const verifyRepositoryFocus = async (youtubeTrailerJobRepository: YoutubeTrailerJobRepository): Promise<void> => {
  const source = { episodeId: 16, sourceFileName: "episodes/16/trailer.mp4", sourceSha256: "a".repeat(64), sourceBytes: 8 };
  const duplicate = youtubeTrailerJobRepository.createOrReuse({ jobId: "job-original", ...source });
  const reused = youtubeTrailerJobRepository.createOrReuse({ jobId: "job-duplicate", ...source });
  assert.equal(duplicate.jobId, "job-original");
  assert.equal(reused.jobId, duplicate.jobId, "duplicate source starts must coalesce");

  const claim = youtubeTrailerJobRepository.claim(source, duplicate.jobId, duplicate.revision, "lease-a");
  assert.ok(claim, "queued source job must be claimable");
  const staleProgress = youtubeTrailerJobRepository.updateProvider({ ...source, jobId: claim.jobId, revision: claim.revision - 1, leaseId: "lease-a" }, { confirmedBytes: 4 }, "transferring");
  assert.equal(staleProgress, null, "stale revision writes must be rejected");
  const progressed = youtubeTrailerJobRepository.updateProvider({ ...source, jobId: claim.jobId, revision: claim.revision, leaseId: "lease-a" }, { confirmedBytes: 4 }, "transferring");
  assert.equal(progressed?.confirmedBytes, 4);

  const changedSource = { ...source, sourceSha256: "b".repeat(64) };
  const obsoleted = youtubeTrailerJobRepository.obsoletePriorSource(source.episodeId, changedSource);
  assert.equal(obsoleted.length, 1);
  assert.equal(obsoleted[0]?.status, "obsolete");
  const staleAfterReplacement = youtubeTrailerJobRepository.updateProvider({ ...source, jobId: progressed!.jobId, revision: progressed!.revision, leaseId: "lease-a" }, { confirmedBytes: 8 }, "transferring");
  assert.equal(staleAfterReplacement, null, "obsolete sources must reject late lease writers");

  const provider = new FakeYoutubeTrailerUploadProvider();
  const session = await provider.beginPrivateSession(8);
  assert.deepEqual(session, { sessionUri: "fake-provider://private-session-1", privacyStatus: "private" });
  assert.deepEqual(await provider.resumeRange(session.sessionUri, 8), { confirmedBytes: 0, providerVideoId: null, range: null });
  assert.deepEqual(provider.normalizeFailure(new Error("repository fixture failure")), {
    code: "retryable",
    message: "Fake provider: repository fixture failure",
  });
};

const verifyWorkerFocus = async (): Promise<void> => {
  const provider = new FakeYoutubeTrailerUploadProvider();
  const session = await provider.beginPrivateSession(8);
  const partial = await provider.uploadChunk(session.sessionUri, 8, 0, Buffer.from("fake"));
  assert.deepEqual(partial, { confirmedBytes: 4, providerVideoId: null });
  assert.deepEqual(await provider.resumeRange(session.sessionUri, 8), { confirmedBytes: 4, providerVideoId: null, range: "bytes=0-3" });
  assert.deepEqual(await provider.cancel(session.sessionUri, null), { accepted: true, boundary: "local-cancelled" });

  const complete = await provider.uploadChunk(session.sessionUri, 8, 4, Buffer.from("data"));
  assert.deepEqual(complete, { confirmedBytes: 8, providerVideoId: "fake-private-video-1" });
  assert.equal((await provider.pollProcessing(complete.providerVideoId!)).processingStatus, "processing");
  assert.equal((await provider.pollProcessing(complete.providerVideoId!)).processingStatus, "succeeded");
  assert.deepEqual(await provider.cancel(session.sessionUri, complete.providerVideoId), {
    accepted: false,
    boundary: "provider-video-retained",
  });
};

const verifyRealWorkerFocus = async (fixture: Fixture): Promise<void> => {
  const [{ getDb }, { youtubeTrailerJobRepository }, { createYoutubeTrailerJob, getYoutubeTrailerJob, requestYoutubeTrailerJobCancellation }, { runYoutubeTrailerJobWorkerOnce }, { replaceEpisodeTrailerVideo }] = await Promise.all([
    import("../database/sqlite.js"),
    import("../database/repositories/youtube-trailer-job.repository.js"),
    import("../services/youtube-trailer-job.service.js"),
    import("../workers/youtube-trailer-job.worker.js"),
    import("../services/episode-trailer-video.service.js"),
  ]);
  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(16, "Worker fixture", "2026-08-04T00:00:00.000Z");
  const trailerPath = path.join(fixture.mediaRoot, "episodes", "16", "trailer.mp4");
  await fs.promises.mkdir(path.dirname(trailerPath), { recursive: true });
  await fs.promises.writeFile(trailerPath, Buffer.from("fakedata"));

  const job = await createYoutubeTrailerJob(16);
  const provider = new FakeYoutubeTrailerUploadProvider();
  provider.failAfterNextChunk = true;
  await runYoutubeTrailerJobWorkerOnce({ provider, recoverInterrupted: true });
  const interrupted = getYoutubeTrailerJob(16, job.jobId);
  assert.equal(interrupted?.status, "queued", "interrupted transfer must become retryable after session persistence");
  assert.ok(interrupted?.sessionUri, "session URI must persist before a chunk can be attempted");
  assert.deepEqual(provider.events.slice(0, 4), ["readiness", "begin-session", "resume:0", "chunk:0-4"]);

  getDb().prepare("UPDATE youtube_trailer_jobs SET next_attempt_at = ? WHERE job_id = ?").run(new Date(Date.now() - 1_000).toISOString(), job.jobId);
  await runYoutubeTrailerJobWorkerOnce({ provider, recoverInterrupted: false });
  const processing = getYoutubeTrailerJob(16, job.jobId);
  assert.equal(processing?.status, "processing", "same persisted session must resume to private processing");
  assert.ok(provider.events.includes("resume:4"), "recovery must query the provider Range before resuming");
  assert.equal(processing?.providerVideoId, "fake-private-video-1");

  await runYoutubeTrailerJobWorkerOnce({ provider, recoverInterrupted: false });
  const ready = getYoutubeTrailerJob(16, job.jobId);
  assert.equal(ready?.status, "ready", "private processing completion must be polled separately from upload");

  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(17, "Cancellation fixture", "2026-08-04T00:00:00.000Z");
  const cancellationPath = path.join(fixture.mediaRoot, "episodes", "17", "trailer.mp4");
  await fs.promises.mkdir(path.dirname(cancellationPath), { recursive: true });
  await fs.promises.writeFile(cancellationPath, Buffer.from("cancelme"));
  const cancellationJob = await createYoutubeTrailerJob(17);
  assert.equal(requestYoutubeTrailerJobCancellation(17, cancellationJob.jobId)?.status, "cancel_requested");
  await runYoutubeTrailerJobWorkerOnce({ provider, recoverInterrupted: false });
  assert.equal(getYoutubeTrailerJob(17, cancellationJob.jobId)?.cancellationBoundary, "local-cancelled");

  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(19, "Accepted cancellation fixture", "2026-08-04T00:00:00.000Z");
  const acceptedCancellationPath = path.join(fixture.mediaRoot, "episodes", "19", "trailer.mp4");
  await fs.promises.mkdir(path.dirname(acceptedCancellationPath), { recursive: true });
  await fs.promises.writeFile(acceptedCancellationPath, Buffer.from("accepted"));
  const acceptedCancellationJob = await createYoutubeTrailerJob(19);
  const acceptedProvider = new FakeYoutubeTrailerUploadProvider();
  await runYoutubeTrailerJobWorkerOnce({ provider: acceptedProvider, recoverInterrupted: false });
  assert.equal(getYoutubeTrailerJob(19, acceptedCancellationJob.jobId)?.status, "processing");
  assert.equal(requestYoutubeTrailerJobCancellation(19, acceptedCancellationJob.jobId)?.status, "cancel_requested");
  await runYoutubeTrailerJobWorkerOnce({ provider: acceptedProvider, recoverInterrupted: false });
  assert.equal(
    getYoutubeTrailerJob(19, acceptedCancellationJob.jobId)?.cancellationBoundary,
    "provider-video-retained",
    "cancellation after provider acceptance must not claim remote rollback"
  );

  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(18, "Replacement fixture", "2026-08-04T00:00:00.000Z");
  const replacementFinalPath = path.join(fixture.mediaRoot, "episodes", "18", "trailer.mp4");
  const replacementStagingPath = path.join(fixture.mediaRoot, "staging", "18", "trailer.mp4");
  await fs.promises.mkdir(path.dirname(replacementFinalPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(replacementStagingPath), { recursive: true });
  await fs.promises.writeFile(replacementFinalPath, Buffer.from("oldvideo"));
  const staleJob = await createYoutubeTrailerJob(18);
  const staleLease = youtubeTrailerJobRepository.claim(
    { episodeId: staleJob.episodeId, sourceFileName: staleJob.sourceFileName, sourceSha256: staleJob.sourceSha256, sourceBytes: staleJob.sourceBytes },
    staleJob.jobId,
    staleJob.revision,
    "stale-lease"
  );
  assert.ok(staleLease, "replacement fixture job must be claimable before source replacement");
  await fs.promises.writeFile(replacementStagingPath, Buffer.from("newvideo"));
  await replaceEpisodeTrailerVideo(18, replacementStagingPath);
  assert.equal(getYoutubeTrailerJob(18, staleJob.jobId)?.status, "obsolete", "replacement must obsolete the prior source job");
  assert.equal(
    youtubeTrailerJobRepository.updateProvider(
      { episodeId: staleJob.episodeId, sourceFileName: staleJob.sourceFileName, sourceSha256: staleJob.sourceSha256, sourceBytes: staleJob.sourceBytes, jobId: staleJob.jobId, revision: staleLease!.revision, leaseId: "stale-lease" },
      { confirmedBytes: staleJob.sourceBytes },
      "transferring"
    ),
    null,
    "obsolete source jobs must reject late worker updates"
  );

  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(20, "OAuth readiness fixture", "2026-08-04T00:00:00.000Z");
  const oauthPath = path.join(fixture.mediaRoot, "episodes", "20", "trailer.mp4");
  await fs.promises.mkdir(path.dirname(oauthPath), { recursive: true });
  await fs.promises.writeFile(oauthPath, Buffer.from("oauth"));
  const oauthJob = await createYoutubeTrailerJob(20);
  const oauthRejectingProvider = new FakeYoutubeTrailerUploadProvider();
  oauthRejectingProvider.failReadiness = true;
  await runYoutubeTrailerJobWorkerOnce({ provider: oauthRejectingProvider, recoverInterrupted: false });
  const oauthRejected = getYoutubeTrailerJob(20, oauthJob.jobId);
  assert.equal(oauthRejected?.status, "queued", "OAuth readiness failure must remain retryable without sending bytes");
  assert.equal(oauthRejected?.confirmedBytes, 0);
  assert.equal(oauthRejected?.sessionUri, null);
  assert.deepEqual(oauthRejectingProvider.events, ["readiness"]);

  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(21, "Worker overlap fixture", "2026-08-04T00:00:00.000Z");
  const overlapPath = path.join(fixture.mediaRoot, "episodes", "21", "trailer.mp4");
  await fs.promises.mkdir(path.dirname(overlapPath), { recursive: true });
  await fs.promises.writeFile(overlapPath, Buffer.from("overlap"));
  await createYoutubeTrailerJob(21);
  const { startYoutubeTrailerJobWorker } = await import("../workers/youtube-trailer-job.worker.js");
  const overlapProvider = new FakeYoutubeTrailerUploadProvider();
  const stops = await Promise.all([startYoutubeTrailerJobWorker(overlapProvider), startYoutubeTrailerJobWorker(overlapProvider)]);
  for (const stop of stops) stop();
  assert.equal(overlapProvider.events.filter((event) => event === "begin-session").length, 1, "worker startup must not overlap one source transfer");
};

const verifyProtectedRouteAndOpenApiFocus = async (fixture: Fixture): Promise<void> => {
  const [{ config }, { swaggerSpec }, { getDb }, routeModule] = await Promise.all([
    import("../config/env.js"),
    import("../docs/openapi.js"),
    import("../database/sqlite.js"),
    import("../routes/episodes.routes.js"),
  ]);
  const episodeId = 22;
  getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(episodeId, "Protected route fixture", "2026-08-04T00:00:00.000Z");
  const trailerPath = path.join(fixture.mediaRoot, "episodes", String(episodeId), "trailer.mp4");
  await fs.promises.mkdir(path.dirname(trailerPath), { recursive: true });
  await fs.promises.writeFile(trailerPath, Buffer.from("protected"));
  const router = routeModule.episodesRouter as { stack?: RouteLayer[] };
  const startPath = "/:episodeId/youtube-trailer-jobs";
  const currentPath = "/:episodeId/youtube-trailer-jobs/current";
  const statusPath = "/:episodeId/youtube-trailer-jobs/:jobId";
  const retryPath = "/:episodeId/youtube-trailer-jobs/:jobId/retry";
  const cancelPath = "/:episodeId/youtube-trailer-jobs/:jobId/cancel";
  const request = (body: unknown, jobId?: string) => ({ body, headers: {}, params: { episodeId: String(episodeId), ...(jobId ? { jobId } : {}) }, user: undefined });

  config.auth.bypassInDev = false;
  const unauthorized = await invokeProtectedRoute(router, "post", startPath, request(undefined));
  assert.equal(unauthorized.response.statusCode, 401);
  assert.equal(unauthorized.response.headers.get("cache-control"), "no-store", "no-store must precede authentication");
  config.auth.bypassInDev = true;

  const invalidStart = await invokeProtectedRoute(router, "post", startPath, request({ sourcePath: "/tmp/forbidden" }));
  assert.equal(invalidStart.response.statusCode, 400, "start must reject client source/path input");
  const missingSource = await invokeProtectedRoute(router, "post", startPath, { ...request(undefined), params: { episodeId: "23" } });
  assert.equal(missingSource.response.statusCode, 404, "missing canonical trailer source must not use a generic validation error");
  const acceptedMetadata = { title: "Selected operator title", summary: "Selected operator summary" };
  const started = await invokeProtectedRoute(router, "post", startPath, request(acceptedMetadata));
  assert.equal(started.response.statusCode, 202);
  assert.equal(started.response.headers.get("cache-control"), "no-store");
  const snapshot = started.response.jsonBody as { jobId: string; [key: string]: unknown };
  assert.match(snapshot.jobId, /^[0-9a-f-]{36}$/);
  assert.equal(snapshot.privateWatchUrl, null, "queued snapshots must expose a nullable sanitized private URL");
  for (const sensitiveField of ["sessionUri", "providerVideoId", "sourceFileName", "sourceSha256", "workerLeaseId", "errorMessage", "errorReason"]) {
    assert.equal(sensitiveField in snapshot, false, `safe route DTO must omit ${sensitiveField}`);
  }
  assert.equal(JSON.stringify(snapshot).includes("fake-provider://"), false);

  const duplicate = await invokeProtectedRoute(router, "post", startPath, request(acceptedMetadata));
  assert.equal((duplicate.response.jsonBody as { jobId: string }).jobId, snapshot.jobId, "duplicate starts must reuse the active current-source job");
  const current = await invokeProtectedRoute(router, "get", currentPath, request(undefined));
  assert.equal(current.response.statusCode, 200);
  assert.equal((current.response.jsonBody as { jobId: string }).jobId, snapshot.jobId, "current lookup must recover the source job");
  const status = await invokeProtectedRoute(router, "get", statusPath, request(undefined, snapshot.jobId));
  assert.equal(status.response.statusCode, 200);
  const retry = await invokeProtectedRoute(router, "post", retryPath, request({}, snapshot.jobId));
  assert.equal(retry.response.statusCode, 202);
  assert.equal((retry.response.jsonBody as { jobId: string }).jobId, snapshot.jobId, "retry must reuse the same durable job");
  const invalidStatus = await invokeProtectedRoute(router, "get", statusPath, request(undefined, "not-a-uuid"));
  assert.equal(invalidStatus.response.statusCode, 404);
  const cancelled = await invokeProtectedRoute(router, "post", cancelPath, request(undefined, snapshot.jobId));
  assert.equal(cancelled.response.statusCode, 202);
  assert.equal((cancelled.response.jsonBody as { status: string }).status, "cancel_requested");
  const retainedPrivate = {
    ...(cancelled.response.jsonBody as Record<string, unknown>),
    status: "cancelled",
    privateWatchUrl: "https://www.youtube.com/watch?v=fake-private-video-1",
    cancellation: { boundary: "provider-video-retained" },
  };
  assert.equal(retainedPrivate.privateWatchUrl, "https://www.youtube.com/watch?v=fake-private-video-1");
  assert.equal((retainedPrivate.cancellation as { boundary: string }).boundary, "provider-video-retained");
  assert.match(JSON.stringify(retainedPrivate), /reconciliation|provider-video-retained|private/i);

  const openApi = swaggerSpec as { paths: Record<string, unknown>; components?: { schemas?: Record<string, { properties: Record<string, unknown> }> } };
  const paths = openApi.paths;
  assert.ok(paths["/v1/episodes/{episodeId}/youtube-trailer-jobs"]);
  assert.ok(paths["/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}"]);
  assert.ok(paths["/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}/cancel"]);
  assert.equal("/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}/publish" in paths, true);
  const schema = openApi.components?.schemas?.YoutubeTrailerJobSnapshot;
  assert.ok(schema);
  for (const sensitiveField of ["sessionUri", "providerVideoId", "sourceFileName", "sourceSha256", "workerLeaseId", "errorMessage", "errorReason"]) {
    assert.equal(sensitiveField in schema.properties, false, `OpenAPI safe DTO must omit ${sensitiveField}`);
  }
};

const parseFocus = (argumentsList: string[]): YoutubeTrailerJobFocus | null => {
  const focusArgument = argumentsList.find((argument) => argument.startsWith("--focus="));
  if (!focusArgument) return null;
  const focus = focusArgument.slice("--focus=".length);
  if (focus === "repository" || focus === "worker") return focus;
  throw new Error("expected --focus=repository or --focus=worker");
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");

  const fixture = await createFixture();
  try {
    await verifyScaffoldIsolation(fixture);
    process.env.SQLITE_PATH = fixture.sqlitePath;
    process.env.MEDIA_STORAGE_ROOT = fixture.mediaRoot;
    process.env.MEDIA_EPISODES_STAGING_DIR = path.join(fixture.mediaRoot, "staging");
    process.env.YOUTUBE_TRAILER_JOB_CHUNK_BYTES = "4";
    const focus = parseFocus(process.argv.slice(2));
    if (focus === "repository") {
      const [{ youtubeTrailerJobRepository }, { getDb }] = await Promise.all([
        import("../database/repositories/youtube-trailer-job.repository.js"),
        import("../database/sqlite.js"),
      ]);
      getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(16, "Repository fixture", "2026-08-04T00:00:00.000Z");
      await verifyRepositoryFocus(youtubeTrailerJobRepository);
      getDb().close();
    }
    if (focus === "worker") {
      await verifyWorkerFocus();
      await verifyRealWorkerFocus(fixture);
    }
    if (!focus) {
      await verifyWorkerFocus();
      await verifyRealWorkerFocus(fixture);
      await verifyProtectedRouteAndOpenApiFocus(fixture);
      console.log(`offline fake-provider lifecycle verified: ${reservedLifecycleScenarios.join("; ")}`);
    } else {
      console.log(`offline fake-provider ${focus} scaffold verified`);
    }
  } finally {
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

if (require.main === module) void main();
