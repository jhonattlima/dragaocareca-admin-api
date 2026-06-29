import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";

const mosaicPath = path.resolve(process.cwd(), "data", "generated", "cover-mosaic.svg");
const canvasWidth = 1600;
const canvasHeight = 960;
const columns = 5;
const rows = 3;
const tileWidth = canvasWidth / columns;
const tileHeight = canvasHeight / rows;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isValidCoverFileName = (value: string | null | undefined): value is string => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && trimmed.toLowerCase() !== "string";
};

const toCoverUrl = (episode: EpisodeRow): string => {
  const lowFileName = isValidCoverFileName(episode.coverLowFileName) ? episode.coverLowFileName : null;
  const highFileName = isValidCoverFileName(episode.coverFileName) ? episode.coverFileName : null;

  if (lowFileName) {
    return `${config.feed.imageBase}${lowFileName}`;
  }

  if (highFileName) {
    return `${config.feed.imageBase}${highFileName}`;
  }

  return "";
};

const selectTileUrls = (episodes: EpisodeRow[]): string[] =>
  episodes
    .filter((episode) => isValidCoverFileName(episode.coverLowFileName) || isValidCoverFileName(episode.coverFileName))
    .slice(0, columns * rows)
    .map((episode) => toCoverUrl(episode))
    .filter((url) => url.length > 0);

const buildTiles = async (episodes: EpisodeRow[]): Promise<string> => {
  const selected = episodes
    .filter((episode) => isValidCoverFileName(episode.coverLowFileName) || isValidCoverFileName(episode.coverFileName))
    .slice(0, columns * rows);
  const tiles: string[] = [];

  for (let index = 0; index < columns * rows; index += 1) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const x = Math.round(col * tileWidth);
    const y = Math.round(row * tileHeight);
    const next = selected[index];

    if (!next) {
      tiles.push(`
        <rect x="${x}" y="${y}" width="${Math.ceil(tileWidth) + 1}" height="${Math.ceil(tileHeight) + 1}" fill="rgba(255,255,255,0.08)" />
      `);
      continue;
    }

    const href = escapeXml(toCoverUrl(next));
    if (!href) {
      tiles.push(`
        <rect x="${x}" y="${y}" width="${Math.ceil(tileWidth) + 1}" height="${Math.ceil(tileHeight) + 1}" fill="rgba(255,255,255,0.08)" />
      `);
      continue;
    }
    tiles.push(`
      <clipPath id="tile-${index}">
        <rect x="${x}" y="${y}" width="${Math.ceil(tileWidth) + 1}" height="${Math.ceil(tileHeight) + 1}" rx="14" ry="14" />
      </clipPath>
      <image
        href="${href}"
        x="${x}"
        y="${y}"
        width="${Math.ceil(tileWidth) + 1}"
        height="${Math.ceil(tileHeight) + 1}"
        preserveAspectRatio="xMidYMid slice"
        clip-path="url(#tile-${index})"
        opacity="0.92"
      />
      <rect x="${x}" y="${y}" width="${Math.ceil(tileWidth) + 1}" height="${Math.ceil(tileHeight) + 1}" rx="14" ry="14" fill="rgba(11, 18, 26, 0.16)" />
    `);
  }

  return tiles.join("\n");
};

export const buildCoverMosaicSvg = async (episodes: EpisodeRow[]): Promise<string> => {
  const title = "Dragão Careca cover mosaic";
  const tiles = await buildTiles(episodes);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="overlay" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f1621" stop-opacity="0.28" />
      <stop offset="55%" stop-color="#0f1621" stop-opacity="0.42" />
      <stop offset="100%" stop-color="#0f1621" stop-opacity="0.58" />
    </linearGradient>
    <filter id="soften">
      <feGaussianBlur stdDeviation="0.3" />
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#121820" />
  <g filter="url(#soften)">
    ${tiles}
  </g>
  <rect width="100%" height="100%" fill="url(#overlay)" />
  <rect width="100%" height="100%" fill="rgba(255,255,255,0.06)" />
</svg>`;
};

export const refreshCoverMosaicBackground = async (): Promise<string> => {
  const episodes = episodeRepository.listAll();
  const svg = await buildCoverMosaicSvg(episodes);
  await fs.mkdir(path.dirname(mosaicPath), { recursive: true });
  await fs.writeFile(mosaicPath, svg, "utf8");
  return mosaicPath;
};

export const getCoverMosaicTileUrls = (): string[] => selectTileUrls(episodeRepository.listAll());

export const getCoverMosaicBackgroundPath = (): string => mosaicPath;
