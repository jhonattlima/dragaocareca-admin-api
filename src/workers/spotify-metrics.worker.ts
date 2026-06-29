import { config } from "../config/env";
import { getSpotifyMetricsSnapshotSafe } from "../services/spotify-metrics.service";

const isSpotifyMetricsSnapshot = (
  value: Awaited<ReturnType<typeof getSpotifyMetricsSnapshotSafe>>
): value is Exclude<Awaited<ReturnType<typeof getSpotifyMetricsSnapshotSafe>>, { ok: false }> => {
  return !("ok" in value && value.ok === false);
};

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (logFailures = true): Promise<void> => {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    const snapshot = await getSpotifyMetricsSnapshotSafe(1);
    if (!isSpotifyMetricsSnapshot(snapshot)) {
      if (logFailures && (snapshot.code === "disabled" || snapshot.code === "missing_credentials")) {
        console.warn("Spotify metrics worker startup skipped", snapshot.details ?? snapshot.message);
        return;
      }

      if (logFailures) {
        console.warn("Spotify metrics worker sample unavailable", snapshot.details ?? snapshot.message);
      }
      return;
    }

    const summary = snapshot.summary ?? null;
    const playsCurrent = summary?.plays?.current ?? null;
    const followersCurrent = summary?.followers?.current ?? null;
    console.log(
      `Spotify metrics sample stored for ${snapshot.range.currentEnd}; followers=${followersCurrent}; plays=${playsCurrent}`
    );
  })().finally(() => {
    activeRun = null;
  });

  return activeRun;
};

const runStartupProbe = (): void => {
  void runOnce(false).catch(() => {
    // Startup probe is best-effort; the periodic timer will retry later.
  });
};

export const startSpotifyMetricsWorker = async (): Promise<() => void> => {
  if (!config.spotify.enabled) {
    console.log("Spotify metrics worker disabled because SPOTIFY_METRICS_ENABLED is false");
    return () => undefined;
  }

  if (config.spotify.sampleIntervalMs <= 0) {
    console.log("Spotify metrics worker disabled by SPOTIFY_METRICS_SAMPLE_INTERVAL_MS");
    return () => undefined;
  }

  if (!config.spotify.podcastId || !config.spotify.clientId || !config.spotify.spDc || !config.spotify.spKey) {
    console.log("Spotify metrics worker disabled because Spotify credentials are missing");
    return () => undefined;
  }

  setTimeout(runStartupProbe, 0);
  pollTimer = setInterval(() => {
    void runOnce(true).catch((error: unknown) => {
      console.error("Spotify metrics worker failed", error);
    });
  }, config.spotify.sampleIntervalMs);

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
};
