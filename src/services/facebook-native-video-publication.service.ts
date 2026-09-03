import { config } from "../config/env";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";
import { metaPublicationProvider, type MetaPublicationProvider } from "./meta-publication.provider";
import { readTrailerBytes } from "./instagram-reel-publication.service";
import { getEpisodeMediaFinalPath } from "./episode-media-layout.service";

const keyFor = (effect: PublicationEffectProjection, episodeId: number): string => `episode:${episodeId}:${effect.sourceRevision}:facebook_native_video`;
export const deliverFacebookNativeVideo = async (episodeId: number, effect: PublicationEffectProjection, provider: MetaPublicationProvider = metaPublicationProvider): Promise<void> => {
  if (!config.meta.facebookReelEnabled || effect.eligibility !== "eligible") return;
  const key = keyFor(effect, episodeId);
  if (effect.lifecycle === "published" && effect.remoteId) return;
  try {
    let identity = effect.checkpoint.providerId;
    if (!identity) {
      const media = await readTrailerBytes(getEpisodeMediaFinalPath(episodeId, "trailerVideo"));
      const uploaded = await provider.uploadFacebookVideo({ media, title: effect.metadata.title, description: effect.metadata.renderedCaption });
      identity = uploaded.id;
      episodePublicationRepository.updateCheckpoint(key, { stage: "upload_accepted", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() }, "processing");
    }
    const processing = await provider.getFacebookVideo(identity);
    episodePublicationRepository.updateCheckpoint(key, { stage: "processing", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() }, "processing");
    if (processing.status && !["ready", "published", "FINISHED"].includes(processing.status)) return;
    const published = await provider.publishFacebookVideo(identity);
    episodePublicationRepository.updateCheckpoint(key, { stage: "remote_identity", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() }, "published", [], published.id || identity, published.permalink ?? null);
  } catch (error) {
    const category = error && typeof error === "object" && "category" in error ? String(error.category) : "transient";
    const providerCode = error && typeof error === "object" && "providerCode" in error ? String(error.providerCode) : null;
    const providerStatus = error && typeof error === "object" && "providerStatus" in error ? String(error.providerStatus) : null;
    const providerMessage = error instanceof Error ? error.message : null;
    const diagnostic = [providerCode ? `code=${providerCode}` : null, providerStatus ? `http=${providerStatus}` : null, providerMessage].filter(Boolean).join(" ").slice(0, 320);
    const attempts = episodePublicationRepository.recordAttempt(key, category === "transient" ? new Date(Date.now() + 60_000).toISOString() : null, [`Facebook delivery ${category}.`]);
    episodePublicationRepository.updateCheckpoint(key, { stage: effect.checkpoint.stage, providerId: effect.checkpoint.providerId, uploadId: effect.checkpoint.uploadId, updatedAt: new Date().toISOString() }, category === "transient" && attempts < 4 ? "failed" : category === "transient" ? "uncertain" : "blocked", [diagnostic || `Facebook delivery requires operator action (${category}).`]);
  }
};
