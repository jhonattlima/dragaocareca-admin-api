import { config } from "../config/env";

export type ProviderResult = { id: string; status?: string; permalink?: string | null };
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
    const category: MetaProviderFailure["category"] = response.status === 401 || response.status === 403 ? "permission" : response.status >= 500 ? "transient" : "provider";
    const providerError = typeof body.error === "object" && body.error ? body.error as Record<string, unknown> : {};
    const message = typeof providerError.message === "string" ? providerError.message : "Meta provider request failed";
    const safeMessage = message.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 240);
    const failure: MetaProviderFailure = Object.assign(new Error(safeMessage), {
      category,
      providerCode: typeof providerError.code === "number" ? providerError.code : undefined,
      providerStatus: response.status,
    });
    throw failure;
  }
  return { id: String(body.id ?? body.video_id ?? ""), status: typeof body.status === "string" ? body.status : undefined, permalink: typeof body.permalink_url === "string" ? body.permalink_url : null };
};

export const metaPublicationProvider: MetaPublicationProvider = {
  createInstagramContainer: (input) => request(`${config.meta.instagramAccountId}/media`, { method: "POST", body: new URLSearchParams({ media_type: "REELS", video_url: input.mediaUrl, caption: input.caption, access_token: publicationToken() }) }),
  getInstagramContainer: (id) => request(`${id}?fields=id,status_code&access_token=${encodeURIComponent(publicationToken())}`),
  publishInstagramContainer: (id) => request(`${config.meta.instagramAccountId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: id, access_token: publicationToken() }) }),
  uploadFacebookVideo: async (input) => {
    const form = new FormData();
    form.set("source", input.media, "trailer.mp4");
    form.set("title", input.title);
    form.set("description", input.description);
    form.set("access_token", await pagePublicationToken());
    return request(`${config.meta.pageId}/videos`, { method: "POST", body: form });
  },
  getFacebookVideo: async (id) => request(`${id}?fields=id,status,permalink_url&access_token=${encodeURIComponent(await pagePublicationToken())}`),
  publishFacebookVideo: async (id) => request(`${id}`, { method: "POST", body: new URLSearchParams({ published: "true", access_token: await pagePublicationToken() }) }),
};
