import { z } from "zod";

export const trailerVideoSyncStatusSchema = z.enum(["unpublished", "manual-sync-required", "synced"]);
export type TrailerVideoSyncStatus = z.infer<typeof trailerVideoSyncStatusSchema>;

type MusicCredit = {
  name?: unknown;
  links?: unknown;
};

const parseMusicCredit = (value: unknown): MusicCredit | null => {
  const parsed = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return null;
        }
      })()
    : value;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as MusicCredit
    : null;
};

export const isCompleteMusicCredit = (value: unknown): boolean => {
  const credit = parseMusicCredit(value);
  const name = typeof credit?.name === "string" ? credit.name.trim() : "";
  const links = Array.isArray(credit?.links) ? credit.links : [];
  return name.length > 0 && links.some((link) => {
    if (link === null || typeof link !== "object") return false;
    const url = (link as { url?: unknown }).url;
    return typeof url === "string" && url.trim().length > 0;
  });
};

const completeMusicCredits = z.array(z.string()).default([]).superRefine((credits, ctx) => {
  if (!credits.some(isCompleteMusicCredit)) {
    ctx.addIssue({ code: "custom", message: "At least one complete music credit is required" });
  }
});

export const episodeSchema = z.object({
  episodeId: z.coerce.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().default(""),
  episodeNumber: z.coerce.number().int().positive().optional(),
  episodeType: z.string().optional(),
  pubDate: z.coerce.date(),
  duration: z.string().optional(),
  bytes: z.coerce.number().int().nonnegative().optional(),
  explicit: z.enum(["yes", "no"]).default("no"),
  authors: z.array(z.string()).default([]),
  guests: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  citations: z.array(z.string()).default([]),
  fileName: z.string().optional(),
  coverFileName: z.string().optional(),
  coverLowFileName: z.string().optional(),
  trailerFileName: z.string().optional(),
  trailerVideoFileName: z.string().optional(),
  trailerVideoSyncStatus: trailerVideoSyncStatusSchema.optional(),
  youtube: z.string().optional(),
  spotifyId: z.string().optional(),
  xmlSnapshot: z.string().optional(),
  musicCredits: completeMusicCredits,
  coverCredits: z.array(z.string()).default([]),
});

export type EpisodeInput = z.infer<typeof episodeSchema>;
