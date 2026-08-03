import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { connectDb } from "../database/connect";
import { getDb } from "../database/sqlite";
import { episodeRepository } from "../database/repositories/episode.repository";
import { artifactJobRepository } from "../database/repositories/artifact-job.repository";
import { config } from "../config/env";
import { swaggerSpec } from "../docs/openapi";
import { episodesRouter } from "../routes/episodes.routes";
import {
  createEpisodeArtifactPreparationStageController,
  getEpisodeArtifactPreparationStatus,
  injectEpisodeArtifactPreparationFailure,
  injectEpisodeArtifactPreparationStageController,
  initializeEpisodeArtifactPreparations,
  prepareEpisodeArtifactArchive,
  processNextEpisodeArtifactPreparation,
  resetEpisodeArtifactPreparationFailure,
  resetEpisodeArtifactPreparationStageController,
  type EpisodeArtifactPreparationStatus,
} from "../services/episode-artifact-preparation.service";
import { EpisodeArtifactSelectorValidationError, parseEpisodeArtifactSelectors } from "../services/episode-artifact-download.service";
import { getEpisodeMediaFinalPath } from "../services/episode-media-layout.service";

const fixtureEpisodeId = 987654321;
const unknownEpisodeId = fixtureEpisodeId + 1;
const preparationRoot = path.join(config.media.storageRoot, ".artifact-preparations");
const archivesRoot = path.join(preparationRoot, "archives");
const startTime = new Date(Date.now());

class MemoryResponse extends Writable {
  statusCode = 200;
  jsonBody: unknown;
  destroyed = false;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
  setHeader(name: string, value: string): void { this.headers.set(name.toLowerCase(), String(value)); }
  getHeader(name: string): string | undefined { return this.headers.get(name.toLowerCase()); }
  destroy(error?: Error): this { this.destroyed = true; super.destroy(error); return this; }
}

type FakeRequest = {
  params: { episodeId: string; jobId?: string };
  headers: { authorization?: string };
  body?: unknown;
  user?: { email: string };
};
type RouteHandler = (req: FakeRequest, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type ArtifactStatus = EpisodeArtifactPreparationStatus;

const resetDirectory = async (directory: string): Promise<void> => {
  await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
};

const resetVerifierFixtures = async (): Promise<void> => {
  await resetDirectory(preparationRoot);
  const mediaDirectory = path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio"));
  await fs.promises.rm(mediaDirectory, { recursive: true, force: true });
  await fs.promises.mkdir(mediaDirectory, { recursive: true });
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio"), "final audio fixture");
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript"), "final transcript fixture");
  episodeRepository.delete(fixtureEpisodeId);
  episodeRepository.create({ episodeId: fixtureEpisodeId, title: "Artifact verifier fixture", summary: "", pubDate: new Date("2026-01-01T00:00:00.000Z"), explicit: "no", authors: [], guests: [], tags: [], citations: [], musicCredits: [], coverCredits: [] });
};

const getRouteHandlers = (routePath: string, method: "get" | "post"): RouteHandler[] => {
  const router = episodesRouter as unknown as { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } }> };
  const route = router.stack?.find((layer) => layer.route?.path === routePath && layer.route.methods?.[method])?.route;
  if (!route?.stack) throw new Error(`artifact route stack not found: ${method} ${routePath}`);
  return route.stack.map((layer) => layer.handle);
};

const invokeRoute = async (
  routePath: string,
  method: "get" | "post",
  params: FakeRequest["params"],
  body?: unknown,
  authorization?: string,
): Promise<MemoryResponse> => {
  const handlers = getRouteHandlers(routePath, method);
  const req: FakeRequest = { params, headers: { authorization }, body };
  const res = new MemoryResponse();
  await new Promise<void>((resolve, reject) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { reject(error); return; }
      const handler = handlers[index++];
      if (!handler) { resolve(); return; }
      Promise.resolve(handler(req, res, next)).catch(reject);
    };
    res.once("finish", resolve);
    res.once("error", reject);
    next();
  });
  return res;
};

const assertPublicSnapshot = (status: ArtifactStatus, state: ArtifactStatus["state"]): void => {
  assert.equal(status.state, state);
  assert.ok(Number.isInteger(status.progress) && status.progress >= 0 && status.progress <= 100);
  assert.ok(status.createdAt && status.updatedAt);
  assert.equal("archivePath" in status, false);
  assert.equal("snapshotPath" in status, false);
  assert.equal("temporaryArchivePath" in status, false);
  assert.equal("storageRoot" in status, false);
};

const assertNoInternalFields = (value: unknown): void => {
  const forbidden = new Set(["path", "manifest", "fingerprint", "cacheKey", "archiveFileName", "archivePath", "snapshotPath", "temporaryArchivePath", "storageRoot", "errorCode"]);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(assertNoInternalFields); return; }
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `internal field leaked: ${key}`);
    assertNoInternalFields(child);
  }
};

const assertNoPartialOutput = async (jobId: string): Promise<void> => {
  const archives = await fs.promises.readdir(archivesRoot).catch(() => [] as string[]);
  const snapshots = await fs.promises.readdir(path.join(preparationRoot, "snapshots", jobId)).catch(() => [] as string[]);
  assert.deepEqual(archives.filter((name) => name.includes(jobId) || name.endsWith(".part")), []);
  assert.deepEqual(snapshots, []);
};

const readZipEntryNames = (bytes: Buffer): string[] => {
  const names: string[] = [];
  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
};

const assertRouteSnapshot = (response: MemoryResponse, state: ArtifactStatus["state"]): ArtifactStatus => {
  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader("cache-control"), "no-store");
  const status = response.jsonBody as ArtifactStatus;
  assertPublicSnapshot(status, state);
  assertNoInternalFields(status);
  return status;
};

const verifySelectorAndValidation = async (): Promise<void> => {
  assert.deepEqual(parseEpisodeArtifactSelectors("trailer-video,image-low,episode,episode,image").map((entry) => entry.selector), ["episode", "trailer-video", "image", "image-low"]);
  for (const invalid of ["", "episode,", ",episode", "episode,,trailer", "unknown", ["episode"], "../audio.mp3", "/tmp/audio.mp3", "audio.mp3", 12, null]) {
    assert.throws(() => parseEpisodeArtifactSelectors(invalid), EpisodeArtifactSelectorValidationError);
  }

  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = true;
  try {
    for (const body of [{ artifacts: [] }, { artifacts: ["../audio.mp3"] }, { artifacts: ["audio.mp3"] }, { artifacts: ["unknown"] }, { artifacts: "episode" }, { artifacts: ["episode"], extra: true }]) {
      const response = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, body);
      assert.equal(response.statusCode, 400);
      assert.equal(response.getHeader("cache-control"), "no-store");
    }
    const invalidId = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: "0" }, { artifacts: ["episode"] });
    assert.equal(invalidId.statusCode, 400);
    const unknown = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(unknownEpisodeId) }, { artifacts: ["episode"] });
    assert.equal(unknown.statusCode, 404);
    assert.deepEqual(unknown.jsonBody, { message: "Episode not found" });

    let defaultAllJob: ArtifactStatus | undefined;
    for (const body of [undefined, {}]) {
      const defaultAll = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, body);
      assert.equal(defaultAll.statusCode, 202);
      assert.deepEqual((defaultAll.jsonBody as ArtifactStatus).requested, ["episode", "trailer", "trailer-video", "transcript", "image", "image-low"]);
      defaultAllJob = defaultAll.jsonBody as ArtifactStatus;
    }

    const noJobCount = (): number => Number((getDb().prepare("SELECT COUNT(*) AS count FROM artifact_jobs WHERE episode_id = ?").get(fixtureEpisodeId) as { count: number }).count);
    const before = noJobCount();
    const noArtifacts = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer"] });
    assert.equal(noArtifacts.statusCode, 404);
    assert.deepEqual(noArtifacts.jsonBody, { message: "No requested artifacts found" });
    assert.equal(noJobCount(), before);

    const trailerVideoPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo");
    await fs.promises.mkdir(trailerVideoPath);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer-video"] })).statusCode, 404);
    await fs.promises.rm(trailerVideoPath, { recursive: true, force: true });
    await fs.promises.symlink(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio"), trailerVideoPath);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer-video"] })).statusCode, 404);
    await fs.promises.unlink(trailerVideoPath);

    assert.ok(defaultAllJob);
    const completedDefaultAll = await processNextEpisodeArtifactPreparation({ now: startTime });
    assert.equal(completedDefaultAll?.state, "completed");
    const defaultAllDownload = await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: defaultAllJob.jobId });
    assert.equal(defaultAllDownload.statusCode, 200);
    assert.equal(defaultAllDownload.getHeader("x-missing-artifacts"), "trailer,trailer-video,image,image-low");
    assert.deepEqual(readZipEntryNames(Buffer.concat(defaultAllDownload.chunks)), [`episode-${fixtureEpisodeId}/audio.mp3`, `episode-${fixtureEpisodeId}/transcript.txt`]);
    await resetVerifierFixtures();
  } finally {
    config.auth.bypassInDev = originalBypass;
  }
};

const verifyLifecycleAndDownload = async (): Promise<{ completed: ArtifactStatus; logs: string[] }> => {
  const originalBypass = config.auth.bypassInDev;
  const originalInfo = console.info;
  const originalError = console.error;
  const logs: string[] = [];
  config.auth.bypassInDev = true;
  console.info = (...args: unknown[]): void => { logs.push(JSON.stringify(args)); };
  console.error = (...args: unknown[]): void => { logs.push(JSON.stringify(args)); };
  try {
    const started = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["transcript", "episode", "episode"] });
    assert.equal(started.statusCode, 202);
    assert.equal(started.getHeader("location"), `/v1/episodes/${fixtureEpisodeId}/artifacts/jobs/${(started.jsonBody as ArtifactStatus).jobId}`);
    const pending = started.jsonBody as ArtifactStatus;
    assertPublicSnapshot(pending, "pending");
    assert.deepEqual(pending.requested, ["episode", "transcript"]);
    assert.equal(pending.progress, 0);

    const duplicate = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["episode", "transcript"] });
    assert.equal((duplicate.jsonBody as ArtifactStatus).jobId, pending.jobId);

    const controller = createEpisodeArtifactPreparationStageController();
    injectEpisodeArtifactPreparationStageController(controller);
    const processingPromise = processNextEpisodeArtifactPreparation({ now: startTime });
    controller.release("processing-preflight");
    await controller.waitForCompletion("processing-preflight");
    const processing = assertRouteSnapshot(await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: pending.jobId }), "processing");
    assert.equal(processing.progress, 0);
    controller.release("processing-evidence");
    controller.release("processing-archive");
    await controller.waitForCompletion("processing-archive");
    const archived = assertRouteSnapshot(await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: pending.jobId }), "processing");
    assert.ok(archived.progress > processing.progress && archived.progress < 100);
    controller.release("processing-finalization");
    controller.release("terminal");
    const completed = (await processingPromise) as ArtifactStatus;
    assertPublicSnapshot(completed, "completed");
    assert.equal(completed.progress, 100);
    assert.equal(completed.error, null);
    assert.equal(Date.parse(completed.expiresAt ?? "") - startTime.getTime(), 24 * 60 * 60 * 1000);
    const persisted = artifactJobRepository.findByJobId(fixtureEpisodeId, pending.jobId);
    assert.ok(persisted && persisted.sourceEvidence.every((evidence) => typeof evidence.selector === "string" && (evidence.missing === true || /^[a-f0-9]{64}$/.test(evidence.sha256 ?? ""))));
    resetEpisodeArtifactPreparationStageController();

    const status = assertRouteSnapshot(await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: pending.jobId }), "completed");
    assert.equal(status.downloadUrl, `/v1/episodes/${fixtureEpisodeId}/artifacts/jobs/${pending.jobId}/download`);
    const download = await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: pending.jobId });
    assert.equal(download.statusCode, 200);
    assert.equal(download.getHeader("cache-control"), "no-store");
    assert.equal(download.getHeader("content-type"), "application/zip");
    assert.equal(download.getHeader("content-disposition"), `attachment; filename="episode-${fixtureEpisodeId}-artifacts.zip"`);
    const entries = readZipEntryNames(Buffer.concat(download.chunks));
    assert.deepEqual(entries, [`episode-${fixtureEpisodeId}/audio.mp3`, `episode-${fixtureEpisodeId}/transcript.txt`]);
    assert.ok(entries.every((entry) => entry.startsWith(`episode-${fixtureEpisodeId}/`) && !entry.includes("..") && !entry.includes("\\")));
    return { completed: status, logs };
  } finally {
    config.auth.bypassInDev = originalBypass;
    console.info = originalInfo;
    console.error = originalError;
    resetEpisodeArtifactPreparationStageController();
  }
};

const verifyPartialAndFailure = async (): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = true;
  try {
    await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo"), "final trailer video fixture");
    const partialStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer", "trailer-video", "transcript"] });
    assert.equal(partialStart.statusCode, 202);
    const partial = partialStart.jsonBody as ArtifactStatus;
    assert.deepEqual(partial.requested, ["trailer", "trailer-video", "transcript"]);
    assert.deepEqual(partial.available, ["trailer-video", "transcript"]);
    assert.deepEqual(partial.missing, ["trailer"]);
    const controller = createEpisodeArtifactPreparationStageController();
    injectEpisodeArtifactPreparationStageController(controller);
    const processing = processNextEpisodeArtifactPreparation({ now: startTime });
    controller.releaseAll();
    await processing;
    resetEpisodeArtifactPreparationStageController();
    const partialDownload = await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: partial.jobId });
    assert.equal(partialDownload.statusCode, 200);
    assert.equal(partialDownload.getHeader("x-missing-artifacts"), "trailer");
    assert.deepEqual(readZipEntryNames(Buffer.concat(partialDownload.chunks)), [`episode-${fixtureEpisodeId}/trailer.mp4`, `episode-${fixtureEpisodeId}/transcript.txt`]);

    await resetVerifierFixtures();
    const failureStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["episode"] });
    const failedJob = failureStart.jsonBody as ArtifactStatus;
    injectEpisodeArtifactPreparationFailure("Verifier forced archive failure at /private/media/source.mp3");
    const failed = (await processNextEpisodeArtifactPreparation({ now: startTime })) as ArtifactStatus;
    resetEpisodeArtifactPreparationFailure();
    assertPublicSnapshot(failed, "failed");
    assert.equal(failed.error, "Artifact archive preparation failed. Please try again.");
    assert.ok(failed.error.length > 0);
    assertNoInternalFields(failed);
    await assertNoPartialOutput(failedJob.jobId);
    const failedStatus = await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: failedJob.jobId });
    assert.equal((failedStatus.jsonBody as ArtifactStatus).error, "Artifact archive preparation failed. Please try again.");
    const failedDownload = await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: failedJob.jobId });
    assert.equal(failedDownload.statusCode, 409);

    await resetVerifierFixtures();
    const evidenceStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["episode"] });
    const evidenceController = createEpisodeArtifactPreparationStageController();
    injectEpisodeArtifactPreparationStageController(evidenceController);
    const evidenceProcessing = processNextEpisodeArtifactPreparation({ now: startTime });
    evidenceController.release("processing-preflight");
    await evidenceController.waitForCompletion("processing-evidence");
    await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio"), "source changed after snapshot", "utf8");
    evidenceController.releaseAll();
    const evidenceFailed = (await evidenceProcessing) as ArtifactStatus;
    assertPublicSnapshot(evidenceFailed, "failed");
    assert.equal(evidenceFailed.error, "Artifact archive preparation failed. Please try again.");
    await assertNoPartialOutput((evidenceStart.jsonBody as ArtifactStatus).jobId);
  } finally {
    resetEpisodeArtifactPreparationFailure();
    resetEpisodeArtifactPreparationStageController();
    config.auth.bypassInDev = originalBypass;
  }
};

const verifyDuplicateRestartExpiryAndOwnership = async (completed: ArtifactStatus): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = true;
  try {
    await resetVerifierFixtures();
    const starts = await Promise.all(Array.from({ length: 4 }, () => invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["episode"] })));
    assert.equal(new Set(starts.map((response) => (response.jsonBody as ArtifactStatus).jobId)).size, 1);
    const activeJob = (starts[0].jsonBody as ArtifactStatus).jobId;
    const pendingOther = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["transcript"] });
    const otherJob = (pendingOther.jsonBody as ArtifactStatus).jobId;
    const activePath = path.join(archivesRoot, `episode-${activeJob}-artifacts.zip`);
    const otherPath = path.join(archivesRoot, `episode-${otherJob}-artifacts.zip`);
    await fs.promises.mkdir(archivesRoot, { recursive: true });
    await fs.promises.writeFile(activePath, "interrupted archive");
    await fs.promises.writeFile(otherPath, "other job archive");
    getDb().prepare("UPDATE artifact_jobs SET status = 'processing', progress = 42 WHERE job_id = ?").run(activeJob);
    await initializeEpisodeArtifactPreparations({ now: startTime, recoverInterrupted: true });
    assert.equal((await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, activeJob, { now: startTime }))?.state, "pending");
    assert.equal(Boolean((await fs.promises.stat(activePath).catch(() => null))?.isFile()), false);
    assert.equal(Boolean((await fs.promises.stat(otherPath).catch(() => null))?.isFile()), true);

    await processNextEpisodeArtifactPreparation({ now: startTime });
    await processNextEpisodeArtifactPreparation({ now: startTime });
    const mismatch = await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(unknownEpisodeId), jobId: completed.jobId });
    const unknown = await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: "unknown-job" });
    assert.equal(mismatch.statusCode, 404);
    assert.equal(unknown.statusCode, 404);
    assert.deepEqual(mismatch.jsonBody, unknown.jsonBody);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(unknownEpisodeId), jobId: completed.jobId })).statusCode, 404);

    const expiryStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["episode"] });
    const expiryJob = expiryStart.jsonBody as ArtifactStatus;
    await processNextEpisodeArtifactPreparation({ now: startTime });
    const exactExpiry = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
    assert.equal(await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, expiryJob.jobId, { now: exactExpiry }), null);

  } finally {
    config.auth.bypassInDev = originalBypass;
  }
};

const verifyEvidenceInvalidation = async (): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = true;
  try {
    await resetVerifierFixtures();
    const changedStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["episode"] });
    const changedJob = changedStart.jsonBody as ArtifactStatus;
    await processNextEpisodeArtifactPreparation({ now: startTime });
    const sourcePath = getEpisodeMediaFinalPath(fixtureEpisodeId, "audio");
    const originalStat = await fs.promises.stat(sourcePath);
    await fs.promises.writeFile(sourcePath, "alter audio fixture");
    await fs.promises.utimes(sourcePath, originalStat.atime, originalStat.mtime);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: changedJob.jobId })).statusCode, 404);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: changedJob.jobId })).statusCode, 404);

    await resetVerifierFixtures();
    const missingStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer", "transcript"] });
    const missingJob = missingStart.jsonBody as ArtifactStatus;
    await processNextEpisodeArtifactPreparation({ now: startTime });
    await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailer"), "new final trailer");
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: missingJob.jobId })).statusCode, 404);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: missingJob.jobId })).statusCode, 404);

    await resetVerifierFixtures();
    const videoMissingStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer-video", "transcript"] });
    const videoMissingJob = videoMissingStart.jsonBody as ArtifactStatus;
    await processNextEpisodeArtifactPreparation({ now: startTime });
    await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo"), "final trailer video fixture");
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: videoMissingJob.jobId })).statusCode, 404);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: videoMissingJob.jobId })).statusCode, 404);

    await resetVerifierFixtures();
    await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo"), "final trailer video fixture");
    const videoChangedStart = await invokeRoute("/:episodeId/artifacts/jobs", "post", { episodeId: String(fixtureEpisodeId) }, { artifacts: ["trailer-video"] });
    const videoChangedJob = videoChangedStart.jsonBody as ArtifactStatus;
    await processNextEpisodeArtifactPreparation({ now: startTime });
    await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo"), "replaced final trailer video fixture");
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: videoChangedJob.jobId })).statusCode, 404);
    assert.equal((await invokeRoute("/:episodeId/artifacts/jobs/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: videoChangedJob.jobId })).statusCode, 404);
  } finally {
    config.auth.bypassInDev = originalBypass;
  }
};

const verifyAuthentication = async (): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = false;
  try {
    for (const [method, routePath, body] of [["post", "/:episodeId/artifacts/jobs", { artifacts: ["episode"] }], ["get", "/:episodeId/artifacts/jobs/:jobId", undefined], ["get", "/:episodeId/artifacts/jobs/:jobId/download", undefined]] as const) {
      const response = await invokeRoute(routePath, method, { episodeId: String(fixtureEpisodeId), jobId: "missing" }, body);
      assert.equal(response.statusCode, 401);
      assert.equal(response.getHeader("cache-control"), "no-store");
      assert.deepEqual(response.jsonBody, { message: "Missing Bearer token" });
    }
  } finally {
    config.auth.bypassInDev = originalBypass;
  }
};

const verifyOpenApi = (): void => {
  const spec = swaggerSpec as { paths?: Record<string, any>; components?: { schemas?: Record<string, any> } };
  const paths = spec.paths ?? {};
  const start = paths["/v1/episodes/{episodeId}/artifacts/jobs"]?.post;
  const status = paths["/v1/episodes/{episodeId}/artifacts/jobs/{jobId}"]?.get;
  const download = paths["/v1/episodes/{episodeId}/artifacts/jobs/{jobId}/download"]?.get;
  const snapshot = spec.components?.schemas?.EpisodeArtifactJobSnapshot;
  assert.ok(start && status && download);
  for (const operation of [start, status, download]) assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  assert.equal(start.requestBody.required, false);
  const requestSchema = start.requestBody.content["application/json"].schema;
  assert.equal(requestSchema.required, undefined);
  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(requestSchema.properties.artifacts.minItems, 1);
  assert.deepEqual(requestSchema.properties.artifacts.items.enum, ["episode", "trailer", "trailer-video", "transcript", "image", "image-low"]);
  assert.deepEqual(snapshot.properties.state.enum, ["pending", "processing", "completed", "failed"]);
  assert.equal(snapshot.properties.progress.minimum, 0);
  assert.equal(snapshot.properties.progress.maximum, 100);
  assert.equal(snapshot.properties.progress.type, "integer");
  assert.match(snapshot.properties.progress.description, /Archiver source bytes/i);
  assert.match(snapshot.properties.expiresAt.description, /24 hours/i);
  assert.match(snapshot.properties.error.description, /generic safe/i);
  assert.ok(snapshot.properties.error && snapshot.properties.createdAt && snapshot.properties.updatedAt && snapshot.properties.downloadUrl);
  for (const operation of [start, status, download]) assert.ok(operation.responses["400"] && operation.responses["401"] && operation.responses["404"]);
  assert.ok(start.responses["409"] || status.responses["409"] || download.responses["409"]);
  assert.equal(start.responses["202"].headers["Cache-Control"].schema.example, "no-store");
  assert.equal(status.responses["200"].headers["Cache-Control"].schema.example, "no-store");
  assert.equal(download.responses["200"].headers["Cache-Control"].schema.example, "no-store");
  assert.ok(download.responses["200"].headers["Content-Disposition"]);
  assert.ok(download.responses["200"].headers["X-Missing-Artifacts"]);
  assert.equal(download.responses["200"].content["application/zip"].schema.format, "binary");
  assertNoInternalFields({ start, status, download, snapshot });
};

export const main = async (): Promise<void> => {
  if (path.basename(__filename) !== "verify-episode-artifact-downloads.js") throw new Error("expected compiled verifier execution");
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development for artifact-download verification");
  await connectDb();
  const phase6ManualDc334Prerequisite = { episodeId: 334, status: "manual-phase-6-prerequisite", owner: "operator" } as const;
  assert.equal(phase6ManualDc334Prerequisite.episodeId, 334);
  try {
    await resetVerifierFixtures();
    await verifySelectorAndValidation();
    await verifyAuthentication();
    verifyOpenApi();
    const { completed, logs } = await verifyLifecycleAndDownload();
    await verifyPartialAndFailure();
    await verifyDuplicateRestartExpiryAndOwnership(completed);
    await verifyEvidenceInvalidation();
    assert.equal(logs.join("\n").includes(config.media.storageRoot), false);
    assert.equal(logs.join("\n").includes("cacheKey"), false);
    assert.equal(logs.join("\n").includes("archivePath"), false);
  } finally {
    resetEpisodeArtifactPreparationFailure();
    resetEpisodeArtifactPreparationStageController();
    episodeRepository.delete(fixtureEpisodeId);
    await resetDirectory(preparationRoot);
  }
  console.log("verified artifact-job routes, default-all, byte progress, 24-hour evidence invalidation, safe failures, auth, ZIP security, and OpenAPI parity");
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
