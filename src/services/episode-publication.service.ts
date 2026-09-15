import { createHash } from "node:crypto";
import type { EpisodeRow } from "../database/repositories/episode.repository";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";
import { config } from "../config/env";
import { publicationMetadataSchema, publicationSourceRevision, type PublicationEffectProjection, type PublicationMetadata, type PublicationPreflight, type PublicationSource } from "../schemas/episode-publication";
import { preflightEpisodePublicationMedia } from "./episode-publication-media.service";
import { postLaunchNotification } from "./launch-notification-client.service";
import { deliverInstagramReel } from "./instagram-reel-publication.service";
import { deliverFacebookNativeVideo } from "./facebook-native-video-publication.service";
import type { MetaPublicationProvider } from "./meta-publication.provider";

const groups = ["telegram", "instagram_reel", "facebook_native_video"] as const;

export const renderSocialCaption = (input: { title: string; summary: string; mentions: string[]; hashtags: string[] }): string => [
  input.title,
  input.summary,
  input.mentions.join(" "),
  input.hashtags.join(" "),
].filter(Boolean).join("\n\n").slice(0, 2200);

const metadataFor = (episode: EpisodeRow): PublicationMetadata => {
  const captionMentions = episode.instagramCaptionMentions ?? [];
  const hashtags = episode.instagramHashtags ?? [];

  return publicationMetadataSchema.parse({
    title: episode.title,
    summary: episode.summary ?? "",
    captionMentions,
    hashtags,
    renderedCaption: renderSocialCaption({ title: episode.title, summary: episode.summary ?? "", mentions: captionMentions, hashtags }),
  });
};

const unavailableSource = (episodeId: number): PublicationSource => ({
  mediaReference: `episodes/${episodeId}/trailer.mp4`,
  sha256: createHash("sha256").update(`unavailable:${episodeId}`).digest("hex"),
  byteCount: 1,
  mimeType: "video/mp4",
});

export const createEpisodePublication = async (episode: EpisodeRow): Promise<{ sourceRevision: string; effects: PublicationEffectProjection[] }> => {
  let source = unavailableSource(episode.episodeId);
  let preflight: PublicationPreflight = { status: "blocked", checkedAt: new Date().toISOString(), providerReachability: "blocked", contentType: null, contentLength: null, rangeSupported: null, failureCategory: "missing_media" };
  try {
    const result = await preflightEpisodePublicationMedia(episode.episodeId);
    source = result.source;
    preflight = result.preflight;
  } catch (error) {
    preflight = { ...preflight, failureCategory: error && typeof error === "object" && "category" in error ? (error as { category: PublicationPreflight["failureCategory"] }).category : "missing_media" };
  }
  const sourceRevision = publicationSourceRevision(episode.episodeId, source);
  const effects = episodePublicationRepository.createOrGet({ episodeId: episode.episodeId, sourceRevision, source, metadata: metadataFor(episode), destinations: [...groups], preflight });
  return { sourceRevision, effects };
};

export const createEpisodeReplacementPublicationInTransaction = (input: {
  episode: EpisodeRow;
  source: PublicationSource;
}): { sourceRevision: string; effects: PublicationEffectProjection[] } => {
  const destinations = [
    ...(config.meta.instagramEnabled ? ["instagram_reel" as const] : []),
    ...(config.meta.facebookReelEnabled ? ["facebook_native_video" as const] : []),
  ];
  const sourceRevision = publicationSourceRevision(input.episode.episodeId, input.source);
  const now = new Date().toISOString();
  const preflight: PublicationPreflight = {
    status: "ready",
    checkedAt: now,
    providerReachability: "not_checked",
    contentType: "video/mp4",
    contentLength: input.source.byteCount,
    rangeSupported: null,
    failureCategory: null,
  };
  const effects = episodePublicationRepository.createOrGet({
    episodeId: input.episode.episodeId,
    sourceRevision,
    source: input.source,
    metadata: metadataFor(input.episode),
    destinations,
    preflight,
    withinTransaction: true,
    youtubeReplacement: true,
  });
  return { sourceRevision, effects };
};

export const dispatchEpisodeReplacementPublication = async (
  episodeId: number,
  sourceRevision: string,
  provider?: MetaPublicationProvider,
): Promise<PublicationEffectProjection[]> => {
  const effects = episodePublicationRepository.list(episodeId, sourceRevision);
  await Promise.all(effects.map((effect) => {
    if (effect.destination === "instagram_reel" && config.meta.instagramEnabled) return deliverInstagramReel(episodeId, effect, provider);
    if (effect.destination === "facebook_native_video" && config.meta.facebookReelEnabled) return deliverFacebookNativeVideo(episodeId, effect, provider);
    return Promise.resolve();
  }));
  return episodePublicationRepository.list(episodeId, sourceRevision);
};

export const deliverEpisodePublication = async (episode: EpisodeRow): Promise<{ delivered: boolean; effects: PublicationEffectProjection[] }> => {
  const publication = await createEpisodePublication(episode);
  const instagram = publication.effects.find((effect) => effect.destination === "instagram_reel");
  const facebook = publication.effects.find((effect) => effect.destination === "facebook_native_video");
  await Promise.all([
    instagram ? deliverInstagramReel(episode.episodeId, instagram) : Promise.resolve(),
    facebook ? deliverFacebookNativeVideo(episode.episodeId, facebook) : Promise.resolve(),
  ]);
  const telegram = publication.effects.find((effect) => effect.destination === "telegram");
  if (!telegram || telegram.lifecycle !== "eligible") return { delivered: false, effects: publication.effects };
  await postLaunchNotification(episode);
  episodePublicationRepository.markTelegramDelivered(episode.episodeId, publication.sourceRevision);
  return { delivered: true, effects: episodePublicationRepository.list(episode.episodeId, publication.sourceRevision) };
};

export const getEpisodePublicationStatus = (episodeId: number): PublicationEffectProjection[] => episodePublicationRepository.list(episodeId);

export const getRegisteredPublicationGroups = (): Array<{ destination: typeof groups[number]; enabled: boolean }> => groups.map((destination) => ({
  destination,
  enabled: destination === "telegram" ? Boolean(config.promotion.legacyLaunchEnabled) : false,
}));
