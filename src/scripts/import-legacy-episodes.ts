import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connectDb } from "../database/connect";
import { getDb } from "../database/sqlite";
import { episodeRepository } from "../database/repositories/episode.repository";
import { episodeSchema } from "../schemas/episode";
import { getEpisodeMediaFinalPath, getEpisodeMediaRelativePath, type EpisodeMediaKind } from "../services/episode-media-layout.service";

type LegacyEpisode = {
  ID: number;
  episode?: number;
  title?: string;
  summary?: string;
  file?: string;
  bytes?: number;
  explicit?: string;
  tags?: string[];
  authors?: string[];
  cover_credits?: Array<{ name?: string }>;
  music_credits?: LegacyContactEntry[];
  citations?: Array<{ name?: string }>;
  guests?: LegacyContactEntry[];
  img?: string;
  duration?: string;
  youtube?: string;
  spotify_id?: string;
  xml?: string;
  pubDate?: string;
};

type LegacyContactEntry = {
  name?: string;
  contacts?: unknown;
};

type StructuredEntry = {
  name: string;
  links: Array<{ label: string; url: string }>;
};

const canonicalParticipantNames: Record<string, string> = {
  galdrim: "Gabriel Moraes",
  "gabriel de moraes": "Gabriel Moraes",
  "gabriel moraes": "Gabriel Moraes",
  tiamat: "Jhonatt Lima",
  "jhonatt lima - tiamat": "Jhonatt Lima",
  "jhonatt lima": "Jhonatt Lima",
};

const normalizeParticipantName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return canonicalParticipantNames[trimmed.toLocaleLowerCase("pt-BR")] ?? trimmed;
};

const toStructuredEntry = (legacy: LegacyContactEntry): StructuredEntry | null => {
  const name = normalizeParticipantName(legacy.name);
  if (!name) return null;

  const contacts = legacy.contacts && typeof legacy.contacts === "object" && !Array.isArray(legacy.contacts)
    ? legacy.contacts as Record<string, unknown>
    : {};
  const links = Object.entries(contacts)
    .map(([label, url]) => {
      const normalizedUrl = typeof url === "string" ? url.trim() : "";
      return normalizedUrl ? { label: label.trim(), url: normalizedUrl } : null;
    })
    .filter((link): link is { label: string; url: string } => link !== null);

  return { name, links };
};

const serializeStructuredEntry = (entry: StructuredEntry): string => JSON.stringify(entry);

const resolveInputPath = (): string => {
  const raw = process.argv.slice(2).find((value) => value !== "--replace");
  if (!raw) {
    throw new Error("Usage: npm run import:episodes -- <path-to-all_episodes.json> [--replace]");
  }
  return path.resolve(raw);
};

const shouldReplaceExistingEpisodes = (): boolean => process.argv.includes("--replace");

const toArray = (value: unknown): LegacyEpisode[] => {
  if (Array.isArray(value)) return value as LegacyEpisode[];
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, LegacyEpisode>);
  }
  return [];
};

const mapLegacyEpisode = (legacy: LegacyEpisode) => {
  const toOptionalString = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const toOptionalNonNegativeInt = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : undefined;
  };

  const rawEpisodeNumber =
    typeof legacy.episode === "number" && Number.isFinite(legacy.episode)
      ? Math.trunc(legacy.episode)
      : undefined;
  const normalizedEpisodeNumber =
    rawEpisodeNumber && rawEpisodeNumber > 0 ? rawEpisodeNumber : undefined;

  const mediaPath = (kind: Exclude<EpisodeMediaKind, "transcript">): string | undefined => {
    const finalPath = getEpisodeMediaFinalPath(legacy.ID, kind);
    return fs.existsSync(finalPath) ? getEpisodeMediaRelativePath(legacy.ID, kind) : undefined;
  };

  const authors = (legacy.authors ?? [])
    .map(normalizeParticipantName)
    .filter((name): name is string => name !== null);
  const guests = (legacy.guests ?? [])
    .map(toStructuredEntry)
    .filter((entry): entry is StructuredEntry => entry !== null);
  const participantGuests = new Set(["Gabriel Moraes"]);
  for (const guest of guests) {
    if (participantGuests.has(guest.name) && !authors.includes(guest.name)) {
      authors.push(guest.name);
    }
  }
  const publicGuests = guests.filter((guest) => !participantGuests.has(guest.name));
  const musicCredits = (legacy.music_credits ?? [])
    .map(toStructuredEntry)
    .filter((entry): entry is StructuredEntry => entry !== null)
    .map(serializeStructuredEntry);

  return episodeSchema.parse({
    episodeId: legacy.ID,
    title: legacy.title ?? `DC ${legacy.ID}`,
    summary: legacy.summary ?? "",
    episodeNumber: normalizedEpisodeNumber,
    pubDate: legacy.pubDate ?? new Date().toISOString(),
    duration: toOptionalString(legacy.duration),
    bytes: toOptionalNonNegativeInt(legacy.bytes) ?? 0,
    explicit: legacy.explicit === "yes" ? "yes" : "no",
    tags: legacy.tags ?? [],
    authors,
    guests: publicGuests.map(serializeStructuredEntry),
    citations: (legacy.citations ?? []).map((item) => item.name).filter(Boolean),
    fileName: mediaPath("audio"),
    trailerFileName: mediaPath("trailer"),
    coverFileName: mediaPath("cover"),
    coverLowFileName: mediaPath("coverLow"),
    youtube: toOptionalString(legacy.youtube),
    spotifyId: toOptionalString(legacy.spotify_id),
    xmlSnapshot: toOptionalString(legacy.xml),
    musicCredits,
    coverCredits: (legacy.cover_credits ?? []).map((item) => item.name).filter(Boolean),
  });
};

const clearEpisodeCatalog = (): void => {
  const db = getDb();
  db.exec(`
    BEGIN;
    DELETE FROM episodes;
    DELETE FROM guests
      WHERE NOT EXISTS (SELECT 1 FROM episode_guests WHERE episode_guests.guest_id = guests.id);
    DELETE FROM music
      WHERE NOT EXISTS (SELECT 1 FROM episode_music WHERE episode_music.music_id = music.id);
    COMMIT;
  `);
};

const run = async (): Promise<void> => {
  const filePath = resolveInputPath();
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  const records = toArray(parsed);

  if (records.length === 0) {
    throw new Error("No episodes found in input file");
  }

  await connectDb();

  if (shouldReplaceExistingEpisodes()) {
    clearEpisodeCatalog();
  }

  let upserted = 0;
  for (const record of records) {
    const mapped = mapLegacyEpisode(record);
    const current = episodeRepository.findByEpisodeId(mapped.episodeId);
    if (current) {
      episodeRepository.update(mapped.episodeId, mapped);
    } else {
      episodeRepository.create(mapped);
    }
    upserted += 1;
  }

  console.log(`Imported/updated ${upserted} episodes into SQLite.`);
  process.exit(0);
};

run().catch((error) => {
  console.error("Import failed", error);
  process.exit(1);
});
