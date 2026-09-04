import { config } from "../config/env";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";
import { metaPublicationProvider, type MetaPublicationProvider } from "./meta-publication.provider";
import { readTrailerBytes } from "./instagram-reel-publication.service";
import { getEpisodeMediaFinalPath } from "./episode-media-layout.service";

const keyFor = (effect: PublicationEffectProjection, episodeId: number): string => `episode:${episodeId}:${effect.sourceRevision}:facebook_native_video`;
const MAX_PROVIDER_ATTEMPTS = 12;
export const deliverFacebookNativeVideo = async (episodeId: number, effect: PublicationEffectProjection, provider: MetaPublicationProvider = metaPublicationProvider): Promise<void> => {
  if (!config.meta.facebookReelEnabled || effect.eligibility !== "eligible") return;
  const key = keyFor(effect, episodeId);
  if (effect.lifecycle === "published" && effect.remoteId) return;
  let currentCheckpoint = effect.checkpoint;
  try {
    let identity = effect.checkpoint.providerId;
    if (!identity) {
      const media = await readTrailerBytes(getEpisodeMediaFinalPath(episodeId, "trailerVideo"));
      const uploaded = await provider.uploadFacebookVideo({ media, title: effect.metadata.title, description: effect.metadata.renderedCaption });
      identity = uploaded.id;
      currentCheckpoint = { stage: "upload_accepted", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() };
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing");
    }
    if (currentCheckpoint.stage === "upload_accepted") {
      const finished = await provider.publishFacebookVideo(identity, { title: effect.metadata.title, description: effect.metadata.renderedCaption });
      currentCheckpoint = { stage: "publish_complete", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() };
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "published", [], finished.id || identity, finished.permalink ?? null);
      return;
    }
    const processing = await provider.getFacebookVideo(identity);
    if (processing.status === "upload_complete") {
      const finished = await provider.publishFacebookVideo(identity, { title: effect.metadata.title, description: effect.metadata.renderedCaption });
      currentCheckpoint = { stage: "publish_complete", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() };
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "published", [], finished.id || identity, finished.permalink ?? null);
      return;
    }
    if (processing.status && !["ready", "published", "FINISHED"].includes(processing.status)) {
      const attempts = episodePublicationRepository.recordAttempt(key, new Date(Date.now() + 60_000).toISOString(), ["Facebook video is still processing; retry scheduled."]);
      currentCheckpoint = { stage: "processing", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() };
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, attempts < MAX_PROVIDER_ATTEMPTS ? "failed" : "uncertain", ["Facebook video is still processing; retry scheduled."]);
      return;
    }
    currentCheckpoint = { stage: "processing", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() };
    episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing");
    const published = await provider.publishFacebookVideo(identity, { title: effect.metadata.title, description: effect.metadata.renderedCaption });
    currentCheckpoint = { stage: "remote_identity", providerId: identity, uploadId: identity, updatedAt: new Date().toISOString() };
    episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "published", [], published.id || identity, published.permalink ?? null);
  } catch (error) {
    const category = error && typeof error === "object" && "category" in error ? String(error.category) : "transient";
    const providerCode = error && typeof error === "object" && "providerCode" in error ? String(error.providerCode) : null;
    const providerStatus = error && typeof error === "object" && "providerStatus" in error ? String(error.providerStatus) : null;
    const providerMessage = error instanceof Error ? error.message : null;
    const diagnostic = [providerCode ? `code=${providerCode}` : null, providerStatus ? `http=${providerStatus}` : null, providerMessage].filter(Boolean).join(" ").slice(0, 320);
    const attempts = episodePublicationRepository.recordAttempt(key, category === "transient" ? new Date(Date.now() + 60_000).toISOString() : null, [`Facebook delivery ${category}.`]);
    episodePublicationRepository.updateCheckpoint(key, { ...currentCheckpoint, updatedAt: new Date().toISOString() }, category === "transient" && attempts < MAX_PROVIDER_ATTEMPTS ? "failed" : category === "transient" ? "uncertain" : "blocked", [diagnostic || `Facebook delivery requires operator action (${category}).`]);
  }
};
