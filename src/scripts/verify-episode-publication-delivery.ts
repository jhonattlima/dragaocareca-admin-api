import assert from "node:assert/strict";
import { config } from "../config/env";
import { deliverInstagramReel } from "../services/instagram-reel-publication.service";
import type { MetaPublicationProvider, ProviderResult } from "../services/meta-publication.provider";
import type { PublicationEffectProjection } from "../schemas/episode-publication";

const effect = (destination: "instagram_reel" | "facebook_native_video"): PublicationEffectProjection => ({
  destination, lifecycle: "eligible", sourceRevision: "episode:1:" + "a".repeat(64),
  source: { mediaReference: "episodes/1/trailer.mp4", sha256: "a".repeat(64), byteCount: 10, mimeType: "video/mp4" },
  metadata: { title: "Fixture", summary: "Offline fixture", captionMentions: [], hashtags: [], renderedCaption: "Fixture" },
  eligibility: "eligible", diagnostics: [], remoteId: null, permalink: null,
  preflight: { status: "ready", checkedAt: new Date().toISOString(), providerReachability: "ready", contentType: "video/mp4", contentLength: 10, rangeSupported: true, failureCategory: null },
  checkpoint: { stage: "none", providerId: null, uploadId: null, updatedAt: null }, attempts: 0, nextAttemptAt: null,
});

const run = async (): Promise<void> => {
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("Outbound network is forbidden in fake-only verification"); }) as typeof fetch;
  const previous = config.meta.instagramEnabled;
  config.meta.instagramEnabled = true;
  try {
    await deliverInstagramReel(1, effect("instagram_reel"), fake);
    assert.deepEqual(calls.slice(0, 3), ["instagram:create", "instagram:status", "instagram:publish"]);
    assert.equal(calls.some((call) => call === "facebook:publish"), false);
  } finally {
    config.meta.instagramEnabled = previous;
    globalThis.fetch = originalFetch;
  }
  console.log(`Fake publication delivery passed: ${calls.join(",")}`);
};

if (process.argv.includes("--fake-only")) {
  void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
} else {
  console.error("Refusing live delivery verification. Use --fake-only.");
  process.exitCode = 2;
}

