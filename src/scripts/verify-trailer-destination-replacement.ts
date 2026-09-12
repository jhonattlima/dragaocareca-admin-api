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
    for (const effect of second.effects) {
      const predecessor = (effect as any).predecessor;
      assert.equal(predecessor?.remoteId, `${effect.destination}-old-remote`, `${effect.destination} retains its exact predecessor ID`);
      assert.equal(predecessor?.permalink, `https://example.invalid/${effect.destination}-old-remote`, `${effect.destination} retains its predecessor permalink`);
      assert.equal((effect as any).retirementStatus, "manual_retirement_required", "unproven Meta deletion stays an actionable manual outcome");
      assert.equal((effect as any).replacementComplete, false, "a pending predecessor never counts as complete");
    }
    console.log("Fake destination replacement lifecycle passed: Instagram and Facebook preserve predecessor identity until retirement confirmation.");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
};

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
