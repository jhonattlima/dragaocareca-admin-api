import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { config } from "../config/env";
import { normalizeSpotifyMetricsSnapshot, SpotifyMetricsSnapshot } from "./spotify-metrics.adapter";
const execFileAsync = promisify(execFile);

export interface SpotifyMetricsErrorResponse {
  source: "spotify-connector";
  fetchedAt: string;
  ok: false;
  code: "disabled" | "missing_credentials" | "fetch_failed";
  message: string;
  details?: string;
}

const scriptPath = path.resolve(process.cwd(), "src", "scripts", "spotify-metrics.py");

export async function getSpotifyMetricsSnapshot(days = 30): Promise<SpotifyMetricsSnapshot> {
  if (!config.spotify.enabled) {
    throw new Error("Spotify metrics are disabled.");
  }

  if (!config.spotify.podcastId || !config.spotify.clientId || !config.spotify.spDc || !config.spotify.spKey) {
    throw new Error("Missing Spotify metrics credentials.");
  }

  const { stdout } = await execFileAsync("python3", [scriptPath], {
    timeout: config.spotify.timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      SPOTIFY_METRICS_BASE_URL: config.spotify.baseUrl,
      SPOTIFY_PODCAST_ID: config.spotify.podcastId,
      SPOTIFY_CLIENT_ID: config.spotify.clientId,
      SPOTIFY_SP_DC: config.spotify.spDc,
      SPOTIFY_SP_KEY: config.spotify.spKey,
      SPOTIFY_METRICS_DAYS: String(days),
      SQLITE_PATH: config.sqlitePath,
    },
  });

  return normalizeSpotifyMetricsSnapshot(JSON.parse(stdout) as SpotifyMetricsSnapshot);
}

export async function getSpotifyMetricsSnapshotSafe(days = 30): Promise<SpotifyMetricsSnapshot | SpotifyMetricsErrorResponse> {
  try {
    return await getSpotifyMetricsSnapshot(days);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const code: SpotifyMetricsErrorResponse["code"] =
      details === "Spotify metrics are disabled."
        ? "disabled"
        : details === "Missing Spotify metrics credentials."
          ? "missing_credentials"
          : "fetch_failed";
    return {
      source: "spotify-connector",
      fetchedAt: new Date().toISOString(),
      ok: false,
      code,
      message: "Unable to fetch Spotify metrics.",
      details,
    };
  }
}
