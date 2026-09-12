import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";

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
  status: "complete" | "waiting_for_successor" | "waiting_for_operator_retirement";
  replacementComplete: boolean;
  destinations: Partial<Record<TrailerReplacementDestination["destination"], TrailerReplacementDestination>>;
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

const aggregateStatus = (effects: PublicationEffectProjection[]): TrailerReplacementStatus["status"] => {
  if (effects.every((effect) => effect.replacementComplete)) return "complete";
  if (effects.some((effect) => effect.retirementStatus === "manual_retirement_required")) return "waiting_for_operator_retirement";
  return "waiting_for_successor";
};

export const getTrailerReplacementStatus = (episodeId: number, sourceRevision: string): TrailerReplacementStatus | null => {
  if (!episodePublicationRepository.hasIntent(episodeId, sourceRevision)) return null;
  const effects = episodePublicationRepository.list(episodeId, sourceRevision)
    .filter((effect) => effect.destination === "instagram_reel" || effect.destination === "facebook_native_video");
  const destinations: TrailerReplacementStatus["destinations"] = {};
  for (const effect of effects) destinations[effect.destination as TrailerReplacementDestination["destination"]] = destinationStatus(effect);
  const status = aggregateStatus(effects);
  return { episodeId, sourceRevision, status, replacementComplete: status === "complete", destinations };
};

export const confirmManualTrailerRetirement = (input: {
  episodeId: number;
  sourceRevision: string;
  destination: "instagram_reel" | "facebook_native_video";
  predecessorRemoteId: string;
  actorEmail: string;
}) => episodePublicationRepository.confirmManualRetirement(input);
