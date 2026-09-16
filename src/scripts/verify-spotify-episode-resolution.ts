import assert from "node:assert/strict";
import fs from "node:fs";
import { getDb } from "../database/sqlite";
import { episodeRepository } from "../database/repositories/episode.repository";
import { createSpotifyEpisodeProvider, reconcileSpotifyEpisodeIds } from "../services/spotify-episode-resolver.service";

const main = async (): Promise<void> => {
const db = getDb();
db.exec("DELETE FROM spotify_episode_resolution_audits; DELETE FROM episodes;");
const insert = db.prepare(`INSERT INTO episodes (episode_id, title, summary, pub_date, explicit, is_draft, spotify_id) VALUES (?, ?, '', ?, 'no', 0, ?)`);
insert.run(1, "Valid", "2020-01-01T00:00:00.000Z", "valid-id");
insert.run(2, "Stale", "2020-01-02T00:00:00.000Z", "obsolete-id");
insert.run(3, "No Match", "2020-01-03T00:00:00.000Z", "old-no-match");
insert.run(4, "Ambiguous", "2020-01-04T00:00:00.000Z", "old-ambiguous");

const catalog = [{ id: "valid-id", name: "Valid" }, { id: "new-id", name: "Stale" }, { id: "amb-1", name: "Ambiguous" }, { id: "amb-2", name: " ambiguous " }];
const results = reconcileSpotifyEpisodeIds(episodeRepository.listPublished(), catalog, (episodeId, expected, next) => episodeRepository.replaceSpotifyIdIfExpected(episodeId, expected, next));
assert.deepEqual(results.slice().sort((a, b) => a.episodeId - b.episodeId).map((item) => item.decision), ["valid", "replaced", "missing", "ambiguous"]);
assert.equal(episodeRepository.findByEpisodeId(1)?.spotifyId, "valid-id");
assert.equal(episodeRepository.findByEpisodeId(2)?.spotifyId, "new-id");
assert.equal(episodeRepository.findByEpisodeId(3)?.spotifyId, "old-no-match");
assert.equal(episodeRepository.findByEpisodeId(4)?.spotifyId, "old-ambiguous");
assert.equal(episodeRepository.replaceSpotifyIdIfExpected(2, "obsolete-id", "wrong-id"), false);

const runId = "offline-run";
for (const result of results) episodeRepository.recordSpotifyResolutionAudit({ auditId: `${runId}:${result.episodeId}`, runId, ...result });
assert.equal((db.prepare("SELECT count(*) AS count FROM spotify_episode_resolution_audits WHERE run_id = ?").get(runId) as { count: number }).count, 4);

const originalFetch = globalThis.fetch;
let page = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  if (String(input).includes("accounts.spotify.com")) return new Response(JSON.stringify({ access_token: "offline-token" }), { status: 200 });
  page += 1;
  return new Response(JSON.stringify({ items: page === 1 ? [{ id: "p1", name: "One" }] : [{ id: "p2", name: "Two" }], total: 2, next: page === 1 ? "next" : null }), { status: 200 });
}) as typeof fetch;
try { assert.deepEqual((await createSpotifyEpisodeProvider().listAllEpisodes!()).map((item) => item.id), ["p1", "p2"]); } finally { globalThis.fetch = originalFetch; }

let failedOnce = true;
globalThis.fetch = (async (input: string | URL | Request) => {
  if (String(input).includes("accounts.spotify.com")) return new Response(JSON.stringify({ access_token: "offline-token" }), { status: 200 });
  if (failedOnce) { failedOnce = false; return new Response("provider failure", { status: 503 }); }
  return new Response(JSON.stringify({ items: [{ id: "retry-id", name: "Retry" }], total: 1, next: null }), { status: 200 });
}) as typeof fetch;
try {
  await assert.rejects(() => createSpotifyEpisodeProvider().listAllEpisodes!());
  assert.deepEqual((await createSpotifyEpisodeProvider().listAllEpisodes!()).map((item) => item.id), ["retry-id"]);
  episodeRepository.recordSpotifyResolutionAudit({ auditId: `${runId}:provider`, runId, decision: "provider_error", reason: "provider failure (retryable)" });
  assert.equal((db.prepare("SELECT count(*) AS count FROM spotify_episode_resolution_audits WHERE decision = 'provider_error'").get() as { count: number }).count, 1);
} finally { globalThis.fetch = originalFetch; }

console.info("Spotify episode resolution verification passed", { pagination: true, decisions: results.map((item) => item.decision), audits: 4, temporaryDatabase: true });
const sqlitePath = process.env.SQLITE_PATH;
if (sqlitePath) for (const suffix of ["", "-wal", "-shm"]) { try { fs.rmSync(`${sqlitePath}${suffix}`, { force: true }); } catch { /* best effort */ } }
};
void main();
