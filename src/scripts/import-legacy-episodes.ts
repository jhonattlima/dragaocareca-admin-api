import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env";
import { connectDb } from "../db/connect";
import { EpisodeModel } from "../models/Episode";
import { episodeSchema } from "../schemas/episode";

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
  music_credits?: Array<{ name?: string }>;
  citations?: Array<{ name?: string }>;
  guests?: Array<{ name?: string }>;
  img?: string;
  duration?: string;
  youtube?: string;
  spotify_id?: string;
  xml?: string;
  pubDate?: string;
};

const resolveInputPath = (): string => {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error("Usage: npm run import:episodes -- <path-to-all_episodes.json>");
  }
  return path.resolve(raw);
};

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
    authors: legacy.authors ?? [],
    guests: (legacy.guests ?? []).map((item) => item.name).filter(Boolean),
    citations: (legacy.citations ?? []).map((item) => item.name).filter(Boolean),
    fileName: toOptionalString(legacy.file),
    coverFileName: toOptionalString(legacy.img),
    youtube: toOptionalString(legacy.youtube),
    spotifyId: toOptionalString(legacy.spotify_id),
    xmlSnapshot: toOptionalString(legacy.xml),
    musicCredits: (legacy.music_credits ?? []).map((item) => item.name).filter(Boolean),
    coverCredits: (legacy.cover_credits ?? []).map((item) => item.name).filter(Boolean),
  });
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

  let upserted = 0;
  for (const record of records) {
    const mapped = mapLegacyEpisode(record);
    await EpisodeModel.updateOne(
      { episodeId: mapped.episodeId },
      { $set: mapped },
      { upsert: true }
    );
    upserted += 1;
  }

  console.log(`Imported/updated ${upserted} episodes into MongoDB (${config.mongodbUri}).`);
  process.exit(0);
};

run().catch((error) => {
  console.error("Import failed", error);
  process.exit(1);
});
