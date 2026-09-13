import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

type RouteHandler = (req: any, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type Router = { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } }> };

class MemoryResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  bodyChunks: Buffer[] = [];
  jsonBody: any;
  headersSent = false;

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.headersSent = true;
    this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
  get body(): Buffer { return Buffer.concat(this.bodyChunks); }
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

const invoke = async (
  router: Router,
  method: "get" | "post",
  routePath: string,
  req: Request,
): Promise<MemoryResponse> => {
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

const trailerParams = (episodeId: number, candidateId: string): Record<string, string> => ({ episodeId: String(episodeId), candidateId });
const previewPath = "/:episodeId/trailer-candidates/:candidateId/preview";
const grantPath = "/:episodeId/trailer-candidates/:candidateId/preview-grant";

const run = async (): Promise<void> => {
  if (!process.argv.includes("--fake-only")) throw new Error("Trailer candidate review verification requires --fake-only");
  if (process.env.NODE_ENV !== "development") throw new Error("Trailer candidate review verification is development-only");

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-trailer-candidate-review-"));
  const mediaRoot = path.join(root, "media");
  const privateRoot = path.join(root, "private", "trailer-candidates");
  process.env.SQLITE_PATH = path.join(root, "review.sqlite");
  process.env.SQLITE_RESET = "true";
  process.env.MEDIA_STORAGE_ROOT = mediaRoot;
  process.env.MEDIA_EPISODES_DIR = path.join(mediaRoot, "episodes");
  process.env.MEDIA_EPISODES_STAGING_DIR = path.join(mediaRoot, "staging");
  process.env.MEDIA_BACKUP_ROOT = path.join(mediaRoot, "backups");
  process.env.MEDIA_BACKUP_EPISODES_DIR = path.join(mediaRoot, "backups", "episodes");
  process.env.TRAILER_CANDIDATES_ROOT = privateRoot;
  process.env.TRAILER_CANDIDATE_RENDER_ENABLED = "true";
  process.env.DISABLE_BACKGROUND_WORKERS = "true";

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls += 1; throw new Error("Outbound network is forbidden in fake-only verification"); }) as typeof fetch;
  const originalNow = Date.now;
  try {
    const [database, episodes, candidates, mediaLayout, candidateService, routes, publicCatalog, candidateWorker] = await Promise.all([
      import("../database/connect.js"),
      import("../database/repositories/episode.repository.js"),
      import("../database/repositories/trailer-candidate.repository.js"),
      import("../services/episode-media-layout.service.js"),
      import("../services/trailer-candidate.service.js"),
      import("../routes/episodes.routes.js"),
      import("../services/public-episode-catalog.service.js"),
      import("../workers/trailer-candidate.worker.js"),
    ]);
    const [{ config }, { episodeSchema }] = await Promise.all([import("../config/env.js"), import("../schemas/episode.js")]);
    await database.connectDb();
    config.auth.bypassInDev = true;
    config.trailerCandidateRenderEnabled = true;

    const episodeId = 992041;
    episodes.episodeRepository.create(episodeSchema.parse({
      episodeId,
      title: "Private trailer preview fixture",
      summary: "Offline review contract",
      pubDate: new Date("2026-01-01T00:00:00.000Z"),
      explicit: "no",
      authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    const coverPath = mediaLayout.getEpisodeMediaStagingPath(episodeId, "cover");
    const audioPath = mediaLayout.getEpisodeMediaStagingPath(episodeId, "trailer");
    await fs.promises.mkdir(path.dirname(coverPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(audioPath), { recursive: true });
    await fs.promises.writeFile(coverPath, "offline-cover-fixture");
    await fs.promises.writeFile(audioPath, "offline-audio-fixture");

    const automaticEpisodeId = episodeId + 1;
    episodes.episodeRepository.create(episodeSchema.parse({
      episodeId: automaticEpisodeId,
      title: "Automatic transcript fixture",
      summary: "Offline transcript contract",
      pubDate: new Date("2026-01-02T00:00:00.000Z"),
      explicit: "no",
      authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    const automaticCoverPath = mediaLayout.getEpisodeMediaStagingPath(automaticEpisodeId, "cover");
    const automaticAudioPath = mediaLayout.getEpisodeMediaStagingPath(automaticEpisodeId, "trailer");
    await fs.promises.mkdir(path.dirname(automaticCoverPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(automaticAudioPath), { recursive: true });
    await fs.promises.writeFile(automaticCoverPath, "automatic-cover-fixture");
    await fs.promises.writeFile(automaticAudioPath, "automatic-audio-fixture");
    const automatic = await candidateService.enqueueTrailerCandidate(automaticEpisodeId, "review-fixture@example.test");
    assert.equal(automatic.waitingForInput, false);
    if (automatic.waitingForInput) throw new Error("Automatic candidate fixture unexpectedly waited for inputs");
    let transcriptionCalls = 0;
    const fakeRunner = async (command: string, args: string[]) => {
      const target = args[args.length - 1];
      if (command === "ffprobe") {
        const isSourceAudio = target === await candidateService.trailerCandidateStoragePath(`${automatic.candidate.candidateId}/trailer.mp3`);
        return { stdout: JSON.stringify(isSourceAudio
          ? { streams: [{ codec_type: "audio", duration: "7.25" }] }
          : { format: { duration: "7.25" }, streams: [
            { codec_type: "video", codec_name: "h264", profile: "Main", width: 1280, height: 1280, pix_fmt: "yuv420p", sample_aspect_ratio: "1:1", duration: "7.25" },
            { codec_type: "audio", codec_name: "aac", duration: "7.25" },
          ] }), stderr: "" };
      }
      if (command === "ffmpeg" && args.includes("null")) return { stdout: "", stderr: "" };
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, Buffer.from("FAKE-CANDIDATE-MP4"));
      return { stdout: "", stderr: "" };
    };
    const fakeTranscribe = async (snapshotAudioPath: string, onProgress: (progress: number) => void) => {
      transcriptionCalls += 1;
      assert.equal(snapshotAudioPath, await candidateService.trailerCandidateStoragePath(`${automatic.candidate.candidateId}/trailer.mp3`));
      assert.equal(await fs.promises.readFile(snapshotAudioPath, "utf8"), "automatic-audio-fixture");
      onProgress(37);
      return { text: "A private generated trailer transcript.", provider: "fake" };
    };
    await candidateWorker.processTrailerCandidate(candidates.trailerCandidateRepository.findById(automatic.candidate.candidateId)!, {
      availableBytes: async () => 2 ** 40,
      processRunner: fakeRunner,
      transcribe: fakeTranscribe,
    });
    let automaticRow = candidates.trailerCandidateRepository.findById(automatic.candidate.candidateId)!;
    assert.equal(automaticRow.status, "ready");
    assert.equal(automaticRow.trailerTranscriptStatus, "done");
    assert.equal(automaticRow.trailerTranscriptProgress, 100);
    assert.equal(automaticRow.trailerTranscriptionProvider, "fake");
    assert.ok(automaticRow.trailerTranscriptRelativePath);
    const privateTranscriptPath = await candidateService.trailerCandidateExistingFilePath(automaticRow.trailerTranscriptRelativePath!);
    const privateTranscript = await fs.promises.readFile(privateTranscriptPath);
    assert.equal(privateTranscript.toString("utf8"), "A private generated trailer transcript.");
    assert.equal(createHash("sha256").update(privateTranscript).digest("hex"), automaticRow.trailerTranscriptSha256);
    const canonicalTranscriptPath = mediaLayout.getEpisodeMediaFinalPath(automaticEpisodeId, "transcript");
    assert.equal(await fs.promises.access(canonicalTranscriptPath).then(() => true).catch(() => false), false);
    assert.equal(episodes.episodeRepository.findByEpisodeId(automaticEpisodeId)?.transcriptStatus, "idle");
    assert.equal(transcriptionCalls, 1);

    const { getDb } = await import("../database/sqlite.js");
    getDb().prepare("UPDATE trailer_candidate_versions SET status = 'processing' WHERE candidate_id = ?").run(automatic.candidate.candidateId);
    const recoveredTranscript = candidates.trailerCandidateRepository.recoverProcessing();
    assert.equal(recoveredTranscript.length, 1);
    assert.equal(candidates.trailerCandidateRepository.findById(automatic.candidate.candidateId)?.trailerTranscriptStatus, "done");
    await candidateWorker.processTrailerCandidate(candidates.trailerCandidateRepository.findById(automatic.candidate.candidateId)!, {
      availableBytes: async () => 2 ** 40,
      processRunner: fakeRunner,
      transcribe: async () => { throw new Error("completed transcript must not be generated twice after restart"); },
    });
    assert.equal(transcriptionCalls, 1, "restart reuses the immutable completed transcript rather than duplicating provider work");

    const failedEpisodeId = episodeId + 2;
    episodes.episodeRepository.create(episodeSchema.parse({
      episodeId: failedEpisodeId, title: "Transcript failure fixture", summary: "", pubDate: new Date("2026-01-03T00:00:00.000Z"),
      explicit: "no", authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    for (const [kind, data] of [["cover", "failure-cover"], ["trailer", "failure-audio"]] as const) {
      const stagedPath = mediaLayout.getEpisodeMediaStagingPath(failedEpisodeId, kind);
      await fs.promises.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.promises.writeFile(stagedPath, data);
    }
    const failedTranscriptCandidate = await candidateService.enqueueTrailerCandidate(failedEpisodeId, "review-fixture@example.test");
    if (failedTranscriptCandidate.waitingForInput) throw new Error("Failure candidate unexpectedly waited for inputs");
    await candidateWorker.processTrailerCandidate(candidates.trailerCandidateRepository.findById(failedTranscriptCandidate.candidate.candidateId)!, {
      availableBytes: async () => 2 ** 40,
      processRunner: fakeRunner,
      transcribe: async () => { throw new Error("offline fake provider failure"); },
    });
    const waveformOnly = candidates.trailerCandidateRepository.findById(failedTranscriptCandidate.candidate.candidateId)!;
    assert.equal(waveformOnly.status, "ready", "transcription failure must not block waveform-only candidate output");
    assert.equal(waveformOnly.trailerTranscriptStatus, "error");
    assert.equal(waveformOnly.trailerTranscriptErrorCategory, "transcription_unavailable");

    const enqueued = await candidateService.enqueueTrailerCandidate(episodeId, "review-fixture@example.test");
    assert.equal(enqueued.waitingForInput, false);
    if (enqueued.waitingForInput) throw new Error("Candidate fixture unexpectedly waited for inputs");
    const candidateId = enqueued.candidate.candidateId;
    const candidate = candidates.trailerCandidateRepository.findById(candidateId);
    assert.ok(candidate);
    const claimed = candidates.trailerCandidateRepository.claim(candidateId, randomUUID());
    assert.ok(claimed);
    const videoBytes = Buffer.from("FAKE-MP4-PRIVATE-BYTES-0123456789");
    const outputRelativePath = path.posix.join(candidate!.snapshotRelativePath.replace(/[\\/]+$/u, ""), "attempts", "1", "candidate.mp4");
    const outputPath = path.join(privateRoot, outputRelativePath);
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, videoBytes);
    const outputSha256 = createHash("sha256").update(videoBytes).digest("hex");
    assert.equal(candidates.trailerCandidateRepository.markReady(candidateId, {
      relativePath: outputRelativePath,
      sha256: outputSha256,
      bytes: videoBytes.length,
      durationSeconds: 7.25,
      probeJson: JSON.stringify({ streams: [{ codec_type: "video", width: 1280, height: 1280 }] }),
    }), true);

    const router = routes.episodesRouter as unknown as Router;
    const generationEpisodeId = episodeId + 3;
    episodes.episodeRepository.create(episodeSchema.parse({
      episodeId: generationEpisodeId, title: "Edited transcript fixture", summary: "", pubDate: new Date("2026-01-04T00:00:00.000Z"),
      explicit: "no", authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    const generationCoverPath = mediaLayout.getEpisodeMediaStagingPath(generationEpisodeId, "cover");
    const generationAudioPath = mediaLayout.getEpisodeMediaStagingPath(generationEpisodeId, "trailer");
    await fs.promises.mkdir(path.dirname(generationCoverPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(generationAudioPath), { recursive: true });
    await fs.promises.writeFile(generationCoverPath, "generation-cover-fixture");
    await fs.promises.writeFile(generationAudioPath, "generation-audio-fixture");
    const generationBase = await candidateService.enqueueTrailerCandidate(generationEpisodeId, "review-fixture@example.test");
    if (generationBase.waitingForInput) throw new Error("Generation fixture unexpectedly waited for inputs");
    const generationBaseRow = candidates.trailerCandidateRepository.findById(generationBase.candidate.candidateId)!;
    const generationBody = {
      transcriptText: "  Operator-edited trailer text.\nKeep the exact spacing.  ",
      expectedSourceFingerprint: generationBaseRow.sourceFingerprint,
    };
    const generation = await invoke(router, "post", "/:episodeId/trailer-candidates", new Request(
      { episodeId: String(generationEpisodeId) }, generationBody,
    ));
    assert.equal(generation.statusCode, 202, "explicit transcript-backed generation queues an immutable candidate version");
    assert.equal(generation.headers["cache-control"], "private, no-store");
    assert.equal(generation.jsonBody.transcriptText, generationBody.transcriptText);
    const generatedCandidateId = generation.jsonBody.candidateId as string;
    assert.notEqual(generatedCandidateId, generationBase.candidate.candidateId);
    const generatedRow = candidates.trailerCandidateRepository.findById(generatedCandidateId)!;
    const generatedTranscriptPath = await candidateService.trailerCandidateExistingFilePath(generatedRow.trailerTranscriptRelativePath!);
    const generatedTranscriptBytes = await fs.promises.readFile(generatedTranscriptPath);
    assert.equal(generatedTranscriptBytes.toString("utf8"), generationBody.transcriptText);
    assert.equal(createHash("sha256").update(generatedTranscriptBytes).digest("hex"), generatedRow.trailerTranscriptSha256);
    assert.equal(generatedRow.trailerTranscriptStatus, "done");
    assert.equal(episodes.episodeRepository.findByEpisodeId(generationEpisodeId)?.transcriptStatus, "idle");
    const generatedRepeat = await invoke(router, "post", "/:episodeId/trailer-candidates", new Request(
      { episodeId: String(generationEpisodeId) }, generationBody,
    ));
    assert.equal(generatedRepeat.statusCode, 200, "identical transcript requests reuse the exact candidate revision");
    assert.equal(generatedRepeat.jsonBody.candidateId, generatedCandidateId);
    const generatedCount = getDb().prepare("SELECT COUNT(*) AS count FROM trailer_candidate_versions WHERE episode_id = ?").get(generationEpisodeId)?.count;
    await fs.promises.writeFile(generationCoverPath, "changed-generation-cover");
    const staleGeneration = await invoke(router, "post", "/:episodeId/trailer-candidates", new Request(
      { episodeId: String(generationEpisodeId) }, generationBody,
    ));
    assert.equal(staleGeneration.statusCode, 409, "a stale source fingerprint cannot create a candidate version");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM trailer_candidate_versions WHERE episode_id = ?").get(generationEpisodeId)?.count, generatedCount);
    await fs.promises.writeFile(generationCoverPath, "generation-cover-fixture");

    const invalidRetry = await invoke(router, "post", "/:episodeId/trailer-candidates/:candidateId/retry", new Request(
      trailerParams(generationEpisodeId, generatedCandidateId), {},
    ));
    assert.equal(invalidRetry.statusCode, 409, "retry conflicts unless the API marks the exact candidate retryable");
    getDb().prepare("UPDATE trailer_candidate_versions SET status = 'retryable' WHERE candidate_id = ?").run(generatedCandidateId);
    const validRetry = await invoke(router, "post", "/:episodeId/trailer-candidates/:candidateId/retry", new Request(
      trailerParams(generationEpisodeId, generatedCandidateId), {},
    ));
    assert.equal(validRetry.statusCode, 202);
    assert.equal(validRetry.jsonBody.candidateId, generatedCandidateId);
    assert.equal(candidates.trailerCandidateRepository.findById(generatedCandidateId)?.status, "pending");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM promotion_notifications WHERE episode_id = ?").get(generationEpisodeId)?.count ?? 0, 0,
      "generation and retry must not trigger publication side effects");

    const statusRoute = "/:episodeId/trailer-candidates/current";
    const status = await invoke(router, "get", statusRoute, new Request({ episodeId: String(episodeId) }));
    assert.equal(status.statusCode, 200);
    assert.equal(status.headers["cache-control"], "private, no-store");
    assert.equal(status.headers["referrer-policy"], "no-referrer");
    assert.equal(status.jsonBody.candidateId, candidateId);
    assert.equal(status.jsonBody.status, "ready");
    assert.equal(status.jsonBody.progress, 100);
    assert.equal(status.jsonBody.durationSeconds, 7.25);
    assert.equal(status.jsonBody.resolution, "1280×1280");
    assert.equal(status.jsonBody.profileId, candidate!.profileId);
    assert.equal(status.jsonBody.profileRevision, candidate!.profileRevision);
    assert.equal(status.jsonBody.isCurrent, true);
    assert.equal(status.jsonBody.outputValid, true);
    const serializedStatus = JSON.stringify(status.jsonBody);
    for (const forbidden of ["snapshotRelativePath", "outputRelativePath", "outputSha256", "outputBytes", "draftId", "probeJson", "errorMessageRaw"]) {
      assert.equal(serializedStatus.includes(forbidden), false, `review DTO must not contain ${forbidden}`);
    }

    const exactStatus = await invoke(router, "get", "/:episodeId/trailer-candidates/:candidateId", new Request(trailerParams(episodeId, candidateId)));
    assert.equal(exactStatus.statusCode, 200);
    const unauthenticatedEpisodeStatus = await (async () => {
      config.auth.bypassInDev = false;
      const response = await invoke(router, "get", "/:episodeId/trailer-candidates/:candidateId", new Request(trailerParams(episodeId, candidateId)));
      config.auth.bypassInDev = true;
      return response;
    })();
    assert.equal(unauthenticatedEpisodeStatus.statusCode, 401, "status reads require authentication outside the explicit development bypass");
    assert.equal(unauthenticatedEpisodeStatus.headers["cache-control"], "private, no-store");

    const grantResponse = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
    assert.equal(grantResponse.statusCode, 201);
    assert.equal(grantResponse.headers["cache-control"], "private, no-store");
    assert.equal(grantResponse.headers["referrer-policy"], "no-referrer");
    const grantUrl = grantResponse.jsonBody.previewUrl as string;
    const grantToken = new URL(grantUrl, "https://api.example.test").searchParams.get("grant");
    assert.ok(grantToken);
    assert.equal(grantResponse.jsonBody.episodeId, episodeId);
    assert.equal(grantResponse.jsonBody.candidateId, candidateId);
    assert.equal(Date.parse(grantResponse.jsonBody.expiresAt) > Date.now(), true);
    assert.equal(grantUrl, `/v1/episodes/${episodeId}/trailer-candidates/${candidateId}/preview?grant=${grantToken}`);

    const unauthenticatedGrant = await (async () => {
      config.auth.bypassInDev = false;
      const response = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
      config.auth.bypassInDev = true;
      return response;
    })();
    assert.equal(unauthenticatedGrant.statusCode, 401, "grant issuance requires authentication");

    const malformedBody = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), { extra: "rejected" }));
    assert.equal(malformedBody.statusCode, 400, "grant request body is strict");
    const crossEpisodeGrant = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId + 1, candidateId), {}));
    assert.equal(crossEpisodeGrant.statusCode, 404, "a candidate cannot be minted through a different episode ID");
    const wrongCandidate = await invoke(router, "get", previewPath, new Request(trailerParams(episodeId, randomUUID()), {}, {}, { grant: grantToken! }));
    assert.equal(wrongCandidate.statusCode, 404, "a grant cannot be replayed for another candidate");
    const duplicateGrant = await invoke(router, "get", previewPath, new Request(trailerParams(episodeId, candidateId), {}, {}, { grant: [grantToken!, grantToken!] }));
    assert.equal(duplicateGrant.statusCode, 404, "duplicate grant query parameters are rejected");

    const preview = (range?: string) => invoke(router, "get", previewPath, new Request(
      trailerParams(episodeId, candidateId), {}, range ? { range } : {}, { grant: grantToken! },
    ));
    const full = await preview();
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers["content-type"], "video/mp4");
    assert.equal(full.headers["content-length"], String(videoBytes.length));
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.equal(full.headers["cache-control"], "private, no-store");
    assert.equal(full.headers["referrer-policy"], "no-referrer");
    assert.deepEqual(full.body, videoBytes);

    const partial = await preview("bytes=2-8");
    assert.equal(partial.statusCode, 206);
    assert.equal(partial.headers["content-range"], `bytes 2-8/${videoBytes.length}`);
    assert.equal(partial.headers["content-length"], "7");
    assert.deepEqual(partial.body, videoBytes.subarray(2, 9));
    const openEnded = await preview("bytes=4-");
    assert.equal(openEnded.statusCode, 206);
    assert.equal(openEnded.headers["content-range"], `bytes 4-${videoBytes.length - 1}/${videoBytes.length}`);
    assert.deepEqual(openEnded.body, videoBytes.subarray(4));
    const suffix = await preview("bytes=-5");
    assert.equal(suffix.statusCode, 206);
    assert.equal(suffix.headers["content-range"], `bytes ${videoBytes.length - 5}-${videoBytes.length - 1}/${videoBytes.length}`);
    assert.deepEqual(suffix.body, videoBytes.subarray(-5));
    for (const invalidRange of ["bytes=999999-", "bytes=8-2", "bytes=1-2,4-5", "bytes=-0", "not-a-range", "bytes=-"]) {
      const rejectedRange = await preview(invalidRange);
      assert.equal(rejectedRange.statusCode, 416, `${invalidRange} must be unsatisfiable/rejected`);
      assert.equal(rejectedRange.headers["content-range"], `bytes */${videoBytes.length}`);
      assert.equal(rejectedRange.body.length, 0);
    }

    const staleCandidate = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
    assert.equal(staleCandidate.statusCode, 201);
    const originalCover = await fs.promises.readFile(coverPath);
    await fs.promises.writeFile(coverPath, "changed-cover-source");
    const stalePreview = await invoke(router, "get", previewPath, new Request(trailerParams(episodeId, candidateId), {}, {}, {
      grant: new URL(staleCandidate.jsonBody.previewUrl, "https://api.example.test").searchParams.get("grant") as string,
    }));
    assert.equal(stalePreview.statusCode, 404, "source changes invalidate grants before bytes are returned");
    await fs.promises.writeFile(coverPath, originalCover);

    const expiringGrant = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
    const expiringToken = new URL(expiringGrant.jsonBody.previewUrl, "https://api.example.test").searchParams.get("grant") as string;
    Date.now = () => originalNow() + 6 * 60 * 1000;
    const expired = await invoke(router, "get", previewPath, new Request(trailerParams(episodeId, candidateId), {}, {}, { grant: expiringToken }));
    assert.equal(expired.statusCode, 404, "expired grants disclose no bytes");
    Date.now = originalNow;

    const changedHashGrant = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
    const changedHashToken = new URL(changedHashGrant.jsonBody.previewUrl, "https://api.example.test").searchParams.get("grant") as string;
    await fs.promises.writeFile(outputPath, Buffer.from("tampered output"));
    const changedHash = await invoke(router, "get", previewPath, new Request(trailerParams(episodeId, candidateId), {}, {}, { grant: changedHashToken }));
    assert.equal(changedHash.statusCode, 404, "changed output hash invalidates the grant");
    assert.equal(changedHash.body.includes(Buffer.from("tampered output")), false);
    await fs.promises.writeFile(outputPath, videoBytes);

    const missingGrant = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
    const missingToken = new URL(missingGrant.jsonBody.previewUrl, "https://api.example.test").searchParams.get("grant") as string;
    await fs.promises.unlink(outputPath);
    const missingOutput = await invoke(router, "get", previewPath, new Request(trailerParams(episodeId, candidateId), {}, {}, { grant: missingToken }));
    assert.equal(missingOutput.statusCode, 404, "missing output files disclose no path or bytes");
    assert.equal(JSON.stringify(missingOutput.jsonBody).includes(privateRoot), false);

    const escapedOutput = path.join(root, "outside.mp4");
    await fs.promises.writeFile(escapedOutput, videoBytes);
    const originalCandidate = candidates.trailerCandidateRepository.findById(candidateId)!;
    const symlinkRelativePath = path.posix.join(originalCandidate.snapshotRelativePath.replace(/[\\/]+$/u, ""), "attempts", "1", "linked.mp4");
    await fs.promises.symlink(escapedOutput, path.join(privateRoot, symlinkRelativePath));
    getDb().prepare("UPDATE trailer_candidate_versions SET output_relative_path = ?, output_sha256 = ?, output_bytes = ? WHERE candidate_id = ?")
      .run(symlinkRelativePath, outputSha256, videoBytes.length, candidateId);
    const escapedGrant = await invoke(router, "post", grantPath, new Request(trailerParams(episodeId, candidateId), {}));
    assert.equal(escapedGrant.statusCode, 404, "symlink output outside the private root is rejected before grant issuance");

    assert.equal(routes.redactTrailerPreviewGrantFromUrl(`/v1/episodes/${episodeId}/trailer-candidates/${candidateId}/preview?grant=secret-token&x=1`),
      `/v1/episodes/${episodeId}/trailer-candidates/${candidateId}/preview?grant=[REDACTED]&x=1`);
    assert.equal(routes.redactTrailerPreviewGrantFromUrl("/v1/episodes/1?x=1"), "/v1/episodes/1?x=1");
    const episodeRow = episodes.episodeRepository.findByEpisodeId(episodeId)!;
    assert.equal("trailerCandidate" in episodeRow, false, "candidate state remains private from canonical/public episode records");
    assert.equal("previewGrant" in episodeRow, false);
    const publicDetail = publicCatalog.mapEpisodeToPublicDetail(episodeRow, { requestOrigin: "https://public.example.test" });
    const publicCatalogItem = publicCatalog.mapEpisodesToPublicCatalog([episodeRow], { requestOrigin: "https://public.example.test" })[0];
    for (const publicDto of [publicDetail, publicCatalogItem]) {
      const serialized = JSON.stringify(publicDto);
      assert.equal(serialized.includes("trailerCandidate"), false, "public episode/feed DTOs exclude candidate state");
      assert.equal(serialized.includes("previewGrant"), false, "public episode/feed DTOs exclude preview capability");
      assert.equal(serialized.includes(candidateId), false, "public episode/feed DTOs exclude candidate identity");
    }
    assert.equal(networkCalls, 0, "the verifier performs no outbound provider or network calls");
    console.log("Trailer candidate review and preview verification passed (fake-only; no outbound network calls).");
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
