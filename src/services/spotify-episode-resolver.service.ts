import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";

export type SpotifyEpisode = { id: string; name: string };

export type SpotifyEpisodeProvider = {
  listRecentEpisodes: () => Promise<SpotifyEpisode[]>;
};

const normalizeTitle = (value: string): string => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

export const findMatchingSpotifyEpisode = (title: string, episodes: SpotifyEpisode[]): SpotifyEpisode | null => {
  const normalized = normalizeTitle(title);
  return episodes.find((episode) => normalizeTitle(episode.name) === normalized) ?? null;
};

const requestJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Spotify request failed with HTTP ${response.status}`);
  return response.json();
};

export const createSpotifyEpisodeProvider = (): SpotifyEpisodeProvider => ({
  async listRecentEpisodes(): Promise<SpotifyEpisode[]> {
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
    const body = await requestJson(`https://api.spotify.com/v1/shows/${encodeURIComponent(config.spotify.episodeResolver.showId)}/episodes?market=BR&limit=50`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }) as { items?: unknown };
    return Array.isArray(body.items) ? body.items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { id?: unknown; name?: unknown };
      return typeof candidate.id === "string" && typeof candidate.name === "string" ? [{ id: candidate.id, name: candidate.name }] : [];
    }) : [];
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
