import { config } from "../config/env";

export type ProviderResult = { id: string; status?: string; permalink?: string | null };
export type MetaPublicationProvider = {
  createInstagramContainer(input: { mediaUrl: string; caption: string }): Promise<ProviderResult>;
  getInstagramContainer(id: string): Promise<ProviderResult>;
  publishInstagramContainer(id: string): Promise<ProviderResult>;
  uploadFacebookVideo(input: { media: Blob; title: string; description: string }): Promise<ProviderResult>;
  getFacebookVideo(id: string): Promise<ProviderResult>;
  publishFacebookVideo(id: string): Promise<ProviderResult>;
};

const providerUrl = (path: string): string => `https://graph.facebook.com/${config.meta.graphApiVersion}/${path}`;
const request = async (path: string, init: RequestInit = {}): Promise<ProviderResult> => {
  if (!config.meta.userAccessToken) throw Object.assign(new Error("Meta connection is not configured."), { category: "configuration" as const });
  const response = await fetch(providerUrl(path), { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const category = response.status === 401 || response.status === 403 ? "permission" : response.status >= 500 ? "transient" : "provider";
    throw Object.assign(new Error(typeof body.error === "object" && body.error && "message" in body.error ? String(body.error.message) : "Meta provider request failed"), { category });
  }
  return { id: String(body.id ?? body.video_id ?? ""), status: typeof body.status === "string" ? body.status : undefined, permalink: typeof body.permalink_url === "string" ? body.permalink_url : null };
};

export const metaPublicationProvider: MetaPublicationProvider = {
  createInstagramContainer: (input) => request(`${config.meta.instagramAccountId}/media`, { method: "POST", body: new URLSearchParams({ media_type: "REELS", video_url: input.mediaUrl, caption: input.caption, access_token: config.meta.userAccessToken }) }),
  getInstagramContainer: (id) => request(`${id}?fields=id,status_code,permalink&access_token=${encodeURIComponent(config.meta.userAccessToken)}`),
  publishInstagramContainer: (id) => request(`${config.meta.instagramAccountId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: id, access_token: config.meta.userAccessToken }) }),
  uploadFacebookVideo: async (input) => {
    const form = new FormData();
    form.set("source", input.media, "trailer.mp4");
    form.set("title", input.title);
    form.set("description", input.description);
    form.set("access_token", config.meta.userAccessToken);
    return request(`${config.meta.pageId}/videos`, { method: "POST", body: form });
  },
  getFacebookVideo: (id) => request(`${id}?fields=id,status,permalink_url&access_token=${encodeURIComponent(config.meta.userAccessToken)}`),
  publishFacebookVideo: (id) => request(`${id}`, { method: "POST", body: new URLSearchParams({ published: "true", access_token: config.meta.userAccessToken }) }),
};

