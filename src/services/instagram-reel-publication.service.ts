import fs from "node:fs";
import { config } from "../config/env";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import type { PublicationEffectProjection } from "../schemas/episode-publication";
import { metaPublicationProvider, type MetaPublicationProvider, type ProviderResult } from "./meta-publication.provider";

const keyFor = (effect: PublicationEffectProjection, episodeId: number): string => `episode:${episodeId}:${effect.sourceRevision}:instagram_reel`;
const checkpoint = (stage: "provider_created" | "processing" | "publish_complete" | "remote_identity", result: ProviderResult) => ({ stage, providerId: result.id, uploadId: null, updatedAt: new Date().toISOString() });

export const deliverInstagramReel = async (episodeId: number, effect: PublicationEffectProjection, provider: MetaPublicationProvider = metaPublicationProvider): Promise<void> => {
  if (!config.meta.instagramEnabled || effect.eligibility !== "eligible") return;
  const key = keyFor(effect, episodeId);
  if (effect.lifecycle === "published" && effect.remoteId) return;
  try {
    let identity = effect.checkpoint.providerId;
    if (!identity) {
      const result = await provider.createInstagramContainer({ mediaUrl: `${config.meta.providerMediaBaseUrl}/${episodeId}/trailer.mp4`, caption: effect.metadata.renderedCaption });
      identity = result.id;
      episodePublicationRepository.updateCheckpoint(key, checkpoint("provider_created", result), "processing");
    }
    const processing = await provider.getInstagramContainer(identity);
    if (processing.status && !["FINISHED", "PUBLISHED"].includes(processing.status)) {
      const attempts = episodePublicationRepository.recordAttempt(key, new Date(Date.now() + 60_000).toISOString(), ["Instagram container is still processing; retry scheduled."]);
      episodePublicationRepository.updateCheckpoint(key, checkpoint("processing", processing), attempts < 4 ? "failed" : "uncertain", ["Instagram container is still processing; retry scheduled."]);
      return;
    }
    episodePublicationRepository.updateCheckpoint(key, checkpoint("processing", processing), "processing");
    const published = await provider.publishInstagramContainer(identity);
    episodePublicationRepository.updateCheckpoint(key, checkpoint("publish_complete", published), "published", [], published.id, published.permalink ?? null);
    episodePublicationRepository.updateCheckpoint(key, checkpoint("remote_identity", published), "published", [], published.id, published.permalink ?? null);
  } catch (error) {
    const category = error && typeof error === "object" && "category" in error ? String(error.category) : "transient";
    const providerCode = error && typeof error === "object" && "providerCode" in error ? String(error.providerCode) : null;
    const providerStatus = error && typeof error === "object" && "providerStatus" in error ? String(error.providerStatus) : null;
    const providerMessage = error instanceof Error ? error.message : null;
    const diagnostic = [providerCode ? `code=${providerCode}` : null, providerStatus ? `http=${providerStatus}` : null, providerMessage].filter(Boolean).join(" ").slice(0, 320);
    const attempts = episodePublicationRepository.recordAttempt(key, category === "transient" ? new Date(Date.now() + 60_000).toISOString() : null, [category === "transient" ? "Temporary Instagram provider failure; retry scheduled." : `Instagram delivery blocked: ${category}.`]);
    episodePublicationRepository.updateCheckpoint(key, { stage: effect.checkpoint.stage, providerId: effect.checkpoint.providerId, uploadId: null, updatedAt: new Date().toISOString() }, category === "transient" && attempts < 4 ? "failed" : category === "transient" ? "uncertain" : "blocked", [diagnostic || (category === "transient" && attempts < 4 ? "Temporary provider failure; bounded retry scheduled." : `Instagram delivery requires operator action (${category}).`)]);
  }
};

export const readTrailerBytes = (path: string): Promise<Blob> => fs.promises.readFile(path).then((bytes) => new Blob([bytes], { type: "video/mp4" }));
