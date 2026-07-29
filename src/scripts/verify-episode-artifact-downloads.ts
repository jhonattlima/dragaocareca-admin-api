import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { connectDb } from "../database/connect";
import { episodeRepository } from "../database/repositories/episode.repository";
import { swaggerSpec } from "../docs/openapi";
import { episodesRouter } from "../routes/episodes.routes";
import {
  EpisodeArtifactSelectorValidationError,
  parseEpisodeArtifactSelectors,
  preflightEpisodeArtifactDownloads,
} from "../services/episode-artifact-download.service";
import { getEpisodeMediaFinalPath } from "../services/episode-media-layout.service";
import { config } from "../config/env";

const fixtureEpisodeId = 987654321;
const preparationRoot = path.join(config.media.storageRoot, ".artifact-preparations");

type PreparationState = "queued" | "preparing" | "ready" | "failed" | "expired";

type PreparationStatus = {
  jobId: string;
  episodeId: number;
  requested: string[];
  available: string[];
  missing: string[];
  state: PreparationState;
  progress: number;
  stateText: string;
  queuePosition: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
};

type PreparationService = {
  initializeEpisodeArtifactPreparations: (options?: { now?: Date }) => Promise<void>;
  prepareEpisodeArtifactArchive: (
    episodeId: number,
    selectedArtifacts: ReturnType<typeof parseEpisodeArtifactSelectors>,
    options?: { now?: Date }
  ) => Promise<PreparationStatus>;
  getEpisodeArtifactPreparationStatus: (
    episodeId: number,
    jobId: string,
    options?: { now?: Date }
  ) => Promise<PreparationStatus | null>;
  getValidatedEpisodeArtifactPreparationDownload: (
    episodeId: number,
    jobId: string,
    options?: { now?: Date }
  ) => Promise<{ status: PreparationStatus; stream: fs.ReadStream } | null>;
  processNextEpisodeArtifactPreparation: (options?: { now?: Date }) => Promise<PreparationStatus | null>;
};

type RouteHandler = (req: FakeRequest, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;

type FakeRequest = {
  params: { episodeId: string };
  query: { artifacts?: unknown };
  headers: { authorization?: string };
  user?: { email: string };
};

class MemoryResponse extends Writable {
  statusCode = 200;
  jsonBody: unknown;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    this.end();
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }
}

const selectors = (artifacts: unknown): string[] => parseEpisodeArtifactSelectors(artifacts).map((artifact) => artifact.selector);

const assertInvalidSelectorInput = (artifacts: unknown): void => {
  assert.throws(() => parseEpisodeArtifactSelectors(artifacts), EpisodeArtifactSelectorValidationError);
};

const verifySelectorContract = (): void => {
  assert.deepEqual(selectors(undefined), ["episode", "trailer", "transcript", "image", "image-low"]);
  assert.deepEqual(selectors("image-low,episode,episode,image"), ["episode", "image", "image-low"]);
  for (const invalidInput of ["", "episode,", ",episode", "episode,,trailer", "unknown", ["episode"], 12, null]) {
    assertInvalidSelectorInput(invalidInput);
  }
};

const createFixtures = async (): Promise<{ directory: string }> => {
  const audioPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "audio");
  const directory = path.dirname(audioPath);
  await fs.promises.rm(directory, { recursive: true, force: true });
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(audioPath, "final audio fixture");
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript"), "final transcript fixture");
  return { directory };
};

const loadPreparationService = (): PreparationService => {
  // Keep the Wave 0 RED gate runtime-only until the planned service exists.
  const modulePath = path.resolve(__dirname, "../services/episode-artifact-preparation.service");
  return require(modulePath) as PreparationService;
};

const assertPreparationStatus = (status: PreparationStatus, state: PreparationState): void => {
  assert.equal(status.state, state);
  assert.ok(Number.isInteger(status.progress));
  assert.ok(status.progress >= 0 && status.progress <= 100);
  assert.ok(status.stateText.length > 0);
  if (state === "queued") {
    assert.ok(status.queuePosition && status.queuePosition >= 1);
    assert.equal(status.downloadUrl, null);
  }
  if (state === "ready") {
    assert.equal(status.progress, 100);
    assert.equal(status.queuePosition, null);
    assert.ok(status.downloadUrl);
  }
};

const verifyPreparationLifecycle = async (): Promise<void> => {
  const preparationService = loadPreparationService();
  const start = new Date("2026-07-29T12:00:00.000Z");
  await preparationService.initializeEpisodeArtifactPreparations({ now: start });

  const normalized = parseEpisodeArtifactSelectors("transcript,episode,episode");
  const queued = await preparationService.prepareEpisodeArtifactArchive(fixtureEpisodeId, normalized, { now: start });
  assertPreparationStatus(queued, "queued");
  assert.deepEqual(queued.requested, ["episode", "transcript"]);
  const duplicate = await preparationService.prepareEpisodeArtifactArchive(
    fixtureEpisodeId,
    parseEpisodeArtifactSelectors("episode,transcript"),
    { now: start }
  );
  assert.equal(duplicate.jobId, queued.jobId);
  assertInvalidSelectorInput(["episode", "transcript"]);

  const processing = preparationService.processNextEpisodeArtifactPreparation({ now: start });
  const concurrent = preparationService.processNextEpisodeArtifactPreparation({ now: start });
  const [ready, concurrentResult] = await Promise.all([processing, concurrent]);
  assert.ok(ready);
  assert.equal(concurrentResult?.jobId, ready.jobId);
  assertPreparationStatus(ready, "ready");
  assert.deepEqual(ready.available, ["episode", "transcript"]);
  assert.deepEqual(ready.missing, []);

  const cached = await preparationService.prepareEpisodeArtifactArchive(fixtureEpisodeId, normalized, { now: start });
  assert.equal(cached.jobId, queued.jobId);
  assertPreparationStatus(cached, "ready");
  const download = await preparationService.getValidatedEpisodeArtifactPreparationDownload(fixtureEpisodeId, queued.jobId, { now: start });
  assert.ok(download);
  download.stream.destroy();

  const audioPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "audio");
  const originalStat = await fs.promises.stat(audioPath);
  await fs.promises.writeFile(audioPath, "altered final audio");
  await fs.promises.utimes(audioPath, originalStat.atime, originalStat.mtime);
  const invalidated = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, queued.jobId, { now: start });
  assert.ok(invalidated);
  assertPreparationStatus(invalidated, "expired");
  assert.equal(await preparationService.getValidatedEpisodeArtifactPreparationDownload(fixtureEpisodeId, queued.jobId, { now: start }), null);

  const missingJob = await preparationService.prepareEpisodeArtifactArchive(
    fixtureEpisodeId,
    parseEpisodeArtifactSelectors("trailer"),
    { now: start }
  );
  assertPreparationStatus(missingJob, "queued");
  const missingReady = await preparationService.processNextEpisodeArtifactPreparation({ now: start });
  assert.ok(missingReady);
  assert.deepEqual(missingReady.missing, ["trailer"]);
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailer"), "new final trailer");
  const appeared = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, missingJob.jobId, { now: start });
  assert.ok(appeared);
  assertPreparationStatus(appeared, "expired");

  const recovering = await preparationService.prepareEpisodeArtifactArchive(
    fixtureEpisodeId,
    parseEpisodeArtifactSelectors("transcript"),
    { now: start }
  );
  await fs.promises.writeFile(path.join(preparationRoot, "stale.part"), "stale output");
  const manifestPath = path.join(preparationRoot, "manifests", `${recovering.jobId}.json`);
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.state = "preparing";
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest));
  await preparationService.initializeEpisodeArtifactPreparations({ now: start });
  const recovered = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, recovering.jobId, { now: start });
  assert.ok(recovered);
  assertPreparationStatus(recovered, "queued");
  await assert.rejects(fs.promises.stat(path.join(preparationRoot, "stale.part")));

  const expired = await preparationService.getEpisodeArtifactPreparationStatus(
    fixtureEpisodeId,
    missingJob.jobId,
    { now: new Date(start.getTime() + 24 * 60 * 60 * 1000 + 1) }
  );
  assert.ok(expired);
  assertPreparationStatus(expired, "expired");
};

const createFixtureEpisode = (): void => {
  episodeRepository.delete(fixtureEpisodeId);
  episodeRepository.create({
    episodeId: fixtureEpisodeId,
    title: "Artifact verifier fixture",
    summary: "",
    pubDate: new Date("2026-01-01T00:00:00.000Z"),
    explicit: "no",
    authors: [], guests: [], tags: [], citations: [], musicCredits: [], coverCredits: [],
  });
};

const getDownloadHandlers = (): RouteHandler[] => {
  const router = episodesRouter as unknown as { stack?: Array<{ route?: { path?: string; stack?: Array<{ handle: RouteHandler }> } }> };
  const route = router.stack?.find((layer) => layer.route?.path === "/:episodeId/artifacts/download")?.route;
  if (!route?.stack || route.stack.length !== 2) throw new Error("artifact download route stack not found");
  return route.stack.map((layer) => layer.handle);
};

const invokeDownload = async (episodeId: string, artifacts?: unknown, authorization?: string): Promise<MemoryResponse> => {
  const handlers = getDownloadHandlers();
  const req: FakeRequest = { params: { episodeId }, query: artifacts === undefined ? {} : { artifacts }, headers: { authorization } };
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

const verifyPreflightContract = async (): Promise<void> => {
  const preflight = await preflightEpisodeArtifactDownloads(fixtureEpisodeId, parseEpisodeArtifactSelectors(undefined));
  assert.deepEqual(preflight.available.map((artifact) => artifact.selector), ["episode", "transcript"]);
  assert.deepEqual(preflight.missing, ["trailer", "image", "image-low"]);
};

const verifyOpenApiContract = (): void => {
  const paths = (swaggerSpec as { paths?: Record<string, any> }).paths;
  const operation = paths?.["/v1/episodes/{episodeId}/artifacts/download"]?.get;
  assert.deepEqual(operation?.security, [{ bearerAuth: [] }]);
  assert.equal(operation?.parameters?.[0]?.schema?.minimum, 1);
  assert.equal(operation?.parameters?.[1]?.schema?.type, "string");
  assert.ok(operation?.responses?.["200"]?.headers?.["X-Missing-Artifacts"]);
  assert.ok(operation?.responses?.["400"] && operation?.responses?.["401"] && operation?.responses?.["404"]);
};

const verifyRouteContract = async (): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = false;
  try {
    const unauthorized = await invokeDownload(String(fixtureEpisodeId));
    assert.equal(unauthorized.statusCode, 401);
    assert.deepEqual(unauthorized.jsonBody, { message: "Missing Bearer token" });
  } finally {
    config.auth.bypassInDev = originalBypass;
  }

  const invalid = await invokeDownload(String(fixtureEpisodeId), "episode,,trailer");
  assert.equal(invalid.statusCode, 400);
  const absent = await invokeDownload("987654322");
  assert.equal(absent.statusCode, 404);
  assert.deepEqual(absent.jsonBody, { message: "Episode not found" });
  const partial = await invokeDownload(String(fixtureEpisodeId));
  assert.equal(partial.statusCode, 200);
  assert.equal(partial.getHeader("content-type"), "application/zip");
  assert.equal(partial.getHeader("content-disposition"), `attachment; filename="episode-${fixtureEpisodeId}-artifacts.zip"`);
  assert.equal(partial.getHeader("x-missing-artifacts"), "trailer,image,image-low");
  assert.deepEqual(readZipEntryNames(Buffer.concat(partial.chunks)), [
    `episode-${fixtureEpisodeId}/audio.mp3`,
    `episode-${fixtureEpisodeId}/transcript.txt`,
  ]);
  const oneFile = await invokeDownload(String(fixtureEpisodeId), "transcript");
  assert.deepEqual(readZipEntryNames(Buffer.concat(oneFile.chunks)), [`episode-${fixtureEpisodeId}/transcript.txt`]);
  await fs.promises.rm(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio"));
  await fs.promises.rm(getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript"));
  const none = await invokeDownload(String(fixtureEpisodeId));
  assert.equal(none.statusCode, 404);
  assert.deepEqual(none.jsonBody, { message: "No requested artifacts found" });
};

export const main = async (): Promise<void> => {
  if (path.basename(__filename) !== "verify-episode-artifact-downloads.js") throw new Error("expected compiled verifier execution");
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development for artifact-download verification");
  await connectDb();
  const { directory } = await createFixtures();
  createFixtureEpisode();
  try {
    verifySelectorContract();
    await verifyPreflightContract();
    verifyOpenApiContract();
    await verifyRouteContract();
    await verifyPreparationLifecycle();
  } finally {
    episodeRepository.delete(fixtureEpisodeId);
    await fs.promises.rm(directory, { recursive: true, force: true });
    await fs.promises.rm(preparationRoot, { recursive: true, force: true });
  }
  console.log("verified episode artifact download route and OpenAPI contract");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
