import { config } from "../config/env";
import { processPendingLaunchNotifications } from "../services/launch-notification.service";

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (): Promise<void> => {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    const result = await processPendingLaunchNotifications();
    if (result.processed > 0) {
      console.log(
        `Launch notification worker processed ${result.processed} pending episode(s); delivered=${result.delivered}; failed=${result.failed}`
      );
    }
  })().finally(() => {
    activeRun = null;
  });

  return activeRun;
};

export const startLaunchNotificationWorker = async (): Promise<() => void> => {
  if (!config.promotion.legacyLaunchEnabled) {
    console.log("Launch notification worker disabled by PROMOTION_LEGACY_LAUNCH_ENABLED=false");
    return () => undefined;
  }
  if (config.telegram.pollIntervalMs <= 0) {
    console.log("Launch notification worker disabled by TELEGRAM_POLL_INTERVAL_MS");
    return () => undefined;
  }

  if (!config.promotion.sharedSecret || !config.promotion.launchNotificationBotUrl) {
    console.log("Launch notification worker disabled because API-to-bot notification authentication is missing");
    return () => undefined;
  }

  await runOnce();
  pollTimer = setInterval(() => {
    void runOnce().catch((error: unknown) => {
      console.error("Launch notification worker failed", error);
    });
  }, config.telegram.pollIntervalMs);

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
