import fs from "node:fs";
import { config } from "../config/env";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";
import { metaPublicationProvider, type MetaPublicationProvider, type ProviderResult } from "./meta-publication.provider";
import { renderStoredSocialCaption } from "./social-caption";

const keyFor = (effect: PublicationEffectProjection, episodeId: number): string => `episode:${episodeId}:${effect.sourceRevision}:instagram_reel`;
const checkpoint = (stage: "provider_created" | "processing" | "publish_complete" | "remote_identity", result: ProviderResult) => ({ stage, providerId: result.id, uploadId: null, updatedAt: new Date().toISOString() });
const MAX_PROVIDER_ATTEMPTS = 12;

const isPendingContainerPublish = (
  category: string,
  providerCode: string | null,
  providerStatus: string | null,
  checkpointState: PublicationEffectProjection["checkpoint"],
): boolean =>
  category === "provider"
  && providerCode === "100"
  && providerStatus === "400"
  && checkpointState.providerId !== null
  && ["provider_created", "processing"].includes(checkpointState.stage);

export const deliverInstagramReel = async (episodeId: number, effect: PublicationEffectProjection, provider: MetaPublicationProvider = metaPublicationProvider): Promise<void> => {
  if (!config.meta.instagramEnabled || effect.eligibility !== "eligible") return;
  const key = keyFor(effect, episodeId);
  const claimed = episodePublicationRepository.claimSocialEffect(key);
  if (!claimed) return;
  effect = claimed;
  if (effect.lifecycle === "published" && effect.remoteId) return;
  let currentCheckpoint = effect.checkpoint;
  try {
    let identity = effect.checkpoint.providerId;
    if (!identity) {
      const result = await provider.createInstagramContainer({ mediaUrl: `${config.meta.providerMediaBaseUrl}/${episodeId}/trailer.mp4`, caption: renderStoredSocialCaption(effect.metadata) });
      identity = result.id;
      currentCheckpoint = checkpoint("provider_created", result);
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing");
    }
    let processing = await provider.getInstagramContainer(identity);
    if (processing.status === "ERROR" || processing.status === "ERROR_OCCURRED") {
      // An ERROR container can never be published, but it also cannot have
      // produced a Reel.  Discard only that provider checkpoint and create a
      // new container from the immutable staged trailer in this same attempt.
      // This is deliberately different from a 400 while processing, which
      // retains the existing container and waits.
      identity = null;
      currentCheckpoint = { stage: "none", providerId: null, uploadId: null, updatedAt: new Date().toISOString() };
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing", ["Instagram container failed at Meta; creating a fresh container."]);
    }
    if (!identity) {
      const result = await provider.createInstagramContainer({ mediaUrl: `${config.meta.providerMediaBaseUrl}/${episodeId}/trailer.mp4`, caption: renderStoredSocialCaption(effect.metadata) });
      identity = result.id;
      currentCheckpoint = checkpoint("provider_created", result);
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing");
      processing = await provider.getInstagramContainer(identity);
    }
    if (processing.status && !["FINISHED", "PUBLISHED"].includes(processing.status)) {
      const attempts = episodePublicationRepository.recordAttempt(key, new Date(Date.now() + 60_000).toISOString(), ["Instagram container is still processing; retry scheduled."]);
      currentCheckpoint = checkpoint("processing", processing);
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, attempts < MAX_PROVIDER_ATTEMPTS ? "failed" : "uncertain", ["Instagram container is still processing; retry scheduled."]);
      return;
    }
    currentCheckpoint = checkpoint("processing", processing);
    episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing");
    const published = await provider.publishInstagramContainer(identity);
    currentCheckpoint = checkpoint("publish_complete", published);
    episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "published", [], published.id, published.permalink ?? null);
    currentCheckpoint = checkpoint("remote_identity", published);
    episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "published", [], published.id, published.permalink ?? null);
  } catch (error) {
    const category = error && typeof error === "object" && "category" in error ? String(error.category) : "transient";
    const providerCode = error && typeof error === "object" && "providerCode" in error ? String(error.providerCode) : null;
    const providerStatus = error && typeof error === "object" && "providerStatus" in error ? String(error.providerStatus) : null;
    const providerMessage = error instanceof Error ? error.message : null;
    const diagnostic = [providerCode ? `code=${providerCode}` : null, providerStatus ? `http=${providerStatus}` : null, providerMessage].filter(Boolean).join(" ").slice(0, 320);
    // Meta can report code 100 / HTTP 400 while a freshly created Reel
    // container is still becoming publishable. A provider ID proves that this
    // is not an invalid creation request; retain it and retry media_publish
    // instead of permanently blocking the effect.
    const retryable = category === "transient" || isPendingContainerPublish(category, providerCode, providerStatus, currentCheckpoint);
    const attempts = episodePublicationRepository.recordAttempt(key, retryable ? new Date(Date.now() + 60_000).toISOString() : null, [retryable ? "Instagram container is still processing; retry scheduled." : `Instagram delivery blocked: ${category}.`]);
    episodePublicationRepository.updateCheckpoint(key, { ...currentCheckpoint, updatedAt: new Date().toISOString() }, retryable && attempts < MAX_PROVIDER_ATTEMPTS ? "failed" : retryable ? "uncertain" : "blocked", [diagnostic || (retryable && attempts < MAX_PROVIDER_ATTEMPTS ? "Instagram container is still processing; retry scheduled." : `Instagram delivery requires operator action (${category}).`)]);
  }
};

export const readTrailerBytes = (path: string): Promise<Blob> => fs.promises.readFile(path).then((bytes) => new Blob([bytes], { type: "video/mp4" }));
