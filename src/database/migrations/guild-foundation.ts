import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const GUILD_SCHEMA_VERSION = "001-guild-foundation";
export const guildSchemaSql = `CREATE TABLE guild_achievements (
  id TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "image_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "image_url" TEXT,
  "category" TEXT,
  "rarity" TEXT NOT NULL,
  "active" INTEGER DEFAULT 0 CHECK ("active" IN (0, 1)),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "badge_image_url" TEXT,
  scope TEXT NOT NULL DEFAULT 'guild' CHECK(scope IN ('guild','game')),
  game_key TEXT,
  CHECK((scope='guild' AND game_key IS NULL) OR (scope='game' AND game_key IS NOT NULL AND length(game_key)>0))
);

CREATE TABLE guild_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  "actor_id" TEXT REFERENCES guild_members(id) ON DELETE RESTRICT,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "details" TEXT CHECK ("details" IS NULL OR json_valid("details")),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  domain TEXT NOT NULL,
  source_collection TEXT,
  source_id TEXT
);

CREATE TABLE guild_birthday_wishes (
  id TEXT PRIMARY KEY NOT NULL,
  "recipient" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "author" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "year" REAL NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE("recipient","author","year")
);

CREATE TABLE guild_top5_entries (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "legacy_id" TEXT,
  "name" TEXT NOT NULL,
  "photo_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "photo_url" TEXT,
  "games" TEXT NOT NULL CHECK ("games" IS NULL OR json_valid("games")),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "legacy_created_at" TEXT
);

CREATE TABLE guild_event_scrolls (
  id TEXT PRIMARY KEY NOT NULL,
  "event" TEXT NOT NULL REFERENCES guild_events(id) ON DELETE RESTRICT,
  "scroll" TEXT NOT NULL REFERENCES guild_scrolls(id) ON DELETE RESTRICT,
  "object_id" TEXT NOT NULL,
  "first_profile" TEXT,
  "released" TEXT CHECK ("released" IS NULL OR json_valid("released")),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE("event","object_id"),
  UNIQUE(event,scroll)
);

CREATE TABLE guild_events (
  id TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL,
  "starts_at" TEXT NOT NULL,
  "ends_at" TEXT NOT NULL,
  "published" INTEGER DEFAULT 0 CHECK ("published" IN (0, 1)),
  "xp" INTEGER CHECK ("xp">=0),
  "first_bonus" REAL,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>=starts_at)
);

CREATE TABLE guild_film_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  "film_id" TEXT NOT NULL REFERENCES guild_films(id) ON DELETE RESTRICT,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "rating" REAL CHECK (rating BETWEEN 0 AND 10 AND rating * 2 = CAST(rating * 2 AS INTEGER)),
  "comment" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "rating_original_five" REAL,
  UNIQUE("film_id","member_id")
);

CREATE TABLE guild_film_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  "film_id" TEXT NOT NULL REFERENCES guild_films(id) ON DELETE RESTRICT,
  "selected_by" TEXT REFERENCES guild_members(id) ON DELETE RESTRICT,
  "watch_deadline" TEXT,
  "discussion_date" TEXT,
  "status" TEXT NOT NULL,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "pitch" TEXT,
  UNIQUE("film_id")
);

CREATE TABLE guild_film_discussions (
  id TEXT PRIMARY KEY NOT NULL,
  "film_id" TEXT NOT NULL REFERENCES guild_films(id) ON DELETE RESTRICT,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "body" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "moment" REAL,
  "as_guilder" INTEGER DEFAULT 0 CHECK ("as_guilder" IN (0, 1)),
  "reactions" TEXT CHECK ("reactions" IS NULL OR json_valid("reactions")),
  "removed" INTEGER DEFAULT 0 CHECK ("removed" IN (0, 1)),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "reply_to" TEXT REFERENCES guild_film_discussions(id) ON DELETE RESTRICT,
  UNIQUE(id,film_id),
  FOREIGN KEY(reply_to,film_id) REFERENCES guild_film_discussions(id,film_id) ON DELETE RESTRICT
);

CREATE TABLE guild_film_watchers (
  id TEXT PRIMARY KEY NOT NULL,
  "film_id" TEXT NOT NULL REFERENCES guild_films(id) ON DELETE RESTRICT,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "minute" REAL,
  "finished" INTEGER DEFAULT 0 CHECK ("finished" IN (0, 1)),
  "seen" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE("film_id","member_id")
);

CREATE TABLE guild_films (
  id TEXT PRIMARY KEY NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "year" REAL NOT NULL,
  "synopsis" TEXT,
  "poster_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "poster_url" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "runtime" REAL,
  "tmdb_id" REAL,
  "meta" TEXT CHECK ("meta" IS NULL OR json_valid("meta")),
  UNIQUE("slug")
);

CREATE TABLE guild_health_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "day" TEXT NOT NULL,
  "photo_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "shared" INTEGER DEFAULT 0 CHECK ("shared" IN (0, 1)),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL CHECK(kind IN ('fruit','blood')),
  next_eligible_day TEXT,
  CHECK(kind='blood' OR next_eligible_day IS NULL),
  UNIQUE("member_id","kind","day")
);

CREATE TABLE guild_game_plays (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "game" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IS NULL OR json_valid("state")),
  "finished" INTEGER DEFAULT 0 CHECK ("finished" IN (0, 1)),
  "xp" INTEGER CHECK ("xp">=0),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK(state_version>0),
  UNIQUE("member_id","game","day")
);

CREATE TABLE guild_manual_quests (
  id TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "image_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "proof" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "repeat" TEXT NOT NULL,
  "interval_hours" REAL,
  "xp" INTEGER CHECK ("xp">=0),
  "starts_at" TEXT,
  "ends_at" TEXT,
  "published" INTEGER DEFAULT 0 CHECK ("published" IN (0, 1)),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE guild_manual_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  "quest" TEXT NOT NULL REFERENCES guild_manual_quests(id) ON DELETE RESTRICT,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "text" TEXT,
  "photo_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "cycle" TEXT NOT NULL,
  "xp" INTEGER CHECK ("xp">=0),
  "revoked" INTEGER DEFAULT 0 CHECK ("revoked" IN (0, 1)),
  "reason" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE("quest","member_id","cycle")
);

CREATE TABLE guild_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "slot" TEXT NOT NULL,
  "title" TEXT,
  "body" TEXT,
  "read" INTEGER DEFAULT 0 CHECK ("read" IN (0, 1)),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "path" TEXT,
  UNIQUE("member_id","slot")
);

CREATE TABLE guild_member_achievements (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "achievement_id" TEXT NOT NULL REFERENCES guild_achievements(id) ON DELETE RESTRICT,
  "awarded_at" TEXT NOT NULL,
  "awarded_by" TEXT REFERENCES guild_members(id) ON DELETE RESTRICT,
  "notes" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source_domain TEXT NOT NULL DEFAULT 'legacy' CHECK(source_domain IN ('game','mission','community','event','administrative','legacy')),
  source_event_key TEXT,
  UNIQUE("member_id","achievement_id")
);

CREATE TABLE guild_members (
  id TEXT PRIMARY KEY NOT NULL,
  "display_name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "character_name" TEXT,
  "bio" TEXT,
  "avatar_file_id" TEXT REFERENCES guild_files(id) ON DELETE RESTRICT,
  "avatar_url" TEXT,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "species" TEXT,
  "class_name" TEXT,
  "alignment" TEXT,
  "attribute" REAL,
  "emblem" TEXT,
  "abilities" TEXT CHECK ("abilities" IS NULL OR json_valid("abilities")),
  "level" INTEGER,
  "sheet_sealed" INTEGER DEFAULT 0 CHECK ("sheet_sealed" IN (0, 1)),
  "xp" INTEGER NOT NULL DEFAULT 0 CHECK ("xp">=0),
  "support_months_prior" INTEGER NOT NULL DEFAULT 0 CHECK ("support_months_prior">=0),
  "is_host" INTEGER DEFAULT 0 CHECK ("is_host" IN (0, 1)),
  "tavern_character" TEXT,
  "tavern_master" INTEGER DEFAULT 0 CHECK ("tavern_master" IN (0, 1)),
  "birthday_md" TEXT,
  "birthday_hidden" INTEGER DEFAULT 0 CHECK ("birthday_hidden" IN (0, 1)),
  "support_roster_key" TEXT,
  "portrait_default" TEXT,
  xp_updated_at TEXT,
  UNIQUE("slug")
);

CREATE TABLE guild_push_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  "notification" TEXT NOT NULL REFERENCES guild_notifications(id) ON DELETE RESTRICT,
  "subscription" TEXT NOT NULL REFERENCES guild_push_subscriptions(id) ON DELETE RESTRICT,
  "sent" INTEGER DEFAULT 0 CHECK ("sent" IN (0, 1)),
  "lease" REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at TEXT,
  lease_expires_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  UNIQUE("notification","subscription")
);

CREATE TABLE guild_push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  invalidated_at TEXT,
  UNIQUE("endpoint")
);

CREATE TABLE guild_xp_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "event_key" TEXT NOT NULL,
  "delta_xp" INTEGER NOT NULL,
  "score" REAL,
  "total" REAL,
  "answers" TEXT CHECK ("answers" IS NULL OR json_valid("answers")),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "film_reward" INTEGER DEFAULT 0 CHECK ("film_reward" IN (0, 1)),
  source_domain TEXT NOT NULL CHECK(source_domain IN ('game','mission','community','event','administrative','legacy')),
  source_type TEXT NOT NULL,
  source_id TEXT,
  reversal_of TEXT REFERENCES guild_xp_ledger(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES guild_members(id) ON DELETE RESTRICT,
  reason TEXT,
  CHECK(reversal_of IS NULL OR reversal_of <> id),
  UNIQUE("member_id","event_key")
);

CREATE TABLE guild_reminder_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "enabled" INTEGER DEFAULT 0 CHECK ("enabled" IN (0, 1)),
  UNIQUE("member_id")
);

CREATE TABLE guild_scrolls (
  id TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "wiki_place" TEXT NOT NULL,
  "archived" INTEGER DEFAULT 0 CHECK ("archived" IN (0, 1)),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE guild_scroll_discoveries (
  id TEXT PRIMARY KEY NOT NULL,
  "item" TEXT NOT NULL REFERENCES guild_event_scrolls(id) ON DELETE RESTRICT,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "saved" INTEGER DEFAULT 0 CHECK ("saved" IN (0, 1)),
  "snapshot" TEXT CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  "first" INTEGER DEFAULT 0 CHECK ("first" IN (0, 1)),
  "xp" INTEGER CHECK ("xp">=0),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE("item","member_id")
);

CREATE TABLE guild_support_periods (
  id TEXT PRIMARY KEY NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT,
  "notes" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(end_date IS NULL OR end_date>=start_date)
);

CREATE TABLE guild_support_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  "source_key" TEXT NOT NULL,
  "member_id" TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  "result" TEXT,
  "snapshot" TEXT CHECK ("snapshot" IS NULL OR json_valid("snapshot")),
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE("source_key")
);

CREATE TABLE guild_tavern_notice_state (
  id TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL,
  "sent_at" REAL,
  UNIQUE("key")
);

CREATE TABLE guild_files (
  id TEXT PRIMARY KEY NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK(byte_count>=0),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
  status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
  uploaded_by TEXT REFERENCES guild_members(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE guild_member_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('email','phone')),
  normalized_value TEXT NOT NULL,
  purpose TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE(member_id,kind,normalized_value)
);

CREATE TABLE guild_identities (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE(provider,subject)
);

CREATE TABLE guild_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES guild_members(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  device_label TEXT,
  CHECK(expires_at>created_at)
);

CREATE TABLE guild_login_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT REFERENCES guild_members(id) ON DELETE RESTRICT,
  destination TEXT NOT NULL,
  channel TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  sent_at TEXT,
  window_start TEXT,
  window_count INTEGER NOT NULL DEFAULT 0 CHECK(window_count>=0)
);

CREATE TABLE guild_import_map (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  source_collection TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  run_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(source,source_collection,source_id)
);
CREATE INDEX guild_support_periods_lookup ON guild_support_periods(member_id,start_date,end_date);
CREATE INDEX guild_xp_ledger_lookup ON guild_xp_ledger(member_id,created_at);
CREATE INDEX guild_film_discussions_lookup ON guild_film_discussions(film_id,created_at,id);
CREATE INDEX guild_notifications_lookup ON guild_notifications(member_id,created_at,id);
CREATE INDEX guild_sessions_lookup ON guild_sessions(expires_at);
CREATE INDEX guild_audit_log_lookup ON guild_audit_log(domain,created_at,id);
CREATE INDEX guild_push_deliveries_lookup ON guild_push_deliveries(status,next_attempt_at);
CREATE UNIQUE INDEX guild_xp_reversal_once ON guild_xp_ledger(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE UNIQUE INDEX guild_first_discovery_once ON guild_scroll_discoveries(item) WHERE first=1;
CREATE UNIQUE INDEX guild_top5_legacy_id ON guild_top5_entries(legacy_id) WHERE legacy_id IS NOT NULL AND legacy_id<>'';
CREATE UNIQUE INDEX guild_member_roster_key ON guild_members(support_roster_key) WHERE support_roster_key IS NOT NULL AND support_roster_key<>'';
CREATE UNIQUE INDEX guild_member_tavern_owner ON guild_members(tavern_character) WHERE tavern_character IS NOT NULL AND tavern_character<>'';`;
export const guildSchemaChecksum = createHash("sha256").update(guildSchemaSql).digest("hex");
export const guildTables = ["guild_achievements", "guild_audit_log", "guild_birthday_wishes", "guild_event_scrolls", "guild_events", "guild_files", "guild_film_discussions", "guild_film_reviews", "guild_film_sessions", "guild_film_watchers", "guild_films", "guild_game_plays", "guild_health_submissions", "guild_identities", "guild_import_map", "guild_login_challenges", "guild_manual_quests", "guild_manual_submissions", "guild_member_achievements", "guild_member_contacts", "guild_members", "guild_notifications", "guild_push_deliveries", "guild_push_subscriptions", "guild_reminder_preferences", "guild_schema_migrations", "guild_scroll_discoveries", "guild_scrolls", "guild_sessions", "guild_support_periods", "guild_support_reconciliations", "guild_tavern_notice_state", "guild_top5_entries", "guild_xp_ledger"] as const;

export function getGuildSchemaState(db: DatabaseSync): "missing" | "ready" | "incompatible" {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='guild_schema_migrations'").get()) return "missing";
  const row = db.prepare("SELECT checksum FROM guild_schema_migrations WHERE version=?").get(GUILD_SCHEMA_VERSION);
  if (!row) return "missing";
  if (row.checksum !== guildSchemaChecksum) return "incompatible";
  const count = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,6)='guild_'").all();
  const present = new Set(count.map((entry) => entry.name));
  return guildTables.every((name) => present.has(name)) ? "ready" : "incompatible";
}

/** Explicit CLI only; never called by request handlers or podcast startup. */
export function migrateGuildFoundation(db: DatabaseSync): { applied: boolean; version: string } {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = getGuildSchemaState(db);
    if (state === "incompatible") throw new Error("Guild schema checksum or tables do not match this release");
    if (state === "ready") {
      db.exec("COMMIT");
      return { applied: false, version: GUILD_SCHEMA_VERSION };
    }
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,6)='guild_'").all();
    if (existing.length) throw new Error("Untracked Guild tables exist; migration requires reconciliation");
    db.exec("CREATE TABLE guild_schema_migrations(version TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
    db.exec(guildSchemaSql);
    const invalid = db.prepare("PRAGMA foreign_key_check").all();
    if (invalid.length) throw new Error("Foreign key validation failed; migration rolled back");
    db.prepare("INSERT INTO guild_schema_migrations VALUES(?,?,?)").run(GUILD_SCHEMA_VERSION,guildSchemaChecksum,new Date().toISOString());
    db.exec("COMMIT");
    return { applied: true, version: GUILD_SCHEMA_VERSION };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
