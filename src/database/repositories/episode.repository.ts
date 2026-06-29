import fs from "node:fs";
import path from "node:path";
import { getDb, nowIso } from "../sqlite";
import type { EpisodeInput } from "../../schemas/episode";

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

type StructuredEntryReference = {
  name: string;
  links: Array<{ label: string; url: string }>;
};

type StructuredEntryCatalog = {
  guests: StructuredEntryReference[];
  musicCredits: StructuredEntryReference[];
};

type LegacyArchiveEntry = {
  name?: string;
  contacts?: Record<string, unknown>;
};

type LegacyArchiveEpisode = {
  guests?: LegacyArchiveEntry[];
  music_credits?: LegacyArchiveEntry[];
  musicCredits?: LegacyArchiveEntry[];
};

let legacyArchiveCatalogCache: StructuredEntryCatalog | null = null;

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

const parseStructuredEntry = (value: string): StructuredEntryReference | null => {
  const fallbackName = value.trim();
  if (!fallbackName) {
    return null;
  }

  try {
    const decoded = JSON.parse(value) as { name?: unknown; links?: unknown };
    const name = typeof decoded.name === "string" ? decoded.name.trim() : fallbackName;
    const rawLinks = Array.isArray(decoded.links) ? decoded.links : [];
    const links = rawLinks
      .map((link) => {
        if (!link || typeof link !== "object") {
          return null;
        }

        const candidate = link as { label?: unknown; url?: unknown };
        const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
        const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
        if (!label && !url) {
          return null;
        }

        return { label, url };
      })
      .filter((link): link is { label: string; url: string } => link !== null);

    return name ? { name, links } : null;
  } catch {
    return { name: fallbackName, links: [] };
  }
};

const mergeStructuredEntries = (entries: StructuredEntryReference[]): StructuredEntryReference[] => {
  const merged = new Map<string, StructuredEntryReference>();

  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        name: entry.name.trim(),
        links: uniqueLinks(entry.links),
      });
      continue;
    }

    for (const link of entry.links) {
      const normalizedLabel = normalizeReferenceLabel(link.label);
      const normalizedUrl = normalizeReferenceUrl(link.url);
      const alreadyExists = existing.links.some(
        (current) => normalizeReferenceLabel(current.label) === normalizedLabel && normalizeReferenceUrl(current.url) === normalizedUrl
      );
      if (!alreadyExists) {
        existing.links.push({ label: link.label.trim(), url: normalizedUrl });
      }
    }
  }

  return [...merged.values()].map((entry) => ({
    name: entry.name.trim(),
    links: uniqueLinks(entry.links),
  }));
};

const normalizeReferenceLabel = (value: string): string => value.trim().toLowerCase();

const mergeReferenceCatalogRows = (
  rows: Array<{
    entityId: number;
    entityName: string;
    referenceLabel: string | null;
    referenceUrl: string | null;
    referenceSortOrder: number | null;
    referenceId: number | null;
  }>
): StructuredEntryReference[] => {
  const catalog = new Map<number, StructuredEntryReference>();

  for (const row of rows) {
    const entityName = row.entityName.trim();
    if (!entityName) {
      continue;
    }

    const existing = catalog.get(row.entityId);
    if (!existing) {
      catalog.set(row.entityId, {
        name: entityName,
        links: [],
      });
    }

    const entry = catalog.get(row.entityId);
    if (!entry || !row.referenceLabel && !row.referenceUrl) {
      continue;
    }

    const label = (row.referenceLabel ?? "").trim();
    const url = normalizeReferenceUrl(row.referenceUrl ?? "");
    if (!label && !url) {
      continue;
    }

    const duplicate = entry.links.some((link) => normalizeReferenceLabel(link.label) === normalizeReferenceLabel(label) && normalizeReferenceUrl(link.url) === url);
    if (!duplicate) {
      entry.links.push({ label, url });
    }
  }

  return [...catalog.values()].map((entry) => ({
    name: entry.name.trim(),
    links: uniqueLinks(entry.links),
  })).sort((left, right) => left.name.localeCompare(right.name));
};

const normalizeReferenceUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const prepared = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/\//, "")}`;
  try {
    const parsed = new URL(prepared);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const normalized = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    return normalized.replace(/\/+$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .replace(/\/$/, "");
  }
};

const uniqueLinks = (links: Array<{ label: string; url: string }>): Array<{ label: string; url: string }> => {
  const unique = new Map<string, { label: string; url: string }>();
  for (const link of links) {
    const label = link.label.trim();
    const url = normalizeReferenceUrl(link.url);
    if (!label && !url) {
      continue;
    }
    const key = `${normalizeReferenceLabel(label)}|${url}`;
    if (!unique.has(key)) {
      unique.set(key, { label, url });
    }
  }
  return [...unique.values()];
};

const legacyContactEntriesToStructured = (entries: LegacyArchiveEntry[] | undefined): StructuredEntryReference[] => {
  if (!Array.isArray(entries)) {
    return [];
  }

  const catalog = new Map<string, StructuredEntryReference>();

  for (const entry of entries) {
    const name = (entry?.name ?? "").trim();
    if (!name) {
      continue;
    }

    const contacts = entry.contacts && typeof entry.contacts === "object" ? entry.contacts : {};
    const links = Object.entries(contacts)
      .map(([label, url]) => {
        if (typeof url !== "string") {
          return null;
        }

        const normalizedUrl = normalizeReferenceUrl(url);
        const normalizedLabel = label.trim();
        if (!normalizedLabel && !normalizedUrl) {
          return null;
        }

        return {
          label: normalizedLabel,
          url: normalizedUrl,
        };
      })
      .filter((link): link is { label: string; url: string } => link !== null);

    const key = name.toLowerCase();
    const existing = catalog.get(key);
    if (!existing) {
      catalog.set(key, { name, links });
      continue;
    }

    for (const link of links) {
      const duplicate = existing.links.some(
        (current) =>
          normalizeReferenceLabel(current.label) === normalizeReferenceLabel(link.label) &&
          normalizeReferenceUrl(current.url) === normalizeReferenceUrl(link.url)
      );
      if (!duplicate) {
        existing.links.push(link);
      }
    }
  }

  return [...catalog.values()];
};

const loadLegacyArchiveCatalog = (): StructuredEntryCatalog => {
  if (legacyArchiveCatalogCache) {
    return legacyArchiveCatalogCache;
  }

  try {
    const archivePath = path.resolve(process.cwd(), "data", "all_episodes.json");
    if (!fs.existsSync(archivePath)) {
      legacyArchiveCatalogCache = { guests: [], musicCredits: [] };
      return legacyArchiveCatalogCache;
    }

    const payload = JSON.parse(fs.readFileSync(archivePath, "utf8")) as LegacyArchiveEpisode[];
    const guests: StructuredEntryReference[] = [];
    const musicCredits: StructuredEntryReference[] = [];

    for (const episode of payload) {
      guests.push(...legacyContactEntriesToStructured(episode.guests));
      musicCredits.push(...legacyContactEntriesToStructured(episode.music_credits ?? episode.musicCredits));
    }

    legacyArchiveCatalogCache = {
      guests: mergeStructuredEntries(guests),
      musicCredits: mergeStructuredEntries(musicCredits),
    };
    return legacyArchiveCatalogCache;
  } catch {
    legacyArchiveCatalogCache = { guests: [], musicCredits: [] };
    return legacyArchiveCatalogCache;
  }
};

const cleanupReferenceTable = (table: "guest_references" | "music_references", entityColumn: "guest_id" | "music_id"): void => {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT id, ${entityColumn} AS entityId, label, url, sort_order AS sortOrder
      FROM ${table}
      ORDER BY ${entityColumn} ASC, sort_order ASC, id ASC
    `)
    .all() as Array<{ id: number; entityId: number; label: string; url: string; sortOrder: number }>;

  const seen = new Set<string>();

  for (const row of rows) {
    const normalizedLabel = normalizeReferenceLabel(row.label);
    const normalizedUrl = normalizeReferenceUrl(row.url);
    const key = `${row.entityId}|${normalizedLabel}|${normalizedUrl}`;

    if (!normalizedLabel && !normalizedUrl) {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
      continue;
    }

    if (seen.has(key)) {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
      continue;
    }

    seen.add(key);
    if (row.label.trim() !== row.label || row.url !== normalizedUrl) {
      db.prepare(`UPDATE ${table} SET label = ?, url = ?, updated_at = ? WHERE id = ?`).run(
        row.label.trim(),
        normalizedUrl,
        nowIso(),
        row.id
      );
    }
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

  const replaceReferences = (
    table: "guest_references" | "music_references",
    entityColumn: "guest_id" | "music_id",
    entityId: number,
    links: Array<{ label: string; url: string }>
  ): void => {
    db.prepare(`DELETE FROM ${table} WHERE ${entityColumn} = ?`).run(entityId);

    const unique = new Map<string, { label: string; url: string }>();
    for (const link of links) {
      const label = link.label.trim();
      const url = normalizeReferenceUrl(link.url);
      if (!label && !url) {
        continue;
      }

      const key = `${normalizeReferenceLabel(label)}|${url}`;
      if (!unique.has(key)) {
        unique.set(key, { label, url });
      }
    }

    [...unique.values()].forEach((link, index) => {
      db.prepare(`
        INSERT INTO ${table} (
          ${entityColumn},
          label,
          url,
          is_primary,
          is_active,
          sort_order,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entityId,
        link.label,
        link.url,
        index === 0 ? 1 : 0,
        1,
        index,
        nowIso(),
        nowIso()
      );
    });
  };

  const guestEntries = values.guests
    .map((value) => parseStructuredEntry(value))
    .filter((entry): entry is StructuredEntryReference => entry !== null && entry.name.length > 0);
  const musicEntries = values.musicCredits
    .map((value) => parseStructuredEntry(value))
    .filter((entry): entry is StructuredEntryReference => entry !== null && entry.name.length > 0);
  const mergedGuestEntries = mergeStructuredEntries(guestEntries);
  const mergedMusicEntries = mergeStructuredEntries(musicEntries);

  db.prepare("DELETE FROM episode_guests WHERE episode_id = ?").run(episodeId);
  db.prepare("DELETE FROM episode_music WHERE episode_id = ?").run(episodeId);

  mergedGuestEntries.forEach((entry, index) => {
    const guestId = upsertName("guests", entry.name);
    db.prepare("INSERT OR REPLACE INTO episode_guests (episode_id, guest_id, sort_order) VALUES (?, ?, ?)")
      .run(episodeId, guestId, index);
    replaceReferences("guest_references", "guest_id", guestId, entry.links);
  });

  mergedMusicEntries.forEach((entry, index) => {
    const musicId = upsertName("music", entry.name);
    db.prepare("INSERT OR REPLACE INTO episode_music (episode_id, music_id, sort_order) VALUES (?, ?, ?)")
      .run(episodeId, musicId, index);
    replaceReferences("music_references", "music_id", musicId, entry.links);
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
  listStructuredEntryCatalog(): StructuredEntryCatalog {
    cleanupReferenceTable("guest_references", "guest_id");
    cleanupReferenceTable("music_references", "music_id");

    const guestRows = getDb()
      .prepare(`
        SELECT
          g.id AS entityId,
          g.name AS entityName,
          gr.label AS referenceLabel,
          gr.url AS referenceUrl,
          gr.sort_order AS referenceSortOrder,
          gr.id AS referenceId
        FROM guests g
        LEFT JOIN guest_references gr
          ON gr.guest_id = g.id
         AND gr.is_active = 1
        ORDER BY lower(g.name) ASC, gr.sort_order ASC, gr.id ASC
      `)
      .all() as Array<{
        entityId: number;
        entityName: string;
        referenceLabel: string | null;
        referenceUrl: string | null;
        referenceSortOrder: number | null;
        referenceId: number | null;
      }>;

    const musicRows = getDb()
      .prepare(`
        SELECT
          m.id AS entityId,
          m.name AS entityName,
          mr.label AS referenceLabel,
          mr.url AS referenceUrl,
          mr.sort_order AS referenceSortOrder,
          mr.id AS referenceId
        FROM music m
        LEFT JOIN music_references mr
          ON mr.music_id = m.id
         AND mr.is_active = 1
        ORDER BY lower(m.name) ASC, mr.sort_order ASC, mr.id ASC
      `)
      .all() as Array<{
        entityId: number;
        entityName: string;
        referenceLabel: string | null;
        referenceUrl: string | null;
        referenceSortOrder: number | null;
        referenceId: number | null;
      }>;

    const dbCatalog = {
      guests: mergeReferenceCatalogRows(guestRows),
      musicCredits: mergeReferenceCatalogRows(musicRows),
    };
    const legacyCatalog = loadLegacyArchiveCatalog();

    return {
      guests: mergeStructuredEntries([...dbCatalog.guests, ...legacyCatalog.guests]),
      musicCredits: mergeStructuredEntries([...dbCatalog.musicCredits, ...legacyCatalog.musicCredits]),
    };
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
