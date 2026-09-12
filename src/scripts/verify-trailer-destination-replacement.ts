import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import type { YoutubeTrailerUploadProvider, YoutubeTrailerVideoRecord } from "../services/youtube-trailer-upload.provider";

class MemoryResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  jsonBody: any;
  _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  setHeader(name: string, value: string): this { this.headers[name.toLowerCase()] = value; return this; }
  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
}

type RouteHandler = (req: any, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type Router = { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: RouteHandler }> } }> };
class Request extends Readable {
  headers = {};
  constructor(readonly params: Record<string, string>, readonly body: unknown) { super(); this.push(null); }
  _read(): void {}
}

const invoke = async (router: Router, method: "get" | "post", routePath: string, req: Request): Promise<MemoryResponse> => {
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

const run = async (): Promise<void> => {
  if (!process.argv.includes("--fake-only")) throw new Error("Destination replacement verification requires --fake-only");
  if (process.env.NODE_ENV !== "development") throw new Error("Destination replacement verification is development-only");

  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-destination-replacement-"));
  process.env.SQLITE_PATH = path.join(root, "replacement.sqlite");
  process.env.SQLITE_RESET = "true";
  process.env.MEDIA_STORAGE_ROOT = path.join(root, "media");
  process.env.MEDIA_EPISODES_DIR = path.join(root, "media", "episodes");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("Outbound network is forbidden in fake-only verification"); }) as typeof fetch;
  try {
    const [{ connectDb }, { episodeRepository }, { episodeSchema }, { config }, { createEpisodeReplacementPublicationInTransaction }, { episodePublicationRepository }, { episodesRouter }] = await Promise.all([
      import("../database/connect.js"),
      import("../database/repositories/episode.repository.js"),
      import("../schemas/episode.js"),
      import("../config/env.js"),
      import("../services/episode-publication.service.js"),
      import("../database/repositories/episode-publication.repository.js"),
      import("../routes/episodes.routes.js"),
    ]);
    const [{ deliverInstagramReel }, { deliverFacebookNativeVideo }, { getEpisodeMediaFinalPath }] = await Promise.all([
      import("../services/instagram-reel-publication.service.js"),
      import("../services/facebook-native-video-publication.service.js"),
      import("../services/episode-media-layout.service.js"),
    ]);
    const [{ getDb }, { youtubeTrailerJobRepository }, { fingerprintYoutubeTrailerSource, createYoutubeTrailerJob }, { publishYoutubeTrailer }, { getTrailerReplacementStatus }] = await Promise.all([
      import("../database/sqlite.js"),
      import("../database/repositories/youtube-trailer-job.repository.js"),
      import("../services/youtube-trailer-job.service.js"),
      import("../services/youtube-trailer-publication.service.js"),
      import("../services/publication-retirement.service.js"),
    ]);
    await connectDb();
    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = true;
    config.trailerCandidateRenderEnabled = true;
    config.auth.bypassInDev = true;
    episodeRepository.create(episodeSchema.parse({
      episodeId: 981903,
      title: "Destination replacement fixture",
      summary: "Offline provider lifecycle fixture",
      pubDate: new Date("2026-01-01T00:00:00.000Z"),
      explicit: "no",
      authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    const episode = episodeRepository.findByEpisodeId(981903);
    assert.ok(episode);
    const finalVideo = getEpisodeMediaFinalPath(981903, "trailerVideo");
    await fs.promises.mkdir(path.dirname(finalVideo), { recursive: true });
    await fs.promises.writeFile(finalVideo, "offline-fixture-video");
    const source = (letter: string) => ({
      mediaReference: "episodes/981903/trailer.mp4",
      sha256: letter.repeat(64),
      byteCount: 10,
      mimeType: "video/mp4" as const,
    });
    const first = createEpisodeReplacementPublicationInTransaction({ episode, source: source("a") });
    for (const effect of first.effects) {
      const id = `${effect.destination}-old-remote`;
      episodePublicationRepository.updateCheckpoint(
        `episode:981903:${first.sourceRevision}:${effect.destination}`,
        { stage: "remote_identity", providerId: id, uploadId: null, updatedAt: new Date().toISOString() },
        "published",
        [],
        id,
        `https://example.invalid/${id}`,
      );
    }

    const second = createEpisodeReplacementPublicationInTransaction({ episode, source: source("b") });
    assert.equal(second.effects.length, 2, "both enabled destinations receive one successor effect");
    const fake = {
      async createInstagramContainer() { return { id: "container-successor", status: "IN_PROGRESS" }; },
      async getInstagramContainer(id: string) { return { id, status: "FINISHED" }; },
      async publishInstagramContainer() { return { id: "instagram_reel-new-remote", status: "PUBLISHED", permalink: "https://example.invalid/instagram-new" }; },
      async uploadFacebookVideo() { return { id: "facebook-upload", status: "PROCESSING" }; },
      async getFacebookVideo(id: string) { return { id, status: "ready" }; },
      async publishFacebookVideo() { return { id: "facebook_native_video-new-remote", status: "PUBLISHED", permalink: "https://example.invalid/facebook-new" }; },
    };
    await deliverInstagramReel(981903, second.effects.find((item) => item.destination === "instagram_reel")!, fake);
    await deliverFacebookNativeVideo(981903, second.effects.find((item) => item.destination === "facebook_native_video")!, fake);
    const publishedSuccessors = episodePublicationRepository.list(981903, second.sourceRevision);
    for (const effect of second.effects) {
      const published = publishedSuccessors.find((item) => item.destination === effect.destination)!;
      assert.equal(published.lifecycle, "published", `${effect.destination} fake successor was confirmed before predecessor retirement`);
      const predecessor = published.predecessor;
      assert.equal(predecessor?.remoteId, `${effect.destination}-old-remote`, `${effect.destination} retains its exact predecessor ID`);
      assert.equal(predecessor?.permalink, `https://example.invalid/${effect.destination}-old-remote`, `${effect.destination} retains its predecessor permalink`);
      assert.equal(published.retirementStatus, "manual_retirement_required", "unproven Meta deletion stays an actionable manual outcome");
      assert.equal(published.replacementComplete, false, "a pending predecessor never counts as complete");
    }
    const getStatus = await invoke(episodesRouter as unknown as Router, "get", "/:episodeId/trailer-replacements/:sourceRevision", new Request({ episodeId: "981903", sourceRevision: second.sourceRevision }, {}));
    assert.equal(getStatus.statusCode, 200);
    assert.equal(getStatus.headers["cache-control"], "no-store");
    assert.equal(getStatus.jsonBody.replacementComplete, false);
    assert.equal(getStatus.jsonBody.destinations.instagram_reel.predecessor.remoteId, "instagram_reel-old-remote");
    assert.equal(getStatus.jsonBody.destinations.instagram_reel.successor.remoteId, "instagram_reel-new-remote");
    assert.equal(getStatus.jsonBody.destinations.instagram_reel.retirementStatus, "manual_retirement_required");

    const confirmPath = "/:episodeId/trailer-replacements/:sourceRevision/destinations/:destination/retirement/confirm";
    const confirm = (destination: string, predecessorRemoteId: string) => invoke(episodesRouter as unknown as Router, "post", confirmPath, new Request({ episodeId: "981903", sourceRevision: second.sourceRevision, destination }, { predecessorRemoteId, confirmation: "removed_manually" }));
    const staleConfirm = await confirm("instagram_reel", "wrong-old-id");
    assert.equal(staleConfirm.statusCode, 409, "confirmation rejects a mismatched predecessor ID");
    const acceptedConfirm = await confirm("instagram_reel", "instagram_reel-old-remote");
    assert.equal(acceptedConfirm.statusCode, 200);
    assert.equal(acceptedConfirm.jsonBody.retirementActorEmail, "dev-bypass@local", "actor comes from authenticated middleware, not request data");
    assert.equal(acceptedConfirm.jsonBody.retirementConfirmedAt !== null, true);
    const replayConfirm = await confirm("instagram_reel", "instagram_reel-old-remote");
    assert.equal(replayConfirm.statusCode, 200, "identical confirmation replay is idempotent");
    assert.equal(replayConfirm.jsonBody.retirementConfirmedAt, acceptedConfirm.jsonBody.retirementConfirmedAt);
    assert.equal(replayConfirm.jsonBody.retirementActorEmail, acceptedConfirm.jsonBody.retirementActorEmail);
    const changedConfirm = await confirm("instagram_reel", "another-old-id");
    assert.equal(changedConfirm.statusCode, 409, "confirmed predecessor identity cannot be changed");
    await confirm("facebook_native_video", "facebook_native_video-old-remote");
    const completedStatus = await invoke(episodesRouter as unknown as Router, "get", "/:episodeId/trailer-replacements/:sourceRevision", new Request({ episodeId: "981903", sourceRevision: second.sourceRevision }, {}));
    assert.equal(completedStatus.jsonBody.replacementComplete, true, "aggregate completes only after every predecessor is confirmed");
    config.trailerCandidateRenderEnabled = false;
    const gated = await invoke(episodesRouter as unknown as Router, "get", "/:episodeId/trailer-replacements/:sourceRevision", new Request({ episodeId: "981903", sourceRevision: second.sourceRevision }, {}));
    assert.equal(gated.statusCode, 503, "replacement status remains behind the default-off candidate gate");

    config.trailerCandidateRenderEnabled = true;
    config.meta.instagramEnabled = false;
    config.meta.facebookReelEnabled = false;
    episodeRepository.create(episodeSchema.parse({
      episodeId: 981904,
      title: "YouTube replacement fixture",
      summary: "Offline YouTube lifecycle fixture",
      pubDate: new Date("2026-01-01T00:00:00.000Z"),
      explicit: "no",
      authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    const youtubeFinalPath = getEpisodeMediaFinalPath(981904, "trailerVideo");
    await fs.promises.mkdir(path.dirname(youtubeFinalPath), { recursive: true });
    await fs.promises.writeFile(youtubeFinalPath, "previous-youtube-trailer");
    const oldSource = await fingerprintYoutubeTrailerSource(981904);
    const oldJob = youtubeTrailerJobRepository.createOrReuse({ jobId: "old-youtube-job", ...oldSource });
    getDb().prepare(`UPDATE youtube_trailer_jobs SET status = 'ready', provider_video_id = ?, publication_status = 'public_confirmed', public_confirmed_at = ?, canonical_url = ? WHERE episode_id = ? AND job_id = ?`)
      .run("old-youtube-video", new Date().toISOString(), "https://www.youtube.com/watch?v=old-youtube-video", 981904, oldJob.jobId);
    await fs.promises.writeFile(youtubeFinalPath, "approved-youtube-successor");
    const replacementSource = await fingerprintYoutubeTrailerSource(981904);
    const youtubeEpisode = episodeRepository.findByEpisodeId(981904);
    assert.ok(youtubeEpisode);
    const youtubeReplacement = createEpisodeReplacementPublicationInTransaction({
      episode: youtubeEpisode,
      source: { mediaReference: `episodes/981904/trailer.mp4`, sha256: replacementSource.sourceSha256, byteCount: replacementSource.sourceBytes, mimeType: "video/mp4" },
    });
    const getYoutubeReplacement = (episodePublicationRepository as any).getYoutubeReplacement as (episodeId: number, sourceRevision: string) => any;
    const waiting = getYoutubeReplacement(981904, youtubeReplacement.sourceRevision);
    assert.equal(waiting.status, "waiting_for_operator_upload", "approval records a YouTube marker but waits for the explicit upload action");
    assert.equal(waiting.predecessor.remoteId, "old-youtube-video");
    assert.equal(youtubeReplacement.effects.length, 0, "disabled Meta destinations do not receive effects");

    const explicitJob = await createYoutubeTrailerJob(981904);
    const linked = getYoutubeReplacement(981904, youtubeReplacement.sourceRevision);
    assert.equal(linked.status, "waiting_for_public_success");
    assert.equal(linked.successorJobId, explicitJob.jobId, "only the explicit YouTube job binds the successor");
    getDb().prepare(`UPDATE youtube_trailer_jobs SET status = 'ready', provider_video_id = ?, provider_privacy_status = 'private', provider_upload_status = 'processed', provider_processing_status = 'succeeded' WHERE episode_id = ? AND job_id = ?`)
      .run("new-youtube-video", 981904, explicitJob.jobId);
    const youtubeCalls: string[] = [];
    let youtubeIsPublic = false;
    let failYoutubeDelete = true;
    let youtubeMetadata: { title: string; description: string; categoryId?: string } | null = null;
    const videoRecord = (id: string): YoutubeTrailerVideoRecord => ({ videoId: id, channelId: "fixture", privacyStatus: youtubeIsPublic ? "public" : "private", uploadStatus: "processed", processingStatus: "succeeded", title: youtubeMetadata?.title ?? null, description: youtubeMetadata?.description ?? null, categoryId: "22" });
    const youtubeFake: YoutubeTrailerUploadProvider = {
      async checkReadiness() {},
      async beginPrivateSession() { throw new Error("unexpected YouTube upload"); },
      async resumeRange() { throw new Error("unexpected YouTube resume"); },
      async uploadChunk() { throw new Error("unexpected YouTube upload"); },
      async pollProcessing() { throw new Error("unexpected YouTube polling"); },
      async cancel() { return { accepted: false, boundary: "provider-video-retained" }; },
      normalizeFailure(error) { return { code: "retryable", message: error instanceof Error ? error.message : "fake failure" }; },
      async getVideo(id: string) { assert.equal(id, "new-youtube-video"); youtubeCalls.push("read"); return videoRecord(id); },
      async updateMetadata(_id: string, metadata: { title: string; description: string; categoryId?: string }) { youtubeCalls.push("metadata"); youtubeMetadata = metadata; return videoRecord("new-youtube-video"); },
      async findPlaylistMembership() { youtubeCalls.push("playlist-read"); return null; },
      async insertPlaylistItem() { youtubeCalls.push("playlist-insert"); return { playlistId: "fixture", videoId: "new-youtube-video", itemId: "fixture-item" }; },
      async publishVideo(id: string) { assert.equal(id, "new-youtube-video"); youtubeCalls.push("public-update"); youtubeIsPublic = true; return videoRecord(id); },
      async deleteVideo(id: string) {
        youtubeCalls.push(`delete:${id}`);
        assert.equal(id, "old-youtube-video", "retirement uses the persisted predecessor ID");
        assert.equal(youtubeTrailerJobRepository.findByJobId(981904, explicitJob.jobId)?.publicationStatus, "public_confirmed", "old video cannot be deleted before durable public success");
        if (failYoutubeDelete) throw new Error("fake predecessor deletion failure");
      },
    };
    const firstYoutubePublish = await publishYoutubeTrailer(981904, explicitJob.jobId, { title: "Approved Trailer", hashtags: [] }, youtubeFake);
    assert.equal(firstYoutubePublish.status, "public_confirmed");
    assert.equal(getYoutubeReplacement(981904, youtubeReplacement.sourceRevision).status, "retirement_retryable_error");
    assert.equal(getTrailerReplacementStatus(981904, youtubeReplacement.sourceRevision)?.replacementComplete, false, "YouTube retirement failure remains incomplete");
    assert.ok(youtubeCalls.includes("delete:old-youtube-video"));
    const publicUpdatesBeforeRetry = youtubeCalls.filter((call) => call === "public-update").length;
    failYoutubeDelete = false;
    const retriedYoutubePublish = await publishYoutubeTrailer(981904, explicitJob.jobId, { title: "Approved Trailer", hashtags: [] }, youtubeFake);
    assert.equal(retriedYoutubePublish.status, "public_confirmed");
    assert.equal(youtubeCalls.filter((call) => call === "public-update").length, publicUpdatesBeforeRetry, "retirement retry never republishes the successor");
    assert.equal(getYoutubeReplacement(981904, youtubeReplacement.sourceRevision).status, "complete");
    assert.equal(getTrailerReplacementStatus(981904, youtubeReplacement.sourceRevision)?.replacementComplete, true);
    console.log("Fake destination replacement lifecycle passed: Meta predecessors remain audited until confirmation; YouTube waits for explicit upload and public-success before retirement.");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
};

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
