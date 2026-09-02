import assert from "node:assert/strict";
import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { getMetaConnectionStatus } from "../services/meta-connection.service";
import { preflightEpisodePublicationMedia } from "../services/episode-publication-media.service";
import { createEpisodePublication } from "../services/episode-publication.service";
import { deliverInstagramReel } from "../services/instagram-reel-publication.service";
import { deliverFacebookNativeVideo } from "../services/facebook-native-video-publication.service";

const value = (name: string): string | null => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const fake = process.argv.includes("--fake-only") || process.argv.includes("--dry-run");
const live = process.argv.includes("--authorize-live");
const selected = (value("--destinations") ?? "instagram,facebook").split(",").filter((d): d is "instagram" | "facebook" => d === "instagram" || d === "facebook");

const main = async (): Promise<void> => {
  if (!fake && !live) throw new Error("Refusing fixture execution without --dry-run/--fake-only or --authorize-live.");
  const episodeId = Number(value("--episode-id"));
  assert(Number.isSafeInteger(episodeId) && episodeId > 0, "--episode-id is required");
  assert(selected.length > 0, "--destinations must include instagram and/or facebook");
  const episode = episodeRepository.findByEpisodeId(episodeId);
  assert(episode, `Episode ${episodeId} was not found.`);
  const media = await preflightEpisodePublicationMedia(episodeId);
  assert.equal(media.preflight.status, "ready");
  const publication = await createEpisodePublication(episode);
  const saved = { token: config.meta.userAccessToken, app: config.meta.appId, secret: config.meta.appSecret, page: config.meta.pageId, account: config.meta.instagramAccountId };
  if (fake) {
    config.meta.userAccessToken = ""; config.meta.appId = ""; config.meta.appSecret = ""; config.meta.pageId = ""; config.meta.instagramAccountId = "";
  }
  const connection = await getMetaConnectionStatus();
  if (fake) {
    console.log(JSON.stringify({ mode: "dry-run", episodeId, sourceRevision: publication.sourceRevision, source: { sha256: media.source.sha256, byteCount: media.source.byteCount }, destinations: selected, connection: { configured: connection.configured, graphApiVersion: connection.graphApiVersion, gates: connection.gates } }));
    Object.assign(config.meta, { userAccessToken: saved.token, appId: saved.app, appSecret: saved.secret, pageId: saved.page, instagramAccountId: saved.account });
    return;
  }
  if (!connection.configured || !connection.checks.identity || !connection.checks.linkage || !connection.checks.permissions || !connection.checks.version) throw new Error("Meta connection preflight did not pass; no publication attempted.");
  config.meta.instagramEnabled = selected.includes("instagram");
  config.meta.facebookReelEnabled = selected.includes("facebook");
  for (const effect of publication.effects) {
    if (effect.destination === "instagram_reel" && selected.includes("instagram")) await deliverInstagramReel(episodeId, effect);
    if (effect.destination === "facebook_native_video" && selected.includes("facebook")) await deliverFacebookNativeVideo(episodeId, effect);
  }
  console.log(JSON.stringify({ mode: "authorized-live", episodeId, sourceRevision: publication.sourceRevision, sourceSha256: media.source.sha256, destinations: selected, graphApiVersion: connection.graphApiVersion, result: "inspect authenticated publication status for redacted remote IDs/permalinks" }));
};

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "fixture failed"); process.exitCode = 1; });
