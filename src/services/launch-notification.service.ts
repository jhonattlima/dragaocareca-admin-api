import { episodeRepository } from "../database/repositories/episode.repository";
import { sendLaunchTelegramNotification } from "./telegram.service";

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
    await sendLaunchTelegramNotification(episode);
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
