import { episodeRepository } from "../database/repositories/episode.repository";
import { deliverEpisodePublication } from "./episode-publication.service";
import { deliverInstagramReel } from "./instagram-reel-publication.service";
import { deliverFacebookNativeVideo } from "./facebook-native-video-publication.service";
import { episodePublicationRepository } from "../database/repositories/episode-publication.repository";

type LaunchNotificationCandidate = {
  episodeId: number;
  pubDate: string;
  launchNotificationState?: "idle" | "pending" | "sent";
};

const isLaunchable = (episode: LaunchNotificationCandidate, now = new Date()): boolean => {
  return new Date(episode.pubDate) <= now && episode.launchNotificationState !== "sent";
};

export const queueLaunchNotification = async (
  episodeId: number
): Promise<{ queued: boolean; alreadyQueued: boolean }> => {
  const now = new Date();
  const episode = episodeRepository.findByEpisodeId(episodeId);

  if (!episode) {
    return { queued: false, alreadyQueued: false };
  }

  if (!isLaunchable(episode, now)) {
    return { queued: false, alreadyQueued: episode.launchNotificationState === "pending" };
  }

  if (episode.launchNotificationState === "pending") {
    return { queued: false, alreadyQueued: true };
  }

  episodeRepository.queueLaunchNotification(episodeId);

  return { queued: true, alreadyQueued: false };
};

export const getPendingLaunchNotifications = async (): Promise<LaunchNotificationCandidate[]> => {
  return episodeRepository.getPendingLaunchNotifications();
};

export const deliverPendingLaunchNotification = async (
  episodeId: number
): Promise<{ delivered: boolean; alreadySent: boolean }> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) {
    return { delivered: false, alreadySent: false };
  }

  if (episode.launchNotificationState === "sent") {
    return { delivered: false, alreadySent: true };
  }

  if (episode.launchNotificationState !== "pending") {
    return { delivered: false, alreadySent: false };
  }

  try {
    await deliverEpisodePublication(episode);
    episodeRepository.markLaunchSent(episodeId);
    return { delivered: true, alreadySent: false };
  } catch (error) {
    episodeRepository.markLaunchError(episodeId, error instanceof Error ? error.message : "Unknown telegram error");
    throw error;
  }
};

export const processPendingLaunchNotifications = async (): Promise<{
  processed: number;
  delivered: number;
  failed: number;
}> => {
  episodeRepository.queueDueLaunchNotifications();
  const pending = await getPendingLaunchNotifications();
  let delivered = 0;
  let failed = 0;

  for (const episode of pending) {
    try {
      const result = await deliverPendingLaunchNotification(episode.episodeId);
      if (result.delivered) {
        delivered += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    processed: pending.length,
    delivered,
    failed,
  };
};

export const processDueSocialPublicationEffects = async (): Promise<{
  processed: number;
  attempted: number;
  failed: number;
}> => {
  const due = episodePublicationRepository.listDueSocialEffects();
  let attempted = 0;
  let failed = 0;

  for (const item of due) {
    const episode = episodeRepository.findByEpisodeId(item.episodeId);
    if (!episode) continue;
    attempted += 1;
    try {
      if (item.effect.destination === "instagram_reel") {
        await deliverInstagramReel(item.episodeId, item.effect);
      } else {
        await deliverFacebookNativeVideo(item.episodeId, item.effect);
      }
    } catch {
      failed += 1;
    }
  }

  return { processed: due.length, attempted, failed };
};
