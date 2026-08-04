import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env";

const uploadScope = "https://www.googleapis.com/auth/youtube.upload";
const resumableUploadBaseUrl = "https://www.googleapis.com/upload/youtube/v3/videos";

export type YoutubeTrailerUploadProviderError = {
  code: "configuration" | "authorization" | "retryable" | "unrecoverable" | "session-expired";
  message: string;
  httpStatus?: number;
  reason?: string;
};

export type YoutubeTrailerPrivateSession = {
  sessionUri: string;
  privacyStatus: "private";
};

export type YoutubeTrailerRangeResume = {
  confirmedBytes: number;
  providerVideoId: string | null;
};

export type YoutubeTrailerChunkResult = {
  confirmedBytes: number;
  providerVideoId: string | null;
};

export type YoutubeTrailerProcessingState = {
  privacyStatus: string | null;
  uploadStatus: string | null;
  processingStatus: string | null;
  partsProcessed: number | null;
  partsTotal: number | null;
  timeLeftMs: number | null;
};

export type YoutubeTrailerCancellationResult = {
  accepted: boolean;
  boundary: "local-cancelled" | "provider-video-retained";
};

/**
 * Internal-only provider contract. Session URIs, access tokens, local paths, and
 * raw provider responses never cross this boundary into status DTOs or routes.
 */
export interface YoutubeTrailerUploadProvider {
  checkReadiness(): Promise<void>;
  beginPrivateSession(sourceBytes: number): Promise<YoutubeTrailerPrivateSession>;
  resumeRange(sessionUri: string, sourceBytes: number): Promise<YoutubeTrailerRangeResume>;
  uploadChunk(sessionUri: string, sourceBytes: number, offset: number, chunk: Buffer): Promise<YoutubeTrailerChunkResult>;
  pollProcessing(providerVideoId: string): Promise<YoutubeTrailerProcessingState>;
  cancel(sessionUri: string, providerVideoId: string | null): Promise<YoutubeTrailerCancellationResult>;
  normalizeFailure(error: unknown): YoutubeTrailerUploadProviderError;
}

type YoutubeVideoResponse = {
  id?: string;
  status?: { privacyStatus?: string; uploadStatus?: string };
  processingDetails?: {
    processingStatus?: string;
    processingProgress?: { partsProcessed?: number; partsTotal?: number; timeLeftMs?: number };
  };
};

const parseRangeEnd = (range: string | null): number => {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range.trim());
  return match ? Number(match[1]) + 1 : 0;
};

const responseReason = async (response: Response): Promise<string | undefined> => {
  const payload = (await response.json().catch(() => null)) as { error?: { errors?: Array<{ reason?: unknown }>; message?: unknown } } | null;
  const reason = payload?.error?.errors?.[0]?.reason;
  return typeof reason === "string" ? reason : undefined;
};

export class LiveYoutubeTrailerUploadProvider implements YoutubeTrailerUploadProvider {
  private readonly client = new OAuth2Client(config.youtube.clientId, config.youtube.clientSecret);
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  async checkReadiness(): Promise<void> {
    if (!config.youtube.clientId || !config.youtube.clientSecret || !config.youtube.refreshToken) {
      throw this.error("configuration", "YouTube trailer upload is not configured.");
    }
    const token = await this.getAccessToken();
    try {
      const info = await this.client.getTokenInfo(token);
      if (!info.scopes.includes(uploadScope)) {
        throw this.error("authorization", "YouTube trailer upload authorization is missing the required upload scope.");
      }
    } catch (error) {
      if (this.isProviderError(error)) throw error;
      throw this.error("authorization", "YouTube trailer upload authorization could not be verified.");
    }
  }

  async beginPrivateSession(sourceBytes: number): Promise<YoutubeTrailerPrivateSession> {
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0) {
      throw this.error("unrecoverable", "Trailer source bytes are invalid.");
    }
    await this.checkReadiness();
    const response = await this.authorizedFetch(`${resumableUploadBaseUrl}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(sourceBytes),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({ status: { privacyStatus: "private" } }),
    });
    if (!response.ok) throw await this.errorFromResponse(response);
    const sessionUri = response.headers.get("location");
    if (!sessionUri) throw this.error("unrecoverable", "YouTube did not provide a resumable upload session.");
    return { sessionUri, privacyStatus: "private" };
  }

  async resumeRange(sessionUri: string, sourceBytes: number): Promise<YoutubeTrailerRangeResume> {
    const response = await this.authorizedFetch(sessionUri, {
      method: "PUT",
      headers: { "Content-Length": "0", "Content-Range": `bytes */${sourceBytes}` },
    });
    if (response.status === 308) return { confirmedBytes: parseRangeEnd(response.headers.get("range")), providerVideoId: null };
    if (!response.ok) throw await this.errorFromResponse(response);
    const payload = (await response.json()) as YoutubeVideoResponse;
    return { confirmedBytes: 0, providerVideoId: payload.id ?? null };
  }

  async uploadChunk(sessionUri: string, sourceBytes: number, offset: number, chunk: Buffer): Promise<YoutubeTrailerChunkResult> {
    if (!Number.isSafeInteger(offset) || offset < 0 || chunk.length === 0) {
      throw this.error("unrecoverable", "Trailer upload chunk is invalid.");
    }
    const end = offset + chunk.length - 1;
    const response = await this.authorizedFetch(sessionUri, {
      method: "PUT",
      headers: { "Content-Length": String(chunk.length), "Content-Range": `bytes ${offset}-${end}/${sourceBytes}`, "Content-Type": "video/mp4" },
      body: new Uint8Array(chunk),
    });
    if (response.status === 308) return { confirmedBytes: parseRangeEnd(response.headers.get("range")), providerVideoId: null };
    if (!response.ok) throw await this.errorFromResponse(response);
    const payload = (await response.json()) as YoutubeVideoResponse;
    return { confirmedBytes: end + 1, providerVideoId: payload.id ?? null };
  }

  async pollProcessing(providerVideoId: string): Promise<YoutubeTrailerProcessingState> {
    const query = new URLSearchParams({ part: "status,processingDetails", id: providerVideoId });
    const response = await this.authorizedFetch(`${config.youtube.dataBaseUrl}/videos?${query.toString()}`, { method: "GET" });
    if (!response.ok) throw await this.errorFromResponse(response);
    const payload = (await response.json()) as { items?: YoutubeVideoResponse[] };
    const video = payload.items?.[0];
    if (!video) throw this.error("unrecoverable", "YouTube private video could not be reconciled.");
    return {
      privacyStatus: video.status?.privacyStatus ?? null,
      uploadStatus: video.status?.uploadStatus ?? null,
      processingStatus: video.processingDetails?.processingStatus ?? null,
      partsProcessed: video.processingDetails?.processingProgress?.partsProcessed ?? null,
      partsTotal: video.processingDetails?.processingProgress?.partsTotal ?? null,
      timeLeftMs: video.processingDetails?.processingProgress?.timeLeftMs ?? null,
    };
  }

  async cancel(_sessionUri: string, providerVideoId: string | null): Promise<YoutubeTrailerCancellationResult> {
    return providerVideoId ? { accepted: false, boundary: "provider-video-retained" } : { accepted: true, boundary: "local-cancelled" };
  }

  normalizeFailure(error: unknown): YoutubeTrailerUploadProviderError {
    if (this.isProviderError(error)) return error;
    return this.error("retryable", "YouTube trailer upload is temporarily unavailable.");
  }

  private async authorizedFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    return fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(config.youtube.trailerJob.providerTimeoutMs),
    }).catch((error: unknown) => {
      throw this.error("retryable", "YouTube trailer upload request failed.", undefined, error instanceof Error ? error.name : undefined);
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessTokenExpiresAt - 300_000 > Date.now()) return this.accessToken;
    this.client.setCredentials({ refresh_token: config.youtube.refreshToken });
    try {
      const result = await this.client.getAccessToken();
      if (!result.token) throw new Error("missing access token");
      this.accessToken = result.token;
      this.accessTokenExpiresAt = this.client.credentials.expiry_date ?? Date.now() + 3_300_000;
      return result.token;
    } catch (_error) {
      throw this.error("authorization", "YouTube trailer upload authorization is unavailable.");
    }
  }

  private async errorFromResponse(response: Response): Promise<YoutubeTrailerUploadProviderError> {
    const reason = await responseReason(response);
    if (response.status === 404 || response.status === 410) return this.error("session-expired", "YouTube resumable upload session is no longer available.", response.status, reason);
    if (response.status === 401 || response.status === 403) return this.error("authorization", "YouTube trailer upload authorization was rejected.", response.status, reason);
    if (response.status === 429 || response.status >= 500) return this.error("retryable", "YouTube trailer upload is temporarily unavailable.", response.status, reason);
    return this.error("unrecoverable", "YouTube trailer upload was rejected.", response.status, reason);
  }

  private error(code: YoutubeTrailerUploadProviderError["code"], message: string, httpStatus?: number, reason?: string): YoutubeTrailerUploadProviderError {
    return { code, message, ...(httpStatus === undefined ? {} : { httpStatus }), ...(reason === undefined ? {} : { reason }) };
  }

  private isProviderError(error: unknown): error is YoutubeTrailerUploadProviderError {
    return Boolean(error && typeof error === "object" && "code" in error && "message" in error);
  }
}

export const createLiveYoutubeTrailerUploadProvider = (): YoutubeTrailerUploadProvider => new LiveYoutubeTrailerUploadProvider();
