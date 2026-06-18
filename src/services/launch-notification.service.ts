import { EpisodeDocument, EpisodeModel } from "../models/Episode";

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

