import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import { episodePromotionRepository } from "../database/repositories/episode-promotion.repository";
import { youtubeTrailerJobRepository } from "../database/repositories/youtube-trailer-job.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";
import { PROMOTION_CONTRACT_SOURCE_REVISION } from "../schemas/episode-promotion";
import { config } from "../config/env";

export type TrailerReplacementDestination = {
  destination: "instagram_reel" | "facebook_native_video";
  lifecycle: PublicationEffectProjection["lifecycle"];
  retirementStatus: PublicationEffectProjection["retirementStatus"];
  replacementComplete: boolean;
  predecessor: PublicationEffectProjection["predecessor"];
  successor: { remoteId: string; permalink: string | null } | null;
  manualInstructions: string | null;
  confirmationEndpoint: string | null;
  retirementActorEmail: string | null;
  retirementConfirmedAt: string | null;
};

export type TrailerReplacementStatus = {
  episodeId: number;
  sourceRevision: string;
  status: "complete" | "waiting_for_successor" | "waiting_for_operator_retirement" | "waiting_for_youtube_action" | "waiting_for_youtube_public_success" | "waiting_for_youtube_retirement" | "waiting_for_telegram";
  replacementComplete: boolean;
  destinations: Partial<Record<TrailerReplacementDestination["destination"], TrailerReplacementDestination>>;
  youtube: null | {
    status: string;
    predecessor: { remoteId: string; permalink: string | null } | null;
    successor: { remoteId: string | null; permalink: string | null; jobId: string } | null;
    retirementError: string | null;
  };
  telegram: {
    configured: boolean;
    status: "not_applicable" | "pending" | "in_progress" | "complete" | "replayed" | "temporary_failure" | "permanent_failure" | "unknown";
    destinations: Partial<Record<"guild_trailer" | "advance_access", {
    status: "not_applicable" | "pending" | "in_progress" | "complete" | "replayed" | "temporary_failure" | "permanent_failure" | "unknown";
      messageId: string | null;
      fileId: string | null;
      topicId: string | null;
      messageThreadId: string | null;
    }>>;
  };
};

const destinationStatus = (effect: PublicationEffectProjection): TrailerReplacementDestination => ({
  destination: effect.destination as TrailerReplacementDestination["destination"],
  lifecycle: effect.lifecycle,
  retirementStatus: effect.retirementStatus,
  replacementComplete: effect.replacementComplete,
  predecessor: effect.predecessor,
  successor: effect.lifecycle === "published" && effect.remoteId ? { remoteId: effect.remoteId, permalink: effect.permalink } : null,
  manualInstructions: effect.retirementStatus === "manual_retirement_required"
    ? "Open the predecessor link in Meta, remove that old item after confirming the successor is live, then submit the exact predecessor ID to this API endpoint."
    : null,
  confirmationEndpoint: effect.retirementStatus === "manual_retirement_required"
    ? `/v1/episodes/${effect.source.mediaReference.match(/^episodes\/(\d+)\//u)?.[1]}/trailer-replacements/${encodeURIComponent(effect.sourceRevision)}/destinations/${effect.destination}/retirement/confirm`
    : null,
  retirementActorEmail: effect.retirementActorEmail,
  retirementConfirmedAt: effect.retirementConfirmedAt,
});

const aggregateStatus = (
  effects: PublicationEffectProjection[],
  requiredMetaDestinations: Array<"instagram_reel" | "facebook_native_video">,
  youtube: TrailerReplacementStatus["youtube"],
  telegram: TrailerReplacementStatus["telegram"],
): TrailerReplacementStatus["status"] => {
  const metaComplete = requiredMetaDestinations.every((destination) =>
    effects.some((effect) => effect.destination === destination && effect.replacementComplete));
  const youtubeComplete = !youtube || youtube.status === "complete" || youtube.status === "not_applicable";
  const telegramComplete = !telegram.configured || telegram.status === "complete" || telegram.status === "replayed" || telegram.status === "not_applicable";
  if (metaComplete && youtubeComplete && telegramComplete) return "complete";
  if (effects.some((effect) => effect.retirementStatus === "manual_retirement_required")) return "waiting_for_operator_retirement";
  if (!metaComplete) return "waiting_for_successor";
  if (youtube?.status === "waiting_for_operator_upload") return "waiting_for_youtube_action";
  if (youtube?.status === "waiting_for_public_success") return "waiting_for_youtube_public_success";
  if (youtube && !youtubeComplete) return "waiting_for_youtube_retirement";
  if (!telegramComplete) return "waiting_for_telegram";
  return "complete";
};

export const getTrailerReplacementStatus = (episodeId: number, sourceRevision: string): TrailerReplacementStatus | null => {
  if (!episodePublicationRepository.hasIntent(episodeId, sourceRevision)) return null;
  const allEffects = episodePublicationRepository.list(episodeId, sourceRevision);
  const effects = allEffects
    .filter((effect) => effect.destination === "instagram_reel" || effect.destination === "facebook_native_video");
  const youtubeReplacement = episodePublicationRepository.getYoutubeReplacement(episodeId, sourceRevision);
  const youtubeSuccessor = youtubeReplacement?.successorJobId
    ? youtubeTrailerJobRepository.findByJobId(episodeId, youtubeReplacement.successorJobId)
    : null;
  const youtube: TrailerReplacementStatus["youtube"] = youtubeReplacement ? {
    status: youtubeReplacement.status,
    predecessor: youtubeReplacement.predecessor,
    successor: youtubeReplacement.successorJobId ? {
      jobId: youtubeReplacement.successorJobId,
      remoteId: youtubeSuccessor?.providerVideoId ?? null,
      permalink: youtubeSuccessor?.canonicalUrl ?? null,
    } : null,
    retirementError: youtubeReplacement.retirementError,
  } : null;
  const destinations: TrailerReplacementStatus["destinations"] = {};
  for (const effect of effects) destinations[effect.destination as TrailerReplacementDestination["destination"]] = destinationStatus(effect);
  const replacementSource = episodePublicationRepository.getSource(episodeId, sourceRevision);
  const telegramConfigured = config.promotion.activeOwner === "promotion";
  const promotionRevision = replacementSource ? `${PROMOTION_CONTRACT_SOURCE_REVISION}:${replacementSource.sha256}` : "";
  const promotion = telegramConfigured && promotionRevision
    ? episodePromotionRepository.findPromotionIntent(`episode:${episodeId}`, promotionRevision)
    : null;
  const telegramEffects = promotion?.effects ?? [];
  const telegramDestinations: NonNullable<TrailerReplacementStatus["telegram"]>["destinations"] = {};
  for (const effect of telegramEffects) {
    telegramDestinations[effect.destination] = {
      status: effect.status,
      messageId: effect.messageId,
      fileId: effect.fileId,
      topicId: effect.topicId,
      messageThreadId: effect.messageThreadId,
    };
  }
  const requiredTelegramDestinations = ["guild_trailer", "advance_access"] as const;
  const completeStatuses = new Set(["complete", "replayed"]);
  const telegramStatus: TrailerReplacementStatus["telegram"]["status"] = !telegramConfigured
    ? "not_applicable"
    : requiredTelegramDestinations.some((destination) => !telegramDestinations[destination])
      ? "pending"
      : requiredTelegramDestinations.every((destination) => completeStatuses.has(telegramDestinations[destination]!.status))
        ? "complete"
        : telegramEffects.some((effect) => effect.status === "permanent_failure")
          ? "permanent_failure"
          : telegramEffects.some((effect) => effect.status === "temporary_failure")
            ? "temporary_failure"
            : telegramEffects.some((effect) => effect.status === "unknown")
              ? "unknown"
              : telegramEffects.some((effect) => effect.status === "in_progress")
                ? "in_progress"
                : "pending";
  const telegram: TrailerReplacementStatus["telegram"] = {
    configured: telegramConfigured,
    status: telegramStatus,
    destinations: telegramDestinations,
  };
  const requiredMetaDestinations = [
    ...(config.meta.instagramEnabled ? ["instagram_reel" as const] : []),
    ...(config.meta.facebookReelEnabled ? ["facebook_native_video" as const] : []),
  ];
  const status = aggregateStatus(effects, requiredMetaDestinations, youtube, telegram);
  return { episodeId, sourceRevision, status, replacementComplete: status === "complete", destinations, youtube, telegram };
};

export const confirmManualTrailerRetirement = (input: {
  episodeId: number;
  sourceRevision: string;
  destination: "instagram_reel" | "facebook_native_video";
  predecessorRemoteId: string;
  actorEmail: string;
}) => episodePublicationRepository.confirmManualRetirement(input);
