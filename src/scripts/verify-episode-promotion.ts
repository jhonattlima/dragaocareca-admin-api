import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EpisodePromotionInput } from "../services/episode-promotion.service";
import type { PromotionEffectRow } from "../database/repositories/episode-promotion.repository";
import type { PromotionRequest } from "../schemas/episode-promotion";

type Scenario = "contract-outbox-tracer" | "state-replay" | "post-save-isolation";

const scenarioArg = process.argv.find((argument) => argument.startsWith("--scenario="))?.split("=", 2)[1] as Scenario | undefined;
const fakeOnly = process.argv.includes("--fake-only");

if (!fakeOnly) throw new Error("This verifier requires --fake-only and never contacts a real transport.");
if (scenarioArg !== "contract-outbox-tracer" && scenarioArg !== "state-replay" && scenarioArg !== "post-save-isolation") {
  throw new Error("Use --scenario=contract-outbox-tracer, --scenario=state-replay, or --scenario=post-save-isolation.");
}

type Fixture = { root: string; database: string; media: string };

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dragaocareca-episode-promotion-"));
  const media = path.join(root, "media");
  await fs.promises.mkdir(media, { recursive: true });
  const database = path.join(root, "promotion.sqlite");
  process.env.NODE_ENV = "development";
  process.env.SQLITE_PATH = database;
  process.env.SQLITE_RESET = "true";
  process.env.MEDIA_STORAGE_ROOT = media;
  process.env.MEDIA_EPISODES_DIR = path.join(media, "episodes");
  process.env.MEDIA_EPISODES_STAGING_DIR = path.join(media, "staging");
  process.env.MEDIA_BACKUP_ROOT = path.join(media, "backups");
  process.env.MEDIA_BACKUP_EPISODES_DIR = path.join(media, "backups", "episodes");
  process.env.FEED_BASE_LINK = "https://podcast.example/episode/";
  process.env.PROMOTION_ENABLED = "true";
  process.env.PROMOTION_BOT_URL = "http://fake.invalid/promotions";
  process.env.PROMOTION_SHARED_SECRET = "fake-only-secret";
  process.env.FEED_AUDIO_BASE = "https://media.example/audio/";
  process.env.FEED_IMAGE_BASE = "https://media.example/images/";
  process.env.FEED_TITLE = "Fake Podcast";
  process.env.FEED_DESCRIPTION = "Offline verifier";
  process.env.FEED_SITE = "https://podcast.example";
  return { root, database, media };
};

const run = async (): Promise<void> => {
  const fixture = await createFixture();
  const [{ getDb }, { episodePromotionRepository }, { episodeRepository }, service, saveService, contract] = await Promise.all([
    import("../database/sqlite.js"),
    import("../database/repositories/episode-promotion.repository.js"),
    import("../database/repositories/episode.repository.js"),
    import("../services/episode-promotion.service.js"),
    import("../services/episode-promotion-save.service.js"),
    import("../schemas/episode-promotion.js"),
  ]);

  class FakeTransport {
    readonly requests: Array<{ request: unknown; destinations: string[] }> = [];
    readonly reconciliations: string[] = [];
    async sendPromotion(request: PromotionRequest, effects: Array<{ destination: string }>): Promise<unknown> {
      this.requests.push({ request, destinations: effects.map((effect) => effect.destination) });
      if (scenarioArg === "post-save-isolation") {
        throw new Error("request timeout");
      }
      if (scenarioArg === "state-replay" && this.requests.length === 1) {
        return {
          contract_version: contract.PROMOTION_CONTRACT_VERSION,
          notification_id: request.notification_id,
          status: "unknown",
          effects: [
            { destination: "guild_trailer", status: "complete", message_id: "fake-guild-message", file_id: "fake-file" },
            { destination: "advance_access", status: "unknown", error: { category: "timeout", description: "fake acknowledgement loss", retryable: true } },
          ],
        };
      }
      return {
        contract_version: contract.PROMOTION_CONTRACT_VERSION,
        notification_id: request.notification_id,
        status: "complete",
        effects: effects.map((effect) => ({
          destination: effect.destination,
          status: "complete",
          message_id: "fake-reconciled-message",
          topic_id: effect.destination === "advance_access" ? "fake-topic" : undefined,
          message_thread_id: effect.destination === "advance_access" ? "fake-thread" : undefined,
        })),
      };
    }

    async reconcilePromotion(request: PromotionRequest, effect: PromotionEffectRow): Promise<unknown> {
      this.reconciliations.push(effect.destination);
      if (scenarioArg === "state-replay" && effect.destination === "advance_access") {
        return {
          destination: effect.destination,
          status: "complete",
          message_id: "fake-reconciled-message",
          topic_id: "fake-topic",
          message_thread_id: "fake-thread",
        };
      }
      return null;
    }
  }

  try {
    const episodeId = 50501;
    getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(episodeId, "Fixture", "2026-08-24T00:00:00.000Z");
    const requestInput = {
      episodeId,
      title: "Ep 42 #spoiler",
      episodeNumber: 42,
      publicDownloadUrl: "https://podcast.example/episode/50501",
      trailerSha256: "a".repeat(64),
      trailerByteCount: 12,
    } satisfies EpisodePromotionInput;
    const request = service.buildEpisodePromotionRequest(requestInput);
    assert.equal(request.contract_version, contract.PROMOTION_CONTRACT_VERSION);
    assert.equal(request.notification_id, "episode:50501");
    assert.equal(request.title, "Ep 42");
    assert.equal(request.episode_number, 42);
    assert.equal(request.trailer.media_reference, "episodes/50501/trailer.mp4");
    assert.equal(request.destinations.length, 2);
    assert.equal(/\/(?:home|tmp)\//.test(JSON.stringify(request)), false);
    assert.equal(/(?:credential|authorization|token|password)/i.test(JSON.stringify(request)), false);
    for (const [message, category] of [
      ["malformed payload", "malformed_payload"],
      ["authentication rejected", "authentication"],
      ["permission denied", "permission"],
      ["missing trailer media", "missing_media"],
      ["digest mismatch", "digest_mismatch"],
      ["request timeout", "timeout"],
      ["transport unavailable", "transport"],
      ["Telegram service unavailable", "telegram_service"],
    ] as const) {
      assert.equal(service.classifyPromotionError(new Error(message)).category, category);
    }

    const transport = new FakeTransport();
    if (scenarioArg === "post-save-isolation") {
      const episodeId = 50502;
      const trailerPath = path.join(fixture.media, "episodes", String(episodeId), "trailer.mp4");
      await fs.promises.mkdir(path.dirname(trailerPath), { recursive: true });
      await fs.promises.writeFile(trailerPath, Buffer.from("canonical trailer"));
      getDb().prepare("INSERT INTO episodes (episode_id, title, pub_date) VALUES (?, ?, ?)").run(episodeId, "Before save", "2026-08-24T00:00:00.000Z");
      const payload = {
        episodeId,
        title: "Saved episode #offline",
        summary: "Saved without Telegram",
        pubDate: new Date("2026-08-24T00:00:00.000Z"),
        explicit: "no" as const,
        authors: [],
        guests: [],
        tags: [],
        citations: [],
        musicCredits: [JSON.stringify({ name: "Offline", links: [{ url: "https://example.com" }] })],
        coverCredits: [],
      };
      const saved = await saveService.saveEpisodeAndQueuePromotion({ episodeId, payload, transport });
      assert.equal(saved.episode.episodeId, episodeId);
      assert.equal(saved.intent.notification.notificationId, `episode:${episodeId}`);
      assert.equal(saved.acknowledgement?.status, "unknown");
      assert.equal(transport.requests.length, 1);
      assert.equal(episodeRepository.findByEpisodeId(episodeId)?.title, "Saved episode #offline");
      assert.equal(fs.existsSync(trailerPath), true);
      const failedEffect = saved.intent.effects.find((effect) => effect.destination === "guild_trailer");
      assert.equal(failedEffect?.status, "pending");
      const persisted = episodePromotionRepository.findPromotionIntent(`episode:${episodeId}`);
      assert.equal(persisted?.effects.every((effect) => effect.status === "unknown"), true);
      assert.equal(persisted?.effects.every((effect) => effect.errorCategory === "timeout"), true);
      console.log("episode post-save isolation passed with fake timeout and committed trailer");
      return;
    }
    const first = await service.createOrReusePromotionIntent(requestInput, transport);
    assert.equal(first.effects.length, 2);
    assert.equal(transport.requests.length, 1);
    assert.deepEqual(transport.requests[0]?.destinations, ["advance_access", "guild_trailer"]);
    assert.ok(first.effects.every((effect) => /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(effect.createdAt)));
    assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM promotion_notifications WHERE notification_id = ?").get(request.notification_id) as { count: number }).count, 1);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM promotion_effects WHERE notification_id = ?").get(request.notification_id) as { count: number }).count, 2);

    if (scenarioArg === "contract-outbox-tracer") {
      assert.ok(first.effects.every((effect) => effect.status === "complete"));
      const replay = await service.createOrReusePromotionIntent(requestInput, transport);
      assert.equal(replay.effects.filter((effect) => effect.status === "complete").length, 2);
      assert.equal(transport.requests.length, 1, "a completed intent must not be sent again");
      console.log("episode promotion contract/outbox tracer passed with fake transport only");
      return;
    }

    assert.equal(first.effects.find((effect) => effect.destination === "guild_trailer")?.status, "complete");
    assert.equal(first.effects.find((effect) => effect.destination === "advance_access")?.status, "unknown");
    assert.equal(episodePromotionRepository.claimDuePromotionEffects({ notificationId: request.notification_id }).length, 0, "future retry state must not be claimed as due");
    const preservedGuild = episodePromotionRepository.recordPromotionAcknowledgement({
      notificationId: request.notification_id,
      destination: "guild_trailer",
      sourceRevision: first.notification.sourceRevision,
      acknowledgement: {
        destination: "guild_trailer",
        status: "temporary_failure",
        error: { category: "transport", description: "stale failure must not overwrite success", retryable: true },
      },
    });
    assert.equal(preservedGuild?.status, "complete", "a late failure must not overwrite a completed sibling");
    const leasedUnknown = episodePromotionRepository.claimUnknownPromotionEffects({ notificationId: request.notification_id });
    assert.equal(leasedUnknown.length, 1);
    const recovered = episodePromotionRepository.recoverExpiredPromotionLeases(new Date(Date.now() + 120_000));
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "unknown");
    assert.equal(recovered[0]?.leaseId, null);
    const replay = await service.createOrReusePromotionIntent(requestInput, transport);
    assert.equal(transport.requests.length, 1, "ambiguous effects must reconcile before another send");
    assert.deepEqual(transport.reconciliations, ["advance_access"]);
    assert.equal(replay.effects.find((effect) => effect.destination === "guild_trailer")?.attemptCount, 1);
    assert.equal(replay.effects.find((effect) => effect.destination === "advance_access")?.status, "complete");
    assert.equal(replay.effects.find((effect) => effect.destination === "advance_access")?.topicId, "fake-topic");
    assert.equal(replay.effects.find((effect) => effect.destination === "advance_access")?.messageThreadId, "fake-thread");

    await assert.rejects(() => service.createOrReusePromotionIntent({ ...requestInput, title: "Different title" }), /Conflicting promotion payload fingerprint/);
    const incomplete = episodePromotionRepository.listIncompletePromotionEffects(request.notification_id);
    assert.equal(incomplete.length, 0);
    console.log("episode promotion state/replay verifier passed with fake acknowledgement loss and no duplicate send");
  } finally {
    getDb().close();
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
