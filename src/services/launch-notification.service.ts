import { EpisodeDocument, EpisodeModel } from "../models/Episode";
import { sendLaunchTelegramNotification } from "./telegram.service";

type LaunchNotificationCandidate = Pick<EpisodeDocument, "episodeId" | "pubDate" | "launchNotificationState">;

const isLaunchable = (episode: LaunchNotificationCandidate, now = new Date()): boolean => {
  return episode.pubDate <= now && episode.launchNotificationState !== "sent";
};

export const queueLaunchNotification = async (
  episodeId: number
): Promise<{ queued: boolean; alreadyQueued: boolean }> => {
  const now = new Date();
  const episode = await EpisodeModel.findOne({ episodeId });

  if (!episode) {
    return { queued: false, alreadyQueued: false };
  }

  if (!isLaunchable(episode, now)) {
    return { queued: false, alreadyQueued: episode.launchNotificationState === "pending" };
  }

  if (episode.launchNotificationState === "pending") {
    return { queued: false, alreadyQueued: true };
  }

  episode.launchNotificationState = "pending";
  episode.launchNotificationQueuedAt = now;
  episode.launchNotificationError = undefined;
  await episode.save();

  return { queued: true, alreadyQueued: false };
};

export const getPendingLaunchNotifications = async (): Promise<EpisodeDocument[]> => {
  return EpisodeModel.find({
    pubDate: { $lte: new Date() },
    launchNotificationState: "pending",
  }).sort({ pubDate: 1, episodeId: 1 });
};

export const deliverPendingLaunchNotification = async (
  episodeId: number
): Promise<{ delivered: boolean; alreadySent: boolean }> => {
  const episode = await EpisodeModel.findOne({ episodeId });
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
    episode.launchNotificationState = "sent";
    episode.launchNotificationSentAt = new Date();
    episode.launchNotificationError = undefined;
    await episode.save();
    return { delivered: true, alreadySent: false };
  } catch (error) {
    episode.launchNotificationError = error instanceof Error ? error.message : "Unknown telegram error";
    await episode.save();
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
