import { config } from "../config/env";
import {
  promotionAcknowledgementSchema,
  promotionRequestSchema,
  type PromotionAcknowledgement,
  type PromotionRequest,
} from "../schemas/episode-promotion";
import type { PromotionEffectRow } from "../database/repositories/episode-promotion.repository";

export type PromotionFetch = typeof fetch;

export type EpisodePromotionClientOptions = {
  fetchImplementation?: PromotionFetch;
  endpoint?: string;
  sharedSecret?: string;
  timeoutMs?: number;
};

const boundedError = (message: string): Error => new Error(message.slice(0, 500));

const safeHttpError = (status: number): Error => {
  if (status === 401 || status === 403) return boundedError(`Promotion authentication or permission failure (HTTP ${status}).`);
  if (status === 408 || status === 504) return boundedError(`Promotion transport timeout (HTTP ${status}).`);
  if (status === 400 || status === 422) return boundedError(`Promotion malformed payload (HTTP ${status}).`);
  if (status >= 500) return boundedError(`Telegram service unavailable (HTTP ${status}).`);
  return boundedError(`Promotion transport rejected the request (HTTP ${status}).`);
};

export const postEpisodePromotion = async (
  request: PromotionRequest,
  _effects?: PromotionEffectRow[],
  options: EpisodePromotionClientOptions = {},
): Promise<PromotionAcknowledgement> => {
  const validatedRequest = promotionRequestSchema.parse(request);
  const endpoint = options.endpoint ?? config.promotion.botUrl;
  const sharedSecret = options.sharedSecret ?? config.promotion.sharedSecret;
  const timeoutMs = options.timeoutMs ?? config.promotion.requestTimeoutMs;
  if (!config.promotion.sharedSecretConfigured && !options.sharedSecret) {
    throw boundedError("Promotion service authentication is not configured.");
  }
  if (!sharedSecret) throw boundedError("Promotion service authentication is not configured.");

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${sharedSecret}`,
        },
        body: JSON.stringify(validatedRequest),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw boundedError("Promotion transport timed out.");
      throw boundedError("Promotion transport unavailable.");
    }

    if (!response.ok) throw safeHttpError(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw boundedError("Promotion transport returned a malformed payload acknowledgement.");
    }
    try {
      return promotionAcknowledgementSchema.parse(payload);
    } catch {
      throw boundedError("Promotion transport returned a malformed payload acknowledgement.");
    }
  } finally {
    clearTimeout(timeout);
  }
};
