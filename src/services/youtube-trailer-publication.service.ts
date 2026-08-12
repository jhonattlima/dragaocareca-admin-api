import { createHash, randomUUID } from "node:crypto";
import { episodeRepository } from "../database/repositories/episode.repository";
import {
  youtubeTrailerJobRepository,
  type YoutubeTrailerJobRow,
  type YoutubeTrailerPublicationLease,
  type YoutubeTrailerSource,
} from "../database/repositories/youtube-trailer-job.repository";
import {
  createLiveYoutubeTrailerUploadProvider,
  type YoutubeTrailerUploadProvider,
  type YoutubeTrailerVideoRecord,
} from "./youtube-trailer-upload.provider";
import { fingerprintYoutubeTrailerSource } from "./youtube-trailer-job.service";
import { retainEpisodeTrailerVersions } from "./episode-trailer-retention.service";

export type YoutubeTrailerPublicationInput = { title: string; hashtags: string[] };
export type YoutubeTrailerPublicationDto = {
  jobId: string;
  episodeId: number;
  status: YoutubeTrailerJobRow["publicationStatus"];
  url: string | null;
  cleanup: { status: YoutubeTrailerJobRow["retentionStatus"]; error: string | null };
  error: { category: string | null; occurredAt: string | null };
};

const invalidMetadata = (message: string): Error & { category: string } => Object.assign(new Error(message), { category: "validation" });
const sourceOf = (job: YoutubeTrailerJobRow): YoutubeTrailerSource => ({ episodeId: job.episodeId, sourceFileName: job.sourceFileName, sourceSha256: job.sourceSha256, sourceBytes: job.sourceBytes });
const leaseOf = (job: YoutubeTrailerJobRow): YoutubeTrailerPublicationLease => ({ ...sourceOf(job), jobId: job.jobId, revision: job.revision, leaseId: job.publicationLeaseId! });

const assembledTitle = (input: YoutubeTrailerPublicationInput): string => {
  if (typeof input.title !== "string" || !input.title.trim() || /[<>]/u.test(input.title)) throw invalidMetadata("Trailer title is invalid.");
  if (!Array.isArray(input.hashtags) || input.hashtags.some((tag) => typeof tag !== "string" || !/^#[\p{L}\p{N}_-]+$/u.test(tag.trim()))) throw invalidMetadata("Trailer hashtags are invalid.");
  if (input.hashtags.length > 3) throw invalidMetadata("Trailer hashtags are limited to three values.");
  const title = `${input.title.trim()} ${input.hashtags.map((tag) => tag.trim()).join(" ")}`.trim();
  if ([...title].length > 100 || /[<>]/u.test(title)) throw invalidMetadata("Trailer title and hashtags must be at most 100 characters.");
  return title;
};

const dto = (job: YoutubeTrailerJobRow): YoutubeTrailerPublicationDto => ({
  jobId: job.jobId,
  episodeId: job.episodeId,
  status: job.publicationStatus,
  url: job.canonicalUrl,
  cleanup: { status: job.retentionStatus, error: job.retentionErrorMessage },
  error: { category: job.errorCategory ?? (job.publicationStatus === "failed" ? "retryable" : null), occurredAt: job.errorAt ?? (job.publicationStatus === "failed" ? job.updatedAt : null) },
});

const providerMethod = <K extends keyof YoutubeTrailerUploadProvider>(provider: YoutubeTrailerUploadProvider, method: K): NonNullable<YoutubeTrailerUploadProvider[K]> => {
  const value = provider[method];
  if (typeof value !== "function") throw new Error("YouTube publication provider operation is unavailable.");
  return value.bind(provider) as NonNullable<YoutubeTrailerUploadProvider[K]>;
};

const persist = (lease: YoutubeTrailerPublicationLease, update: Parameters<typeof youtubeTrailerJobRepository.updatePublication>[1]): YoutubeTrailerJobRow => {
  const row = youtubeTrailerJobRepository.updatePublication(lease, update);
  if (!row) throw new Error("Trailer publication source changed during publication.");
  return row;
};

const failure = (lease: YoutubeTrailerPublicationLease, category: string, message: string): YoutubeTrailerPublicationDto => {
  const row = youtubeTrailerJobRepository.updatePublication(lease, { publicationStatus: "failed", retentionStatus: "not_started" });
  if (!row) throw new Error("Trailer publication source changed during failure recovery.");
  return { ...dto(row), error: { category, occurredAt: row.errorAt } };
};

export const publishYoutubeTrailer = async (
  episodeId: number,
  jobId: string,
  input: YoutubeTrailerPublicationInput,
  provider: YoutubeTrailerUploadProvider = createLiveYoutubeTrailerUploadProvider()
): Promise<YoutubeTrailerPublicationDto> => {
  const title = assembledTitle(input);
  const episode = episodeRepository.findByEpisodeId(episodeId);
  const initial = youtubeTrailerJobRepository.findByJobId(episodeId, jobId);
  if (!episode || !initial || initial.status !== "ready" || !initial.providerVideoId) throw new Error("Ready trailer publication job was not found.");
  const current = await fingerprintYoutubeTrailerSource(episodeId);
  if (JSON.stringify(sourceOf(initial)) !== JSON.stringify(current)) throw new Error("Trailer publication source is stale.");
  if (initial.publicationStatus === "public_confirmed" && initial.canonicalUrl) {
    if (initial.retentionStatus !== "complete") {
      const cleanup = await retainEpisodeTrailerVersions(episodeId);
      const cleanupRow = youtubeTrailerJobRepository.updatePublication(
        { ...sourceOf(initial), jobId, revision: initial.revision, leaseId: initial.publicationLeaseId ?? "" },
        cleanup.status === "complete"
          ? { retentionStatus: "complete", retentionErrorCategory: null, retentionErrorMessage: null, retentionErrorAt: null }
          : { retentionStatus: "retryable-error", retentionErrorCategory: cleanup.errorCategory, retentionErrorMessage: cleanup.errorMessage, retentionErrorAt: new Date().toISOString() }
      );
      return dto(cleanupRow ?? initial);
    }
    return dto(initial);
  }
  const claimed = youtubeTrailerJobRepository.claimPublication(sourceOf(initial), jobId, initial.revision, randomUUID());
  if (!claimed || !claimed.publicationLeaseId) return dto(youtubeTrailerJobRepository.findByJobId(episodeId, jobId) ?? initial);
  let publicationLease = leaseOf(claimed);
  try {
    const getVideo = providerMethod(provider, "getVideo") as (id: string) => Promise<YoutubeTrailerVideoRecord>;
    const updateMetadata = providerMethod(provider, "updateMetadata") as (id: string, metadata: { title: string; description: string; categoryId?: string }) => Promise<YoutubeTrailerVideoRecord>;
    const findPlaylist = providerMethod(provider, "findPlaylistMembership") as (id: string) => Promise<unknown>;
    const insertPlaylist = providerMethod(provider, "insertPlaylistItem") as (id: string) => Promise<unknown>;
    const publishVideo = providerMethod(provider, "publishVideo") as (id: string) => Promise<YoutubeTrailerVideoRecord>;
    const providerId = claimed.providerVideoId!;
    const privateReady = await getVideo(providerId);
    if (privateReady.privacyStatus !== "private" || privateReady.uploadStatus === "failed" || privateReady.processingStatus === "processing") return failure(publicationLease, "retryable", "YouTube trailer is not privately ready for publication.");
    const metadata = { title, description: episode.summary, categoryId: privateReady.categoryId ?? undefined };
    const metadataJson = JSON.stringify(metadata);
    const digest = createHash("sha256").update(metadataJson).digest("hex");
    if (claimed.metadataDigest !== digest || claimed.metadataSnapshotJson !== metadataJson) {
      const accepted = await updateMetadata(providerId, metadata);
      if (accepted.privacyStatus !== "private") return failure(publicationLease, "retryable", "YouTube trailer became public before playlist confirmation.");
      const metadataAccepted = persist(publicationLease, { publicationStatus: "metadata_accepted", metadataSnapshotJson: metadataJson, metadataDigest: digest, metadataAcceptedAt: new Date().toISOString() });
      publicationLease = { ...publicationLease, revision: metadataAccepted.revision };
    }
    let membership = await findPlaylist(providerId);
    if (!membership) {
      await insertPlaylist(providerId);
      membership = await findPlaylist(providerId);
      if (!membership) return failure(publicationLease, "retryable", "YouTube trailer playlist membership was not confirmed.");
    }
    const playlistConfirmed = persist(publicationLease, { publicationStatus: "playlist_confirmed", playlistMembershipConfirmedAt: new Date().toISOString() });
    publicationLease = { ...publicationLease, revision: playlistConfirmed.revision };
    const privateConfirmed = await getVideo(providerId);
    if (privateConfirmed.privacyStatus !== "private") return failure(publicationLease, "retryable", "YouTube trailer privacy could not be confirmed before publication.");
    const published = await publishVideo(providerId);
    const publicConfirmed = await getVideo(providerId);
    if (published.privacyStatus !== "public" || publicConfirmed.privacyStatus !== "public") return failure(publicationLease, "retryable", "YouTube public publication was not confirmed.");
    const url = `https://www.youtube.com/watch?v=${providerId}`;
    const confirmed = persist(publicationLease, { publicationStatus: "public_confirmed", publicConfirmedAt: new Date().toISOString(), canonicalUrl: url });
    episodeRepository.updateYoutubePublication(episodeId, url, "synced");
    const cleanup = await retainEpisodeTrailerVersions(episodeId);
    const final = youtubeTrailerJobRepository.updatePublication(
      { ...publicationLease, revision: confirmed.revision },
      cleanup.status === "complete"
        ? { retentionStatus: "complete", retentionErrorCategory: null, retentionErrorMessage: null, retentionErrorAt: null }
        : { retentionStatus: "retryable-error", retentionErrorCategory: cleanup.errorCategory, retentionErrorMessage: cleanup.errorMessage, retentionErrorAt: new Date().toISOString() }
    );
    return dto(final ?? confirmed);
  } catch (error) {
    const category = typeof error === "object" && error && "category" in error ? String((error as { category: unknown }).category) : "retryable";
    return failure(publicationLease, category, error instanceof Error ? error.message : "Trailer publication failed.");
  }
};
