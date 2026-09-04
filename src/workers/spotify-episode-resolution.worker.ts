import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { resolveEpisodeSpotifyId } from "../services/spotify-episode-resolver.service";

let timer: NodeJS.Timeout | undefined;
let active: Promise<void> | null = null;

const runOnce = async (): Promise<void> => {
  if (active) return active;
  active = (async () => {
    const expired = episodeRepository.expireSpotifyResolutionJobs();
    const due = episodeRepository.getDueSpotifyResolutionJobs();
    for (const job of due) {
      try {
        const result = await resolveEpisodeSpotifyId(job.episodeId);
        episodeRepository.markSpotifyResolutionAttempt(job.episodeId, result === "matched" || result === "already_set" ? "matched" : "no_match");
        console.info("Spotify episode resolution completed", { episode_id: job.episodeId, result });
      } catch (error) {
        episodeRepository.markSpotifyResolutionAttempt(job.episodeId, "failed", error instanceof Error ? error.message : "unknown provider error");
        console.warn("Spotify episode resolution failed", { episode_id: job.episodeId, attempt: job.attemptCount + 1 });
      }
    }
    if (expired || due.length) console.info("Spotify episode resolution worker pass", { expired, processed: due.length });
  })().finally(() => { active = null; });
  return active;
};

export const startSpotifyEpisodeResolutionWorker = async (): Promise<() => void> => {
  if (!config.spotify.episodeResolver.enabled) {
    console.info("Spotify episode resolution worker disabled by SPOTIFY_EPISODE_RESOLVER_ENABLED=false");
    return () => undefined;
  }
  await runOnce();
  timer = setInterval(() => void runOnce().catch((error: unknown) => console.error("Spotify episode resolution worker failed", error)), 5 * 60 * 1000);
  return () => { if (timer) clearInterval(timer); timer = undefined; };
};
