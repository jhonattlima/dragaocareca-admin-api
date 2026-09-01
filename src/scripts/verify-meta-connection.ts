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

// Start from an explicitly empty connection regardless of developer .env files.
config.meta.userAccessToken = "";
config.meta.appId = "";
config.meta.appSecret = "";
config.meta.pageId = "";
config.meta.instagramAccountId = "";
config.meta.instagramEnabled = false;
config.meta.facebookReelEnabled = false;
const status = await getMetaConnectionStatus();
assert.equal(status.graphApiVersion, "v25.0");
assert.equal(status.accountTagging, "not_proven");
assert.equal(status.gates.instagram.status, "disabled");
assert.equal(status.gates.facebookReel.status, "disabled");
assert.equal(findMetaConnectionStatus()?.gates.instagram.status, "disabled");
assert.deepEqual(Object.keys(status).sort(), ["accountTagging", "checks", "checkedAt", "configured", "contractVersion", "diagnostic", "gates", "graphApiVersion", "page", "permissions", "requestId", "tasks", "token"].sort());

const serviceSource = await fs.readFile(path.join(process.cwd(), "src/services/meta-connection.service.ts"), "utf8");
for (const forbidden of ["/media", "media_publish", "video_reels", "rupload.facebook.com", "POST", "PUT", "DELETE"]) {
  assert.equal(serviceSource.includes(forbidden), false, `connection service must not contain provider write surface: ${forbidden}`);
}
for (const forbidden of ["fake-only-secret", "fake-secret", "access_token", "Authorization", "graph.facebook.com", "/tmp/"]) {
  assert.equal(JSON.stringify(status).includes(forbidden), false, `safe status leaked ${forbidden}`);
}

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

const validProbe = { identity: true, linkage: true, permissions: true, permissionNames: ["CREATE_CONTENT"], taskNames: ["CREATE_CONTENT", "MANAGE"], version: true, tokenStatus: "valid" as const, expiresAt: null, requestId: "fake-request", diagnostic: "validated" as const };
setMetaGraphClientForVerification({ probe: async () => validProbe });
config.meta.instagramEnabled = true;
config.meta.facebookReelEnabled = false;
const instagramOnly = await getMetaConnectionStatus();
assert.equal(instagramOnly.gates.instagram.status, "ready");
assert.equal(instagramOnly.gates.facebookReel.status, "disabled");

config.meta.facebookReelEnabled = true;
setMetaGraphClientForVerification({ probe: async () => ({ ...validProbe, permissions: false, permissionNames: [], taskNames: [] }) });
const missingPermissions = await getMetaConnectionStatus();
assert.equal(missingPermissions.gates.instagram.status, "blocked");
assert.equal(missingPermissions.gates.facebookReel.status, "blocked");
assert.match(missingPermissions.gates.instagram.reasons.join(" "), /permissions/);

for (const tokenStatus of ["invalid", "expiring", "unknown"] as const) {
  setMetaGraphClientForVerification({ probe: async () => ({ ...validProbe, tokenStatus }) });
  const tokenFailure = await getMetaConnectionStatus();
  assert.equal(tokenFailure.gates.instagram.canPublish, false);
  assert.match(tokenFailure.gates.instagram.reasons.join(" "), new RegExp(tokenStatus));
}

setMetaGraphClientForVerification({ probe: async () => ({ ...validProbe, linkage: false }) });
const staleLinkage = await getMetaConnectionStatus();
assert.equal(staleLinkage.gates.instagram.canPublish, false);
assert.equal(staleLinkage.gates.facebookReel.canPublish, true, "Facebook gate must remain independent of Instagram linkage");

config.meta.graphApiVersion = "v24.0";
const staleVersion = await getMetaConnectionStatus();
assert.equal(staleVersion.checks.version, false);
assert.equal(staleVersion.gates.instagram.canPublish, false);
config.meta.graphApiVersion = "v25.0";

config.meta.userAccessToken = "";
const missingConfiguration = await getMetaConnectionStatus();
assert.equal(missingConfiguration.configured, false);
assert.equal(missingConfiguration.diagnostic, "not_configured");
assert.equal(missingConfiguration.gates.instagram.canPublish, false);
config.meta.userAccessToken = "fake-only-secret";

const schema = (swaggerSpec as { components: { schemas: Record<string, { properties?: Record<string, unknown>; additionalProperties?: boolean }> } }).components.schemas.MetaConnectionStatus;
assert.equal(schema.additionalProperties, false);
assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), Object.keys(status).sort());
metaConnectionStatusSchema.parse(findMetaConnectionStatus());

  console.log("fake-only Meta connection verification passed: redaction, persistence, failure matrix, independent gates, OpenAPI parity, unproven tagging, and zero provider writes");
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
