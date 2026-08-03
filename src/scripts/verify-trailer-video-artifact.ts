import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { connectDb } from "../database/connect";
import { getDb } from "../database/sqlite";
import { episodeRepository } from "../database/repositories/episode.repository";
import { config } from "../config/env";
import { swaggerSpec } from "../docs/openapi";
import { getEpisodeMediaFinalPath } from "../services/episode-media-layout.service";
import { prepareEpisodeArtifactArchive, processNextEpisodeArtifactPreparation } from "../services/episode-artifact-preparation.service";

const fixtureEpisodeId = 987654322;
const preparationRoot = path.join(config.media.storageRoot, ".artifact-preparations");

class MultipartRequest extends Readable {
  params: { episodeId: string };
  body: Record<string, unknown> = {};
  user?: { email: string };
  headers: Record<string, string>;

  constructor(episodeId: number, bytes: Buffer, originalName: string, mimetype: string) {
    const boundary = "----trailer-video-verifier-boundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"${originalName}\"\r\nContent-Type: ${mimetype}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    super();
    this.params = { episodeId: String(episodeId) };
    this.headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(payload.length),
    };
    this.push(payload);
    this.push(null);
  }
}

class MemoryResponse extends Writable {
  statusCode = 200;
  jsonBody: unknown;
  readonly headers = new Map<string, string>();

  _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }

  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
  setHeader(name: string, value: string): void { this.headers.set(name.toLowerCase(), String(value)); }
  getHeader(name: string): string | undefined { return this.headers.get(name.toLowerCase()); }
}

type RouteHandler = (req: MultipartRequest, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type EpisodesRouter = { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } }> };

let episodesRouter: EpisodesRouter | undefined;

const loadEpisodesRouter = (): EpisodesRouter => {
  const modulePath = require.resolve("../routes/episodes.routes");
  delete require.cache[modulePath];
  return (require("../routes/episodes.routes") as { episodesRouter: EpisodesRouter }).episodesRouter;
};

const getUploadHandlers = (): RouteHandler[] => {
  const router = episodesRouter ?? (episodesRouter = loadEpisodesRouter());
  const route = router.stack?.find((layer) => layer.route?.path === "/:episodeId/trailer-video" && layer.route.methods?.post)?.route;
  if (!route?.stack) throw new Error("trailer-video route stack not found");
  return route.stack.map((layer) => layer.handle);
};

const invokeUpload = async (bytes: Buffer, originalName: string, mimetype: string): Promise<{ response: MemoryResponse; error?: unknown }> => {
  const req = new MultipartRequest(fixtureEpisodeId, bytes, originalName, mimetype);
  const res = new MemoryResponse();
  const handlers = getUploadHandlers();
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { resolve({ response: res, error }); return; }
      const handler = handlers[index++];
      if (!handler) { resolve({ response: res }); return; }
      Promise.resolve(handler(req, res, next)).catch(reject);
    };
    res.once("finish", () => resolve({ response: res }));
    res.once("error", reject);
    next();
  });
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

const resetFixtures = async (): Promise<void> => {
  episodeRepository.delete(fixtureEpisodeId);
  await fs.promises.rm(path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo")), { recursive: true, force: true });
  await fs.promises.rm(preparationRoot, { recursive: true, force: true });
  episodeRepository.create({
    episodeId: fixtureEpisodeId,
    title: "Trailer video verifier fixture",
    summary: "",
    pubDate: new Date("2026-01-01T00:00:00.000Z"),
    explicit: "no",
    authors: [], guests: [], tags: [], citations: [], musicCredits: [], coverCredits: [],
  });
};

const verifyUploadBoundary = async (): Promise<void> => {
  const finalPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo");
  const originalBypass = config.auth.bypassInDev;
  const originalLimit = config.media.trailerVideoMaxBytes;
  const originalInfo = console.info;
  const originalError = console.error;
  const logs: string[] = [];
  console.info = (...args: unknown[]): void => { logs.push(JSON.stringify(args)); };
  console.error = (...args: unknown[]): void => { logs.push(JSON.stringify(args)); };
  try {
    config.auth.bypassInDev = false;
    const unauthenticated = await invokeUpload(Buffer.from("first MP4"), "trailer.mp4", "video/mp4");
    assert.equal(unauthenticated.error, undefined);
    assert.equal(unauthenticated.response.statusCode, 401);
    assert.deepEqual(unauthenticated.response.jsonBody, { message: "Missing Bearer token" });
    assert.equal(await fs.promises.lstat(finalPath).then(() => true).catch(() => false), false);

    config.auth.bypassInDev = true;
    config.media.trailerVideoMaxBytes = 1024;
    const first = await invokeUpload(Buffer.from("first MP4"), "trailer.mp4", "video/mp4");
    assert.equal(first.error, undefined);
    assert.equal(first.response.statusCode, 200);
    assert.equal((first.response.jsonBody as { trailerVideoFileName?: unknown }).trailerVideoFileName, `episodes/${fixtureEpisodeId}/trailer.mp4`);
    assert.equal((first.response.jsonBody as { trailerVideoSyncStatus?: unknown }).trailerVideoSyncStatus, "unpublished");
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), "first MP4");

    const replacement = await invokeUpload(Buffer.from("second MP4"), "replacement.mp4", "video/mp4");
    assert.equal(replacement.error, undefined);
    assert.equal((replacement.response.jsonBody as { trailerVideoSyncStatus?: unknown }).trailerVideoSyncStatus, "manual-sync-required");
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), "second MP4");

    getDb().prepare("UPDATE episodes SET youtube = ? WHERE episode_id = ?").run("https://youtube.example/video", fixtureEpisodeId);
    const publishedReplacement = await invokeUpload(Buffer.from("third MP4"), "published-replacement.mp4", "video/mp4");
    const published = publishedReplacement.response.jsonBody as { youtube?: unknown; trailerVideoSyncStatus?: unknown };
    assert.equal(publishedReplacement.error, undefined);
    assert.equal(published.youtube, "https://youtube.example/video");
    assert.equal(published.trailerVideoSyncStatus, "manual-sync-required");
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), "third MP4");

    const finalBeforeInvalid = await fs.promises.readFile(finalPath, "utf8");
    const nonMp4 = await invokeUpload(Buffer.from("not an MP4"), "trailer.txt", "text/plain");
    assert.ok(nonMp4.error instanceof Error);
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), finalBeforeInvalid);

    config.media.trailerVideoMaxBytes = 3;
    episodesRouter = loadEpisodesRouter();
    const tooLarge = await invokeUpload(Buffer.from("four bytes"), "oversized.mp4", "video/mp4");
    assert.ok(tooLarge.error instanceof Error);
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), finalBeforeInvalid);
    assert.equal(logs.join("\n").includes(config.media.storageRoot), false);
    assert.equal(logs.join("\n").includes(finalPath), false);
  } finally {
    config.auth.bypassInDev = originalBypass;
    config.media.trailerVideoMaxBytes = originalLimit;
    console.info = originalInfo;
    console.error = originalError;
  }
};

const verifyTrailerVideoZip = async (): Promise<void> => {
  const originalBypass = config.auth.bypassInDev;
  try {
    config.auth.bypassInDev = true;
    const job = await prepareEpisodeArtifactArchive(fixtureEpisodeId, [{ selector: "trailer-video", kind: "trailerVideo", fileName: "trailer.mp4" }]);
    const completed = await processNextEpisodeArtifactPreparation({ now: new Date() });
    assert.equal(completed?.state, "completed");
    const archivePath = path.join(preparationRoot, "archives", `episode-${job.jobId}-artifacts.zip`);
    assert.deepEqual(readZipEntryNames(await fs.promises.readFile(archivePath)), [`episode-${fixtureEpisodeId}/trailer.mp4`]);
  } finally {
    config.auth.bypassInDev = originalBypass;
  }
};

const verifyOpenApiContract = (): void => {
  const spec = swaggerSpec as { paths?: Record<string, any>; components?: { schemas?: Record<string, any> } };
  const upload = spec.paths?.["/v1/episodes/{episodeId}/trailer-video"]?.post;
  const jobs = spec.paths?.["/v1/episodes/{episodeId}/artifacts/jobs"]?.post;
  const episode = spec.components?.schemas?.Episode;
  assert.ok(upload && jobs && episode);
  assert.deepEqual(upload.security, [{ bearerAuth: [] }]);
  assert.equal(upload.requestBody.required, true);
  assert.equal(upload.requestBody.content["multipart/form-data"].schema.properties.file.format, "binary");
  assert.match(upload.description, /MP4/i);
  assert.match(upload.description, /524288000/);
  assert.match(upload.description, /never accepts client paths/i);
  assert.ok(upload.responses["400"] && upload.responses["401"] && upload.responses["404"]);
  assert.deepEqual(episode.properties.trailerVideoSyncStatus.enum, ["unpublished", "manual-sync-required", "synced"]);
  assert.match(jobs.requestBody.content["application/json"].schema.properties.artifacts.description, /trailer\.mp4/i);
};

const main = async (): Promise<void> => {
  if (path.basename(__filename) !== "verify-trailer-video-artifact.js") throw new Error("expected compiled verifier execution");
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development for trailer-video verification");
  await connectDb();
  try {
    await resetFixtures();
    await verifyUploadBoundary();
    await verifyTrailerVideoZip();
    verifyOpenApiContract();
  } finally {
    episodeRepository.delete(fixtureEpisodeId);
    await fs.promises.rm(path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo")), { recursive: true, force: true });
    await fs.promises.rm(preparationRoot, { recursive: true, force: true });
  }
  console.log("verified protected trailer-video MP4 upload, replacement sync state, rejection boundaries, and canonical ZIP artifact");
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
