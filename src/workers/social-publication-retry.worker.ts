import { config } from "../config/env";
import { processDueSocialPublicationEffects } from "../services/launch-notification.service";

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (): Promise<void> => {
  if (activeRun) return activeRun;
  activeRun = (async () => {
    const result = await processDueSocialPublicationEffects();
    if (result.processed > 0) {
      console.log(`Social publication retry worker processed ${result.processed} effect(s); attempted=${result.attempted}; failed=${result.failed}`);
    }
  })().finally(() => { activeRun = null; });
  return activeRun;
};

export const startSocialPublicationRetryWorker = async (): Promise<() => void> => {
  if (!config.meta.instagramEnabled && !config.meta.facebookReelEnabled) {
    console.log("Social publication retry worker disabled because no Meta destination is enabled");
    return () => undefined;
  }
  await runOnce();
  pollTimer = setInterval(() => {
    void runOnce().catch((error: unknown) => console.error("Social publication retry worker failed", error));
  }, config.promotion.socialRetryPollIntervalMs);
  return () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  };
};
