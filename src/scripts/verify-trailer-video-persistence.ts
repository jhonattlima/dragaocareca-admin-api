import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { getDb } from "../database/sqlite";
import {
  episodeMediaFieldForKind,
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
  getEpisodeMediaStagingPath,
} from "../services/episode-media-layout.service";

const databasePath = path.resolve(config.sqlitePath);
const fixtureEpisodeId = 42;

const resetDatabase = (): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
};

const createPreMigrationDatabase = (): void => {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      episode_number INTEGER,
      episode_type TEXT,
      pub_date TEXT NOT NULL,
      duration TEXT,
      bytes INTEGER,
      explicit TEXT NOT NULL DEFAULT 'no',
      authors_json TEXT NOT NULL DEFAULT '[]',
      guests_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      citations_json TEXT NOT NULL DEFAULT '[]',
      file_name TEXT,
      cover_file_name TEXT,
      cover_low_file_name TEXT,
      trailer_file_name TEXT,
      youtube TEXT,
      spotify_id TEXT,
      xml_snapshot TEXT,
      music_credits_json TEXT NOT NULL DEFAULT '[]',
      cover_credits_json TEXT NOT NULL DEFAULT '[]',
      transcript_file_name TEXT,
      transcript_status TEXT NOT NULL DEFAULT 'idle',
      transcript_updated_at TEXT,
      transcript_error TEXT,
      launch_notification_state TEXT NOT NULL DEFAULT 'idle',
      launch_notification_queued_at TEXT,
      launch_notification_sent_at TEXT,
      launch_notification_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO episodes (episode_id, title, pub_date)
    VALUES (${fixtureEpisodeId}, 'Pre-migration trailer fixture', '2026-01-01T00:00:00.000Z');
  `);
  database.close();
};

const main = (): void => {
  resetDatabase();
  createPreMigrationDatabase();

  const columns = getDb().prepare("PRAGMA table_info(episodes)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  assert.ok(columnNames.has("trailer_video_file_name"));
  assert.ok(columnNames.has("trailer_video_sync_status"));

  const migrated = episodeRepository.findByEpisodeId(fixtureEpisodeId);
  assert.equal(migrated?.title, "Pre-migration trailer fixture");
  assert.equal(migrated?.trailerVideoFileName, undefined);
  assert.equal(migrated?.trailerVideoSyncStatus, "unpublished");

  const updated = episodeRepository.updateMedia(fixtureEpisodeId, {
    trailerVideoFileName: "episodes/42/trailer.mp4",
    trailerVideoSyncStatus: "manual-sync-required",
  });
  assert.equal(updated?.trailerVideoFileName, "episodes/42/trailer.mp4");
  assert.equal(updated?.trailerVideoSyncStatus, "manual-sync-required");
  assert.equal(updated?.trailerFileName, undefined);

  assert.equal(getEpisodeMediaRelativePath(fixtureEpisodeId, "trailerVideo"), "episodes/42/trailer.mp4");
  assert.equal(getEpisodeMediaFinalPath(fixtureEpisodeId, "trailerVideo"), path.resolve(config.media.storageRoot, "episodes/42/trailer.mp4"));
  assert.equal(getEpisodeMediaStagingPath(fixtureEpisodeId, "trailerVideo"), path.resolve(config.media.episodesStagingDir, "42/trailer.mp4"));
  assert.equal(episodeMediaFieldForKind("trailerVideo"), "trailerVideoFileName");
  assert.equal(getEpisodeMediaRelativePath(fixtureEpisodeId, "trailer"), "episodes/42/trailer.mp3");

  console.log("Trailer-video persistence verifier passed");
};

try {
  main();
} finally {
  getDb().close();
  resetDatabase();
}
