import { z } from "zod";

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
  youtube: z.string().optional(),
  spotifyId: z.string().optional(),
  xmlSnapshot: z.string().optional(),
  musicCredits: z.array(z.string()).default([]),
  coverCredits: z.array(z.string()).default([]),
});

export type EpisodeInput = z.infer<typeof episodeSchema>;
