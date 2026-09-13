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
  const [{ config }, { connectDb }, { episodeRepository }, { episodeSchema }, { episodePublicationRepository }, { publicationSourceRevision }, { deliverInstagramReel }, { normalizeMetaProviderStatus }] = await Promise.all([
    import("../config/env.js"), import("../database/connect.js"), import("../database/repositories/episode.repository.js"),
    import("../schemas/episode.js"), import("../database/repositories/episode-publication.repository.js"), import("../schemas/episode-publication.js"),
    import("../services/instagram-reel-publication.service.js"), import("../services/meta-publication.provider.js"),
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
  const result = (id: string, status = "FINISHED"): ProviderResult => ({ id, status, permalink: `https://example.invalid/${id}` });
  const fake: MetaPublicationProvider = {
    async createInstagramContainer() { calls.push("instagram:create"); return result("container-1", "IN_PROGRESS"); },
    async getInstagramContainer() { calls.push("instagram:status"); return result("container-1"); },
    async publishInstagramContainer() { calls.push("instagram:publish"); return result("media-1"); },
    async uploadFacebookVideo() { calls.push("facebook:upload"); return result("video-1"); },
    async getFacebookVideo() { calls.push("facebook:status",); return result("video-1", "ready"); },
    async publishFacebookVideo() { calls.push("facebook:publish"); return result("video-1"); },
  };
  globalThis.fetch = (async () => { throw new Error("Outbound network is forbidden in fake-only verification"); }) as typeof fetch;
  const previous = config.meta.instagramEnabled;
  config.meta.instagramEnabled = true;
  try {
    const source = { mediaReference: "episodes/1/trailer.mp4", sha256: "a".repeat(64), byteCount: 10, mimeType: "video/mp4" as const };
    const sourceRevision = publicationSourceRevision(1, source);
    const preflight = { status: "ready" as const, checkedAt: new Date().toISOString(), providerReachability: "ready" as const, contentType: "video/mp4" as const, contentLength: 10, rangeSupported: true, failureCategory: null };
    const [instagramEffect] = episodePublicationRepository.createOrGet({
      episodeId: 1, sourceRevision, source, destinations: ["instagram_reel"],
      metadata: { title: "Fixture", summary: "Offline fixture", captionMentions: [], hashtags: [], renderedCaption: "Fixture" },
      preflight,
    });
    await deliverInstagramReel(1, instagramEffect, fake);
    assert.deepEqual(calls.slice(0, 3), ["instagram:create", "instagram:status", "instagram:publish"]);
    assert.equal(calls.some((call) => call === "facebook:publish"), false);
  } finally {
    config.meta.instagramEnabled = previous;
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
