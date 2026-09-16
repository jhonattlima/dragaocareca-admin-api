import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";

export type SpotifyEpisode = { id: string; name: string };

export type SpotifyEpisodeProvider = {
  listRecentEpisodes: () => Promise<SpotifyEpisode[]>;
  listAllEpisodes?: () => Promise<SpotifyEpisode[]>;
};

const normalizeTitle = (value: string): string => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

export const findMatchingSpotifyEpisode = (title: string, episodes: SpotifyEpisode[]): SpotifyEpisode | null => {
  const normalized = normalizeTitle(title);
  const matches = episodes.filter((episode) => normalizeTitle(episode.name) === normalized);
  return matches.length === 1 ? matches[0] : null;
};

export type SpotifyReconciliationDecision = "valid" | "replaced" | "missing" | "ambiguous";
export type SpotifyReconciliationItem = { episodeId: number; previousSpotifyId: string | null; newSpotifyId: string | null; decision: SpotifyReconciliationDecision; reason: string };

export const reconcileSpotifyEpisodeIds = (
  episodes: Array<{ episodeId: number; title: string; spotifyId?: string | null }>,
  catalog: SpotifyEpisode[],
  replace: (episodeId: number, expectedSpotifyId: string, newSpotifyId: string) => boolean,
): SpotifyReconciliationItem[] => {
  const catalogIds = new Set(catalog.map((episode) => episode.id));
  return episodes.map((episode) => {
    const previous = episode.spotifyId ?? null;
    if (previous && catalogIds.has(previous)) return { episodeId: episode.episodeId, previousSpotifyId: previous, newSpotifyId: previous, decision: "valid", reason: "saved ID exists in current Spotify catalog" };
    const normalized = normalizeTitle(episode.title);
    const matches = catalog.filter((candidate) => normalizeTitle(candidate.name) === normalized);
    if (matches.length === 0) return { episodeId: episode.episodeId, previousSpotifyId: previous, newSpotifyId: previous, decision: "missing", reason: "no exact title match in current Spotify catalog" };
    if (matches.length > 1) return { episodeId: episode.episodeId, previousSpotifyId: previous, newSpotifyId: previous, decision: "ambiguous", reason: "multiple exact title matches in current Spotify catalog" };
    const candidate = matches[0];
    if (!replace(episode.episodeId, previous ?? "", candidate.id)) return { episodeId: episode.episodeId, previousSpotifyId: previous, newSpotifyId: previous, decision: "missing", reason: "conditional update lost a concurrent change" };
    return { episodeId: episode.episodeId, previousSpotifyId: previous, newSpotifyId: candidate.id, decision: "replaced", reason: previous ? "obsolete ID replaced by unique exact title match" : "missing ID filled by unique exact title match" };
  });
};

const requestJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Spotify request failed with HTTP ${response.status}`);
  return response.json();
};

export const createSpotifyEpisodeProvider = (): SpotifyEpisodeProvider => ({
  async listRecentEpisodes(): Promise<SpotifyEpisode[]> {
    return this.listAllEpisodes ? this.listAllEpisodes() : [];
  },
  async listAllEpisodes(): Promise<SpotifyEpisode[]> {
    if (!config.spotify.episodeResolver.clientId || !config.spotify.episodeResolver.clientSecret || !config.spotify.episodeResolver.showId) {
      throw new Error("Spotify episode resolver configuration is incomplete");
    }
    const credentials = Buffer.from(`${config.spotify.episodeResolver.clientId}:${config.spotify.episodeResolver.clientSecret}`).toString("base64");
    const tokenBody = await requestJson("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }) as { access_token?: unknown };
    if (typeof tokenBody.access_token !== "string") throw new Error("Spotify token response did not contain access_token");
    const result: SpotifyEpisode[] = [];
    for (let offset = 0; ; offset += 50) {
      const body = await requestJson(`https://api.spotify.com/v1/shows/${encodeURIComponent(config.spotify.episodeResolver.showId)}/episodes?market=BR&limit=50&offset=${offset}`, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      }) as { items?: unknown; total?: unknown; next?: unknown };
      const items = Array.isArray(body.items) ? body.items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as { id?: unknown; name?: unknown };
        return typeof candidate.id === "string" && typeof candidate.name === "string" ? [{ id: candidate.id, name: candidate.name }] : [];
      }) : [];
      result.push(...items);
      if (items.length === 0 || (typeof body.total === "number" && result.length >= body.total) || typeof body.next !== "string") break;
    }
    return result;
  },
});

export const resolveEpisodeSpotifyId = async (
  episodeId: number,
  provider: SpotifyEpisodeProvider = createSpotifyEpisodeProvider(),
): Promise<"matched" | "no_match" | "already_set" | "missing_episode"> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) return "missing_episode";
  if (episode.spotifyId) return "already_set";
  const match = findMatchingSpotifyEpisode(episode.title, await provider.listRecentEpisodes());
  if (!match) return "no_match";
  episodeRepository.setSpotifyIdIfMissing(episodeId, match.id);
  return "matched";
};
