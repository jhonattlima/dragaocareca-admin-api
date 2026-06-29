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
  youtube?: string | null;
  spotifyId?: string | null;
  xmlSnapshot?: string | null;
  musicCredits: string[];
  coverCredits: string[];
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
  youtube TEXT,
  spotify_id TEXT,
  xml_snapshot TEXT,
  music_credits_json TEXT NOT NULL DEFAULT '[]',
  cover_credits_json TEXT NOT NULL DEFAULT '[]',
  launch_notification_state TEXT NOT NULL DEFAULT 'idle' CHECK (launch_notification_state IN ('idle', 'pending', 'sent')),
  launch_notification_queued_at TEXT,
  launch_notification_sent_at TEXT,
  launch_notification_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_episodes_pub_date ON episodes(pub_date);
CREATE INDEX IF NOT EXISTS idx_episodes_launch_state ON episodes(launch_notification_state, pub_date);

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
  }
  return db;
};

export const nowIso = (): string => new Date().toISOString();

const ensureYoutubeMetricSampleColumns = (database: DatabaseSync): void => {
  const columns = database.prepare("PRAGMA table_info(youtube_metric_samples)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("subscribers_current")) {
    database.exec("ALTER TABLE youtube_metric_samples ADD COLUMN subscribers_current INTEGER NOT NULL DEFAULT 0;");
  }
};
