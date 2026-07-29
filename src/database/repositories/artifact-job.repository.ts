import { getDb, nowIso } from "../sqlite";

export type ArtifactJobStatus = "pending" | "processing" | "completed" | "failed";

export type ArtifactJobRow = {
  jobId: string;
  episodeId: number;
  selectorKey: string;
  requested: string[];
  available: string[];
  missing: string[];
  status: ArtifactJobStatus;
  progress: number;
  archiveFileName: string | null;
  archivePath: string | null;
  snapshotPath: string | null;
  temporaryArchivePath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

type ArtifactJobInput = Omit<ArtifactJobRow, "createdAt" | "updatedAt" | "completedAt" | "expiresAt" | "status" | "progress" | "error"> & {
  status?: ArtifactJobStatus;
  progress?: number;
  error?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
};

type SqliteArtifactJobRow = {
  job_id: string;
  episode_id: number;
  selector_key: string;
  requested_selectors_json: string;
  available_selectors_json: string;
  missing_selectors_json: string;
  status: ArtifactJobStatus;
  progress: number;
  archive_file_name: string | null;
  archive_path: string | null;
  snapshot_path: string | null;
  temporary_archive_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string | null;
};

const jsonArray = (value: readonly string[]): string => JSON.stringify(value);
const parseArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
};

const mapRow = (row: SqliteArtifactJobRow | undefined): ArtifactJobRow | null => {
  if (!row) return null;
  return {
    jobId: row.job_id,
    episodeId: row.episode_id,
    selectorKey: row.selector_key,
    requested: parseArray(row.requested_selectors_json),
    available: parseArray(row.available_selectors_json),
    missing: parseArray(row.missing_selectors_json),
    status: row.status,
    progress: Math.max(0, Math.min(100, Math.trunc(row.progress))),
    archiveFileName: row.archive_file_name,
    archivePath: row.archive_path,
    snapshotPath: row.snapshot_path,
    temporaryArchivePath: row.temporary_archive_path,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
};

const selectBy = (where: string, ...parameters: Array<string | number | null>): ArtifactJobRow | null =>
  mapRow(getDb().prepare(`SELECT * FROM artifact_jobs WHERE ${where} LIMIT 1`).get(...parameters) as SqliteArtifactJobRow | undefined);

export const artifactJobRepository = {
  create(input: ArtifactJobInput): ArtifactJobRow {
    const now = nowIso();
    getDb().prepare(`
      INSERT INTO artifact_jobs (
        job_id, episode_id, selector_key, requested_selectors_json, available_selectors_json,
        missing_selectors_json, status, progress, archive_file_name, archive_path,
        snapshot_path, temporary_archive_path, error, created_at, updated_at, completed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.jobId, input.episodeId, input.selectorKey, jsonArray(input.requested), jsonArray(input.available),
      jsonArray(input.missing), input.status ?? "pending", input.progress ?? 0, input.archiveFileName,
      input.archivePath, input.snapshotPath, input.temporaryArchivePath, input.error ?? null, now, now,
      input.completedAt ?? null, input.expiresAt ?? null,
    );
    return artifactJobRepository.findByJobId(input.episodeId, input.jobId) as ArtifactJobRow;
  },

  findByJobId(episodeId: number, jobId: string): ArtifactJobRow | null {
    return selectBy("episode_id = ? AND job_id = ?", episodeId, jobId);
  },

  findActive(episodeId: number, selectorKey: string): ArtifactJobRow | null {
    return selectBy("episode_id = ? AND selector_key = ? AND status IN ('pending', 'processing') ORDER BY created_at ASC, job_id ASC", episodeId, selectorKey);
  },

  findCompleted(episodeId: number, selectorKey: string): ArtifactJobRow | null {
    return selectBy("episode_id = ? AND selector_key = ? AND status = 'completed' ORDER BY completed_at DESC, created_at DESC", episodeId, selectorKey);
  },

  listPending(): ArtifactJobRow[] {
    return (getDb().prepare("SELECT * FROM artifact_jobs WHERE status = 'pending' ORDER BY datetime(created_at) ASC, job_id ASC").all() as SqliteArtifactJobRow[])
      .map((row) => mapRow(row) as ArtifactJobRow);
  },

  transitionToProcessing(jobId: string): ArtifactJobRow | null {
    const now = nowIso();
    getDb().prepare("UPDATE artifact_jobs SET status = 'processing', progress = 0, updated_at = ? WHERE job_id = ? AND status = 'pending'").run(now, jobId);
    return selectBy("job_id = ?", jobId);
  },

  updateProgress(jobId: string, progress: number): ArtifactJobRow | null {
    const bounded = Math.max(0, Math.min(100, Math.trunc(progress)));
    getDb().prepare("UPDATE artifact_jobs SET progress = MAX(progress, ?), updated_at = ? WHERE job_id = ? AND status = 'processing'").run(bounded, nowIso(), jobId);
    return selectBy("job_id = ?", jobId);
  },

  complete(jobId: string, archiveFileName: string, archivePath: string, expiresAt: string): ArtifactJobRow | null {
    const now = nowIso();
    getDb().prepare(`UPDATE artifact_jobs SET status = 'completed', progress = 100, archive_file_name = ?, archive_path = ?,
      error = NULL, completed_at = ?, expires_at = ?, updated_at = ? WHERE job_id = ? AND status = 'processing'`).run(
      archiveFileName, archivePath, now, expiresAt, now, jobId,
    );
    return selectBy("job_id = ?", jobId);
  },

  fail(jobId: string, error: string): ArtifactJobRow | null {
    const message = error.trim().replace(/\s+/g, " ").slice(0, 500) || "Artifact preparation failed";
    getDb().prepare("UPDATE artifact_jobs SET status = 'failed', error = ?, updated_at = ? WHERE job_id = ? AND status = 'processing'").run(message, nowIso(), jobId);
    return selectBy("job_id = ?", jobId);
  },

  recoverProcessing(): ArtifactJobRow[] {
    const now = nowIso();
    getDb().prepare("UPDATE artifact_jobs SET status = 'pending', progress = 0, updated_at = ? WHERE status = 'processing'").run(now);
    return artifactJobRepository.listPending();
  },

  cleanupExpired(referenceTime = new Date()): ArtifactJobRow[] {
    const expired = (getDb().prepare("SELECT * FROM artifact_jobs WHERE status = 'completed' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)").all(referenceTime.toISOString()) as SqliteArtifactJobRow[])
      .map((row) => mapRow(row) as ArtifactJobRow);
    if (expired.length > 0) {
      getDb().prepare("DELETE FROM artifact_jobs WHERE status = 'completed' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)").run(referenceTime.toISOString());
    }
    return expired;
  },
};
