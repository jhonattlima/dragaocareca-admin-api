import { config } from "../config/env";

export type ProviderResult = { id: string; status?: string; permalink?: string | null; uploadUrl?: string };
type MetaProviderFailure = Error & { category: "permission" | "provider" | "transient"; providerCode?: number; providerStatus?: number };
export type MetaPublicationProvider = {
  createInstagramContainer(input: { mediaUrl: string; caption: string }): Promise<ProviderResult>;
  getInstagramContainer(id: string): Promise<ProviderResult>;
  publishInstagramContainer(id: string): Promise<ProviderResult>;
  uploadFacebookVideo(input: { media: Blob; title: string; description: string }): Promise<ProviderResult>;
  getFacebookVideo(id: string): Promise<ProviderResult>;
  publishFacebookVideo(id: string): Promise<ProviderResult>;
};

const providerUrl = (path: string): string => `https://graph.facebook.com/${config.meta.graphApiVersion}/${path}`;
const publicationToken = (): string => config.meta.systemUserAccessToken || config.meta.pageAccessToken;
const pagePublicationToken = async (): Promise<string> => {
  if (!config.meta.systemUserAccessToken) return config.meta.pageAccessToken;
  try {
    const response = await fetch(providerUrl(`me/accounts?fields=id,access_token&access_token=${encodeURIComponent(config.meta.systemUserAccessToken)}`), { signal: AbortSignal.timeout(30_000) });
    const body = await response.json() as { data?: Array<{ id?: string; access_token?: string }> };
    const page = body.data?.find((item) => item.id === config.meta.pageId);
    if (response.ok && page?.access_token) return page.access_token;
  } catch { /* use the configured page token as a fallback */ }
  return config.meta.pageAccessToken;
};
const request = async (path: string, init: RequestInit = {}): Promise<ProviderResult> => {
  if (!publicationToken()) throw Object.assign(new Error("Meta publication connection is not configured."), { category: "configuration" as const });
  const response = await fetch(providerUrl(path), { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const providerError = typeof body.error === "object" && body.error ? body.error as Record<string, unknown> : {};
    const providerCode = typeof providerError.code === "number" ? providerError.code : undefined;
    const category: MetaProviderFailure["category"] = response.status === 401 || response.status === 403 ? "permission" : response.status >= 500 || providerCode === 9007 ? "transient" : "provider";
    const message = typeof providerError.message === "string" ? providerError.message : "Meta provider request failed";
    const safeMessage = message.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 240);
    const failure: MetaProviderFailure = Object.assign(new Error(safeMessage), {
      category,
      providerCode,
      providerStatus: response.status,
    });
    throw failure;
  }
  const status = typeof body.status === "string" ? body.status : typeof body.status === "object" && body.status ? String((body.status as Record<string, unknown>).video_status ?? "") : undefined;
  return { id: String(body.id ?? body.video_id ?? ""), status: status || undefined, permalink: typeof body.permalink_url === "string" ? body.permalink_url : null, uploadUrl: typeof body.upload_url === "string" ? body.upload_url : undefined };
};

export const metaPublicationProvider: MetaPublicationProvider = {
  createInstagramContainer: async (input) => request(`${config.meta.instagramAccountId}/media`, { method: "POST", body: new URLSearchParams({ media_type: "REELS", video_url: input.mediaUrl, caption: input.caption, access_token: await pagePublicationToken() }) }),
  getInstagramContainer: async (id) => request(`${id}?fields=id,status_code&access_token=${encodeURIComponent(await pagePublicationToken())}`),
  publishInstagramContainer: async (id) => request(`${config.meta.instagramAccountId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: id, access_token: await pagePublicationToken() }) }),
  uploadFacebookVideo: async (input) => {
    const token = await pagePublicationToken();
    const start = await request(`${config.meta.pageId}/video_reels?upload_phase=start&access_token=${encodeURIComponent(token)}`, { method: "POST" });
    if (!start.id || !start.uploadUrl) throw Object.assign(new Error("Facebook Reel upload session did not return a video ID and upload URL."), { category: "provider" as const });
    const upload = await fetch(start.uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(input.media.size), "Content-Type": "application/octet-stream" }, body: input.media, signal: AbortSignal.timeout(60_000) });
    if (!upload.ok) throw Object.assign(new Error(`Facebook Reel binary upload failed (HTTP ${upload.status}).`), { category: upload.status >= 500 ? "transient" as const : "provider" as const, providerStatus: upload.status });
    return { id: start.id };
  },
  getFacebookVideo: async (id) => request(`${id}?fields=id,status,permalink_url&access_token=${encodeURIComponent(await pagePublicationToken())}`),
  publishFacebookVideo: async (id) => request(`${config.meta.pageId}/video_reels`, { method: "POST", body: new URLSearchParams({ video_id: id, upload_phase: "finish", video_state: "PUBLISHED", access_token: await pagePublicationToken() }) }),
};
