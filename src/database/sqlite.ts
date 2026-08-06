import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config/env";

export type EpisodeRecord = {
  id?: number;
  episodeId: number;
  title: string;
  summary: string;
  episodeNumber?: number | null;
  episodeType?: string | null;
  pubDate: string;
  duration?: string | null;
  bytes?: number | null;
  explicit: "yes" | "no";
  authors: string[];
  guests: string[];
  tags: string[];
  citations: string[];
  fileName?: string | null;
  coverFileName?: string | null;
  coverLowFileName?: string | null;
  trailerFileName?: string | null;
  trailerVideoFileName?: string | null;
  trailerVideoSyncStatus?: "unpublished" | "manual-sync-required" | "synced";
  youtube?: string | null;
  spotifyId?: string | null;
  xmlSnapshot?: string | null;
  musicCredits: string[];
  coverCredits: string[];
  transcriptFileName?: string | null;
  transcriptStatus?: "idle" | "pending" | "processing" | "done" | "error";
  transcriptUpdatedAt?: string | null;
  transcriptError?: string | null;
  launchNotificationState: "idle" | "pending" | "sent";
  launchNotificationQueuedAt?: string | null;
  launchNotificationSentAt?: string | null;
  launchNotificationError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type GuestRecord = {
  id?: number;
  name: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MusicRecord = {
  id?: number;
  name: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ReferenceRecord = {
  id?: number;
  label: string;
  url: string;
  isPrimary: number;
  isActive: number;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type EpisodeWithRelations = EpisodeRecord & {
  guests?: GuestRecord[];
  guestReferences?: Array<GuestRecord & { references: ReferenceRecord[] }>;
  music?: MusicRecord[];
  musicReferences?: Array<MusicRecord & { references: ReferenceRecord[] }>;
  references?: ReferenceRecord[];
};

let db: DatabaseSync | null = null;

const ensureDir = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  episode_number INTEGER,
  episode_type TEXT,
  pub_date TEXT NOT NULL,
  duration TEXT,
  bytes INTEGER,
  explicit TEXT NOT NULL DEFAULT 'no' CHECK (explicit IN ('yes', 'no')),
  authors_json TEXT NOT NULL DEFAULT '[]',
  guests_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  citations_json TEXT NOT NULL DEFAULT '[]',
  file_name TEXT,
  cover_file_name TEXT,
  cover_low_file_name TEXT,
  trailer_file_name TEXT,
  trailer_video_file_name TEXT,
  trailer_video_sync_status TEXT NOT NULL DEFAULT 'unpublished' CHECK (trailer_video_sync_status IN ('unpublished', 'manual-sync-required', 'synced')),
  youtube TEXT,
  spotify_id TEXT,
  xml_snapshot TEXT,
  music_credits_json TEXT NOT NULL DEFAULT '[]',
  cover_credits_json TEXT NOT NULL DEFAULT '[]',
  transcript_file_name TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'idle' CHECK (transcript_status IN ('idle', 'pending', 'processing', 'done', 'error')),
  transcript_updated_at TEXT,
  transcript_error TEXT,
  launch_notification_state TEXT NOT NULL DEFAULT 'idle' CHECK (launch_notification_state IN ('idle', 'pending', 'sent')),
  launch_notification_queued_at TEXT,
  launch_notification_sent_at TEXT,
  launch_notification_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episodes_pub_date ON episodes(pub_date);
CREATE INDEX IF NOT EXISTS idx_episodes_launch_state ON episodes(launch_notification_state, pub_date);

-- D-12/D-13/D-14: durable opaque artifact-job state, bounded public progress,
-- and selector-only source evidence for cache revalidation.
CREATE TABLE IF NOT EXISTS artifact_jobs (
  job_id TEXT PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  selector_key TEXT NOT NULL,
  requested_selectors_json TEXT NOT NULL,
  available_selectors_json TEXT NOT NULL,
  missing_selectors_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  archive_file_name TEXT,
  archive_path TEXT,
  snapshot_path TEXT,
  temporary_archive_path TEXT,
  source_evidence_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS episode_trailer_video_drafts (
  draft_id TEXT PRIMARY KEY,
  episode_id INTEGER NOT NULL UNIQUE,
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'staged', 'consumed', 'expired'))
);

-- D-08: durable, server-only coordination state for the private-first
-- trailer-video upload lifecycle. Source evidence is canonical relative media
-- metadata, never a browser-supplied or absolute filesystem path.
CREATE TABLE IF NOT EXISTS youtube_trailer_jobs (
  job_id TEXT PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  source_file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0),
  source_captured_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'transferring', 'processing', 'ready', 'failed', 'cancel_requested', 'cancelled', 'obsolete')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  worker_lease_id TEXT,
  lease_claimed_at TEXT,
  lease_heartbeat_at TEXT,
  session_uri TEXT,
  confirmed_bytes INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_bytes >= 0),
  provider_video_id TEXT,
  provider_privacy_status TEXT,
  provider_upload_status TEXT,
  provider_processing_status TEXT,
  provider_processing_parts_processed INTEGER,
  provider_processing_parts_total INTEGER,
  provider_processing_time_left_ms INTEGER,
  provider_checked_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at TEXT,
  error_category TEXT,
  error_message TEXT,
  error_reason TEXT,
  error_http_status INTEGER,
  error_at TEXT,
  cancel_requested_at TEXT,
  cancelled_at TEXT,
  cancellation_boundary TEXT,
  obsolete_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS youtube_hashtag_count_cache (
  normalized_tag TEXT NOT NULL,
  region_code TEXT NOT NULL,
  relevance_language TEXT NOT NULL,
  search_shape_version TEXT NOT NULL,
  approximate_count INTEGER NOT NULL CHECK (approximate_count BETWEEN 0 AND 1000000),
  retrieved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  error_category TEXT,
  PRIMARY KEY (normalized_tag, region_code, relevance_language, search_shape_version)
);

CREATE INDEX IF NOT EXISTS idx_youtube_hashtag_count_cache_fresh
  ON youtube_hashtag_count_cache(normalized_tag, region_code, relevance_language, search_shape_version, expires_at);

CREATE TABLE IF NOT EXISTS youtube_hashtag_quota_admissions (
  quota_date TEXT NOT NULL,
  caller_class TEXT NOT NULL CHECK (caller_class IN ('automatic', 'manual')),
  admitted_count INTEGER NOT NULL DEFAULT 0 CHECK (admitted_count >= 0),
  PRIMARY KEY (quota_date, caller_class)
);

CREATE INDEX IF NOT EXISTS idx_youtube_hashtag_quota_admissions_day
  ON youtube_hashtag_quota_admissions(quota_date, caller_class);

CREATE INDEX IF NOT EXISTS idx_episode_trailer_video_drafts_expiry
  ON episode_trailer_video_drafts(state, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_trailer_jobs_active_source
  ON youtube_trailer_jobs(episode_id, source_file_name, source_sha256, source_bytes)
  WHERE status IN ('queued', 'claimed', 'transferring', 'processing', 'cancel_requested');
CREATE INDEX IF NOT EXISTS idx_youtube_trailer_jobs_recovery
  ON youtube_trailer_jobs(status, next_attempt_at, lease_heartbeat_at, created_at, job_id);
CREATE INDEX IF NOT EXISTS idx_youtube_trailer_jobs_episode_source
  ON youtube_trailer_jobs(episode_id, source_file_name, source_sha256, source_bytes, created_at);

CREATE INDEX IF NOT EXISTS idx_artifact_jobs_active_selector
  ON artifact_jobs(episode_id, selector_key, status);
CREATE INDEX IF NOT EXISTS idx_artifact_jobs_pending_fifo
  ON artifact_jobs(status, created_at, job_id);
CREATE INDEX IF NOT EXISTS idx_artifact_jobs_episode_job
  ON artifact_jobs(episode_id, job_id);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guest_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS music (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS music_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  music_id INTEGER NOT NULL REFERENCES music(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episode_guests (
  episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  role_label TEXT,
  PRIMARY KEY (episode_id, guest_id)
);

CREATE TABLE IF NOT EXISTS episode_music (
  episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  music_id INTEGER NOT NULL REFERENCES music(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  usage_note TEXT,
  PRIMARY KEY (episode_id, music_id)
);

CREATE TABLE IF NOT EXISTS episode_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spotify_metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id TEXT NOT NULL,
  sample_date TEXT NOT NULL,
  network_id TEXT,
  starts INTEGER NOT NULL,
  streams INTEGER NOT NULL,
  listeners INTEGER NOT NULL,
  followers INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(show_id, sample_date)
);

CREATE INDEX IF NOT EXISTS idx_spotify_metric_samples_show_date
  ON spotify_metric_samples(show_id, sample_date);

CREATE TABLE IF NOT EXISTS youtube_metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  sample_date TEXT NOT NULL,
  views INTEGER NOT NULL,
  estimated_minutes_watched REAL NOT NULL,
  subscribers_gained INTEGER NOT NULL,
  subscribers_lost INTEGER NOT NULL,
  likes INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, sample_date)
);

CREATE INDEX IF NOT EXISTS idx_youtube_metric_samples_channel_date
  ON youtube_metric_samples(channel_id, sample_date);

CREATE VIEW IF NOT EXISTS v_episode_feed AS
SELECT
  e.*
FROM episodes e;

CREATE VIEW IF NOT EXISTS v_episode_admin AS
SELECT
  e.*
FROM episodes e;
`;

export const getDb = (): DatabaseSync => {
  if (!db) {
    const dbPath = path.resolve(config.sqlitePath);
    ensureDir(dbPath);
    if (config.sqliteReset && fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
    }
    db = new DatabaseSync(dbPath);
    db.exec(schema);
    ensureYoutubeMetricSampleColumns(db);
    ensureEpisodeTranscriptColumns(db);
    ensureEpisodeTrailerVideoColumns(db);
    ensureArtifactJobColumns(db);
    ensureEpisodeTrailerVideoDraftTable(db);
    ensureYoutubeTrailerJobColumns(db);
    ensureYoutubeHashtagCacheTables(db);
  }
  return db;
};

const ensureYoutubeHashtagCacheTables = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS youtube_hashtag_count_cache (
      normalized_tag TEXT NOT NULL,
      region_code TEXT NOT NULL,
      relevance_language TEXT NOT NULL,
      search_shape_version TEXT NOT NULL,
      approximate_count INTEGER NOT NULL DEFAULT 0,
      retrieved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      error_category TEXT,
      PRIMARY KEY (normalized_tag, region_code, relevance_language, search_shape_version)
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_hashtag_count_cache_fresh
      ON youtube_hashtag_count_cache(normalized_tag, region_code, relevance_language, search_shape_version, expires_at);
    CREATE TABLE IF NOT EXISTS youtube_hashtag_quota_admissions (
      quota_date TEXT NOT NULL,
      caller_class TEXT NOT NULL CHECK (caller_class IN ('automatic', 'manual')),
      admitted_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (quota_date, caller_class)
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_hashtag_quota_admissions_day
      ON youtube_hashtag_quota_admissions(quota_date, caller_class);
  `);
};

const ensureEpisodeTrailerVideoDraftTable = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS episode_trailer_video_drafts (
      draft_id TEXT PRIMARY KEY,
      episode_id INTEGER NOT NULL UNIQUE,
      owner_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'staged', 'consumed', 'expired'))
    );
    CREATE INDEX IF NOT EXISTS idx_episode_trailer_video_drafts_expiry
      ON episode_trailer_video_drafts(state, expires_at);
  `);
};

export const nowIso = (): string => new Date().toISOString();

const ensureYoutubeMetricSampleColumns = (database: DatabaseSync): void => {
  const columns = database.prepare("PRAGMA table_info(youtube_metric_samples)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("subscribers_current")) {
    database.exec("ALTER TABLE youtube_metric_samples ADD COLUMN subscribers_current INTEGER NOT NULL DEFAULT 0;");
  }
};

const ensureEpisodeTranscriptColumns = (database: DatabaseSync): void => {
  const columns = database.prepare("PRAGMA table_info(episodes)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("transcript_file_name")) {
    database.exec("ALTER TABLE episodes ADD COLUMN transcript_file_name TEXT;");
  }
  if (!columnNames.has("transcript_status")) {
    database.exec("ALTER TABLE episodes ADD COLUMN transcript_status TEXT NOT NULL DEFAULT 'idle';");
  }
  if (!columnNames.has("transcript_updated_at")) {
    database.exec("ALTER TABLE episodes ADD COLUMN transcript_updated_at TEXT;");
  }
  if (!columnNames.has("transcript_error")) {
    database.exec("ALTER TABLE episodes ADD COLUMN transcript_error TEXT;");
  }
};

const ensureEpisodeTrailerVideoColumns = (database: DatabaseSync): void => {
  const columns = database.prepare("PRAGMA table_info(episodes)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("trailer_video_file_name")) {
    database.exec("ALTER TABLE episodes ADD COLUMN trailer_video_file_name TEXT;");
  }
  if (!columnNames.has("trailer_video_sync_status")) {
    database.exec("ALTER TABLE episodes ADD COLUMN trailer_video_sync_status TEXT NOT NULL DEFAULT 'unpublished';");
  }
};

const ensureArtifactJobColumns = (database: DatabaseSync): void => {
  const columns = database.prepare("PRAGMA table_info(artifact_jobs)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("source_evidence_json")) {
    database.exec("ALTER TABLE artifact_jobs ADD COLUMN source_evidence_json TEXT NOT NULL DEFAULT '[]';");
  }
};

const ensureYoutubeTrailerJobColumns = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS youtube_trailer_jobs (
      job_id TEXT PRIMARY KEY,
      episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
      source_file_name TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      source_bytes INTEGER NOT NULL DEFAULT 1,
      source_captured_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      revision INTEGER NOT NULL DEFAULT 0,
      worker_lease_id TEXT,
      lease_claimed_at TEXT,
      lease_heartbeat_at TEXT,
      session_uri TEXT,
      confirmed_bytes INTEGER NOT NULL DEFAULT 0,
      provider_video_id TEXT,
      provider_privacy_status TEXT,
      provider_upload_status TEXT,
      provider_processing_status TEXT,
      provider_processing_parts_processed INTEGER,
      provider_processing_parts_total INTEGER,
      provider_processing_time_left_ms INTEGER,
      provider_checked_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      error_category TEXT,
      error_message TEXT,
      error_reason TEXT,
      error_http_status INTEGER,
      error_at TEXT,
      cancel_requested_at TEXT,
      cancelled_at TEXT,
      cancellation_boundary TEXT,
      obsolete_at TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT
    );
  `);

  const columns = database.prepare("PRAGMA table_info(youtube_trailer_jobs)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const additions = [
    ["source_file_name", "TEXT NOT NULL DEFAULT ''"],
    ["source_sha256", "TEXT NOT NULL DEFAULT ''"],
    ["source_bytes", "INTEGER NOT NULL DEFAULT 1"],
    ["source_captured_at", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'queued'"],
    ["revision", "INTEGER NOT NULL DEFAULT 0"],
    ["worker_lease_id", "TEXT"],
    ["lease_claimed_at", "TEXT"],
    ["lease_heartbeat_at", "TEXT"],
    ["session_uri", "TEXT"],
    ["confirmed_bytes", "INTEGER NOT NULL DEFAULT 0"],
    ["provider_video_id", "TEXT"],
    ["provider_privacy_status", "TEXT"],
    ["provider_upload_status", "TEXT"],
    ["provider_processing_status", "TEXT"],
    ["provider_processing_parts_processed", "INTEGER"],
    ["provider_processing_parts_total", "INTEGER"],
    ["provider_processing_time_left_ms", "INTEGER"],
    ["provider_checked_at", "TEXT"],
    ["retry_count", "INTEGER NOT NULL DEFAULT 0"],
    ["next_attempt_at", "TEXT"],
    ["error_category", "TEXT"],
    ["error_message", "TEXT"],
    ["error_reason", "TEXT"],
    ["error_http_status", "INTEGER"],
    ["error_at", "TEXT"],
    ["cancel_requested_at", "TEXT"],
    ["cancelled_at", "TEXT"],
    ["cancellation_boundary", "TEXT"],
    ["obsolete_at", "TEXT"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["completed_at", "TEXT"],
  ] as const;

  for (const [name, definition] of additions) {
    if (!columnNames.has(name)) {
      database.exec(`ALTER TABLE youtube_trailer_jobs ADD COLUMN ${name} ${definition};`);
    }
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_trailer_jobs_active_source
      ON youtube_trailer_jobs(episode_id, source_file_name, source_sha256, source_bytes)
      WHERE status IN ('queued', 'claimed', 'transferring', 'processing', 'cancel_requested');
    CREATE INDEX IF NOT EXISTS idx_youtube_trailer_jobs_recovery
      ON youtube_trailer_jobs(status, next_attempt_at, lease_heartbeat_at, created_at, job_id);
    CREATE INDEX IF NOT EXISTS idx_youtube_trailer_jobs_episode_source
      ON youtube_trailer_jobs(episode_id, source_file_name, source_sha256, source_bytes, created_at);
  `);
};
