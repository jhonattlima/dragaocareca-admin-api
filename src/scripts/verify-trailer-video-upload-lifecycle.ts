import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { connectDb } from "../database/connect";
import { getDb } from "../database/sqlite";
import { episodeRepository } from "../database/repositories/episode.repository";
import { config } from "../config/env";
import { cleanupExpiredTrailerVideoDrafts, checkTrailerVideoDraft, reserveTrailerVideoDraft } from "../services/episode-draft-reservation.service";
import { replaceEpisodeTrailerVideo } from "../services/episode-trailer-video.service";
import { getEpisodeMediaFinalPath, getEpisodeMediaStagingDirectory, getEpisodeMediaStagingPath } from "../services/episode-media-layout.service";

const fixtureEpisodeId = 987654391;
const replacementEpisodeId = fixtureEpisodeId + 1;
const consumeFailureEpisodeId = fixtureEpisodeId + 4;
const createFailureEpisodeId = fixtureEpisodeId + 5;
const promotionFailureEpisodeId = fixtureEpisodeId + 6;
const postCreateFailureEpisodeId = fixtureEpisodeId + 7;
const owner = "dev-bypass@local";

class MultipartRequest extends Readable {
  params: { episodeId: string };
  body: Record<string, unknown> = {};
  headers: Record<string, string>;

  constructor(episodeId: number, bytes?: Buffer, originalName = "trailer.mp4", mimetype = "video/mp4", draftId?: string) {
    super();
    this.params = { episodeId: String(episodeId) };
    const boundary = "----trailer-video-lifecycle-boundary";
    this.headers = {
      "content-type": bytes ? `multipart/form-data; boundary=${boundary}` : "application/json",
      ...(draftId ? { "x-episode-draft-id": draftId } : {}),
    };
    if (bytes) {
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${originalName}"\r\nContent-Type: ${mimetype}\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      this.headers["content-length"] = String(payload.length);
      this.push(payload);
      this.push(null);
    }
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

const loadRouter = (): { stack?: Layer[] } => {
  const modulePath = require.resolve("../routes/episodes.routes");
  delete require.cache[modulePath];
  return (require("../routes/episodes.routes") as { episodesRouter: { stack?: Layer[] } }).episodesRouter;
};

const invoke = async (router: { stack?: Layer[] }, routePath: string, req: any): Promise<{ response: MemoryResponse; error?: unknown }> => {
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

const jsonRequest = (body: Record<string, unknown>): any => ({ body, headers: { "content-type": "application/json" }, params: {}, user: undefined });

const seedEpisode = (episodeId: number): void => {
  episodeRepository.delete(episodeId);
  episodeRepository.create({
    episodeId,
    title: "Trailer lifecycle fixture",
    summary: "",
    pubDate: new Date("2026-01-01T00:00:00.000Z"),
    explicit: "no",
    authors: [], guests: [], tags: [], citations: [], musicCredits: [], coverCredits: [],
  });
};

const exists = async (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true).catch(() => false);

const episodeCreateBody = (episodeId: number, draftId?: string): Record<string, unknown> => ({
  episodeId,
  ...(draftId ? { draftId } : {}),
  title: "Created trailer fixture",
  summary: "",
  pubDate: "2026-01-01T00:00:00.000Z",
  explicit: "no",
  authors: [],
  guests: [],
  tags: [],
  citations: [],
  musicCredits: [],
  coverCredits: [],
});

const stageTrailerDraft = async (router: { stack?: Layer[] }, episodeId: number, bytes: string) => {
  const reservation = await reserveTrailerVideoDraft(episodeId, owner);
  const staged = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(episodeId, Buffer.from(bytes), "x.mp4", "video/mp4", reservation.draftId));
  assert.equal(staged.response.statusCode, 200);
  return reservation;
};

const assertCreateCompensated = async (episodeId: number, draftId: string, expectedDraftState: "reserved" | "staged") => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  assert.ok(!episode || episode.isDraft, "failed create must not leave a published episode row");
  assert.equal(await exists(getEpisodeMediaFinalPath(episodeId, "trailerVideo")), false);
  assert.equal(episodeRepository.findTrailerVideoDraft(draftId)?.state, expectedDraftState);
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");
  await connectDb();
  const router = loadRouter();
  try {
    episodeRepository.delete(fixtureEpisodeId);
    episodeRepository.delete(replacementEpisodeId);
    getDb().prepare("DELETE FROM episode_trailer_video_drafts WHERE episode_id IN (?, ?)").run(fixtureEpisodeId, replacementEpisodeId);
    await fs.promises.rm(getEpisodeMediaStagingDirectory(fixtureEpisodeId), { recursive: true, force: true });
    await fs.promises.rm(getEpisodeMediaStagingDirectory(replacementEpisodeId), { recursive: true, force: true });
    await fs.promises.rm(path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo")), { recursive: true, force: true });

    config.auth.bypassInDev = false;
    const unauthorized = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(fixtureEpisodeId, Buffer.from("x"), "x.mp4"));
    assert.equal(unauthorized.response.statusCode, 401);
    config.auth.bypassInDev = true;

    const invalid = await invoke(router, "/drafts", jsonRequest({ episodeId: 0 }));
    assert.equal(invalid.response.statusCode, 400);
    const reservation = await reserveTrailerVideoDraft(fixtureEpisodeId, owner);
    assert.match(reservation.draftId, /^[0-9a-f-]{36}$/);
    assert.equal("ownerEmail" in reservation, false);
    const wrongOwner = checkTrailerVideoDraft(reservation.draftId, fixtureEpisodeId, "other@example.com");
    assert.equal(wrongOwner.ok, false);
    if (!wrongOwner.ok) assert.equal(wrongOwner.status, 403);

    const arbitrary = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(fixtureEpisodeId, Buffer.from("x"), "x.mp4", "video/mp4", "not-reserved"));
    assert.equal(arbitrary.response.statusCode, 409);
    const wrongType = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(fixtureEpisodeId, Buffer.from("x"), "x.txt", "text/plain", reservation.draftId));
    assert.ok(wrongType.error || wrongType.response.statusCode >= 400);
    config.media.trailerVideoMaxBytes = 2;
    const tooLarge = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(fixtureEpisodeId, Buffer.alloc(2048, "x"), "x.mp4", "video/mp4", reservation.draftId));
    assert.ok(tooLarge.error || tooLarge.response.statusCode >= 400);
    config.media.trailerVideoMaxBytes = 1024;

    const staged = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(fixtureEpisodeId, Buffer.from("draft-bytes"), "x.mp4", "video/mp4", reservation.draftId));
    assert.equal(staged.response.statusCode, 200);
    assert.deepEqual(staged.response.jsonBody, {
      episodeId: fixtureEpisodeId,
      draftId: reservation.draftId,
      state: "staged",
      trailerVideoFileName: null,
      message: "Trailer video staged; save the episode to finalize it.",
    });
    assert.equal(await fs.promises.readFile(getEpisodeMediaStagingPath(fixtureEpisodeId, "trailerVideo"), "utf8"), "draft-bytes");

    const noVideoEpisodeId = fixtureEpisodeId + 2;
    const noVideo = await invoke(router, "/", { body: { ...episodeCreateBody(noVideoEpisodeId), title: "Created without trailer video" }, headers: {}, params: {} });
    assert.equal(noVideo.response.statusCode, 201);
    assert.equal((noVideo.response.jsonBody as any).episodeId, noVideoEpisodeId);
    assert.equal((noVideo.response.jsonBody as any).trailerVideoFileName, undefined);
    episodeRepository.delete(noVideoEpisodeId);

    const created = await invoke(router, "/", { body: episodeCreateBody(fixtureEpisodeId, reservation.draftId), headers: {}, params: {} });
    assert.equal(created.response.statusCode, 201);
    assert.equal((created.response.jsonBody as any).state, "finalized");
    assert.equal((created.response.jsonBody as any).trailerVideoFileName, `episodes/${fixtureEpisodeId}/trailer.mp4`);
    assert.equal(await fs.promises.readFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo"), "utf8"), "draft-bytes");
    assert.equal(episodeRepository.findTrailerVideoDraft(reservation.draftId)?.state, "consumed");
    assert.equal(await exists(getEpisodeMediaStagingPath(fixtureEpisodeId, "trailerVideo")), false);

    // D-03: consumption is part of the create unit. A failed consume must not publish
    // the newly-created episode or its staged media as canonical final state.
    const consumeFailureReservation = await stageTrailerDraft(router, consumeFailureEpisodeId, "consume-failure");
    const originalConsumeDraft = episodeRepository.consumeTrailerVideoDraft;
    (episodeRepository as any).consumeTrailerVideoDraft = (): boolean => false;
    const consumeFailure = await invoke(router, "/", { body: episodeCreateBody(consumeFailureEpisodeId, consumeFailureReservation.draftId), headers: {}, params: {} });
    (episodeRepository as any).consumeTrailerVideoDraft = originalConsumeDraft;
    assert.ok(consumeFailure.error, "D-03 consume failure must surface through the route error boundary");
    await assertCreateCompensated(consumeFailureEpisodeId, consumeFailureReservation.draftId, "reserved");

    // D-02/D-03: create, canonical promotion, and post-create work all compensate
    // the new row/final file and retain a safe retry boundary.
    const createFailureReservation = await stageTrailerDraft(router, createFailureEpisodeId, "create-failure");
    const originalCreate = episodeRepository.create;
    (episodeRepository as any).create = (): never => { throw new Error("injected create failure"); };
    const createFailure = await invoke(router, "/", { body: episodeCreateBody(createFailureEpisodeId, createFailureReservation.draftId), headers: {}, params: {} });
    (episodeRepository as any).create = originalCreate;
    assert.ok(createFailure.error, "D-03 create failure must surface through the route error boundary");
    await assertCreateCompensated(createFailureEpisodeId, createFailureReservation.draftId, "reserved");

    const promotionFailureReservation = await stageTrailerDraft(router, promotionFailureEpisodeId, "promotion-failure");
    const originalUpdateMedia = episodeRepository.updateMedia;
    (episodeRepository as any).updateMedia = (): null => null;
    const promotionFailure = await invoke(router, "/", { body: episodeCreateBody(promotionFailureEpisodeId, promotionFailureReservation.draftId), headers: {}, params: {} });
    (episodeRepository as any).updateMedia = originalUpdateMedia;
    assert.ok(promotionFailure.error, "D-03 promotion metadata failure must surface through the route error boundary");
    await assertCreateCompensated(promotionFailureEpisodeId, promotionFailureReservation.draftId, "reserved");

    const postCreateFailureReservation = await stageTrailerDraft(router, postCreateFailureEpisodeId, "post-create-failure");
    const originalQueueLaunchNotification = episodeRepository.queueLaunchNotification;
    (episodeRepository as any).queueLaunchNotification = (): never => { throw new Error("injected post-create failure"); };
    const postCreateFailure = await invoke(router, "/", { body: episodeCreateBody(postCreateFailureEpisodeId, postCreateFailureReservation.draftId), headers: {}, params: {} });
    (episodeRepository as any).queueLaunchNotification = originalQueueLaunchNotification;
    assert.ok(postCreateFailure.error, "D-03 post-create failure must surface through the route error boundary");
    await assertCreateCompensated(postCreateFailureEpisodeId, postCreateFailureReservation.draftId, "reserved");

    seedEpisode(replacementEpisodeId);
    const finalPath = getEpisodeMediaFinalPath(replacementEpisodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.promises.writeFile(finalPath, "last-known-good");
    episodeRepository.updateMedia(replacementEpisodeId, { trailerVideoFileName: `episodes/${replacementEpisodeId}/trailer.mp4` });
    const replacement = await invoke(router, "/:episodeId/trailer-video", new MultipartRequest(replacementEpisodeId, Buffer.from("replacement"), "replacement.mp4"));
    assert.equal(replacement.response.statusCode, 200);
    assert.equal((replacement.response.jsonBody as any).state, "finalized");
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), "replacement");

    const rollbackStage = getEpisodeMediaStagingPath(replacementEpisodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(rollbackStage), { recursive: true });
    await fs.promises.writeFile(rollbackStage, "bad-replacement");
    const originalUpdate = episodeRepository.updateMedia;
    (episodeRepository as any).updateMedia = () => null;
    await assert.rejects(() => replaceEpisodeTrailerVideo(replacementEpisodeId, rollbackStage));
    (episodeRepository as any).updateMedia = originalUpdate;
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), "replacement");
    assert.equal(await exists(rollbackStage), false);

    const expiredEpisodeId = fixtureEpisodeId + 3;
    const expired = await reserveTrailerVideoDraft(expiredEpisodeId, owner, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    await fs.promises.mkdir(getEpisodeMediaStagingDirectory(expiredEpisodeId), { recursive: true });
    await fs.promises.writeFile(getEpisodeMediaStagingPath(expiredEpisodeId, "trailerVideo"), "expired");
    await cleanupExpiredTrailerVideoDrafts();
    assert.equal(episodeRepository.findTrailerVideoDraft(expired.draftId)?.state, "expired");
    assert.equal(await exists(getEpisodeMediaStagingDirectory(expiredEpisodeId)), false);

    const routesSource = await fs.promises.readFile(path.resolve(process.cwd(), "src/routes/episodes.routes.ts"), "utf8");
    assert.match(routesSource, /youtube-trailer-jobs/);
    assert.match(routesSource, /youtube-trailer-jobs[\s\S]*publish/i);
    console.log("verified D-01/D-02/D-03 trailer-video reservation, auth, staging, fault-injected create/promotion/consume/post-create compensation, rollback, expiry cleanup, and YouTube job/publication route integration");
  } finally {
    config.auth.bypassInDev = true;
    config.media.trailerVideoMaxBytes = 500 * 1024 * 1024;
    episodeRepository.delete(fixtureEpisodeId);
    episodeRepository.delete(replacementEpisodeId);
    episodeRepository.delete(consumeFailureEpisodeId);
    episodeRepository.delete(createFailureEpisodeId);
    episodeRepository.delete(promotionFailureEpisodeId);
    episodeRepository.delete(postCreateFailureEpisodeId);
    getDb().prepare("DELETE FROM episode_trailer_video_drafts WHERE episode_id IN (?, ?, ?, ?, ?, ?, ?, ?)").run(fixtureEpisodeId, replacementEpisodeId, fixtureEpisodeId + 2, fixtureEpisodeId + 3, consumeFailureEpisodeId, createFailureEpisodeId, promotionFailureEpisodeId, postCreateFailureEpisodeId);
    await fs.promises.rm(path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo")), { recursive: true, force: true });
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
