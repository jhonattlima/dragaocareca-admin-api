import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  youtubeTrailerJobRepository,
  type YoutubeTrailerJobLease,
  type YoutubeTrailerJobRow,
  type YoutubeTrailerSource,
} from "../database/repositories/youtube-trailer-job.repository";
import { config } from "../config/env";
import { getEpisodeMediaFinalPath, getEpisodeMediaRelativePath, getEpisodeMediaStagingPath } from "./episode-media-layout.service";
import {
  createLiveYoutubeTrailerUploadProvider,
  type YoutubeTrailerUploadProvider,
  type YoutubeTrailerUploadProviderError,
} from "./youtube-trailer-upload.provider";
import { publishYoutubeTrailer } from "./youtube-trailer-publication.service";
import { episodeRepository } from "../database/repositories/episode.repository";

type ProcessOptions = {
  provider?: YoutubeTrailerUploadProvider;
};

export type YoutubeTrailerJobStatusDto = {
  jobId: string;
  episodeId: number;
  status: YoutubeTrailerJobRow["status"];
  progress: {
    confirmedBytes: number;
    totalBytes: number;
    processingPartsProcessed: number | null;
    processingPartsTotal: number | null;
    processingTimeLeftMs: number | null;
  };
  cancellation: {
    requestedAt: string | null;
    cancelledAt: string | null;
    boundary: string | null;
  };
  error: {
    category: string | null;
    occurredAt: string | null;
  };
  retry: {
    count: number;
    nextAttemptAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  privateWatchUrl: string | null;
  publicationStatus: YoutubeTrailerJobRow["publicationStatus"];
  publicationErrorCategory: string | null;
};

const safeErrorCategory = (category: string | null): string | null => {
  if (!category) return null;
  if (category === "authorization" || category === "configuration") return "authentication";
  if (category === "session-expired") return "session-expired";
  if (category === "quota" || category === "timeout" || category === "network" || category === "provider" || category === "invalid-trailer" || category === "reconciliation-required") return category;
  return category === "unrecoverable" ? "provider" : "network";
};

// Deliberately map only operator-safe lifecycle state. Provider identifiers,
// resumable session locations, source evidence, raw provider details, and
// worker lease data stay internal to the service/repository boundary.
export const toYoutubeTrailerJobStatusDto = (job: YoutubeTrailerJobRow): YoutubeTrailerJobStatusDto => ({
  jobId: job.jobId,
  episodeId: job.episodeId,
  status: job.status,
  progress: {
    confirmedBytes: job.confirmedBytes,
    totalBytes: job.sourceBytes,
    processingPartsProcessed: job.providerProcessingPartsProcessed,
    processingPartsTotal: job.providerProcessingPartsTotal,
    processingTimeLeftMs: job.providerProcessingTimeLeftMs,
  },
  cancellation: {
    requestedAt: job.cancelRequestedAt,
    cancelledAt: job.cancelledAt,
    boundary: job.cancellationBoundary,
  },
  error: {
    category: safeErrorCategory(job.errorCategory),
    occurredAt: job.errorAt,
  },
  retry: {
    count: job.retryCount,
    nextAttemptAt: job.nextAttemptAt,
  },
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt,
  privateWatchUrl: sanitizedPrivateWatchUrl(job.providerVideoId),
  publicationStatus: job.publicationStatus,
  publicationErrorCategory: safeErrorCategory(job.errorCategory),
});

const sanitizedPrivateWatchUrl = (providerVideoId: string | null): string | null => {
  if (!providerVideoId || !/^[A-Za-z0-9_-]{6,64}$/.test(providerVideoId)) return null;
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", providerVideoId);
  return url.toString();
};

type YoutubeTrailerJobMetadata = { title: string; summary: string; hashtags?: string[] };

const metadataForJob = (job: YoutubeTrailerJobRow): YoutubeTrailerJobMetadata | undefined => {
  if (!job.metadataSnapshotJson) return undefined;
  try {
    const value = JSON.parse(job.metadataSnapshotJson) as { title?: unknown; summary?: unknown; hashtags?: unknown };
    return typeof value.title === "string" && typeof value.summary === "string"
      ? { title: value.title, summary: value.summary, hashtags: Array.isArray(value.hashtags) ? value.hashtags.filter((tag): tag is string => typeof tag === "string") : [] }
      : undefined;
  } catch {
    return undefined;
  }
};

const sourceForJob = (job: YoutubeTrailerJobRow): YoutubeTrailerSource => ({
  episodeId: job.episodeId,
  sourceFileName: job.sourceFileName,
  sourceSha256: job.sourceSha256,
  sourceBytes: job.sourceBytes,
});

const leaseForJob = (job: YoutubeTrailerJobRow): YoutubeTrailerJobLease | null =>
  job.workerLeaseId
    ? { ...sourceForJob(job), jobId: job.jobId, revision: job.revision, leaseId: job.workerLeaseId }
    : null;

const calculateRetryAt = (retryCount: number): string => {
  const delay = Math.min(
    config.youtube.trailerJob.retryInitialDelayMs * 2 ** Math.max(0, retryCount),
    config.youtube.trailerJob.retryMaxDelayMs
  );
  return new Date(Date.now() + delay).toISOString();
};

export const fingerprintYoutubeTrailerSource = async (episodeId: number): Promise<YoutubeTrailerSource> => {
  const finalPath = getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  const stagingPath = getEpisodeMediaStagingPath(episodeId, "trailerVideo");
  const sourcePath = (await fs.promises.lstat(finalPath).catch(() => null))?.isFile() ? finalPath : stagingPath;
  const stats = await fs.promises.lstat(sourcePath).catch(() => null);
  if (!stats?.isFile()) throw new Error("Final trailer-video source is missing");

  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(sourcePath)) hash.update(chunk);
  return {
    episodeId,
    sourceFileName: getEpisodeMediaRelativePath(episodeId, "trailerVideo"),
    sourceSha256: hash.digest("hex"),
    sourceBytes: stats.size,
  };
};

const hasCurrentSource = async (source: YoutubeTrailerSource): Promise<boolean> => {
  try {
    const current = await fingerprintYoutubeTrailerSource(source.episodeId);
    return (
      current.sourceFileName === source.sourceFileName &&
      current.sourceSha256 === source.sourceSha256 &&
      current.sourceBytes === source.sourceBytes
    );
  } catch {
    return false;
  }
};

const obsoleteIfSourceChanged = async (job: YoutubeTrailerJobRow): Promise<boolean> => {
  const source = sourceForJob(job);
  if (await hasCurrentSource(source)) return false;
  const current = await fingerprintYoutubeTrailerSource(job.episodeId).catch(() => null);
  if (current) {
    youtubeTrailerJobRepository.obsoletePriorSource(job.episodeId, current);
  } else {
    // A missing canonical source is no longer safe to transfer. The impossible
    // fingerprint intentionally obsoletes every active row for this episode.
    youtubeTrailerJobRepository.obsoletePriorSource(job.episodeId, {
      sourceFileName: "",
      sourceSha256: "",
      sourceBytes: -1,
    });
  }
  return true;
};

const guardedProviderUpdate = async (
  job: YoutubeTrailerJobRow,
  lease: YoutubeTrailerJobLease,
  update: Parameters<typeof youtubeTrailerJobRepository.updateProvider>[1],
  status: "claimed" | "transferring" | "processing"
): Promise<YoutubeTrailerJobRow | null> => {
  if (await obsoleteIfSourceChanged(job)) return null;
  return youtubeTrailerJobRepository.updateProvider(lease, update, status);
};

const recordProviderFailure = (lease: YoutubeTrailerJobLease, job: YoutubeTrailerJobRow, error: YoutubeTrailerUploadProviderError): YoutubeTrailerJobRow | null => {
  const retryable = error.code === "retryable" || error.code === "session-expired";
  const nextAttemptAt = retryable && job.retryCount < config.youtube.trailerJob.retryAttempts ? calculateRetryAt(job.retryCount) : null;
  const failed = youtubeTrailerJobRepository.recordError(lease, {
    category: error.code,
    message: error.message,
    reason: error.reason,
    httpStatus: error.httpStatus,
    nextAttemptAt,
  });
  if (!failed || !nextAttemptAt) return failed;
  return youtubeTrailerJobRepository.retry(sourceForJob(failed), failed.jobId, failed.revision, nextAttemptAt);
};

const claimNext = (job: YoutubeTrailerJobRow): YoutubeTrailerJobRow | null => {
  const source = sourceForJob(job);
  const leaseId = randomUUID();
  if (job.status === "queued") {
    return youtubeTrailerJobRepository.claim(source, job.jobId, job.revision, leaseId);
  }
  if (
    job.status === "claimed" ||
    job.status === "transferring" ||
    job.status === "processing" ||
    job.status === "cancel_requested"
  ) {
    return youtubeTrailerJobRepository.claimRecovery(source, job.jobId, job.revision, leaseId);
  }
  return null;
};

const cancelLocally = async (job: YoutubeTrailerJobRow, lease: YoutubeTrailerJobLease, provider: YoutubeTrailerUploadProvider): Promise<void> => {
  if (job.sessionUri) {
    const result = await provider.cancel(job.sessionUri, job.providerVideoId);
    if (await obsoleteIfSourceChanged(job)) return;
    // Once any bytes or a provider video are known to have crossed the remote
    // acceptance boundary, local cancellation cannot honestly claim rollback.
    const boundary = job.providerVideoId || job.confirmedBytes > 0 ? "provider-video-retained" : result.boundary;
    youtubeTrailerJobRepository.markCancelled(lease, boundary);
    return;
  }
  if (await obsoleteIfSourceChanged(job)) return;
  youtubeTrailerJobRepository.markCancelled(lease, "local-cancelled");
};

const pollPrivateProcessing = async (
  job: YoutubeTrailerJobRow,
  lease: YoutubeTrailerJobLease,
  provider: YoutubeTrailerUploadProvider
): Promise<void> => {
  if (!job.providerVideoId) return;
  const heartbeat = youtubeTrailerJobRepository.heartbeat(lease);
  const refreshedLease = heartbeat ? leaseForJob(heartbeat) : null;
  if (!heartbeat || !refreshedLease) return;
  const details = await provider.pollProcessing(job.providerVideoId);
  const updated = await guardedProviderUpdate(job, refreshedLease, {
    providerPrivacyStatus: details.privacyStatus,
    providerUploadStatus: details.uploadStatus,
    providerProcessingStatus: details.processingStatus,
    providerProcessingPartsProcessed: details.partsProcessed,
    providerProcessingPartsTotal: details.partsTotal,
    providerProcessingTimeLeftMs: details.timeLeftMs,
  }, "processing");
  if (!updated) return;
  const updatedLease = leaseForJob(updated);
  if (
    updatedLease &&
    details.privacyStatus === "private" &&
    details.uploadStatus === "processed" &&
    details.processingStatus === "succeeded"
  ) {
    const ready = youtubeTrailerJobRepository.markReady(updatedLease);
    if (ready?.publicationRequestedAt) {
      const metadata = metadataForJob(ready);
      const episode = episodeRepository.findByEpisodeId(ready.episodeId);
      const hashtags = metadata?.hashtags ?? [];
      await publishYoutubeTrailer(ready.episodeId, ready.jobId, { title: metadata?.title ?? `Trailer - ${episode?.title ?? `Episode ${ready.episodeId}`}`, hashtags }, provider);
    }
  }
};

const transferPrivateSource = async (
  initialJob: YoutubeTrailerJobRow,
  initialLease: YoutubeTrailerJobLease,
  provider: YoutubeTrailerUploadProvider
): Promise<void> => {
  let job = initialJob;
  let lease = initialLease;
  if (job.status === "cancel_requested") return cancelLocally(job, lease, provider);
  // Provider acceptance is durable evidence. Reconcile the recorded private
  // video directly; never reopen a resumable session or clear its video ID.
  if (job.providerVideoId) return pollPrivateProcessing(job, lease, provider);

  if (!job.sessionUri) {
    const heartbeat = youtubeTrailerJobRepository.heartbeat(lease);
    const pendingLease = heartbeat ? leaseForJob(heartbeat) : null;
    if (!heartbeat || !pendingLease) return;
    // The worker asks the injected provider to prove authorization before it
    // obtains a resumable session, so missing upload scope cannot transfer bytes.
    await provider.checkReadiness();
    const session = await provider.beginPrivateSession(job.sourceBytes, metadataForJob(job));
    const persisted = await guardedProviderUpdate(job, pendingLease, {
      sessionUri: session.sessionUri,
      providerPrivacyStatus: session.privacyStatus,
      confirmedBytes: 0,
    }, "transferring");
    if (!persisted) return;
    job = persisted;
    lease = leaseForJob(persisted) as YoutubeTrailerJobLease;
  }

  const resumeHeartbeat = youtubeTrailerJobRepository.heartbeat(lease);
  const resumeLease = resumeHeartbeat ? leaseForJob(resumeHeartbeat) : null;
  if (!resumeHeartbeat || !resumeLease || !job.sessionUri) return;
  const resumed = await provider.resumeRange(job.sessionUri, job.sourceBytes);
  const reconciled = await guardedProviderUpdate(job, resumeLease, {
    confirmedBytes: resumed.confirmedBytes,
    providerVideoId: resumed.providerVideoId,
  }, resumed.providerVideoId ? "processing" : "transferring");
  if (!reconciled) return;
  job = reconciled;
  lease = leaseForJob(reconciled) as YoutubeTrailerJobLease;

  if (job.providerVideoId) return pollPrivateProcessing(job, lease, provider);

  const finalPath = getEpisodeMediaFinalPath(job.episodeId, "trailerVideo");
  const stagingPath = getEpisodeMediaStagingPath(job.episodeId, "trailerVideo");
  const sourcePath = (await fs.promises.lstat(finalPath).catch(() => null))?.isFile() ? finalPath : stagingPath;
  const handle = await fs.promises.open(sourcePath, "r");
  try {
    let offset = job.confirmedBytes;
    while (offset < job.sourceBytes) {
      const latest = youtubeTrailerJobRepository.findByJobId(job.episodeId, job.jobId);
      if (!latest || latest.status === "cancel_requested") {
        if (latest) {
          const cancellationLease = leaseForJob(latest);
          if (cancellationLease) await cancelLocally(latest, cancellationLease, provider);
        }
        return;
      }
      const length = Math.min(config.youtube.trailerJob.chunkBytes, job.sourceBytes - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) throw new Error("Trailer source changed during transfer");
      const heartbeat = youtubeTrailerJobRepository.heartbeat(lease);
      const chunkLease = heartbeat ? leaseForJob(heartbeat) : null;
      if (!heartbeat || !chunkLease || !job.sessionUri) return;
      const result = await provider.uploadChunk(job.sessionUri, job.sourceBytes, offset, buffer.subarray(0, bytesRead));
      const persisted = await guardedProviderUpdate(job, chunkLease, {
        confirmedBytes: result.confirmedBytes,
        providerVideoId: result.providerVideoId,
      }, result.providerVideoId ? "processing" : "transferring");
      if (!persisted) return;
      job = persisted;
      lease = leaseForJob(persisted) as YoutubeTrailerJobLease;
      offset = job.confirmedBytes;
      if (job.providerVideoId) return pollPrivateProcessing(job, lease, provider);
    }
  } finally {
    await handle.close();
  }
};

export const createYoutubeTrailerJob = async (episodeId: number, metadata?: YoutubeTrailerJobMetadata): Promise<YoutubeTrailerJobRow> => {
  const source = await fingerprintYoutubeTrailerSource(episodeId);
  youtubeTrailerJobRepository.obsoletePriorSource(episodeId, source);
  return youtubeTrailerJobRepository.createOrReuse({
    jobId: randomUUID(),
    ...source,
    metadataSnapshotJson: metadata ? JSON.stringify(metadata) : null,
  });
};

export const getCurrentYoutubeTrailerJob = async (episodeId: number): Promise<YoutubeTrailerJobRow | null> => {
  const source = await fingerprintYoutubeTrailerSource(episodeId);
  youtubeTrailerJobRepository.obsoletePriorSource(episodeId, source);
  return youtubeTrailerJobRepository.findActive(source);
};

export const retryYoutubeTrailerJob = async (episodeId: number, jobId: string): Promise<YoutubeTrailerJobRow | null> => {
  const job = youtubeTrailerJobRepository.findByJobId(episodeId, jobId);
  if (!job) return null;
  const current = await fingerprintYoutubeTrailerSource(episodeId);
  if (current.sourceFileName !== job.sourceFileName || current.sourceSha256 !== job.sourceSha256 || current.sourceBytes !== job.sourceBytes) return null;
  if (["queued", "claimed", "transferring", "processing", "cancel_requested"].includes(job.status)) return job;
  if (job.status !== "failed") return null;
  return youtubeTrailerJobRepository.retry(current, job.jobId, job.revision, new Date().toISOString());
};

export const getYoutubeTrailerJob = (episodeId: number, jobId: string): YoutubeTrailerJobRow | null =>
  youtubeTrailerJobRepository.findByJobId(episodeId, jobId);

export const requestYoutubeTrailerJobCancellation = (episodeId: number, jobId: string): YoutubeTrailerJobRow | null => {
  const job = youtubeTrailerJobRepository.findByJobId(episodeId, jobId);
  if (!job) return null;
  return youtubeTrailerJobRepository.requestCancellation(sourceForJob(job), job.jobId, job.revision);
};

export const obsoleteYoutubeTrailerJobsForCurrentSource = async (episodeId: number): Promise<YoutubeTrailerJobRow[]> => {
  const source = await fingerprintYoutubeTrailerSource(episodeId);
  return youtubeTrailerJobRepository.obsoletePriorSource(episodeId, source);
};

export const cleanupYoutubeTrailerVideos = async (
  jobs: YoutubeTrailerJobRow[],
  provider: YoutubeTrailerUploadProvider = createLiveYoutubeTrailerUploadProvider(),
): Promise<void> => {
  for (const job of jobs) {
    if (!job.providerVideoId || job.providerCleanupStatus === "complete") continue;
    youtubeTrailerJobRepository.updateProviderCleanup(job, "pending");
    try {
      if (!provider.deleteVideo) throw new Error("YouTube provider deletion is unavailable.");
      await provider.deleteVideo(job.providerVideoId);
      const latest = youtubeTrailerJobRepository.findByJobId(job.episodeId, job.jobId);
      if (latest) youtubeTrailerJobRepository.updateProviderCleanup(latest, "complete");
    } catch (error) {
      const latest = youtubeTrailerJobRepository.findByJobId(job.episodeId, job.jobId);
      if (latest) youtubeTrailerJobRepository.updateProviderCleanup(latest, "retryable-error", error instanceof Error ? error.message : "YouTube video cleanup failed.");
      console.warn("YouTube trailer cleanup requires reconciliation", { episodeId: job.episodeId, jobId: job.jobId });
    }
  }
};

export const initializeYoutubeTrailerJobs = async (): Promise<void> => {
  for (const job of youtubeTrailerJobRepository.listRecoveryCandidates()) {
    if (job.status !== "queued") {
      youtubeTrailerJobRepository.recoverInterrupted(sourceForJob(job), job.jobId, job.revision);
    }
  }
};

export const processNextYoutubeTrailerJob = async ({ provider = createLiveYoutubeTrailerUploadProvider() }: ProcessOptions = {}): Promise<void> => {
  const candidate = youtubeTrailerJobRepository.listRecoveryCandidates()[0];
  if (!candidate) return;

  if (candidate.status === "ready") {
    const metadata = metadataForJob(candidate);
    const episode = episodeRepository.findByEpisodeId(candidate.episodeId);
    if (!episode || !candidate.providerVideoId) return;
    const result = await publishYoutubeTrailer(
      candidate.episodeId,
      candidate.jobId,
      {
        title: metadata?.title ?? `Trailer - ${episode.title}`,
        hashtags: metadata?.hashtags ?? [],
      },
      provider,
    );
    if (result.status === "failed") {
      console.error("YouTube trailer publication retry failed", {
        episodeId: candidate.episodeId,
        category: result.error.category,
      });
    }
    return;
  }

  const job = claimNext(candidate);
  const lease = job ? leaseForJob(job) : null;
  if (!job || !lease) return;
  try {
    if (await obsoleteIfSourceChanged(job)) return;
    await transferPrivateSource(job, lease, provider);
  } catch (error) {
    const latest = youtubeTrailerJobRepository.findByJobId(job.episodeId, job.jobId);
    const latestLease = latest ? leaseForJob(latest) : null;
    if (latest && latestLease && !(await obsoleteIfSourceChanged(latest))) {
      recordProviderFailure(latestLease, latest, provider.normalizeFailure(error));
    }
  }
};
