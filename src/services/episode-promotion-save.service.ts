import { createHash } from "node:crypto";
import fs from "node:fs";

import { config } from "../config/env";
import { episodePromotionRepository, type PromotionIntent } from "../database/repositories/episode-promotion.repository";
import { episodeRepository, withImmediateTransaction, type EpisodeRow } from "../database/repositories/episode.repository";
import { episodeSchema, type EpisodeInput } from "../schemas/episode";
import type { PromotionAcknowledgement, PromotionError } from "../schemas/episode-promotion";
import {
  buildEpisodePromotionRequest,
  dispatchPromotionIntent,
  getPromotionRequestFingerprint,
  type PromotionTransport,
} from "./episode-promotion.service";
import { postEpisodePromotion } from "./episode-promotion-client.service";
import { getEpisodeMediaFinalPath, getEpisodeMediaRelativePath } from "./episode-media-layout.service";

export type EpisodePromotionSaveInput = {
  episodeId: number;
  payload: EpisodeInput;
  mediaUpdates?: Parameters<typeof episodeRepository.updateMedia>[1];
  transport?: PromotionTransport;
};

export type EpisodePromotionSaveResult = {
  episode: EpisodeRow;
  intent: PromotionIntent | null;
  acknowledgement?: PromotionAcknowledgement;
  promotionError?: PromotionError;
};

type TrailerFingerprint = {
  sha256: string;
  byteCount: number;
};

const readCanonicalTrailerFingerprint = async (episodeId: number): Promise<TrailerFingerprint | null> => {
  const trailerPath = getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  const stats = await fs.promises.stat(trailerPath).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0) {
    return null;
  }

  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(trailerPath)) {
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), byteCount: stats.size };
};

const publicDownloadUrlFor = (episodeId: number): string =>
  `${config.feed.baseLink.replace(/\/+$/, "")}/${episodeId}`;

const configuredPromotionTransport = (): PromotionTransport => ({
  async sendPromotion(request, effects): Promise<unknown> {
    return postEpisodePromotion(request, effects);
  },
});

export const dispatchPromotionAfterCommit = async (
  notificationId: string,
  transport?: PromotionTransport,
): Promise<PromotionAcknowledgement | null> => {
  if (!config.promotion.enabled && !transport) return null;
  try {
    return await dispatchPromotionIntent(notificationId, transport ?? configuredPromotionTransport());
  } catch (error) {
    console.warn(
      "Post-commit episode promotion dispatch failed",
      error instanceof Error ? error.message.slice(0, 500) : "Unknown promotion dispatch error",
    );
    return null;
  }
};

export const saveEpisodeAndQueuePromotion = async (
  input: EpisodePromotionSaveInput,
): Promise<EpisodePromotionSaveResult> => {
  const payload = episodeSchema.parse(input.payload);
  const trailer = await readCanonicalTrailerFingerprint(input.episodeId);
  const request = trailer
    ? buildEpisodePromotionRequest({
        episodeId: input.episodeId,
        title: payload.title,
        episodeNumber: payload.episodeNumber,
        publicDownloadUrl: publicDownloadUrlFor(input.episodeId),
        imageUrl: `${config.feed.imageBase}${payload.coverFileName ?? `episodes/${input.episodeId}/cover.jpeg`}`,
        trailerMediaReference: getEpisodeMediaRelativePath(input.episodeId, "trailerVideo"),
        trailerSha256: trailer.sha256,
        trailerByteCount: trailer.byteCount,
      })
    : null;

  const committed = withImmediateTransaction(() => {
    const saved = episodeRepository.update(input.episodeId, payload);
    if (!saved) throw new Error("Episode could not be finalized");
    let finalEpisode = episodeRepository.updateMedia(input.episodeId, input.mediaUpdates ?? {}) ?? saved;
    const intent = request
      ? episodePromotionRepository.upsertPromotionIntent({
          request,
          requestFingerprint: getPromotionRequestFingerprint(request),
          withinTransaction: true,
          allowPayloadReplacement: true,
        })
      : null;
    if (!intent) {
      // Keep the independently persisted save while projecting a bounded promotion
      // failure through the existing episode error field; no legacy delivery is queued.
      episodeRepository.markLaunchError(input.episodeId, "Promotion failed: canonical trailer media is missing or inaccessible.");
      finalEpisode = episodeRepository.findByEpisodeId(input.episodeId) ?? finalEpisode;
    }
    return { episode: finalEpisode, intent };
  });

  if (!committed.intent) {
    return {
      ...committed,
      promotionError: {
        category: "missing_media",
        description: "Canonical trailer media is missing or inaccessible.",
        retryable: false,
      },
    };
  }

  const acknowledgement = await dispatchPromotionAfterCommit(committed.intent.notification.notificationId, input.transport);
  return { ...committed, acknowledgement: acknowledgement ?? undefined };
};
