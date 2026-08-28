import { config } from "../config/env";
import type { EpisodeRow } from "../database/repositories/episode.repository";

const boundedError = (message: string): Error => new Error(message.slice(0, 500));

export const postLaunchNotification = async (episode: EpisodeRow): Promise<void> => {
  if (!config.promotion.sharedSecret) {
    throw boundedError("Launch notification service authentication is not configured.");
  }

  const response = await fetch(config.promotion.launchNotificationBotUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${config.promotion.sharedSecret}`,
    },
    body: JSON.stringify({
      notification_id: `episode:${episode.episodeId}`,
      episode_id: episode.episodeId,
      title: episode.title,
      summary: episode.summary,
      pub_date: episode.pubDate,
      web_url: `https://dragaocareca.com/#/episode/${episode.episodeId}`,
      image_url: `${config.feed.imageBase}${episode.coverFileName ?? `episodes/${episode.episodeId}/cover.jpeg`}`,
    }),
    signal: AbortSignal.timeout(config.promotion.requestTimeoutMs),
  }).catch(() => {
    throw boundedError("Launch notification transport unavailable.");
  });

  if (!response.ok) {
    throw boundedError(`Launch notification service rejected the request (HTTP ${response.status}).`);
  }
};
