import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MetaPublicationProvider, ProviderResult } from "../services/meta-publication.provider";

const run = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("Publication delivery verification is development-only");
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-publication-delivery-"));
  const originalWorkingDirectory = process.cwd();
  const originalFetch = globalThis.fetch;
  process.chdir(root);
  try {
  process.env.SQLITE_PATH = path.join(root, "publication.sqlite");
  process.env.SQLITE_RESET = "true";
  process.env.MEDIA_STORAGE_ROOT = path.join(root, "media");
  process.env.MEDIA_EPISODES_DIR = path.join(root, "media", "episodes");
  process.env.MEDIA_EPISODES_STAGING_DIR = path.join(root, "media", "staging");
  process.env.TRAILER_CANDIDATES_ROOT = path.join(root, "generated", "trailer-candidates");
  process.env.FEED_BASE_LINK = "https://example.test/episodes";
  process.env.FEED_AUDIO_BASE = "https://example.test/media";
  process.env.FEED_IMAGE_BASE = "https://example.test/images/";
  process.env.FEED_TITLE = "Offline verification feed";
  process.env.FEED_DESCRIPTION = "Synthetic fake-only fixture";
  process.env.FEED_SITE = "https://example.test";
  const [{ config }, { connectDb }, { episodeRepository }, { getDb }, { episodeSchema }, { episodePublicationRepository }, { publicationSourceRevision }, { deliverInstagramReel }, { normalizeMetaProviderStatus }, { deliverEpisodePublication, dispatchEpisodeReplacementPublication }] = await Promise.all([
    import("../config/env.js"), import("../database/connect.js"), import("../database/repositories/episode.repository.js"),
    import("../database/sqlite.js"),
    import("../schemas/episode.js"), import("../database/repositories/episode-publication.repository.js"), import("../schemas/episode-publication.js"),
    import("../services/instagram-reel-publication.service.js"), import("../services/meta-publication.provider.js"), import("../services/episode-publication.service.js"),
  ]);
  await connectDb();
  episodeRepository.create(episodeSchema.parse({
    episodeId: 1, title: "Offline delivery fixture", summary: "Fake-only", pubDate: new Date("2026-01-01T00:00:00.000Z"),
    explicit: "no", authors: [], guests: [], tags: [], citations: [],
    musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
    coverCredits: [], launchNotificationState: "idle",
  }));
  assert.equal(normalizeMetaProviderStatus({ status_code: "IN_PROGRESS" }), "IN_PROGRESS");
  assert.equal(normalizeMetaProviderStatus({ status_code: "FINISHED" }), "FINISHED");
  assert.equal(normalizeMetaProviderStatus({ status: { video_status: "ready" } }), "ready");
  const calls: string[] = [];
  let sentInstagramCaption = "";
  const result = (id: string, status = "FINISHED"): ProviderResult => ({ id, status, permalink: `https://example.invalid/${id}` });
  const fake: MetaPublicationProvider = {
    async createInstagramContainer(input) { calls.push("instagram:create"); sentInstagramCaption = input.caption; return result("container-1", "IN_PROGRESS"); },
    async getInstagramContainer() { calls.push("instagram:status"); return result("container-1"); },
    async publishInstagramContainer() { calls.push("instagram:publish"); return result("media-1"); },
    async uploadFacebookVideo() { calls.push("facebook:upload"); return result("video-1"); },
    async getFacebookVideo() { calls.push("facebook:status",); return result("video-1", "ready"); },
    async publishFacebookVideo() { calls.push("facebook:publish"); return result("video-1"); },
  };
  globalThis.fetch = (async () => { throw new Error("Outbound network is forbidden in fake-only verification"); }) as typeof fetch;
  const previous = { instagramEnabled: config.meta.instagramEnabled, facebookReelEnabled: config.meta.facebookReelEnabled };
  config.meta.instagramEnabled = true;
  config.meta.facebookReelEnabled = true;
  try {
    const source = { mediaReference: "episodes/1/trailer.mp4", sha256: "a".repeat(64), byteCount: 10, mimeType: "video/mp4" as const };
    const sourceRevision = publicationSourceRevision(1, source);
    const preflight = { status: "ready" as const, checkedAt: new Date().toISOString(), providerReachability: "ready" as const, contentType: "video/mp4" as const, contentLength: 10, rangeSupported: true, failureCategory: null };
    const [instagramEffect] = episodePublicationRepository.createOrGet({
      episodeId: 1, sourceRevision, source, destinations: ["instagram_reel"],
      // Simulate a legacy pending publication row created before the 30-tag
      // cap. Delivery must rebuild the caption and never resend all 50.
      metadata: {
        title: "Fixture", summary: "Offline fixture", captionMentions: [],
        hashtags: Array.from({ length: 50 }, (_, index) => `#legacy${index + 1}`),
        renderedCaption: `Fixture\n\n${Array.from({ length: 50 }, (_, index) => `#legacy${index + 1}`).join(" ")}`,
      },
      preflight,
    });
    const [savedEpisodeMetadata] = episodePublicationRepository.createOrGet({
      episodeId: 1, sourceRevision, source, destinations: ["instagram_reel"],
      metadata: {
        title: "Final saved title", summary: "Final saved summary", captionMentions: [], hashtags: ["#final"],
        renderedCaption: "Final saved title\n\nFinal saved summary\n\n#final",
      },
      preflight,
    });
    assert.equal(savedEpisodeMetadata.metadata.title, "Final saved title", "an unpublished trailer effect must use final episode metadata");
    await deliverInstagramReel(1, savedEpisodeMetadata, fake);
    assert.deepEqual(calls.slice(0, 3), ["instagram:create", "instagram:status", "instagram:publish"]);
    assert.equal((sentInstagramCaption.match(/#[^\s#]+/gu) ?? []).length, 1, "the refreshed final snapshot replaces draft hashtags");
    assert.equal(sentInstagramCaption.includes("#legacy31"), false, "draft hashtags are not retained after the episode is saved");
    assert.equal(sentInstagramCaption.startsWith("Final saved title"), true, "delivery uses metadata refreshed after the draft was saved");
    assert.equal(calls.some((call) => call === "facebook:publish"), false);

    const retrySource = { mediaReference: "episodes/1/trailer.mp4", sha256: "c".repeat(64), byteCount: 11, mimeType: "video/mp4" as const };
    const retryRevision = publicationSourceRevision(1, retrySource);
    const [retryEffect] = episodePublicationRepository.createOrGet({
      episodeId: 1, sourceRevision: retryRevision, source: retrySource, destinations: ["instagram_reel"],
      metadata: { title: "Retry fixture", summary: "Persist the container", captionMentions: [], hashtags: [], renderedCaption: "Retry fixture\n\nPersist the container" },
      preflight,
    });
    let retryPublishCalls = 0;
    const retryingInstagram: MetaPublicationProvider = {
      ...fake,
      async createInstagramContainer() { calls.push("instagram:retry-create"); return result("container-retry"); },
      async getInstagramContainer() { calls.push("instagram:retry-status"); return result("container-retry"); },
      async publishInstagramContainer() {
        calls.push("instagram:retry-publish");
        retryPublishCalls += 1;
        if (retryPublishCalls === 1) throw Object.assign(new Error("Invalid parameter"), { category: "provider", providerCode: 100, providerStatus: 400 });
        return result("media-retry");
      },
    };
    await deliverInstagramReel(1, retryEffect, retryingInstagram);
    let retriedEffect = episodePublicationRepository.list(1, retryRevision).find((effect) => effect.destination === "instagram_reel");
    assert.equal(retriedEffect?.lifecycle, "failed", "a persisted Instagram container that Meta is still processing must be retryable");
    assert.equal(retriedEffect?.attempts, 1, "a not-ready publish response records one bounded retry");
    assert.equal(retriedEffect?.checkpoint.providerId, "container-retry", "the retry keeps the original Meta container");
    assert.equal(episodePublicationRepository.requeueSocialEffectForFixture(`episode:1:${retryRevision}:instagram_reel`), true, "fixture can make the due retry immediate without network or clock changes");
    await deliverInstagramReel(1, episodePublicationRepository.list(1, retryRevision).find((effect) => effect.destination === "instagram_reel")!, retryingInstagram);
    retriedEffect = episodePublicationRepository.list(1, retryRevision).find((effect) => effect.destination === "instagram_reel");
    assert.equal(retriedEffect?.lifecycle, "published", "the existing Instagram container is published by the retry");
    assert.equal(retriedEffect?.remoteId, "media-retry", "the successful retry persists one remote identity");
    assert.equal(calls.filter((call) => call === "instagram:retry-create").length, 1, "a retry never creates a second Instagram container");

    const failedContainerSource = { mediaReference: "episodes/1/trailer.mp4", sha256: "d".repeat(64), byteCount: 12, mimeType: "video/mp4" as const };
    const failedContainerRevision = publicationSourceRevision(1, failedContainerSource);
    const [failedContainerEffect] = episodePublicationRepository.createOrGet({
      episodeId: 1, sourceRevision: failedContainerRevision, source: failedContainerSource, destinations: ["instagram_reel"],
      metadata: { title: "Failed container fixture", summary: "Recreate only after a terminal Meta status", captionMentions: [], hashtags: [], renderedCaption: "Failed container fixture" },
      preflight,
    });
    const failedContainerKey = `episode:1:${failedContainerRevision}:instagram_reel`;
    episodePublicationRepository.updateCheckpoint(failedContainerKey, { stage: "processing", providerId: "container-dead", uploadId: null, updatedAt: new Date().toISOString() }, "failed");
    const terminalContainerProvider: MetaPublicationProvider = {
      ...fake,
      async createInstagramContainer() { calls.push("instagram:terminal-create"); return result("container-fresh"); },
      async getInstagramContainer(id) { calls.push(`instagram:terminal-status:${id}`); return result(id, id === "container-dead" ? "ERROR" : "FINISHED"); },
      async publishInstagramContainer(id) { calls.push(`instagram:terminal-publish:${id}`); return result("media-fresh"); },
    };
    await deliverInstagramReel(1, failedContainerEffect, terminalContainerProvider);
    const recreatedEffect = episodePublicationRepository.list(1, failedContainerRevision).find((effect) => effect.destination === "instagram_reel");
    assert.equal(recreatedEffect?.lifecycle, "published", "a terminal Meta container is replaced by a fresh container");
    assert.equal(recreatedEffect?.remoteId, "media-fresh", "the replacement container persists the published Reel identity");
    assert.deepEqual(calls.slice(-4), ["instagram:terminal-status:container-dead", "instagram:terminal-create", "instagram:terminal-status:container-fresh", "instagram:terminal-publish:container-fresh"], "only a confirmed terminal container is replaced");

    const futureEpisode = episodeRepository.create(episodeSchema.parse({
      episodeId: 2, title: "Final scheduled title", summary: "Final scheduled summary", pubDate: new Date("2099-01-01T00:00:00.000Z"),
      explicit: "no", authors: [], guests: [], tags: [], citations: [],
      musicCredits: [JSON.stringify({ name: "Scheduled fixture", links: [{ url: "https://example.test/scheduled" }] })],
      coverCredits: [], launchNotificationState: "idle",
    }));
    const futureTrailerPath = path.join(process.env.MEDIA_EPISODES_DIR!, "2", "trailer.mp4");
    await fs.promises.mkdir(path.dirname(futureTrailerPath), { recursive: true });
    await fs.promises.writeFile(futureTrailerPath, Buffer.from("fake scheduled trailer"));
    const futureSource = { mediaReference: "episodes/2/trailer.mp4", sha256: "b".repeat(64), byteCount: 10, mimeType: "video/mp4" as const };
    const futureRevision = publicationSourceRevision(2, futureSource);
    episodePublicationRepository.createOrGet({
      episodeId: 2, sourceRevision: futureRevision, source: futureSource, destinations: ["instagram_reel", "facebook_native_video"],
      metadata: { title: futureEpisode.title, summary: futureEpisode.summary, captionMentions: [], hashtags: ["#scheduled"], renderedCaption: "Final scheduled title\n\nFinal scheduled summary\n\n#scheduled" },
      preflight,
    });
    const beforeReleaseCalls = calls.length;
    const directBeforeRelease = await deliverEpisodePublication(futureEpisode);
    assert.equal(directBeforeRelease.delivered, false, "direct launch delivery is blocked before the scheduled release");
    await dispatchEpisodeReplacementPublication(2, futureRevision, fake);
    assert.equal(calls.length, beforeReleaseCalls, "no Meta provider method is called before pubDate");
    assert.equal(episodePublicationRepository.listDueSocialEffects(new Date("2098-12-31T23:59:59.000Z")).some((item) => item.episodeId === 2), false, "future social effects are not due to the worker");

    getDb().prepare("UPDATE episodes SET pub_date = ? WHERE episode_id = ?").run("2026-01-01T00:00:00.000Z", 2);
    assert.equal(episodePublicationRepository.listDueSocialEffects(new Date("2026-01-01T00:00:01.000Z")).filter((item) => item.episodeId === 2).length >= 2, true, "social effects become due only after pubDate");
    await dispatchEpisodeReplacementPublication(2, futureRevision, fake);
    assert.equal(calls.length > beforeReleaseCalls, true, "Meta delivery begins only after the scheduled release");
    assert.equal(calls.includes("facebook:upload"), true, "Facebook receives the final trailer only after pubDate");
    assert.equal(sentInstagramCaption.startsWith("Final scheduled title"), true, "released Meta delivery retains final title metadata");
  } finally {
    config.meta.instagramEnabled = previous.instagramEnabled;
    config.meta.facebookReelEnabled = previous.facebookReelEnabled;
    globalThis.fetch = originalFetch;
  }
  console.log(`Fake publication delivery passed: ${calls.join(",")}`);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalWorkingDirectory);
    const rootStat = await fs.promises.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) {
      throw new Error("Refusing to remove a publication delivery root that no longer matches its temporary identity");
    }
    await fs.promises.rm(root, { recursive: true, force: false });
    assert.equal(await fs.promises.access(root).then(() => true).catch(() => false), false, "publication delivery fixture root must be absent after cleanup");
  }
};

if (process.argv.includes("--fake-only")) {
  void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
} else {
  console.error("Refusing live delivery verification. Use --fake-only.");
  process.exitCode = 2;
}
