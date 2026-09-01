import { createHash } from "node:crypto";
import { z } from "zod";

export const EPISODE_PUBLICATION_CONTRACT_VERSION = "episode-publication.v1";
export const publicationDestinationSchema = z.enum(["telegram", "instagram_reel", "facebook_native_video"]);
export type PublicationDestination = z.infer<typeof publicationDestinationSchema>;
export const publicationLifecycleSchema = z.enum(["pending", "eligible", "blocked", "delivering", "published", "failed"]);
export type PublicationLifecycle = z.infer<typeof publicationLifecycleSchema>;

export const publicationSourceSchema = z.object({
  mediaReference: z.string().regex(/^episodes\/[1-9][0-9]*\/trailer\.mp4$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteCount: z.number().int().positive(),
  mimeType: z.literal("video/mp4"),
}).strict();
export type PublicationSource = z.infer<typeof publicationSourceSchema>;

export const publicationMetadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().max(10_000),
  captionMentions: z.array(z.string().regex(/^@[a-z0-9._]{1,30}$/i)).max(50),
  hashtags: z.array(z.string().regex(/^#[^#\s]{1,100}$/u)).max(50),
  renderedCaption: z.string().max(2_200),
}).strict();
export type PublicationMetadata = z.infer<typeof publicationMetadataSchema>;

export const publicationPreflightSchema = z.object({
  status: z.enum(["not_checked", "ready", "blocked"]),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  providerReachability: z.enum(["not_checked", "ready", "blocked"]),
  contentType: z.string().nullable(),
  contentLength: z.number().int().nonnegative().nullable(),
  rangeSupported: z.boolean().nullable(),
  failureCategory: z.enum(["missing_media", "non_regular_media", "incompatible_media", "digest_mismatch", "provider_unreachable", "provider_auth", "redirect_rejected"]).nullable(),
}).strict();
export type PublicationPreflight = z.infer<typeof publicationPreflightSchema>;

export type PublicationEffectProjection = {
  destination: PublicationDestination;
  lifecycle: PublicationLifecycle;
  sourceRevision: string;
  source: PublicationSource;
  metadata: PublicationMetadata;
  eligibility: "eligible" | "blocked";
  diagnostics: string[];
  remoteId: string | null;
  permalink: string | null;
  preflight: PublicationPreflight;
};

export const publicationSourceRevision = (episodeId: number, source: PublicationSource): string =>
  `episode:${episodeId}:${createHash("sha256").update(JSON.stringify(source)).digest("hex")}`;
