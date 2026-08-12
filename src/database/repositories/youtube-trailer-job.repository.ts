import { getDb, nowIso } from "../sqlite";

export type YoutubeTrailerJobStatus =
  | "queued"
  | "claimed"
  | "transferring"
  | "processing"
  | "ready"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "obsolete";

export type YoutubeTrailerSource = {
  episodeId: number;
  sourceFileName: string;
  sourceSha256: string;
  sourceBytes: number;
};

export type YoutubeTrailerJobLease = YoutubeTrailerSource & {
  jobId: string;
  revision: number;
  leaseId: string;
};

export type YoutubeTrailerPublicationStatus =
  | "not_started"
  | "metadata_accepted"
  | "playlist_confirmed"
  | "public_confirmed"
  | "failed";

export type YoutubeTrailerRetentionStatus = "not_started" | "pending" | "complete" | "retryable-error";
export type YoutubeTrailerProviderCleanupStatus = "not_required" | "pending" | "complete" | "retryable-error";

export type YoutubeTrailerPublicationLease = YoutubeTrailerSource & {
  jobId: string;
  revision: number;
  leaseId: string;
};

export type YoutubeTrailerJobRow = YoutubeTrailerSource & {
  jobId: string;
  sourceCapturedAt: string;
  status: YoutubeTrailerJobStatus;
  revision: number;
  workerLeaseId: string | null;
  leaseClaimedAt: string | null;
  leaseHeartbeatAt: string | null;
  sessionUri: string | null;
  confirmedBytes: number;
  providerVideoId: string | null;
  providerPrivacyStatus: string | null;
  providerUploadStatus: string | null;
  providerProcessingStatus: string | null;
  providerProcessingPartsProcessed: number | null;
  providerProcessingPartsTotal: number | null;
  providerProcessingTimeLeftMs: number | null;
  providerCheckedAt: string | null;
  retryCount: number;
  nextAttemptAt: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  errorReason: string | null;
  errorHttpStatus: number | null;
  errorAt: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  cancellationBoundary: string | null;
  obsoleteAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  publicationStatus: YoutubeTrailerPublicationStatus;
  publicationLeaseId: string | null;
  publicationLeaseClaimedAt: string | null;
  publicationRequestedAt: string | null;
  metadataSnapshotJson: string | null;
  metadataDigest: string | null;
  metadataAcceptedAt: string | null;
  playlistMembershipConfirmedAt: string | null;
  publicConfirmedAt: string | null;
  canonicalUrl: string | null;
  retentionStatus: YoutubeTrailerRetentionStatus;
  retentionErrorCategory: string | null;
  retentionErrorMessage: string | null;
  retentionErrorAt: string | null;
  providerCleanupStatus: YoutubeTrailerProviderCleanupStatus;
  providerCleanupError: string | null;
  providerCleanupAt: string | null;
};

export type CreateYoutubeTrailerJobInput = YoutubeTrailerSource & {
  jobId: string;
  metadataSnapshotJson?: string | null;
};

export type YoutubeTrailerProviderUpdate = {
  sessionUri?: string | null;
  confirmedBytes?: number;
  providerVideoId?: string | null;
  providerPrivacyStatus?: string | null;
  providerUploadStatus?: string | null;
  providerProcessingStatus?: string | null;
  providerProcessingPartsProcessed?: number | null;
  providerProcessingPartsTotal?: number | null;
  providerProcessingTimeLeftMs?: number | null;
  providerCheckedAt?: string | null;
};

export type YoutubeTrailerJobError = {
  category: string;
  message: string;
  reason?: string | null;
  httpStatus?: number | null;
  nextAttemptAt?: string | null;
};

export type YoutubeTrailerPublicationUpdate = {
  publicationStatus?: YoutubeTrailerPublicationStatus;
  metadataSnapshotJson?: string | null;
  metadataDigest?: string | null;
  metadataAcceptedAt?: string | null;
  playlistMembershipConfirmedAt?: string | null;
  publicConfirmedAt?: string | null;
  canonicalUrl?: string | null;
  retentionStatus?: YoutubeTrailerRetentionStatus;
  retentionErrorCategory?: string | null;
  retentionErrorMessage?: string | null;
  retentionErrorAt?: string | null;
  providerCleanupStatus?: YoutubeTrailerProviderCleanupStatus;
  providerCleanupError?: string | null;
  providerCleanupAt?: string | null;
};

type SqliteYoutubeTrailerJobRow = {
  job_id: string;
  episode_id: number;
  source_file_name: string;
  source_sha256: string;
  source_bytes: number;
  source_captured_at: string;
  status: YoutubeTrailerJobStatus;
  revision: number;
  worker_lease_id: string | null;
  lease_claimed_at: string | null;
  lease_heartbeat_at: string | null;
  session_uri: string | null;
  confirmed_bytes: number;
  provider_video_id: string | null;
  provider_privacy_status: string | null;
  provider_upload_status: string | null;
  provider_processing_status: string | null;
  provider_processing_parts_processed: number | null;
  provider_processing_parts_total: number | null;
  provider_processing_time_left_ms: number | null;
  provider_checked_at: string | null;
  retry_count: number;
  next_attempt_at: string | null;
  error_category: string | null;
  error_message: string | null;
  error_reason: string | null;
  error_http_status: number | null;
  error_at: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  cancellation_boundary: string | null;
  obsolete_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  publication_status: YoutubeTrailerPublicationStatus;
  publication_lease_id: string | null;
  publication_lease_claimed_at: string | null;
  publication_requested_at: string | null;
  metadata_snapshot_json: string | null;
  metadata_digest: string | null;
  metadata_accepted_at: string | null;
  playlist_membership_confirmed_at: string | null;
  public_confirmed_at: string | null;
  canonical_url: string | null;
  retention_status: YoutubeTrailerRetentionStatus;
  retention_error_category: string | null;
  retention_error_message: string | null;
  retention_error_at: string | null;
  provider_cleanup_status: YoutubeTrailerProviderCleanupStatus;
  provider_cleanup_error: string | null;
  provider_cleanup_at: string | null;
};

const activeStatuses = "'queued', 'claimed', 'transferring', 'processing', 'cancel_requested'";
const leaseOwnedStatuses = "'claimed', 'transferring', 'processing', 'cancel_requested'";

const mapRow = (row: SqliteYoutubeTrailerJobRow | undefined): YoutubeTrailerJobRow | null => {
  if (!row) return null;
  return {
    jobId: row.job_id,
    episodeId: row.episode_id,
    sourceFileName: row.source_file_name,
    sourceSha256: row.source_sha256,
    sourceBytes: row.source_bytes,
    sourceCapturedAt: row.source_captured_at,
    status: row.status,
    revision: row.revision,
    workerLeaseId: row.worker_lease_id,
    leaseClaimedAt: row.lease_claimed_at,
    leaseHeartbeatAt: row.lease_heartbeat_at,
    sessionUri: row.session_uri,
    confirmedBytes: row.confirmed_bytes,
    providerVideoId: row.provider_video_id,
    providerPrivacyStatus: row.provider_privacy_status,
    providerUploadStatus: row.provider_upload_status,
    providerProcessingStatus: row.provider_processing_status,
    providerProcessingPartsProcessed: row.provider_processing_parts_processed,
    providerProcessingPartsTotal: row.provider_processing_parts_total,
    providerProcessingTimeLeftMs: row.provider_processing_time_left_ms,
    providerCheckedAt: row.provider_checked_at,
    retryCount: row.retry_count,
    nextAttemptAt: row.next_attempt_at,
    errorCategory: row.error_category,
    errorMessage: row.error_message,
    errorReason: row.error_reason,
    errorHttpStatus: row.error_http_status,
    errorAt: row.error_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    cancellationBoundary: row.cancellation_boundary,
    obsoleteAt: row.obsolete_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    publicationStatus: row.publication_status ?? "not_started",
    publicationLeaseId: row.publication_lease_id,
    publicationLeaseClaimedAt: row.publication_lease_claimed_at,
    publicationRequestedAt: row.publication_requested_at,
    metadataSnapshotJson: row.metadata_snapshot_json,
    metadataDigest: row.metadata_digest,
    metadataAcceptedAt: row.metadata_accepted_at,
    playlistMembershipConfirmedAt: row.playlist_membership_confirmed_at,
    publicConfirmedAt: row.public_confirmed_at,
    canonicalUrl: row.canonical_url,
    retentionStatus: row.retention_status ?? "not_started",
    retentionErrorCategory: row.retention_error_category,
    retentionErrorMessage: row.retention_error_message,
    retentionErrorAt: row.retention_error_at,
    providerCleanupStatus: row.provider_cleanup_status ?? "not_required",
    providerCleanupError: row.provider_cleanup_error,
    providerCleanupAt: row.provider_cleanup_at,
  };
};

const selectOne = (where: string, ...parameters: Array<string | number | null>): YoutubeTrailerJobRow | null =>
  mapRow(getDb().prepare(`SELECT * FROM youtube_trailer_jobs WHERE ${where} LIMIT 1`).get(...parameters) as SqliteYoutubeTrailerJobRow | undefined);

const selectAfterCas = (lease: YoutubeTrailerJobLease): YoutubeTrailerJobRow | null =>
  selectOne("job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ? AND revision = ?", lease.jobId, lease.episodeId, lease.sourceFileName, lease.sourceSha256, lease.sourceBytes, lease.revision + 1);

const updateWithLease = (lease: YoutubeTrailerJobLease, setClause: string, values: Array<string | number | null>, expectedStatuses = leaseOwnedStatuses): YoutubeTrailerJobRow | null => {
  const now = nowIso();
  const result = getDb().prepare(`
    UPDATE youtube_trailer_jobs SET ${setClause}, revision = revision + 1, updated_at = ?
    WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
      AND revision = ? AND worker_lease_id = ? AND status IN (${expectedStatuses})
  `).run(...values, now, lease.jobId, lease.episodeId, lease.sourceFileName, lease.sourceSha256, lease.sourceBytes, lease.revision, lease.leaseId);
  if (result.changes !== 1) return null;
  return selectAfterCas(lease);
};

const selectAfterPublicationCas = (lease: YoutubeTrailerPublicationLease): YoutubeTrailerJobRow | null =>
  selectOne("job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ? AND revision = ?", lease.jobId, lease.episodeId, lease.sourceFileName, lease.sourceSha256, lease.sourceBytes, lease.revision + 1);

const updateWithPublicationLease = (
  lease: YoutubeTrailerPublicationLease,
  setClause: string,
  values: Array<string | number | null>
): YoutubeTrailerJobRow | null => {
  const now = nowIso();
  const result = getDb().prepare(`
    UPDATE youtube_trailer_jobs SET ${setClause}, revision = revision + 1, updated_at = ?
    WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
      AND revision = ? AND publication_lease_id = ? AND status = 'ready'
  `).run(...values, now, lease.jobId, lease.episodeId, lease.sourceFileName, lease.sourceSha256, lease.sourceBytes, lease.revision, lease.leaseId);
  if (result.changes !== 1) return null;
  return selectAfterPublicationCas(lease);
};

export const youtubeTrailerJobRepository = {
  createOrReuse(input: CreateYoutubeTrailerJobInput): YoutubeTrailerJobRow {
    const now = nowIso();
    getDb().prepare(`
      INSERT INTO youtube_trailer_jobs (
        job_id, episode_id, source_file_name, source_sha256, source_bytes, source_captured_at,
        status, metadata_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(input.jobId, input.episodeId, input.sourceFileName, input.sourceSha256, input.sourceBytes, now, input.metadataSnapshotJson ?? null, now, now);
    return youtubeTrailerJobRepository.findActive(input) as YoutubeTrailerJobRow;
  },

  findByJobId(episodeId: number, jobId: string): YoutubeTrailerJobRow | null {
    return selectOne("episode_id = ? AND job_id = ?", episodeId, jobId);
  },

  findByEpisodeId(episodeId: number): YoutubeTrailerJobRow[] {
    return (getDb().prepare("SELECT * FROM youtube_trailer_jobs WHERE episode_id = ? ORDER BY datetime(created_at) DESC, job_id DESC").all(episodeId) as SqliteYoutubeTrailerJobRow[]).map((row) => mapRow(row) as YoutubeTrailerJobRow);
  },

  updateProviderCleanup(job: YoutubeTrailerJobRow, status: YoutubeTrailerProviderCleanupStatus, error: string | null = null): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const updated = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET provider_cleanup_status = ?, provider_cleanup_error = ?, provider_cleanup_at = ?, revision = revision + 1, updated_at = ?
      WHERE episode_id = ? AND job_id = ? AND revision = ?
    `).run(status, error, now, now, job.episodeId, job.jobId, job.revision);
    return updated.changes === 1 ? selectOne("episode_id = ? AND job_id = ?", job.episodeId, job.jobId) : null;
  },

  requestPublication(job: YoutubeTrailerJobRow): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const updated = getDb().prepare(`UPDATE youtube_trailer_jobs SET publication_requested_at = ?, revision = revision + 1, updated_at = ? WHERE episode_id = ? AND job_id = ? AND revision = ?`).run(now, now, job.episodeId, job.jobId, job.revision);
    return updated.changes === 1 ? selectOne("episode_id = ? AND job_id = ?", job.episodeId, job.jobId) : null;
  },

  findActive(source: YoutubeTrailerSource): YoutubeTrailerJobRow | null {
    return selectOne(`episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ? AND status IN (${activeStatuses}) ORDER BY created_at ASC, job_id ASC`, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes);
  },

  claim(source: YoutubeTrailerSource, jobId: string, expectedRevision: number, leaseId: string): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const result = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET status = 'claimed', worker_lease_id = ?, lease_claimed_at = ?, lease_heartbeat_at = ?, revision = revision + 1, updated_at = ?
      WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
        AND revision = ? AND status = 'queued' AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime(?))
    `).run(leaseId, now, now, now, jobId, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes, expectedRevision, now);
    if (result.changes !== 1) return null;
    return selectOne("job_id = ? AND revision = ? AND worker_lease_id = ?", jobId, expectedRevision + 1, leaseId);
  },

  claimRecovery(source: YoutubeTrailerSource, jobId: string, expectedRevision: number, leaseId: string): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const result = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET worker_lease_id = ?, lease_claimed_at = ?, lease_heartbeat_at = ?, revision = revision + 1, updated_at = ?
      WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
        AND revision = ? AND status IN ('claimed', 'transferring', 'processing', 'cancel_requested')
    `).run(leaseId, now, now, now, jobId, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes, expectedRevision);
    if (result.changes !== 1) return null;
    return selectOne("job_id = ? AND revision = ? AND worker_lease_id = ?", jobId, expectedRevision + 1, leaseId);
  },

  recoverInterrupted(source: YoutubeTrailerSource, jobId: string, expectedRevision: number): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const result = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET status = CASE WHEN status = 'cancel_requested' THEN 'cancel_requested' ELSE 'queued' END,
        worker_lease_id = NULL, lease_claimed_at = NULL, lease_heartbeat_at = NULL, revision = revision + 1, updated_at = ?
      WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
        AND revision = ? AND status IN ('claimed', 'transferring', 'processing', 'cancel_requested')
    `).run(now, jobId, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes, expectedRevision);
    if (result.changes !== 1) return null;
    return selectOne("job_id = ? AND revision = ?", jobId, expectedRevision + 1);
  },

  heartbeat(lease: YoutubeTrailerJobLease): YoutubeTrailerJobRow | null {
    return updateWithLease(lease, "lease_heartbeat_at = ?", [nowIso()]);
  },

  updateProvider(lease: YoutubeTrailerJobLease, update: YoutubeTrailerProviderUpdate, status: Extract<YoutubeTrailerJobStatus, "claimed" | "transferring" | "processing">): YoutubeTrailerJobRow | null {
    const fields: Array<[string, string | number | null]> = [["status", status]];
    if (update.sessionUri !== undefined) fields.push(["session_uri", update.sessionUri]);
    if (update.confirmedBytes !== undefined) fields.push(["confirmed_bytes", Math.max(0, Math.trunc(update.confirmedBytes))]);
    if (update.providerVideoId !== undefined) fields.push(["provider_video_id", update.providerVideoId]);
    if (update.providerPrivacyStatus !== undefined) fields.push(["provider_privacy_status", update.providerPrivacyStatus]);
    if (update.providerUploadStatus !== undefined) fields.push(["provider_upload_status", update.providerUploadStatus]);
    if (update.providerProcessingStatus !== undefined) fields.push(["provider_processing_status", update.providerProcessingStatus]);
    if (update.providerProcessingPartsProcessed !== undefined) fields.push(["provider_processing_parts_processed", update.providerProcessingPartsProcessed]);
    if (update.providerProcessingPartsTotal !== undefined) fields.push(["provider_processing_parts_total", update.providerProcessingPartsTotal]);
    if (update.providerProcessingTimeLeftMs !== undefined) fields.push(["provider_processing_time_left_ms", update.providerProcessingTimeLeftMs]);
    fields.push(["provider_checked_at", update.providerCheckedAt ?? nowIso()], ["lease_heartbeat_at", nowIso()]);
    return updateWithLease(lease, fields.map(([name]) => `${name} = ?`).join(", "), fields.map(([, value]) => value));
  },

  recordError(lease: YoutubeTrailerJobLease, error: YoutubeTrailerJobError): YoutubeTrailerJobRow | null {
    const now = nowIso();
    return updateWithLease(lease, "status = 'failed', error_category = ?, error_message = ?, error_reason = ?, error_http_status = ?, error_at = ?, next_attempt_at = ?, worker_lease_id = NULL", [error.category, error.message, error.reason ?? null, error.httpStatus ?? null, now, error.nextAttemptAt ?? null]);
  },

  requestCancellation(source: YoutubeTrailerSource, jobId: string, expectedRevision: number): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const result = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET status = 'cancel_requested', cancel_requested_at = ?, revision = revision + 1, updated_at = ?
      WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
        AND revision = ? AND status IN ('queued', 'claimed', 'transferring', 'processing')
    `).run(now, now, jobId, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes, expectedRevision);
    if (result.changes !== 1) return null;
    return selectOne("job_id = ? AND revision = ?", jobId, expectedRevision + 1);
  },

  markCancelled(lease: YoutubeTrailerJobLease, boundary: string): YoutubeTrailerJobRow | null {
    const now = nowIso();
    return updateWithLease(lease, "status = 'cancelled', cancelled_at = ?, cancellation_boundary = ?, worker_lease_id = NULL", [now, boundary], "'cancel_requested'");
  },

  markReady(lease: YoutubeTrailerJobLease): YoutubeTrailerJobRow | null {
    return updateWithLease(lease, "status = 'ready', completed_at = ?", [nowIso()], "'processing'");
  },

  claimPublication(source: YoutubeTrailerSource, jobId: string, expectedRevision: number, leaseId: string): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const result = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET publication_lease_id = ?, publication_lease_claimed_at = ?, revision = revision + 1, updated_at = ?
      WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
        AND revision = ? AND status = 'ready' AND provider_video_id IS NOT NULL
    `).run(leaseId, now, now, jobId, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes, expectedRevision);
    if (result.changes !== 1) return null;
    return selectOne("job_id = ? AND revision = ? AND publication_lease_id = ?", jobId, expectedRevision + 1, leaseId);
  },

  updatePublication(lease: YoutubeTrailerPublicationLease, update: YoutubeTrailerPublicationUpdate): YoutubeTrailerJobRow | null {
    const fields: Array<[string, string | number | null]> = [];
    const mappings: Array<[keyof YoutubeTrailerPublicationUpdate, string]> = [
      ["publicationStatus", "publication_status"],
      ["metadataSnapshotJson", "metadata_snapshot_json"],
      ["metadataDigest", "metadata_digest"],
      ["metadataAcceptedAt", "metadata_accepted_at"],
      ["playlistMembershipConfirmedAt", "playlist_membership_confirmed_at"],
      ["publicConfirmedAt", "public_confirmed_at"],
      ["canonicalUrl", "canonical_url"],
      ["retentionStatus", "retention_status"],
      ["retentionErrorCategory", "retention_error_category"],
      ["retentionErrorMessage", "retention_error_message"],
      ["retentionErrorAt", "retention_error_at"],
    ];
    for (const [key, column] of mappings) {
      if (update[key] !== undefined) fields.push([column, update[key] as string | null]);
    }
    if (fields.length === 0) return youtubeTrailerJobRepository.findByJobId(lease.episodeId, lease.jobId);
    return updateWithPublicationLease(lease, fields.map(([name]) => `${name} = ?`).join(", "), fields.map(([, value]) => value));
  },

  retry(source: YoutubeTrailerSource, jobId: string, expectedRevision: number, nextAttemptAt: string | null): YoutubeTrailerJobRow | null {
    const now = nowIso();
    const result = getDb().prepare(`
      UPDATE youtube_trailer_jobs
      SET status = 'queued', retry_count = retry_count + 1, next_attempt_at = ?, worker_lease_id = NULL, lease_claimed_at = NULL,
        lease_heartbeat_at = NULL, revision = revision + 1, updated_at = ?
      WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
        AND revision = ? AND status = 'failed'
    `).run(nextAttemptAt, now, jobId, source.episodeId, source.sourceFileName, source.sourceSha256, source.sourceBytes, expectedRevision);
    if (result.changes !== 1) return null;
    return selectOne("job_id = ? AND revision = ?", jobId, expectedRevision + 1);
  },

  listRecoveryCandidates(referenceTime = new Date()): YoutubeTrailerJobRow[] {
    return (getDb().prepare(`
      SELECT * FROM youtube_trailer_jobs
      WHERE status IN ('queued', 'claimed', 'transferring', 'processing', 'cancel_requested')
        AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime(?))
      ORDER BY datetime(created_at) ASC, job_id ASC
    `).all(referenceTime.toISOString()) as SqliteYoutubeTrailerJobRow[]).map((row) => mapRow(row) as YoutubeTrailerJobRow);
  },

  obsoletePriorSource(episodeId: number, currentSource: Pick<YoutubeTrailerSource, "sourceFileName" | "sourceSha256" | "sourceBytes">): YoutubeTrailerJobRow[] {
    const rows = (getDb().prepare(`
      SELECT * FROM youtube_trailer_jobs WHERE episode_id = ? AND status IN (${activeStatuses})
        AND NOT (source_file_name = ? AND source_sha256 = ? AND source_bytes = ?)
    `).all(episodeId, currentSource.sourceFileName, currentSource.sourceSha256, currentSource.sourceBytes) as SqliteYoutubeTrailerJobRow[]).map((row) => mapRow(row) as YoutubeTrailerJobRow);
    if (rows.length === 0) return [];
    const now = nowIso();
    getDb().prepare(`
      UPDATE youtube_trailer_jobs SET status = 'obsolete', obsolete_at = ?, worker_lease_id = NULL, revision = revision + 1, updated_at = ?
      WHERE episode_id = ? AND status IN (${activeStatuses}) AND NOT (source_file_name = ? AND source_sha256 = ? AND source_bytes = ?)
    `).run(now, now, episodeId, currentSource.sourceFileName, currentSource.sourceSha256, currentSource.sourceBytes);
    return rows.map((row) => youtubeTrailerJobRepository.findByJobId(row.episodeId, row.jobId) as YoutubeTrailerJobRow);
  },
};
