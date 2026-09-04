import { createHash } from "node:crypto";
import { episodePromotionRepository, type PromotionEffectRow, type PromotionIntent } from "../database/repositories/episode-promotion.repository";
import {
  fingerprintPromotionRequest,
  PROMOTION_CONTRACT_SOURCE_REVISION,
  PROMOTION_CONTRACT_VERSION,
  promotionAcknowledgementSchema,
  promotionDestinationAcknowledgementSchema,
  promotionRequestSchema,
  type PromotionAcknowledgement,
  type PromotionDestination,
  type PromotionError,
  type PromotionRequest,
} from "../schemas/episode-promotion";

export type EpisodePromotionInput = {
  episodeId: number;
  title: string;
  episodeNumber?: number | null;
  publicDownloadUrl: string;
  imageUrl?: string;
  trailerMediaReference?: string;
  trailerSha256: string;
  trailerByteCount: number;
  trailerMimeType?: "video/mp4";
};

export type PromotionTransport = {
  sendPromotion(request: PromotionRequest, effects: PromotionEffectRow[]): Promise<unknown>;
  reconcilePromotion?: (request: PromotionRequest, effect: PromotionEffectRow) => Promise<unknown>;
};

export type PromotionIntentResult = PromotionIntent & {
  request: PromotionRequest;
  acknowledgement?: PromotionAcknowledgement;
};

const stripHashtags = (title: string): string => title
  .replace(/(^|\s)#[^\s#]+/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

const sourceRevisionFor = (sha256: string): string => `${PROMOTION_CONTRACT_SOURCE_REVISION}:${sha256}`;

export const buildEpisodePromotionRequest = (input: EpisodePromotionInput): PromotionRequest => {
  const request = {
    contract_version: PROMOTION_CONTRACT_VERSION,
    source_revision: sourceRevisionFor(input.trailerSha256),
    notification_id: `episode:${input.episodeId}`,
    episode_id: input.episodeId,
    episode_number: input.episodeNumber ?? input.episodeId,
    title: stripHashtags(input.title),
    public_download_url: input.publicDownloadUrl,
    ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
    trailer: {
      media_reference: input.trailerMediaReference ?? `episodes/${input.episodeId}/trailer.mp4`,
      sha256: input.trailerSha256,
      byte_count: input.trailerByteCount,
      mime_type: input.trailerMimeType ?? "video/mp4",
    },
    destinations: ["guild_trailer", "advance_access"] as [PromotionDestination, PromotionDestination],
  };
  return promotionRequestSchema.parse(request);
};

export const classifyPromotionError = (error: unknown): PromotionError => {
  const message = error instanceof Error ? error.message : "Unknown promotion transport error.";
  const lower = message.toLowerCase();
  const category: PromotionError["category"] = (error instanceof Error && error.constructor.name === "ZodError") || lower.includes("invalid payload") || lower.includes("malformed payload")
    ? "malformed_payload"
    : lower.includes("digest")
    ? "digest_mismatch"
    : lower.includes("media") || lower.includes("trailer") || lower.includes("file")
      ? "missing_media"
      : lower.includes("auth") || lower.includes("token") || lower.includes("credential")
        ? "authentication"
        : lower.includes("permission") || lower.includes("forbidden")
          ? "permission"
          : lower.includes("timeout") || lower.includes("timed out")
            ? "timeout"
            : lower.includes("telegram")
              ? "telegram_service"
              : lower.includes("payload") || lower.includes("schema")
                ? "malformed_payload"
                : lower.includes("network") || lower.includes("fetch") || lower.includes("transport")
                  ? "transport"
                  : "unknown";
  const retryable = category === "timeout" || category === "transport" || category === "telegram_service" || category === "unknown";
  return { category, description: message.slice(0, 500), retryable };
};

const globalAcknowledgement = (status: PromotionAcknowledgement["status"], notificationId: string, effects: PromotionAcknowledgement["effects"]): PromotionAcknowledgement =>
  promotionAcknowledgementSchema.parse({
    contract_version: PROMOTION_CONTRACT_VERSION,
    notification_id: notificationId,
    status,
    effects,
  });

const acknowledgementFailure = (
  effect: PromotionEffectRow,
  error: PromotionError,
): ReturnType<typeof promotionDestinationAcknowledgementSchema.parse> => ({
  destination: effect.destination,
  status: error.retryable ? "unknown" : "permanent_failure",
  error,
});

const parseDestinationAcknowledgement = (value: unknown, effect: PromotionEffectRow): ReturnType<typeof promotionDestinationAcknowledgementSchema.parse> => {
  try {
    const acknowledgement = promotionDestinationAcknowledgementSchema.parse(value);
    if (acknowledgement.destination !== effect.destination) throw new Error("Acknowledgement destination mismatch.");
    return acknowledgement;
  } catch {
    return acknowledgementFailure(effect, {
      category: "malformed_payload",
      description: "Promotion reconciliation returned an invalid acknowledgement.",
      retryable: false,
    });
  }
};

const reconcileUnknownPromotionEffects = async (
  request: PromotionRequest,
  transport: PromotionTransport,
): Promise<void> => {
  const ambiguous = episodePromotionRepository.claimUnknownPromotionEffects({
    notificationId: request.notification_id,
    limit: 2,
  });
  for (const effect of ambiguous) {
    let acknowledgement: ReturnType<typeof promotionDestinationAcknowledgementSchema.parse>;
    if (!transport.reconcilePromotion) {
      acknowledgement = acknowledgementFailure(effect, {
        category: "unknown",
        description: "No reconciliation transport is configured for an ambiguous promotion effect.",
        retryable: true,
      });
    } else {
      try {
        const result = await transport.reconcilePromotion(request, effect);
        acknowledgement = result === null || result === undefined
          ? acknowledgementFailure(effect, {
            category: "unknown",
            description: "Promotion side effect remains ambiguous after reconciliation.",
            retryable: true,
          })
          : parseDestinationAcknowledgement(result, effect);
      } catch (error) {
        const safeError = classifyPromotionError(error);
        acknowledgement = acknowledgementFailure(effect, safeError);
      }
    }
    episodePromotionRepository.recordPromotionAcknowledgement({
      notificationId: request.notification_id,
      destination: effect.destination,
      sourceRevision: effect.sourceRevision,
      effectKey: effect.effectKey,
      leaseId: effect.leaseId ?? undefined,
      revision: effect.revision,
      acknowledgement,
    });
  }
};

export const dispatchPromotionIntent = async (notificationId: string, transport: PromotionTransport): Promise<PromotionAcknowledgement | null> => {
  const intent = episodePromotionRepository.findPromotionIntent(notificationId);
  if (!intent) throw new Error(`Promotion notification ${notificationId} was not found.`);
  const request = promotionRequestSchema.parse(JSON.parse(intent.notification.requestJson));
  episodePromotionRepository.recoverExpiredPromotionLeases();
  await reconcileUnknownPromotionEffects(request, transport);
  const claimed = episodePromotionRepository.claimDuePromotionEffects({ notificationId, limit: 2 });
  if (claimed.length === 0) return null;

  let acknowledgement: PromotionAcknowledgement;
  try {
    acknowledgement = promotionAcknowledgementSchema.parse(await transport.sendPromotion(request, claimed));
  } catch (error) {
    const safeError = classifyPromotionError(error);
    const status: PromotionAcknowledgement["status"] = safeError.retryable ? "unknown" : "permanent_failure";
    const effects = claimed.map((effect) => ({
      destination: effect.destination,
      status,
      error: safeError,
    }));
    acknowledgement = globalAcknowledgement(status, notificationId, effects);
  }

  for (const effect of claimed) {
    const destinationAcknowledgement = acknowledgement.effects.find((candidate) => candidate.destination === effect.destination)
      ?? promotionDestinationAcknowledgementSchema.parse({
        destination: effect.destination,
        status: "unknown",
        error: { category: "unknown", description: "Acknowledgement omitted this destination.", retryable: true },
      });
    episodePromotionRepository.recordPromotionAcknowledgement({
      notificationId,
      destination: effect.destination,
      sourceRevision: effect.sourceRevision,
      effectKey: effect.effectKey,
      leaseId: effect.leaseId ?? undefined,
      revision: effect.revision,
      acknowledgement: destinationAcknowledgement,
    });
  }
  return acknowledgement;
};

export const createOrReusePromotionIntent = async (input: EpisodePromotionInput, transport?: PromotionTransport): Promise<PromotionIntentResult> => {
  const request = buildEpisodePromotionRequest(input);
  const intent = episodePromotionRepository.upsertPromotionIntent({ request, requestFingerprint: fingerprintPromotionRequest(request) });
  if (!transport) return { ...intent, request };
  const acknowledgement = await dispatchPromotionIntent(request.notification_id, transport);
  return { ...episodePromotionRepository.findPromotionIntent(request.notification_id)!, request, acknowledgement: acknowledgement ?? undefined };
};

export const getPromotionRequestFingerprint = (request: PromotionRequest): string =>
  createHash("sha256").update(JSON.stringify(promotionRequestSchema.parse(request))).digest("hex");
