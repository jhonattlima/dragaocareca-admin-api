import { getDb, nowIso } from "../sqlite";

export type TrailerCandidateStatus = "pending" | "processing" | "waiting_capacity" | "retryable" | "ready" | "stale" | "superseded";
export type TrailerCandidateAttemptStatus = "processing" | "waiting_capacity" | "ready" | "failed" | "stale" | "interrupted";

export type TrailerCandidateRow = {
  candidateId: string;
  episodeId: number;
  draftId: string | null;
  version: number;
  sourceFingerprint: string;
  coverSha256: string;
  audioSha256: string;
  transcriptSha256: string | null;
  profileId: string;
  profileRevision: number;
  snapshotRelativePath: string;
  outputRelativePath: string | null;
  outputSha256: string | null;
  outputBytes: number | null;
  durationSeconds: number | null;
  probeJson: string | null;
  status: TrailerCandidateStatus;
  progress: number;
  errorCategory: string | null;
  errorMessage: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  staleAt: string | null;
};

export type TrailerCandidateAttemptRow = {
  attemptId: string;
  candidateId: string;
  attemptNumber: number;
  sourceFingerprint: string;
  status: TrailerCandidateAttemptStatus;
  startedAt: string;
  endedAt: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  outputPartialRelativePath: string | null;
};

export type CreateTrailerCandidateInput = {
  candidateId: string;
  episodeId: number;
  draftId?: string | null;
  sourceFingerprint: string;
  coverSha256: string;
  audioSha256: string;
  transcriptSha256?: string | null;
  profileId: string;
  profileRevision: number;
  snapshotRelativePath: string;
};

type CandidateSqlRow = {
  candidate_id: string; episode_id: number; draft_id: string | null; version: number;
  source_fingerprint: string; cover_sha256: string; audio_sha256: string; transcript_sha256: string | null;
  profile_id: string; profile_revision: number; snapshot_relative_path: string; output_relative_path: string | null;
  output_sha256: string | null; output_bytes: number | null; duration_seconds: number | null; probe_json: string | null;
  status: TrailerCandidateStatus; progress: number; error_category: string | null; error_message: string | null;
  attempt_count: number; created_at: string; updated_at: string; ready_at: string | null; stale_at: string | null;
};

type AttemptSqlRow = {
  attempt_id: string; candidate_id: string; attempt_number: number; source_fingerprint: string;
  status: TrailerCandidateAttemptStatus; started_at: string; ended_at: string | null;
  error_category: string | null; error_message: string | null; output_partial_relative_path: string | null;
};

const mapCandidate = (row: CandidateSqlRow | undefined): TrailerCandidateRow | null => row ? ({
  candidateId: row.candidate_id,
  episodeId: row.episode_id,
  draftId: row.draft_id,
  version: row.version,
  sourceFingerprint: row.source_fingerprint,
  coverSha256: row.cover_sha256,
  audioSha256: row.audio_sha256,
  transcriptSha256: row.transcript_sha256,
  profileId: row.profile_id,
  profileRevision: row.profile_revision,
  snapshotRelativePath: row.snapshot_relative_path,
  outputRelativePath: row.output_relative_path,
  outputSha256: row.output_sha256,
  outputBytes: row.output_bytes,
  durationSeconds: row.duration_seconds,
  probeJson: row.probe_json,
  status: row.status,
  progress: row.progress,
  errorCategory: row.error_category,
  errorMessage: row.error_message,
  attemptCount: row.attempt_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  readyAt: row.ready_at,
  staleAt: row.stale_at,
}) : null;

const mapAttempt = (row: AttemptSqlRow): TrailerCandidateAttemptRow => ({
  attemptId: row.attempt_id,
  candidateId: row.candidate_id,
  attemptNumber: row.attempt_number,
  sourceFingerprint: row.source_fingerprint,
  status: row.status,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  errorCategory: row.error_category,
  errorMessage: row.error_message,
  outputPartialRelativePath: row.output_partial_relative_path,
});

const byId = (candidateId: string): TrailerCandidateRow | null => mapCandidate(
  getDb().prepare("SELECT * FROM trailer_candidate_versions WHERE candidate_id = ?").get(candidateId) as CandidateSqlRow | undefined,
);

const inImmediateTransaction = <T>(work: () => T): T => {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const trailerCandidateRepository = {
  createOrReuse(input: CreateTrailerCandidateInput): { candidate: TrailerCandidateRow; reused: boolean } {
    const db = getDb();
    const create = () => inImmediateTransaction(() => {
      const existing = db.prepare(`SELECT * FROM trailer_candidate_versions
        WHERE episode_id = ? AND source_fingerprint = ?
          AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
        ORDER BY version DESC LIMIT 1`).get(input.episodeId, input.sourceFingerprint) as CandidateSqlRow | undefined;
      if (existing) return { candidate: mapCandidate(existing) as TrailerCandidateRow, reused: true };
      const version = Number((db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM trailer_candidate_versions WHERE episode_id = ?")
        .get(input.episodeId) as { next_version: number }).next_version);
      const now = nowIso();
      db.prepare(`INSERT INTO trailer_candidate_versions (
        candidate_id, episode_id, draft_id, version, source_fingerprint, cover_sha256, audio_sha256,
        transcript_sha256, profile_id, profile_revision, snapshot_relative_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
        input.candidateId, input.episodeId, input.draftId ?? null, version, input.sourceFingerprint,
        input.coverSha256, input.audioSha256, input.transcriptSha256 ?? null, input.profileId,
        input.profileRevision, input.snapshotRelativePath, now, now,
      );
      return { candidate: byId(input.candidateId) as TrailerCandidateRow, reused: false };
    });
    try {
      return create();
    } catch (error) {
      // A concurrent creator may win the partial unique index. In that case
      // converge on its durable identity instead of exposing a duplicate job.
      const winner = mapCandidate(db.prepare(`SELECT * FROM trailer_candidate_versions
        WHERE episode_id = ? AND source_fingerprint = ?
          AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
        ORDER BY version DESC LIMIT 1`).get(input.episodeId, input.sourceFingerprint) as CandidateSqlRow | undefined);
      if (winner) return { candidate: winner, reused: true };
      throw error;
    }
  },

  findById(candidateId: string): TrailerCandidateRow | null { return byId(candidateId); },

  findCurrentByFingerprint(episodeId: number, fingerprint: string): TrailerCandidateRow | null {
    return mapCandidate(getDb().prepare(`SELECT * FROM trailer_candidate_versions
      WHERE episode_id = ? AND source_fingerprint = ?
        AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
      ORDER BY version DESC LIMIT 1`).get(episodeId, fingerprint) as CandidateSqlRow | undefined);
  },

  findPreviousReady(episodeId: number, exceptCandidateId?: string): TrailerCandidateRow | null {
    return mapCandidate(getDb().prepare(`SELECT * FROM trailer_candidate_versions
      WHERE episode_id = ? AND status = 'ready' AND candidate_id <> COALESCE(?, '')
      ORDER BY version DESC LIMIT 1`).get(episodeId, exceptCandidateId ?? null) as CandidateSqlRow | undefined);
  },

  listPending(limit = 100): TrailerCandidateRow[] {
    const bounded = Math.max(1, Math.min(1000, Math.trunc(limit)));
    return (getDb().prepare(`SELECT * FROM trailer_candidate_versions
      WHERE status IN ('pending', 'waiting_capacity')
      ORDER BY datetime(created_at), version, candidate_id LIMIT ?`).all(bounded) as CandidateSqlRow[])
      .map((row) => mapCandidate(row) as TrailerCandidateRow);
  },

  claim(candidateId: string, attemptId: string): TrailerCandidateRow | null {
    const db = getDb();
    const start = () => inImmediateTransaction(() => {
      const row = db.prepare(`SELECT * FROM trailer_candidate_versions WHERE candidate_id = ?
        AND status IN ('pending', 'waiting_capacity')`).get(candidateId) as CandidateSqlRow | undefined;
      if (!row) return;
      const now = nowIso();
      const attemptNumber = row.attempt_count + 1;
      const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'processing', attempt_count = ?,
        progress = 0, error_category = NULL, error_message = NULL, updated_at = ?
        WHERE candidate_id = ? AND status IN ('pending', 'waiting_capacity')`).run(attemptNumber, now, candidateId).changes;
      if (!changed) return;
      db.prepare(`INSERT INTO trailer_candidate_attempts (
        attempt_id, candidate_id, attempt_number, source_fingerprint, status, started_at
      ) VALUES (?, ?, ?, ?, 'processing', ?)`).run(attemptId, candidateId, attemptNumber, row.source_fingerprint, now);
    });
    start();
    return byId(candidateId);
  },

  updateProgress(candidateId: string, progress: number): boolean {
    const bounded = Math.max(0, Math.min(99, Math.trunc(progress)));
    return getDb().prepare(`UPDATE trailer_candidate_versions SET progress = MAX(progress, ?), updated_at = ?
      WHERE candidate_id = ? AND status = 'processing'`).run(bounded, nowIso(), candidateId).changes > 0;
  },

  waitForCapacity(candidateId: string, category = "capacity"): boolean {
    const db = getDb(); const now = nowIso();
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'waiting_capacity', error_category = ?,
      error_message = NULL, updated_at = ? WHERE candidate_id = ? AND status = 'processing'`).run(category, now, candidateId).changes;
    if (changed) db.prepare(`UPDATE trailer_candidate_attempts SET status = 'waiting_capacity', ended_at = ?
      WHERE candidate_id = ? AND attempt_number = (SELECT attempt_count FROM trailer_candidate_versions WHERE candidate_id = ?)
        AND status = 'processing'`).run(now, candidateId, candidateId);
    return changed > 0;
  },

  markReady(candidateId: string, output: { relativePath: string; sha256: string; bytes: number; durationSeconds: number; probeJson: string }): boolean {
    const db = getDb(); const now = nowIso();
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'ready', progress = 100,
      output_relative_path = ?, output_sha256 = ?, output_bytes = ?, duration_seconds = ?, probe_json = ?,
      error_category = NULL, error_message = NULL, ready_at = ?, updated_at = ?
      WHERE candidate_id = ? AND status = 'processing'`).run(
      output.relativePath, output.sha256, output.bytes, output.durationSeconds, output.probeJson, now, now, candidateId,
    ).changes;
    if (changed) db.prepare(`UPDATE trailer_candidate_attempts SET status = 'ready', ended_at = ?
      WHERE candidate_id = ? AND attempt_number = (SELECT attempt_count FROM trailer_candidate_versions WHERE candidate_id = ?)
        AND status IN ('processing', 'waiting_capacity')`).run(now, candidateId, candidateId);
    return changed > 0;
  },

  markRetryable(candidateId: string, category: string, message: string): boolean {
    const db = getDb(); const now = nowIso();
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'retryable', error_category = ?,
      error_message = ?, updated_at = ? WHERE candidate_id = ? AND status = 'processing'`).run(category, message, now, candidateId).changes;
    if (changed) db.prepare(`UPDATE trailer_candidate_attempts SET status = 'failed', ended_at = ?, error_category = ?, error_message = ?
      WHERE candidate_id = ? AND attempt_number = (SELECT attempt_count FROM trailer_candidate_versions WHERE candidate_id = ?)
        AND status IN ('processing', 'waiting_capacity')`).run(now, category, message, candidateId, candidateId);
    return changed > 0;
  },

  markStale(candidateId: string, category = "source_changed", message = "Source inputs changed during rendering"): boolean {
    const db = getDb(); const now = nowIso();
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'stale', error_category = ?,
      error_message = ?, stale_at = ?, updated_at = ? WHERE candidate_id = ?
        AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable')`).run(category, message, now, now, candidateId).changes;
    if (changed) db.prepare(`UPDATE trailer_candidate_attempts SET status = 'stale', ended_at = ?, error_category = ?, error_message = ?
      WHERE candidate_id = ? AND attempt_number = (SELECT attempt_count FROM trailer_candidate_versions WHERE candidate_id = ?)
        AND status IN ('processing', 'waiting_capacity')`).run(now, category, message, candidateId, candidateId);
    return changed > 0;
  },

  retry(candidateId: string): TrailerCandidateRow | null {
    const db = getDb();
    db.prepare(`UPDATE trailer_candidate_versions SET status = 'pending', progress = 0, error_category = NULL,
      error_message = NULL, updated_at = ? WHERE candidate_id = ? AND status = 'retryable'`).run(nowIso(), candidateId);
    return byId(candidateId);
  },

  recoverProcessing(): TrailerCandidateRow[] {
    const db = getDb();
    const recover = () => inImmediateTransaction(() => {
      const interrupted = db.prepare("SELECT * FROM trailer_candidate_versions WHERE status = 'processing' ORDER BY datetime(created_at), candidate_id").all() as CandidateSqlRow[];
      const now = nowIso();
      db.prepare(`UPDATE trailer_candidate_attempts SET status = 'interrupted', ended_at = ?, error_category = 'process_restart',
        error_message = 'Render interrupted by API restart'
        WHERE status = 'processing' AND candidate_id IN (
          SELECT candidate_id FROM trailer_candidate_versions WHERE status = 'processing'
        )`).run(now);
      db.prepare(`UPDATE trailer_candidate_versions SET status = 'pending', progress = 0, updated_at = ? WHERE status = 'processing'`).run(now);
      return interrupted.map((row) => mapCandidate(row) as TrailerCandidateRow);
    });
    return recover();
  },

  hasActiveForDraft(draftId: string): boolean {
    return Boolean(getDb().prepare(`SELECT 1 FROM trailer_candidate_versions WHERE draft_id = ?
      AND status IN ('pending', 'processing', 'waiting_capacity') LIMIT 1`).get(draftId));
  },

  hasHistoryForEpisode(episodeId: number): boolean {
    return Boolean(getDb().prepare("SELECT 1 FROM trailer_candidate_versions WHERE episode_id = ? LIMIT 1").get(episodeId));
  },

  listAttempts(candidateId: string): TrailerCandidateAttemptRow[] {
    return (getDb().prepare("SELECT * FROM trailer_candidate_attempts WHERE candidate_id = ? ORDER BY attempt_number").all(candidateId) as AttemptSqlRow[]).map(mapAttempt);
  },
};
