import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

  async checkReadiness(): Promise<void> {
    this.events.push("readiness");
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
  const [{ getDb }, { createYoutubeTrailerJob, getYoutubeTrailerJob, requestYoutubeTrailerJobCancellation }, { runYoutubeTrailerJobWorkerOnce }] = await Promise.all([
    import("../database/sqlite.js"),
    import("../services/youtube-trailer-job.service.js"),
    import("../workers/youtube-trailer-job.worker.js"),
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
  assert.deepEqual(provider.events.slice(0, 4), ["readiness", "begin-session", "resume:0", "chunk:0-8"]);

  await runYoutubeTrailerJobWorkerOnce({ provider, recoverInterrupted: false });
  const processing = getYoutubeTrailerJob(16, job.jobId);
  assert.equal(processing?.status, "processing", "same persisted session must resume to private processing");
  assert.ok(provider.events.includes("resume:8"), "recovery must query the provider Range before resuming");
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
      console.log(`offline fake-provider scaffold verified; Plan 16-04 reserves: ${reservedLifecycleScenarios.join("; ")}`);
    } else {
      console.log(`offline fake-provider ${focus} scaffold verified`);
    }
  } finally {
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

if (require.main === module) void main();
