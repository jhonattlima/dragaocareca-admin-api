import type { EpisodeRow } from "../database/repositories/episode.repository";
import { config } from "../config/env";

export type PublicEpisodeCatalogGuest = {
  name: string;
};

export type PublicEpisodeReferenceLink = {
  label: string;
  url: string;
};

export type PublicEpisodeReference = {
  name: string;
  links: PublicEpisodeReferenceLink[];
};

export type PublicEpisodeCoverCredit = {
  name: string;
  member: boolean;
};

export type PublicEpisodeCatalogItem = {
  episodeId: number;
  title: string;
  summary: string;
  pubDate: string;
  guests: PublicEpisodeCatalogGuest[];
  pageUrl: string;
  audioUrl: string | null;
  coverUrl: string | null;
  trailerUrl: string | null;
};

export type PublicEpisodeDetail = {
  episodeId: number;
  title: string;
  summary: string;
  pubDate: string;
  duration: string | null;
  explicit: "yes" | "no";
  authors: PublicEpisodeCatalogGuest[];
  guests: PublicEpisodeReference[];
  citations: string[];
  musicCredits: PublicEpisodeReference[];
  coverCredits: PublicEpisodeCoverCredit[];
  pageUrl: string;
  audioUrl: string | null;
  downloadUrl: string | null;
  coverUrl: string | null;
  trailerUrl: string | null;
  youtubeUrl: string | null;
  youtubeEmbedUrl: string | null;
  spotifyId: string | null;
  spotifyEmbedUrl: string | null;
};

export type PublicCatalogContext = {
  requestOrigin: string;
};

const ensureTrailingSlash = (value: string): string => (value.endsWith("/") ? value : `${value}/`);

const buildAbsoluteFromBase = (base: string, suffix: string): string => `${ensureTrailingSlash(base)}${suffix.replace(/^\/+/, "")}`;

const buildMediaUrlFromOrigin = (origin: string, relativePath: string): string =>
  `${origin.replace(/\/+$/, "")}/media/${relativePath.replace(/^\/+/, "")}`;

const normalizeEntryName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // Fall back to the raw stored string.
  }

  return trimmed;
};

const mapGuests = (guests: string[]): PublicEpisodeCatalogGuest[] =>
  guests
    .map(normalizeEntryName)
    .filter((name): name is string => name.length > 0)
    .map((name) => ({ name }));

const mapStringList = (values: string[]): string[] => values.map((value) => value.trim()).filter((value) => value.length > 0);

const mapStructuredReferences = (values: string[]): PublicEpisodeReference[] =>
  values
    .map((value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed) as { name?: unknown; links?: unknown };
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        const rawLinks = Array.isArray(parsed.links) ? parsed.links : [];
        const links = rawLinks
          .map((link) => {
            if (!link || typeof link !== "object") {
              return null;
            }

            const candidate = link as { label?: unknown; url?: unknown };
            const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
            const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
            if (!label && !url) {
              return null;
            }

            return { label, url };
          })
          .filter((link): link is PublicEpisodeReferenceLink => link !== null);

        if (!name) {
          return null;
        }

        return { name, links };
      } catch {
        return { name: trimmed, links: [] };
      }
    })
    .filter((entry): entry is PublicEpisodeReference => entry !== null);

const mapCoverCredits = (values: string[]): PublicEpisodeCoverCredit[] =>
  values
    .map((value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed) as { name?: unknown; member?: unknown };
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        if (!name) {
          return null;
        }

        return {
          name,
          member: parsed.member === true,
        };
      } catch {
        return {
          name: trimmed,
          member: false,
        };
      }
    })
    .filter((entry): entry is PublicEpisodeCoverCredit => entry !== null);

const buildPageBaseUrl = (): string => {
  if (config.feed.baseLink.includes("#/episode/")) {
    return config.feed.baseLink;
  }

  return `${config.feed.site.replace(/\/+$/, "")}/#/episode/`;
};

const buildPageUrl = (episodeId: number): string => `${buildPageBaseUrl()}${episodeId}`;

const buildAudioUrl = (episode: EpisodeRow, context: PublicCatalogContext): string | null => {
  if (!episode.fileName) {
    return null;
  }

  return episode.fileName.includes("/")
    ? buildMediaUrlFromOrigin(context.requestOrigin, episode.fileName)
    : buildAbsoluteFromBase(config.feed.audioBase, episode.fileName);
};

const buildCoverUrl = (episode: EpisodeRow, context: PublicCatalogContext): string | null => {
  if (episode.coverLowFileName) {
    return episode.coverLowFileName.includes("/")
      ? buildMediaUrlFromOrigin(context.requestOrigin, episode.coverLowFileName)
      : buildAbsoluteFromBase(`${ensureTrailingSlash(config.feed.imageBase)}low/`, episode.coverLowFileName);
  }

  if (!episode.coverFileName) {
    return null;
  }

  return episode.coverFileName.includes("/")
    ? buildMediaUrlFromOrigin(context.requestOrigin, episode.coverFileName)
    : buildAbsoluteFromBase(config.feed.imageBase, episode.coverFileName);
};

const buildTrailerUrl = (episode: EpisodeRow, context: PublicCatalogContext): string | null => {
  if (!episode.trailerFileName) {
    return null;
  }

  return episode.trailerFileName.includes("/")
    ? buildMediaUrlFromOrigin(context.requestOrigin, episode.trailerFileName)
    : buildMediaUrlFromOrigin(context.requestOrigin, `trailers/${episode.trailerFileName}`);
};

const normalizeYoutubeUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://www.youtube.com/watch?v=${trimmed}`;
};

const buildYoutubeEmbedUrl = (value: string | undefined): string | null => {
  const url = normalizeYoutubeUrl(value);
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\/+/, "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (host.endsWith("youtube.com")) {
      if (parsed.pathname.startsWith("/shorts/")) {
        const id = parsed.pathname.replace(/^\/shorts\/+/, "").split("/")[0];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }

      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }

      if (parsed.pathname.startsWith("/embed/")) {
        return `https://www.youtube.com${parsed.pathname}`;
      }
    }
  } catch {
    return `https://www.youtube.com/embed/${url}`;
  }

  return null;
};

const buildSpotifyEmbedUrl = (spotifyId: string | undefined): string | null => {
  const trimmed = spotifyId?.trim();
  if (!trimmed) {
    return null;
  }

  return `https://open.spotify.com/embed-podcast/episode/${trimmed}`;
};

export const mapEpisodeToPublicCatalogItem = (
  episode: EpisodeRow,
  context: PublicCatalogContext
): PublicEpisodeCatalogItem => ({
  episodeId: episode.episodeId,
  title: episode.title,
  summary: episode.summary,
  pubDate: episode.pubDate,
  guests: mapGuests(episode.guests),
  pageUrl: buildPageUrl(episode.episodeId),
  audioUrl: buildAudioUrl(episode, context),
  coverUrl: buildCoverUrl(episode, context),
  trailerUrl: buildTrailerUrl(episode, context),
});

export const mapEpisodesToPublicCatalog = (
  episodes: EpisodeRow[],
  context: PublicCatalogContext
): PublicEpisodeCatalogItem[] => episodes.map((episode) => mapEpisodeToPublicCatalogItem(episode, context));

export const mapEpisodeToPublicDetail = (
  episode: EpisodeRow,
  context: PublicCatalogContext
): PublicEpisodeDetail => {
  const audioUrl = buildAudioUrl(episode, context);

  return {
    episodeId: episode.episodeId,
    title: episode.title,
    summary: episode.summary,
    pubDate: episode.pubDate,
    duration: episode.duration ?? null,
    explicit: episode.explicit,
    authors: mapGuests(episode.authors),
    guests: mapStructuredReferences(episode.guests),
    citations: mapStringList(episode.citations),
    musicCredits: mapStructuredReferences(episode.musicCredits),
    coverCredits: mapCoverCredits(episode.coverCredits),
    pageUrl: buildPageUrl(episode.episodeId),
    audioUrl,
    downloadUrl: audioUrl,
    coverUrl: buildCoverUrl(episode, context),
    trailerUrl: buildTrailerUrl(episode, context),
    youtubeUrl: normalizeYoutubeUrl(episode.youtube),
    youtubeEmbedUrl: buildYoutubeEmbedUrl(episode.youtube),
    spotifyId: episode.spotifyId ?? null,
    spotifyEmbedUrl: buildSpotifyEmbedUrl(episode.spotifyId),
  };
};
