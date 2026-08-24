import { createHash } from "node:crypto";
import { z } from "zod";

export const PROMOTION_CONTRACT_VERSION = "episode-promotion.v1";
export const PROMOTION_CONTRACT_SOURCE_REVISION = "phase-05-promotion-contract-1";

export const promotionDestinationSchema = z.enum(["guild_trailer", "advance_access"]);
export type PromotionDestination = z.infer<typeof promotionDestinationSchema>;

export const promotionEffectStatusSchema = z.enum([
  "pending",
  "in_progress",
  "complete",
  "replayed",
  "temporary_failure",
  "permanent_failure",
  "unknown",
]);
export type PromotionEffectStatus = z.infer<typeof promotionEffectStatusSchema>;

const logicalMediaReferenceSchema = z.string().regex(/^episodes\/[1-9][0-9]*\/trailer\.mp4$/, "Trailer reference must be logical.");

export const promotionErrorSchema = z.object({
  category: z.enum([
    "malformed_payload",
    "authentication",
    "permission",
    "missing_media",
    "digest_mismatch",
    "timeout",
    "transport",
    "telegram_service",
    "unknown",
  ]),
  description: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
}).strict();
export type PromotionError = z.infer<typeof promotionErrorSchema>;

export const promotionRequestSchema = z.object({
  contract_version: z.literal(PROMOTION_CONTRACT_VERSION),
  source_revision: z.string().regex(/^phase-05-promotion-contract-1:[a-f0-9]{64}$/),
  notification_id: z.string().regex(/^episode:[1-9][0-9]*$/),
  episode_id: z.number().int().positive(),
  episode_number: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).refine((value) => !/(^|\s)#\S+/.test(value), "Title must not contain hashtags."),
  public_download_url: z.string().url(),
  trailer: z.object({
    media_reference: logicalMediaReferenceSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byte_count: z.number().int().positive(),
    mime_type: z.literal("video/mp4"),
  }).strict(),
  destinations: z.array(promotionDestinationSchema).length(2).refine(
    (destinations) => new Set(destinations).size === 2,
    "Both promotion destinations must be present exactly once."
  ),
}).strict();
export type PromotionRequest = z.infer<typeof promotionRequestSchema>;

export const promotionDestinationAcknowledgementSchema = z.object({
  destination: promotionDestinationSchema,
  status: z.enum(["complete", "replayed", "temporary_failure", "permanent_failure", "unknown"]),
  message_id: z.string().trim().min(1).max(128).nullable().optional(),
  file_id: z.string().trim().min(1).max(256).nullable().optional(),
  topic_id: z.string().trim().min(1).max(128).nullable().optional(),
  message_thread_id: z.string().trim().min(1).max(128).nullable().optional(),
  acknowledged_at: z.string().datetime({ offset: true }).nullable().optional(),
  error: promotionErrorSchema.nullable().optional(),
}).strict();
export type PromotionDestinationAcknowledgement = z.infer<typeof promotionDestinationAcknowledgementSchema>;

export const promotionAcknowledgementSchema = z.object({
  contract_version: z.literal(PROMOTION_CONTRACT_VERSION),
  notification_id: z.string().regex(/^episode:[1-9][0-9]*$/),
  status: z.enum(["complete", "replayed", "temporary_failure", "permanent_failure", "unknown"]),
  effects: z.array(promotionDestinationAcknowledgementSchema).min(1).max(2),
}).strict();
export type PromotionAcknowledgement = z.infer<typeof promotionAcknowledgementSchema>;

export type PromotionContractProjection = {
  contractVersion: typeof PROMOTION_CONTRACT_VERSION;
  sourceRevision: typeof PROMOTION_CONTRACT_SOURCE_REVISION;
  destinations: PromotionDestination[];
  acknowledgementStatuses: Array<PromotionAcknowledgement["status"]>;
  errorCategories: Array<PromotionError["category"]>;
};

export const getPromotionContractProjection = (): PromotionContractProjection => ({
  contractVersion: PROMOTION_CONTRACT_VERSION,
  sourceRevision: PROMOTION_CONTRACT_SOURCE_REVISION,
  destinations: ["guild_trailer", "advance_access"],
  acknowledgementStatuses: ["complete", "replayed", "temporary_failure", "permanent_failure", "unknown"],
  errorCategories: [
    "malformed_payload",
    "authentication",
    "permission",
    "missing_media",
    "digest_mismatch",
    "timeout",
    "transport",
    "telegram_service",
    "unknown",
  ],
});

export const fingerprintPromotionRequest = (request: PromotionRequest): string =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex");
