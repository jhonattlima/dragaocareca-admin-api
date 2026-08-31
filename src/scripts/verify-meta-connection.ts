import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const main = async (): Promise<void> => {
  if (!process.argv.includes("--fake-only")) throw new Error("This verifier requires --fake-only and never contacts a real transport.");
  globalThis.fetch = (async () => { throw new Error("real fetch is prohibited in fake-only verification"); }) as typeof fetch;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dragaocareca-meta-connection-"));
process.env.SQLITE_PATH = path.join(root, "meta.sqlite");
process.env.SQLITE_RESET = "true";
process.env.FEED_BASE_LINK = "https://podcast.example/episode/";
process.env.FEED_AUDIO_BASE = "https://media.example/audio/";
process.env.FEED_IMAGE_BASE = "https://media.example/images/";
process.env.FEED_TITLE = "Fake Podcast";
process.env.FEED_DESCRIPTION = "Offline verifier";
process.env.FEED_SITE = "https://podcast.example";

const [{ getDb }, { findMetaConnectionStatus }, { getMetaConnectionStatus, setMetaGraphClientForVerification }, { swaggerSpec }, { metaConnectionStatusSchema }, { config }] = await Promise.all([
  import("../database/sqlite.js"),
  import("../database/repositories/meta-connection.repository.js"),
  import("../services/meta-connection.service.js"),
  import("../docs/openapi.js"),
  import("../schemas/meta-connection.js"),
  import("../config/env.js"),
]);

const status = await getMetaConnectionStatus();
assert.equal(status.graphApiVersion, "v25.0");
assert.equal(status.accountTagging, "not_proven");
assert.equal(status.gates.instagram.status, "disabled");
assert.equal(status.gates.facebookReel.status, "disabled");
assert.equal(findMetaConnectionStatus()?.gates.instagram.status, "disabled");
assert.deepEqual(Object.keys(status).sort(), ["accountTagging", "checks", "checkedAt", "configured", "contractVersion", "diagnostic", "gates", "graphApiVersion", "page", "permissions", "requestId", "tasks", "token"].sort());

config.meta.userAccessToken = "fake-only-secret";
config.meta.appId = "fake-app";
config.meta.appSecret = "fake-secret";
config.meta.pageId = "page-1";
config.meta.instagramAccountId = "ig-1";
config.meta.instagramEnabled = true;
config.meta.facebookReelEnabled = true;
process.env.META_FACEBOOK_REEL_ENABLED = "true";
setMetaGraphClientForVerification({ probe: async () => ({ identity: true, linkage: true, permissions: true, permissionNames: ["CREATE_CONTENT"], taskNames: ["CREATE_CONTENT"], version: true, tokenStatus: "valid", expiresAt: null, requestId: "fake-request", diagnostic: "validated" }) });
const enabled = await getMetaConnectionStatus();
assert.equal(enabled.gates.instagram.canPublish, true);
assert.equal(enabled.gates.facebookReel.canPublish, true);
assert.equal(findMetaConnectionStatus()?.token.status, "valid");
assert.equal(JSON.stringify(enabled).includes("fake-secret"), false);
assert.equal(JSON.stringify(enabled).includes("access_token"), false);
assert.equal(JSON.stringify(enabled).includes("Authorization"), false);
assert.equal((swaggerSpec as { components: { schemas: Record<string, unknown> } }).components.schemas.MetaConnectionStatus !== undefined, true);
metaConnectionStatusSchema.parse(findMetaConnectionStatus());

  console.log("fake-only Meta connection verification passed: redaction, persistence, independent gates, and unproven tagging evidence");
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
