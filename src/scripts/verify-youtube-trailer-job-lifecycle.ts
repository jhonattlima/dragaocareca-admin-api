import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type YoutubeTrailerJobFocus = "repository" | "worker";

export type FakeProviderFailure = {
  code: "fake-provider-failure";
  message: string;
};

export type FakeProcessingState = "processing" | "succeeded";

export type FakePrivateSession = {
  sessionUri: string;
  privacyStatus: "private";
};

export type FakeRangeResume = {
  confirmedBytes: number;
  range: string | null;
};

export type FakeChunkResult = {
  confirmedBytes: number;
  providerVideoId: string | null;
};

export type FakeCancellationResult = {
  accepted: boolean;
  boundary: "local-cancelled" | "provider-video-retained";
};

export interface YoutubeTrailerUploadProvider {
  beginPrivateSession(sourceBytes: number): Promise<FakePrivateSession>;
  resumeRange(sessionUri: string): Promise<FakeRangeResume>;
  uploadChunk(sessionUri: string, offset: number, chunk: Buffer): Promise<FakeChunkResult>;
  pollProcessing(providerVideoId: string): Promise<FakeProcessingState>;
  cancel(sessionUri: string, providerVideoId: string | null): Promise<FakeCancellationResult>;
  normalizeFailure(error: unknown): FakeProviderFailure;
}

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

  async beginPrivateSession(sourceBytes: number): Promise<FakePrivateSession> {
    assert.ok(sourceBytes > 0, "fake provider requires a non-empty source");
    this.sourceBytes = sourceBytes;
    return { sessionUri: this.sessionUri, privacyStatus: "private" };
  }

  async resumeRange(sessionUri: string): Promise<FakeRangeResume> {
    this.assertSession(sessionUri);
    return {
      confirmedBytes: this.confirmedBytes,
      range: this.confirmedBytes === 0 ? null : `bytes=0-${this.confirmedBytes - 1}`,
    };
  }

  async uploadChunk(sessionUri: string, offset: number, chunk: Buffer): Promise<FakeChunkResult> {
    this.assertSession(sessionUri);
    assert.equal(offset, this.confirmedBytes, "fake provider only accepts resumed offsets");
    assert.ok(chunk.length > 0, "fake provider requires a non-empty chunk");
    this.confirmedBytes = Math.min(this.sourceBytes, this.confirmedBytes + chunk.length);
    return {
      confirmedBytes: this.confirmedBytes,
      providerVideoId: this.confirmedBytes === this.sourceBytes ? this.providerVideoId : null,
    };
  }

  async pollProcessing(providerVideoId: string): Promise<FakeProcessingState> {
    assert.equal(providerVideoId, this.providerVideoId, "fake provider video ID must match");
    this.processingPolls += 1;
    return this.processingPolls === 1 ? "processing" : "succeeded";
  }

  async cancel(sessionUri: string, providerVideoId: string | null): Promise<FakeCancellationResult> {
    this.assertSession(sessionUri);
    if (providerVideoId) {
      assert.equal(providerVideoId, this.providerVideoId, "fake provider video ID must match");
      return { accepted: false, boundary: "provider-video-retained" };
    }
    return { accepted: true, boundary: "local-cancelled" };
  }

  normalizeFailure(error: unknown): FakeProviderFailure {
    const detail = error instanceof Error ? error.message : "unknown fake-provider failure";
    return { code: "fake-provider-failure", message: `Fake provider: ${detail}` };
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
  await fs.promises.writeFile(sqlitePath, "offline verifier fixture");
  return { root, mediaRoot, sqlitePath };
};

const verifyScaffoldIsolation = async (fixture: Fixture): Promise<void> => {
  assert.match(fixture.root, /^\/tmp\/dragaocareca-youtube-trailer-job-/);
  assert.equal(await fs.promises.stat(fixture.mediaRoot).then((entry) => entry.isDirectory()), true);
  assert.equal(await fs.promises.stat(fixture.sqlitePath).then((entry) => entry.isFile()), true);
  assert.equal(reservedLifecycleScenarios.length, 5);
};

const verifyRepositoryFocus = async (): Promise<void> => {
  const provider = new FakeYoutubeTrailerUploadProvider();
  const session = await provider.beginPrivateSession(8);
  assert.deepEqual(session, { sessionUri: "fake-provider://private-session-1", privacyStatus: "private" });
  assert.deepEqual(await provider.resumeRange(session.sessionUri), { confirmedBytes: 0, range: null });
  assert.deepEqual(provider.normalizeFailure(new Error("repository fixture failure")), {
    code: "fake-provider-failure",
    message: "Fake provider: repository fixture failure",
  });
};

const verifyWorkerFocus = async (): Promise<void> => {
  const provider = new FakeYoutubeTrailerUploadProvider();
  const session = await provider.beginPrivateSession(8);
  const partial = await provider.uploadChunk(session.sessionUri, 0, Buffer.from("fake"));
  assert.deepEqual(partial, { confirmedBytes: 4, providerVideoId: null });
  assert.deepEqual(await provider.resumeRange(session.sessionUri), { confirmedBytes: 4, range: "bytes=0-3" });
  assert.deepEqual(await provider.cancel(session.sessionUri, null), { accepted: true, boundary: "local-cancelled" });

  const complete = await provider.uploadChunk(session.sessionUri, 4, Buffer.from("data"));
  assert.deepEqual(complete, { confirmedBytes: 8, providerVideoId: "fake-private-video-1" });
  assert.equal(await provider.pollProcessing(complete.providerVideoId!), "processing");
  assert.equal(await provider.pollProcessing(complete.providerVideoId!), "succeeded");
  assert.deepEqual(await provider.cancel(session.sessionUri, complete.providerVideoId), {
    accepted: false,
    boundary: "provider-video-retained",
  });
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
    const focus = parseFocus(process.argv.slice(2));
    if (focus === "repository") await verifyRepositoryFocus();
    if (focus === "worker") await verifyWorkerFocus();
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
