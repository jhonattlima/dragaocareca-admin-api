import { getDb, nowIso } from "../db/sqlite";
import type { EpisodeInput } from "../schemas/episode";

export type EpisodeRow = Omit<EpisodeInput, "pubDate"> & {
  id?: number;
  pubDate: string;
  authors: string[];
  guests: string[];
  tags: string[];
  citations: string[];
  musicCredits: string[];
  coverCredits: string[];
  launchNotificationState?: "idle" | "pending" | "sent";
  launchNotificationQueuedAt?: string | null;
  launchNotificationSentAt?: string | null;
  launchNotificationError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type SqliteEpisodeRow = {
  id: number;
  episode_id: number;
  title: string;
  summary: string;
  episode_number: number | null;
  episode_type: string | null;
  pub_date: string;
  duration: string | null;
  bytes: number | null;
  explicit: "yes" | "no";
  authors_json: string;
  guests_json: string;
  tags_json: string;
  citations_json: string;
  file_name: string | null;
  cover_file_name: string | null;
  cover_low_file_name: string | null;
  trailer_file_name: string | null;
  youtube: string | null;
  spotify_id: string | null;
  xml_snapshot: string | null;
  music_credits_json: string;
  cover_credits_json: string;
  launch_notification_state: "idle" | "pending" | "sent";
  launch_notification_queued_at: string | null;
  launch_notification_sent_at: string | null;
  launch_notification_error: string | null;
  created_at: string;
  updated_at: string;
};

const jsonArray = (value: unknown): string => JSON.stringify(Array.isArray(value) ? value : []);
const parseArray = (value: string | null | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const mapRow = (row: SqliteEpisodeRow): EpisodeRow => ({
  episodeId: row.episode_id,
  title: row.title,
  summary: row.summary,
  episodeNumber: row.episode_number ?? undefined,
  episodeType: row.episode_type ?? undefined,
  pubDate: row.pub_date,
  duration: row.duration ?? undefined,
  bytes: row.bytes ?? undefined,
  explicit: row.explicit,
  authors: parseArray(row.authors_json),
  guests: parseArray(row.guests_json),
  tags: parseArray(row.tags_json),
  citations: parseArray(row.citations_json),
  fileName: row.file_name ?? undefined,
  coverFileName: row.cover_file_name ?? undefined,
  coverLowFileName: row.cover_low_file_name ?? undefined,
  trailerFileName: row.trailer_file_name ?? undefined,
  youtube: row.youtube ?? undefined,
  spotifyId: row.spotify_id ?? undefined,
  xmlSnapshot: row.xml_snapshot ?? undefined,
  musicCredits: parseArray(row.music_credits_json),
  coverCredits: parseArray(row.cover_credits_json),
  launchNotificationState: row.launch_notification_state,
  launchNotificationQueuedAt: row.launch_notification_queued_at ?? undefined,
  launchNotificationSentAt: row.launch_notification_sent_at ?? undefined,
  launchNotificationError: row.launch_notification_error ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fetchOne = (episodeId: number): EpisodeRow | null => {
  const row = getDb()
    .prepare("SELECT * FROM episodes WHERE episode_id = ?")
    .get(episodeId) as SqliteEpisodeRow | undefined;
  return row ? mapRow(row) : null;
};

const baseInsert = `
INSERT INTO episodes (
  episode_id, title, summary, episode_number, episode_type, pub_date, duration, bytes, explicit,
  authors_json, guests_json, tags_json, citations_json, file_name, cover_file_name, cover_low_file_name,
  trailer_file_name, youtube, spotify_id, xml_snapshot, music_credits_json, cover_credits_json,
  launch_notification_state, launch_notification_queued_at, launch_notification_sent_at, launch_notification_error,
  created_at, updated_at
) VALUES (
  @episodeId, @title, @summary, @episodeNumber, @episodeType, @pubDate, @duration, @bytes, @explicit,
  @authorsJson, @guestsJson, @tagsJson, @citationsJson, @fileName, @coverFileName, @coverLowFileName,
  @trailerFileName, @youtube, @spotifyId, @xmlSnapshot, @musicCreditsJson, @coverCreditsJson,
  @launchNotificationState, @launchNotificationQueuedAt, @launchNotificationSentAt, @launchNotificationError,
  @createdAt, @updatedAt
)`;

const touchMediaRelations = (episodeId: number, values: EpisodeInput): void => {
  const db = getDb();
  const upsertName = (table: "guests" | "music", name: string): number => {
    const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number } | undefined;
    if (row) return row.id;
    const result = db.prepare(`INSERT INTO ${table} (name, created_at, updated_at) VALUES (?, ?, ?)`).run(name, nowIso(), nowIso());
    return Number(result.lastInsertRowid);
  };

  db.prepare("DELETE FROM episode_guests WHERE episode_id = ?").run(episodeId);
  db.prepare("DELETE FROM episode_music WHERE episode_id = ?").run(episodeId);

  values.guests.forEach((name, index) => {
    const guestId = upsertName("guests", name);
    db.prepare("INSERT OR REPLACE INTO episode_guests (episode_id, guest_id, sort_order) VALUES (?, ?, ?)")
      .run(episodeId, guestId, index);
  });

  values.musicCredits.forEach((name, index) => {
    const musicId = upsertName("music", name);
    db.prepare("INSERT OR REPLACE INTO episode_music (episode_id, music_id, sort_order) VALUES (?, ?, ?)")
      .run(episodeId, musicId, index);
  });
};

export const episodeRepository = {
  listAll(): EpisodeRow[] {
    const rows = getDb().prepare("SELECT * FROM episodes ORDER BY datetime(pub_date) DESC, episode_id DESC").all() as SqliteEpisodeRow[];
    return rows.map(mapRow);
  },
  listPublished(now = new Date()): EpisodeRow[] {
    const rows = getDb()
      .prepare("SELECT * FROM episodes WHERE datetime(pub_date) <= datetime(?) ORDER BY datetime(pub_date) DESC, episode_id DESC")
      .all(now.toISOString()) as SqliteEpisodeRow[];
    return rows.map(mapRow);
  },
  listPreview(): EpisodeRow[] {
    return this.listAll();
  },
  countPublished(now = new Date()): number {
    const row = getDb().prepare("SELECT count(*) as count FROM episodes WHERE datetime(pub_date) <= datetime(?)").get(now.toISOString()) as { count: number };
    return row.count;
  },
  countScheduled(now = new Date()): number {
    const row = getDb().prepare("SELECT count(*) as count FROM episodes WHERE datetime(pub_date) > datetime(?)").get(now.toISOString()) as { count: number };
    return row.count;
  },
  findNextScheduled(now = new Date()): EpisodeRow | null {
    const row = getDb()
      .prepare("SELECT * FROM episodes WHERE datetime(pub_date) > datetime(?) ORDER BY datetime(pub_date) ASC, episode_id ASC LIMIT 1")
      .get(now.toISOString()) as SqliteEpisodeRow | undefined;
    return row ? mapRow(row) : null;
  },
  findByEpisodeId(episodeId: number): EpisodeRow | null {
    return fetchOne(episodeId);
  },
  create(input: EpisodeInput): EpisodeRow {
    const db = getDb();
    const now = nowIso();
    const result = db.prepare(baseInsert).run({
      episodeId: input.episodeId,
      title: input.title,
      summary: input.summary ?? "",
      episodeNumber: input.episodeNumber ?? null,
      episodeType: input.episodeType ?? null,
      pubDate: new Date(input.pubDate).toISOString(),
      duration: input.duration ?? null,
      bytes: input.bytes ?? null,
      explicit: input.explicit,
      authorsJson: jsonArray(input.authors),
      guestsJson: jsonArray(input.guests),
      tagsJson: jsonArray(input.tags),
      citationsJson: jsonArray(input.citations),
      fileName: input.fileName ?? null,
      coverFileName: input.coverFileName ?? null,
      coverLowFileName: input.coverLowFileName ?? null,
      trailerFileName: input.trailerFileName ?? null,
      youtube: input.youtube ?? null,
      spotifyId: input.spotifyId ?? null,
      xmlSnapshot: input.xmlSnapshot ?? null,
      musicCreditsJson: jsonArray(input.musicCredits),
      coverCreditsJson: jsonArray(input.coverCredits),
      launchNotificationState: "idle",
      launchNotificationQueuedAt: null,
      launchNotificationSentAt: null,
      launchNotificationError: null,
      createdAt: now,
      updatedAt: now,
    });
    touchMediaRelations(input.episodeId, input);
    return this.findByEpisodeId(input.episodeId) as EpisodeRow;
  },
  update(episodeId: number, input: EpisodeInput): EpisodeRow | null {
    const existing = this.findByEpisodeId(episodeId);
    if (!existing) return null;
    const now = nowIso();
    getDb().prepare(`
      UPDATE episodes SET
        title = @title,
        summary = @summary,
        episode_number = @episodeNumber,
        episode_type = @episodeType,
        pub_date = @pubDate,
        duration = @duration,
        bytes = @bytes,
        explicit = @explicit,
        authors_json = @authorsJson,
        guests_json = @guestsJson,
        tags_json = @tagsJson,
        citations_json = @citationsJson,
        file_name = @fileName,
        cover_file_name = @coverFileName,
        cover_low_file_name = @coverLowFileName,
        trailer_file_name = @trailerFileName,
        youtube = @youtube,
        spotify_id = @spotifyId,
        xml_snapshot = @xmlSnapshot,
        music_credits_json = @musicCreditsJson,
        cover_credits_json = @coverCreditsJson,
        updated_at = @updatedAt
      WHERE episode_id = @episodeId
    `).run({
      episodeId,
      title: input.title,
      summary: input.summary ?? "",
      episodeNumber: input.episodeNumber ?? null,
      episodeType: input.episodeType ?? null,
      pubDate: new Date(input.pubDate).toISOString(),
      duration: input.duration ?? null,
      bytes: input.bytes ?? null,
      explicit: input.explicit,
      authorsJson: jsonArray(input.authors),
      guestsJson: jsonArray(input.guests),
      tagsJson: jsonArray(input.tags),
      citationsJson: jsonArray(input.citations),
      fileName: input.fileName ?? null,
      coverFileName: input.coverFileName ?? null,
      coverLowFileName: input.coverLowFileName ?? null,
      trailerFileName: input.trailerFileName ?? null,
      youtube: input.youtube ?? null,
      spotifyId: input.spotifyId ?? null,
      xmlSnapshot: input.xmlSnapshot ?? null,
      musicCreditsJson: jsonArray(input.musicCredits),
      coverCreditsJson: jsonArray(input.coverCredits),
      updatedAt: now,
    });
    touchMediaRelations(episodeId, input);
    return this.findByEpisodeId(episodeId);
  },
  delete(episodeId: number): void {
    getDb().prepare("DELETE FROM episodes WHERE episode_id = ?").run(episodeId);
  },
  updateMedia(
    episodeId: number,
    patch: Partial<
      Record<"fileName" | "trailerFileName" | "coverFileName" | "coverLowFileName", string | null>
    >
  ): EpisodeRow | null {
    const existing = this.findByEpisodeId(episodeId);
    if (!existing) return null;
    const assignments: string[] = [];
    const params: Record<string, string | number | null> = {
      episodeId,
      updatedAt: nowIso(),
    };

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const column =
        key === "fileName"
          ? "file_name"
          : key === "trailerFileName"
            ? "trailer_file_name"
            : key === "coverFileName"
              ? "cover_file_name"
              : "cover_low_file_name";
      assignments.push(`${column} = @${key}`);
      params[key] = value;
    }

    if (assignments.length === 0) {
      return existing;
    }

    assignments.push("updated_at = @updatedAt");
    getDb().prepare(`UPDATE episodes SET ${assignments.join(", ")} WHERE episode_id = @episodeId`).run(params);
    return this.findByEpisodeId(episodeId);
  },
  queueLaunchNotification(episodeId: number): EpisodeRow | null {
    const existing = this.findByEpisodeId(episodeId);
    if (!existing) return null;
    if (existing.launchNotificationState !== "idle") return existing;
    getDb().prepare(`
      UPDATE episodes SET launch_notification_state = 'pending', launch_notification_queued_at = ?, launch_notification_error = NULL, updated_at = ?
      WHERE episode_id = ?
    `).run(nowIso(), nowIso(), episodeId);
    return this.findByEpisodeId(episodeId);
  },
  markLaunchSent(episodeId: number): EpisodeRow | null {
    const existing = this.findByEpisodeId(episodeId);
    if (!existing) return null;
    getDb().prepare(`
      UPDATE episodes SET launch_notification_state = 'sent', launch_notification_sent_at = ?, launch_notification_error = NULL, updated_at = ?
      WHERE episode_id = ?
    `).run(nowIso(), nowIso(), episodeId);
    return this.findByEpisodeId(episodeId);
  },
  markLaunchError(episodeId: number, message: string): EpisodeRow | null {
    getDb().prepare(`
      UPDATE episodes SET launch_notification_error = ?, updated_at = ? WHERE episode_id = ?
    `).run(message, nowIso(), episodeId);
    return this.findByEpisodeId(episodeId);
  },
  getPendingLaunchNotifications(): EpisodeRow[] {
    const rows = getDb()
      .prepare("SELECT * FROM episodes WHERE launch_notification_state = 'pending' AND datetime(pub_date) <= datetime(?) ORDER BY datetime(pub_date) ASC, episode_id ASC")
      .all(new Date().toISOString()) as SqliteEpisodeRow[];
    return rows.map(mapRow);
  },
};
