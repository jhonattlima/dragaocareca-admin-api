import { config } from "../config/env";
import { episodePromotionRepository } from "../database/repositories/episode-promotion.repository";
import {
  classifyPromotionError,
  dispatchPromotionIntent,
  type PromotionTransport,
} from "../services/episode-promotion.service";
import { postEpisodePromotion } from "../services/episode-promotion-client.service";

type PromotionRecoveryRepository = Pick<
  typeof episodePromotionRepository,
  | "recoverExpiredPromotionLeases"
  | "listIncompletePromotionEffects"
  | "findPromotionIntent"
>;

export type EpisodePromotionRecoveryOptions = {
  repository?: PromotionRecoveryRepository;
  transport?: PromotionTransport;
  now?: () => Date;
  leaseDurationMs?: number;
};

export type EpisodePromotionRecoveryResult = {
  recoveredLeaseCount: number;
  incompleteNotificationCount: number;
  dispatchedNotificationCount: number;
  failedNotificationCount: number;
};

const configuredPromotionTransport: PromotionTransport = {
  async sendPromotion(request, effects): Promise<unknown> {
    return postEpisodePromotion(request, effects);
  },
};

const privateBotConfigurationIsValid = (): boolean => {
  if (config.promotion.activeOwner !== "promotion" || !config.promotion.enabled) return false;
  if (!config.promotion.sharedSecretConfigured || !config.promotion.sharedSecret) return false;
  if (config.promotion.pollIntervalMs <= 0) return false;
  try {
    const endpoint = new URL(config.promotion.botUrl);
    return endpoint.protocol === "http:" || endpoint.protocol === "https:";
  } catch {
    return false;
  }
};

const logRecoveryFailure = (notificationId: string, error: unknown): void => {
  const classified = classifyPromotionError(error);
  console.error("Episode promotion recovery failed", {
    at: new Date().toISOString(),
    correlation_id: notificationId,
    category: classified.category,
    description: classified.description,
    retryable: classified.retryable,
  });
};

export const runEpisodePromotionRecoveryPass = async (
  options: EpisodePromotionRecoveryOptions = {},
): Promise<EpisodePromotionRecoveryResult> => {
  const repository = options.repository ?? episodePromotionRepository;
  const referenceTime = options.now?.() ?? new Date();
  const recovered = repository.recoverExpiredPromotionLeases(referenceTime, options.leaseDurationMs);
  const incompleteEffects = repository.listIncompletePromotionEffects();
  const notificationIds = [...new Set(incompleteEffects.map((effect) => effect.notificationId))];
  const transport = options.transport ?? configuredPromotionTransport;
  let dispatchedNotificationCount = 0;
  let failedNotificationCount = 0;

  for (const notificationId of notificationIds) {
    if (!repository.findPromotionIntent(notificationId)) continue;
    try {
      const acknowledgement = await dispatchPromotionIntent(notificationId, transport);
      if (acknowledgement) dispatchedNotificationCount += 1;
    } catch (error) {
      failedNotificationCount += 1;
      logRecoveryFailure(notificationId, error);
    }
  }

  return {
    recoveredLeaseCount: recovered.length,
    incompleteNotificationCount: notificationIds.length,
    dispatchedNotificationCount,
    failedNotificationCount,
  };
};

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (options: EpisodePromotionRecoveryOptions): Promise<void> => {
  if (activeRun) return activeRun;
  activeRun = (async () => {
    try {
      const result = await runEpisodePromotionRecoveryPass(options);
      if (result.recoveredLeaseCount > 0 || result.dispatchedNotificationCount > 0 || result.failedNotificationCount > 0) {
        console.info("Episode promotion recovery pass completed", {
          at: new Date().toISOString(),
          recovered_leases: result.recoveredLeaseCount,
          incomplete_notifications: result.incompleteNotificationCount,
          dispatched_notifications: result.dispatchedNotificationCount,
          failed_notifications: result.failedNotificationCount,
        });
      }
    } catch (error) {
      logRecoveryFailure("worker-pass", error);
    }
  })().finally(() => {
    activeRun = null;
  });
  return activeRun;
};

export const startEpisodePromotionWorker = async (
  options: EpisodePromotionRecoveryOptions = {},
): Promise<() => void> => {
  if (!privateBotConfigurationIsValid()) {
    console.info("Episode promotion worker disabled because private bot configuration is incomplete or invalid");
    return () => undefined;
  }

  await runOnce(options);
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void runOnce(options);
    }, config.promotion.pollIntervalMs);
    pollTimer.unref();
  }

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
