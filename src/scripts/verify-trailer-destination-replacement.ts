import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    const [{ connectDb }, { episodeRepository }, { episodeSchema }, { config }, { createEpisodeReplacementPublicationInTransaction }, { episodePublicationRepository }] = await Promise.all([
      import("../database/connect.js"),
      import("../database/repositories/episode.repository.js"),
      import("../schemas/episode.js"),
      import("../config/env.js"),
      import("../services/episode-publication.service.js"),
      import("../database/repositories/episode-publication.repository.js"),
    ]);
    const [{ deliverInstagramReel }, { deliverFacebookNativeVideo }, { getEpisodeMediaFinalPath }] = await Promise.all([
      import("../services/instagram-reel-publication.service.js"),
      import("../services/facebook-native-video-publication.service.js"),
      import("../services/episode-media-layout.service.js"),
    ]);
    await connectDb();
    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = true;
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
    console.log("Fake destination replacement lifecycle passed: Instagram and Facebook preserve predecessor identity until retirement confirmation.");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
};

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
