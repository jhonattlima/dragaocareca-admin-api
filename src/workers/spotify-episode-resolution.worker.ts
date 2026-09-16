import { randomUUID } from "node:crypto";
import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { createSpotifyEpisodeProvider, reconcileSpotifyEpisodeIds, resolveEpisodeSpotifyId, type SpotifyEpisodeProvider } from "../services/spotify-episode-resolver.service";
import { setSpotifyResolutionWakeListener } from "./spotify-episode-resolution.signal";

let timer: NodeJS.Timeout | undefined;
let active: Promise<void> | null = null;
const retryDelayMs = 5 * 60 * 1000;
let fullScanCompleted = false;

const runFullScan = async (): Promise<void> => {
  if (!config.spotify.episodeResolver.fullScanEnabled || fullScanCompleted) return;
  const provider: SpotifyEpisodeProvider = createSpotifyEpisodeProvider();
  const runId = randomUUID();
  try {
    const catalog = await (provider.listAllEpisodes ? provider.listAllEpisodes() : provider.listRecentEpisodes());
    const results = reconcileSpotifyEpisodeIds(episodeRepository.listPublished(), catalog, (episodeId, expected, next) => episodeRepository.replaceSpotifyIdIfExpected(episodeId, expected, next));
    for (const result of results) episodeRepository.recordSpotifyResolutionAudit({ auditId: `${runId}:${result.episodeId}`, runId, ...result });
    fullScanCompleted = true;
    console.info("Spotify episode resolution reconciliation completed", { run_id: runId, catalog_count: catalog.length, processed: results.length });
  } catch (error) {
    episodeRepository.recordSpotifyResolutionAudit({ auditId: `${runId}:provider`, runId, decision: "provider_error", reason: error instanceof Error ? error.message : "unknown provider error" });
    console.warn("Spotify episode resolution reconciliation failed", { run_id: runId });
  }
};

const runOnce = async (): Promise<void> => {
  if (active) return active;
  active = (async () => {
    const recovered = episodeRepository.recoverSpotifyResolutionJobs();
    const expired = episodeRepository.expireSpotifyResolutionJobs();
    await runFullScan();
    const due = episodeRepository.getDueSpotifyResolutionJobs();
    for (const job of due) {
      if (!episodeRepository.claimSpotifyResolutionJob(job.episodeId)) continue;
      try {
        const result = await resolveEpisodeSpotifyId(job.episodeId);
        episodeRepository.markSpotifyResolutionAttempt(job.episodeId, result === "matched" || result === "already_set" ? "matched" : "no_match");
        console.info("Spotify episode resolution completed", { episode_id: job.episodeId, result });
      } catch (error) {
        episodeRepository.markSpotifyResolutionAttempt(job.episodeId, "failed", error instanceof Error ? error.message : "unknown provider error");
        console.warn("Spotify episode resolution failed", { episode_id: job.episodeId, attempt: job.attemptCount + 1 });
      }
    }
    if (recovered || expired || due.length) console.info("Spotify episode resolution worker pass", { recovered, expired, processed: due.length });
  })().finally(() => { active = null; });
  return active;
};

const scheduleNextPass = (): void => {
  if (timer || !episodeRepository.hasActiveSpotifyResolutionJobs()) return;
  timer = setTimeout(() => {
    timer = undefined;
    void runOnce()
      .catch((error: unknown) => console.error("Spotify episode resolution worker failed", error))
      .finally(scheduleNextPass);
  }, retryDelayMs);
};

const wake = (): void => {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  void runOnce()
    .catch((error: unknown) => console.error("Spotify episode resolution worker failed", error))
    .finally(scheduleNextPass);
};

export const startSpotifyEpisodeResolutionWorker = async (): Promise<() => void> => {
  if (!config.spotify.episodeResolver.enabled) {
    console.info("Spotify episode resolution worker disabled by SPOTIFY_EPISODE_RESOLVER_ENABLED=false");
    return () => undefined;
  }
  const queued = episodeRepository.enqueueMissingSpotifyResolutions();
  if (queued) console.info("Spotify episode resolution backfill queued", { queued });
  setSpotifyResolutionWakeListener(wake);
  await runOnce();
  scheduleNextPass();
  return () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    setSpotifyResolutionWakeListener(undefined);
  };
};
