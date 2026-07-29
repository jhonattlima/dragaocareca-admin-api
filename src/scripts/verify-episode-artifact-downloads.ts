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

type OpenApiStringSchema = {
  type?: unknown;
  pattern?: unknown;
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
  params: { episodeId: string; jobId?: string };
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

const schemaAcceptsString = (schema: OpenApiStringSchema | undefined, value: string): boolean =>
  schema?.type === "string" && typeof schema.pattern === "string" && new RegExp(schema.pattern).test(value);

const assertNoInternalFields = (value: unknown): void => {
  const forbidden = new Set(["path", "manifest", "fingerprint", "cacheKey", "archiveFileName", "storageRoot", "errorCode"]);
  if (Array.isArray(value)) {
    value.forEach(assertNoInternalFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `unexpected internal field: ${key}`);
    assertNoInternalFields(child);
  }
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

const readStreamBytes = async (stream: fs.ReadStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
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
  assert.deepEqual(readZipEntryNames(await readStreamBytes(download.stream)), [
    `episode-${fixtureEpisodeId}/audio.mp3`,
    `episode-${fixtureEpisodeId}/transcript.txt`,
  ]);

  const audioPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "audio");
  const originalStat = await fs.promises.stat(audioPath);
  await fs.promises.writeFile(audioPath, "altered final audio");
  await fs.promises.utimes(audioPath, originalStat.atime, originalStat.mtime);
  const invalidated = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, queued.jobId, { now: start });
  assert.ok(invalidated);
  assertPreparationStatus(invalidated, "expired");
  assert.equal(await preparationService.getValidatedEpisodeArtifactPreparationDownload(fixtureEpisodeId, queued.jobId, { now: start }), null);

  const retried = await Promise.all(Array.from({ length: 4 }, () =>
    preparationService.prepareEpisodeArtifactArchive(
      fixtureEpisodeId,
      parseEpisodeArtifactSelectors("transcript,episode,episode"),
      { now: start }
    )
  ));
  const retryJobIds = new Set(retried.map((status) => status.jobId));
  assert.equal(retryJobIds.size, 1);
  for (const retry of retried) assert.ok(retry.state === "queued" || retry.state === "preparing");
  assert.equal(retryJobIds.has(queued.jobId), false);
  const cacheKey = `${fixtureEpisodeId}:episode,transcript`;
  const matchingManifests = await Promise.all(
    (await fs.promises.readdir(path.join(preparationRoot, "manifests")))
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => JSON.parse(await fs.promises.readFile(path.join(preparationRoot, "manifests", fileName), "utf8")) as {
        cacheKey: string;
        state: PreparationState;
      })
  );
  const cacheHistory = matchingManifests.filter((manifest) => manifest.cacheKey === cacheKey);
  assert.equal(cacheHistory.filter((manifest) => manifest.state === "expired").length, 1);
  assert.equal(cacheHistory.filter((manifest) => manifest.state === "queued" || manifest.state === "preparing").length, 1);
  const retriedReady = await preparationService.processNextEpisodeArtifactPreparation({ now: start });
  assert.ok(retriedReady);
  assertPreparationStatus(retriedReady, "ready");

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
  const interrupted = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, recovering.jobId, { now: start });
  assert.ok(interrupted);
  assertPreparationStatus(interrupted, "preparing");
  await preparationService.initializeEpisodeArtifactPreparations({ now: start });
  const recovered = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, recovering.jobId, { now: start });
  assert.ok(recovered);
  assertPreparationStatus(recovered, "queued");
  await assert.rejects(fs.promises.stat(path.join(preparationRoot, "stale.part")));

  manifest.state = "failed";
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest));
  const failed = await preparationService.getEpisodeArtifactPreparationStatus(fixtureEpisodeId, recovering.jobId, { now: start });
  assert.ok(failed);
  assertPreparationStatus(failed, "failed");

  const expiring = await preparationService.prepareEpisodeArtifactArchive(
    fixtureEpisodeId,
    parseEpisodeArtifactSelectors("image"),
    { now: start }
  );
  assertPreparationStatus(expiring, "queued");
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "cover"), "final cover fixture");
  const expiringReady = await preparationService.processNextEpisodeArtifactPreparation({ now: start });
  assert.ok(expiringReady);
  assertPreparationStatus(expiringReady, "ready");

  const expired = await preparationService.getEpisodeArtifactPreparationStatus(
    fixtureEpisodeId,
    expiring.jobId,
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

const getRouteHandlers = (path: string, method: "get" | "post"): RouteHandler[] => {
  const router = episodesRouter as unknown as {
    stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } }>;
  };
  const route = router.stack?.find((layer) => layer.route?.path === path && layer.route.methods?.[method])?.route;
  if (!route?.stack || route.stack.length < 2) throw new Error(`artifact route stack not found: ${method} ${path}`);
  return route.stack.map((layer) => layer.handle);
};

const invokeRoute = async (
  path: string,
  method: "get" | "post",
  params: FakeRequest["params"],
  artifacts?: unknown,
  authorization?: string
): Promise<MemoryResponse> => {
  const handlers = getRouteHandlers(path, method);
  const req: FakeRequest = { params, query: artifacts === undefined ? {} : { artifacts }, headers: { authorization } };
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
  const prepare = paths?.["/v1/episodes/{episodeId}/artifacts/prepare"]?.post;
  const status = paths?.["/v1/episodes/{episodeId}/artifacts/preparations/{jobId}"]?.get;
  const download = paths?.["/v1/episodes/{episodeId}/artifacts/preparations/{jobId}/download"]?.get;
  const legacy = paths?.["/v1/episodes/{episodeId}/artifacts/download"]?.get;
  const statusSchema = (swaggerSpec as { components?: { schemas?: Record<string, any> } }).components?.schemas?.EpisodeArtifactPreparationStatus;
  const artifactsSchema = prepare?.parameters?.find((parameter: { name?: string; in?: string }) =>
    parameter.name === "artifacts" && parameter.in === "query"
  )?.schema as OpenApiStringSchema | undefined;
  const representativeCsv = "episode,transcript";
  const outsideSelector = "outside";

  for (const operation of [prepare, status, download, legacy]) assert.deepEqual(operation?.security, [{ bearerAuth: [] }]);
  assert.equal(prepare?.parameters?.[0]?.schema?.minimum, 1);
  assert.deepEqual(selectors(representativeCsv), ["episode", "transcript"]);
  assert.equal(schemaAcceptsString(artifactsSchema, representativeCsv), true);
  assertInvalidSelectorInput(outsideSelector);
  assert.equal(schemaAcceptsString(artifactsSchema, outsideSelector), false);
  assert.ok(prepare?.responses?.["200"] && prepare?.responses?.["202"] && prepare?.responses?.["400"] && prepare?.responses?.["401"] && prepare?.responses?.["404"]);
  assert.equal(prepare?.responses?.["202"]?.headers?.["Cache-Control"]?.schema?.example, "no-store");
  assert.equal(status?.responses?.["200"]?.headers?.["Cache-Control"]?.schema?.example, "no-store");
  assert.ok(status?.responses?.["400"] && status?.responses?.["401"] && status?.responses?.["404"]);
  assert.equal(download?.responses?.["200"]?.headers?.["Cache-Control"]?.schema?.example, "no-store");
  assert.ok(download?.responses?.["200"]?.headers?.["X-Missing-Artifacts"]);
  assert.ok(download?.responses?.["400"] && download?.responses?.["401"] && download?.responses?.["404"] && download?.responses?.["409"] && download?.responses?.["410"]);
  assert.equal(legacy?.deprecated, true);
  assert.equal(legacy?.responses?.["410"]?.headers?.["Cache-Control"]?.schema?.example, "no-store");
  assert.match(JSON.stringify(legacy?.responses?.["410"]), /POST \/v1\/episodes\/:episodeId\/artifacts\/prepare/);
  assert.deepEqual(Object.keys(statusSchema?.properties ?? {}).sort(), ["available", "downloadUrl", "episodeId", "expiresAt", "jobId", "missing", "progress", "queuePosition", "requested", "state", "stateText"]);
  assertNoInternalFields({ prepare, status, download, legacy, statusSchema });
};

const verifyRouteContract = async (): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  config.auth.bypassInDev = false;
  try {
    for (const [path, method, params] of [
      ["/:episodeId/artifacts/prepare", "post", { episodeId: String(fixtureEpisodeId) }],
      ["/:episodeId/artifacts/preparations/:jobId", "get", { episodeId: String(fixtureEpisodeId), jobId: "missing" }],
      ["/:episodeId/artifacts/preparations/:jobId/download", "get", { episodeId: String(fixtureEpisodeId), jobId: "missing" }],
      ["/:episodeId/artifacts/download", "get", { episodeId: String(fixtureEpisodeId) }],
    ] as const) {
      const unauthorized = await invokeRoute(path, method, params);
      assert.equal(unauthorized.statusCode, 401);
      assert.deepEqual(unauthorized.jsonBody, { message: "Missing Bearer token" });
      assert.equal(unauthorized.getHeader("cache-control"), "no-store");
    }
  } finally {
    config.auth.bypassInDev = originalBypass;
  }

  const capturedLogs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]): void => { capturedLogs.push(JSON.stringify(args)); };
  console.error = (...args: unknown[]): void => { capturedLogs.push(JSON.stringify(args)); };
  config.auth.bypassInDev = true;
  try {
  const invalid = await invokeRoute("/:episodeId/artifacts/prepare", "post", { episodeId: String(fixtureEpisodeId) }, "episode,,trailer");
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.getHeader("cache-control"), "no-store");
  const absent = await invokeRoute("/:episodeId/artifacts/prepare", "post", { episodeId: "987654322" });
  assert.equal(absent.statusCode, 404);
  assert.deepEqual(absent.jsonBody, { message: "Episode not found" });
  assert.equal(absent.getHeader("cache-control"), "no-store");
  const prepared = await invokeRoute("/:episodeId/artifacts/prepare", "post", { episodeId: String(fixtureEpisodeId) }, "episode,transcript");
  assert.equal(prepared.statusCode, 202);
  assert.equal(prepared.getHeader("cache-control"), "no-store");
  const queued = prepared.jsonBody as PreparationStatus;
  assertPreparationStatus(queued, "queued");
  assert.deepEqual(queued.requested, ["episode", "transcript"]);
  const queuedAgain = await invokeRoute("/:episodeId/artifacts/prepare", "post", { episodeId: String(fixtureEpisodeId) }, "episode");
  assert.equal(queuedAgain.statusCode, 202);
  const secondQueued = queuedAgain.jsonBody as PreparationStatus;
  assertPreparationStatus(secondQueued, "queued");
  assert.equal(secondQueued.queuePosition, 2);

  const queuedStatus = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  assert.equal(queuedStatus.statusCode, 200);
  assert.equal(queuedStatus.getHeader("cache-control"), "no-store");
  assertPreparationStatus(queuedStatus.jsonBody as PreparationStatus, "queued");

  const manifestPath = path.join(preparationRoot, "manifests", `${queued.jobId}.json`);
  const queuedManifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await fs.promises.writeFile(manifestPath, JSON.stringify({ ...queuedManifest, state: "preparing", progress: 42, stateText: "Preparing archive" }));
  const preparingStatus = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  const preparing = preparingStatus.jsonBody as PreparationStatus;
  assertPreparationStatus(preparing, "preparing");
  assert.equal(preparing.progress, 42);
  assert.equal(preparing.stateText, "Preparing archive");
  assert.equal(preparing.queuePosition, null);
  assert.equal(preparing.downloadUrl, null);
  await fs.promises.writeFile(manifestPath, JSON.stringify(queuedManifest));

  const notReady = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId/download",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  assert.equal(notReady.statusCode, 409);
  assert.deepEqual(notReady.jsonBody, { message: "Artifact archive is not ready" });
  assert.equal(notReady.getHeader("cache-control"), "no-store");

  const preparationService = loadPreparationService();
  await preparationService.processNextEpisodeArtifactPreparation();
  const readyStatus = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  assertPreparationStatus(readyStatus.jsonBody as PreparationStatus, "ready");
  assert.equal(readyStatus.getHeader("cache-control"), "no-store");

  const download = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId/download",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  assert.equal(download.statusCode, 200);
  assert.equal(download.getHeader("cache-control"), "no-store");
  assert.equal(download.getHeader("content-type"), "application/zip");
  assert.deepEqual(readZipEntryNames(Buffer.concat(download.chunks)), [
    `episode-${fixtureEpisodeId}/audio.mp3`,
    `episode-${fixtureEpisodeId}/transcript.txt`,
  ]);
  await preparationService.processNextEpisodeArtifactPreparation();

  const readyAgain = await invokeRoute("/:episodeId/artifacts/prepare", "post", { episodeId: String(fixtureEpisodeId) }, "episode,transcript");
  assert.equal(readyAgain.statusCode, 200);
  assert.equal((readyAgain.jsonBody as PreparationStatus).jobId, queued.jobId);

  const audioPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript");
  const originalStat = await fs.promises.stat(audioPath);
  await fs.promises.writeFile(audioPath, "altered transcript!".padEnd(originalStat.size, "!"));
  await fs.promises.utimes(audioPath, originalStat.atime, originalStat.mtime);
  const invalidatedStatus = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  assert.equal((invalidatedStatus.jsonBody as PreparationStatus).state, "expired");
  assert.equal(invalidatedStatus.getHeader("cache-control"), "no-store");
  const invalidatedDownload = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId/download",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: queued.jobId }
  );
  assert.equal(invalidatedDownload.statusCode, 410);
  assert.equal(invalidatedDownload.getHeader("cache-control"), "no-store");

  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript"), "final transcript fixture");
  const partialPrepared = await invokeRoute("/:episodeId/artifacts/prepare", "post", { episodeId: String(fixtureEpisodeId) }, "trailer,transcript");
  const partial = partialPrepared.jsonBody as PreparationStatus;
  await preparationService.processNextEpisodeArtifactPreparation();
  const partialDownload = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId/download",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: partial.jobId }
  );
  assert.equal(partialDownload.statusCode, 200);
  assert.equal(partialDownload.getHeader("x-missing-artifacts"), "trailer");
  assert.deepEqual(readZipEntryNames(Buffer.concat(partialDownload.chunks)), [`episode-${fixtureEpisodeId}/transcript.txt`]);
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailer"), "new final trailer");
  const appearedStatus = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: partial.jobId }
  );
  assert.equal((appearedStatus.jsonBody as PreparationStatus).state, "expired");
  const appearedDownload = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId/download",
    "get",
    { episodeId: String(fixtureEpisodeId), jobId: partial.jobId }
  );
  assert.equal(appearedDownload.statusCode, 410);

  const mismatched = await invokeRoute(
    "/:episodeId/artifacts/preparations/:jobId",
    "get",
    { episodeId: "987654322", jobId: queued.jobId }
  );
  assert.equal(mismatched.statusCode, 404);
  assert.equal(mismatched.getHeader("cache-control"), "no-store");

  const migration = await invokeRoute("/:episodeId/artifacts/download", "get", { episodeId: String(fixtureEpisodeId) });
  assert.equal(migration.statusCode, 410);
  assert.equal(migration.getHeader("cache-control"), "no-store");
  assert.deepEqual(migration.jsonBody, {
    message: "Artifact downloads now require preparation",
    prepareEndpoint: "POST /v1/episodes/:episodeId/artifacts/prepare",
  });
  const captured = JSON.stringify([prepared.jsonBody, queuedStatus.jsonBody, preparingStatus.jsonBody, readyStatus.jsonBody, invalidatedStatus.jsonBody, partialDownload.jsonBody, appearedStatus.jsonBody, mismatched.jsonBody, migration.jsonBody]);
  assert.equal(captured.includes(config.media.storageRoot), false);
  assert.equal(capturedLogs.join("\n").includes(config.media.storageRoot), false);
  } finally {
    config.auth.bypassInDev = originalBypass;
    console.info = originalInfo;
    console.error = originalError;
  }
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
    await fs.promises.rm(preparationRoot, { recursive: true, force: true });
    await createFixtures();
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
