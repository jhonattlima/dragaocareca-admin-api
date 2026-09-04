import fs from "node:fs";
import { config } from "../config/env";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";
import { metaPublicationProvider, type MetaPublicationProvider, type ProviderResult } from "./meta-publication.provider";

const keyFor = (effect: PublicationEffectProjection, episodeId: number): string => `episode:${episodeId}:${effect.sourceRevision}:instagram_reel`;
const checkpoint = (stage: "provider_created" | "processing" | "publish_complete" | "remote_identity", result: ProviderResult) => ({ stage, providerId: result.id, uploadId: null, updatedAt: new Date().toISOString() });
const MAX_PROVIDER_ATTEMPTS = 12;

export const deliverInstagramReel = async (episodeId: number, effect: PublicationEffectProjection, provider: MetaPublicationProvider = metaPublicationProvider): Promise<void> => {
  if (!config.meta.instagramEnabled || effect.eligibility !== "eligible") return;
  const key = keyFor(effect, episodeId);
  if (effect.lifecycle === "published" && effect.remoteId) return;
  let currentCheckpoint = effect.checkpoint;
  try {
    let identity = effect.checkpoint.providerId;
    if (!identity) {
      const result = await provider.createInstagramContainer({ mediaUrl: `${config.meta.providerMediaBaseUrl}/${episodeId}/trailer.mp4`, caption: effect.metadata.renderedCaption });
      identity = result.id;
      currentCheckpoint = checkpoint("provider_created", result);
      episodePublicationRepository.updateCheckpoint(key, currentCheckpoint, "processing");
    }
    const processing = await provider.getInstagramContainer(identity);
    if (processing.status === "ERROR" || processing.status === "ERROR_OCCURRED") {
      throw Object.assign(new Error("Instagram container processing failed at Meta."), { category: "provider" as const });
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
    const attempts = episodePublicationRepository.recordAttempt(key, category === "transient" ? new Date(Date.now() + 60_000).toISOString() : null, [category === "transient" ? "Temporary Instagram provider failure; retry scheduled." : `Instagram delivery blocked: ${category}.`]);
    episodePublicationRepository.updateCheckpoint(key, { ...currentCheckpoint, updatedAt: new Date().toISOString() }, category === "transient" && attempts < MAX_PROVIDER_ATTEMPTS ? "failed" : category === "transient" ? "uncertain" : "blocked", [diagnostic || (category === "transient" && attempts < MAX_PROVIDER_ATTEMPTS ? "Temporary provider failure; bounded retry scheduled." : `Instagram delivery requires operator action (${category}).`)]);
  }
};

export const readTrailerBytes = (path: string): Promise<Blob> => fs.promises.readFile(path).then((bytes) => new Blob([bytes], { type: "video/mp4" }));
