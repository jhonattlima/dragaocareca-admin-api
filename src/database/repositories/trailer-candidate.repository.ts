import { getDb, nowIso } from "../sqlite";

export type TrailerCandidateStatus = "pending" | "processing" | "waiting_capacity" | "retryable" | "ready" | "stale" | "superseded";
export type TrailerCandidateAttemptStatus = "processing" | "waiting_capacity" | "ready" | "failed" | "stale" | "interrupted";
export type TrailerTranscriptStatus = "not_started" | "processing" | "done" | "error";
export type TrailerCaptionMode = "automatic" | "disabled";
export type TrailerCaptionStatus = "checking" | "eligible" | "aligning" | "rendering" | "included" | "waveform_only" | "unavailable";
export type TrailerCaptionReasonCode =
  | "quality_calibration_unavailable"
  | "capacity_unavailable"
  | "captions_disabled"
  | "transcript_unavailable"
  | "model_unavailable"
  | "aligner_unavailable"
  | "alignment_failed"
  | "alignment_provenance_stale"
  | "alignment_coverage_insufficient"
  | "alignment_timing_invalid"
  | "quality_below_calibration"
  | "caption_render_failed"
  | null;

export type TrailerCandidateRow = {
  candidateId: string;
  episodeId: number;
  draftId: string | null;
  version: number;
  sourceFingerprint: string;
  coverSha256: string;
  audioSha256: string;
  transcriptSha256: string | null;
  trailerTranscriptStatus: TrailerTranscriptStatus;
  trailerTranscriptProgress: number | null;
  trailerTranscriptRelativePath: string | null;
  trailerTranscriptSha256: string | null;
  trailerTranscriptionProvider: string | null;
  trailerTranscriptErrorCategory: string | null;
  captionMode: TrailerCaptionMode;
  captionStatus: TrailerCaptionStatus;
  captionReasonCode: TrailerCaptionReasonCode;
  captionAudioSha256: string | null;
  captionTranscriptSha256: string | null;
  captionAlignerVersion: string | null;
  captionModelId: string | null;
  captionModelRevision: string | null;
  captionModelSha256: string | null;
  captionProfileRevision: number | null;
  captionOutputSha256: string | null;
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
  trailerTranscriptStatus?: TrailerTranscriptStatus;
  trailerTranscriptRelativePath?: string | null;
  trailerTranscriptSha256?: string | null;
  trailerTranscriptionProvider?: string | null;
  captionMode?: TrailerCaptionMode;
  profileId: string;
  profileRevision: number;
  snapshotRelativePath: string;
};

export type TrailerCandidateCaptionProvenance = {
  status: TrailerCaptionStatus;
  reasonCode: TrailerCaptionReasonCode;
  audioSha256: string;
  transcriptSha256: string | null;
  alignerVersion?: string | null;
  modelId?: string | null;
  modelRevision?: string | null;
  modelSha256?: string | null;
  profileRevision?: number | null;
  outputSha256?: string | null;
};

export type TrailerCandidateCaptionRevision = {
  sourceFingerprint: string;
  audioSha256: string;
  transcriptSha256: string | null;
};

type CandidateSqlRow = {
  candidate_id: string; episode_id: number; draft_id: string | null; version: number;
  source_fingerprint: string; cover_sha256: string; audio_sha256: string; transcript_sha256: string | null;
  trailer_transcript_status: TrailerTranscriptStatus; trailer_transcript_progress: number | null;
  trailer_transcript_relative_path: string | null; trailer_transcript_sha256: string | null;
  trailer_transcription_provider: string | null; trailer_transcript_error_category: string | null;
  caption_mode: TrailerCaptionMode; caption_status: TrailerCaptionStatus; caption_reason_code: TrailerCaptionReasonCode;
  caption_audio_sha256: string | null; caption_transcript_sha256: string | null;
  caption_aligner_version: string | null; caption_model_id: string | null; caption_model_revision: string | null;
  caption_model_sha256: string | null; caption_profile_revision: number | null; caption_output_sha256: string | null;
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
  trailerTranscriptStatus: row.trailer_transcript_status ?? "not_started",
  trailerTranscriptProgress: row.trailer_transcript_progress ?? null,
  trailerTranscriptRelativePath: row.trailer_transcript_relative_path ?? null,
  trailerTranscriptSha256: row.trailer_transcript_sha256 ?? null,
  trailerTranscriptionProvider: row.trailer_transcription_provider ?? null,
  trailerTranscriptErrorCategory: row.trailer_transcript_error_category ?? null,
  captionMode: row.caption_mode ?? "automatic",
  captionStatus: row.caption_status ?? "waveform_only",
  captionReasonCode: row.caption_reason_code ?? "quality_calibration_unavailable",
  captionAudioSha256: row.caption_audio_sha256 ?? null,
  captionTranscriptSha256: row.caption_transcript_sha256 ?? null,
  captionAlignerVersion: row.caption_aligner_version ?? null,
  captionModelId: row.caption_model_id ?? null,
  captionModelRevision: row.caption_model_revision ?? null,
  captionModelSha256: row.caption_model_sha256 ?? null,
  captionProfileRevision: row.caption_profile_revision ?? null,
  captionOutputSha256: row.caption_output_sha256 ?? null,
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
          AND caption_mode = ?
          AND COALESCE(trailer_transcript_sha256, '') = COALESCE(?, '')
          AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
        ORDER BY version DESC LIMIT 1`).get(input.episodeId, input.sourceFingerprint, input.captionMode ?? "automatic", input.trailerTranscriptSha256 ?? null) as CandidateSqlRow | undefined;
      if (existing) return { candidate: mapCandidate(existing) as TrailerCandidateRow, reused: true };
      const version = Number((db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM trailer_candidate_versions WHERE episode_id = ?")
        .get(input.episodeId) as { next_version: number }).next_version);
      const now = nowIso();
      db.prepare(`INSERT INTO trailer_candidate_versions (
        candidate_id, episode_id, draft_id, version, source_fingerprint, cover_sha256, audio_sha256,
        transcript_sha256, trailer_transcript_status, trailer_transcript_relative_path, trailer_transcript_sha256,
        trailer_transcription_provider, caption_mode, caption_status, caption_reason_code, profile_id, profile_revision,
        snapshot_relative_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
        input.candidateId, input.episodeId, input.draftId ?? null, version, input.sourceFingerprint,
        input.coverSha256, input.audioSha256, input.transcriptSha256 ?? null,
        input.trailerTranscriptStatus ?? "not_started", input.trailerTranscriptRelativePath ?? null,
        input.trailerTranscriptSha256 ?? null, input.trailerTranscriptionProvider ?? null, input.captionMode ?? "automatic",
        "waveform_only",
        input.captionMode === "disabled" ? "captions_disabled" : "quality_calibration_unavailable",
        input.profileId,
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
          AND caption_mode = ?
          AND COALESCE(trailer_transcript_sha256, '') = COALESCE(?, '')
          AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
        ORDER BY version DESC LIMIT 1`).get(input.episodeId, input.sourceFingerprint, input.captionMode ?? "automatic", input.trailerTranscriptSha256 ?? null) as CandidateSqlRow | undefined);
      if (winner) return { candidate: winner, reused: true };
      throw error;
    }
  },

  findById(candidateId: string): TrailerCandidateRow | null { return byId(candidateId); },

  findCurrentByEpisode(episodeId: number): TrailerCandidateRow | null {
    return mapCandidate(getDb().prepare(`SELECT * FROM trailer_candidate_versions
      WHERE episode_id = ? AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
      ORDER BY version DESC LIMIT 1`).get(episodeId) as CandidateSqlRow | undefined);
  },

  findCurrentByFingerprint(episodeId: number, fingerprint: string, captionMode?: TrailerCaptionMode): TrailerCandidateRow | null {
    return mapCandidate(getDb().prepare(`SELECT * FROM trailer_candidate_versions
      WHERE episode_id = ? AND source_fingerprint = ?
        AND (? IS NULL OR caption_mode = ?)
        AND status IN ('pending', 'processing', 'waiting_capacity', 'retryable', 'ready')
      ORDER BY version DESC LIMIT 1`).get(episodeId, fingerprint, captionMode ?? null, captionMode ?? null) as CandidateSqlRow | undefined);
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

  updateTrailerTranscript(candidateId: string, input: {
    status: TrailerTranscriptStatus;
    progress?: number | null;
    relativePath?: string | null;
    sha256?: string | null;
    provider?: string | null;
    errorCategory?: string | null;
  }): boolean {
    const progress = input.progress == null ? null : Math.max(0, Math.min(100, Math.trunc(input.progress)));
    return getDb().prepare(`UPDATE trailer_candidate_versions SET trailer_transcript_status = ?,
      trailer_transcript_progress = ?, trailer_transcript_relative_path = COALESCE(?, trailer_transcript_relative_path),
      trailer_transcript_sha256 = COALESCE(?, trailer_transcript_sha256),
      trailer_transcription_provider = COALESCE(?, trailer_transcription_provider),
      trailer_transcript_error_category = ?, updated_at = ? WHERE candidate_id = ?`)
      .run(input.status, progress, input.relativePath ?? null, input.sha256 ?? null,
        input.provider ?? null, input.errorCategory ?? null, nowIso(), candidateId).changes > 0;
  },

  updateCaptionState(candidateId: string, expected: TrailerCandidateCaptionRevision, caption: TrailerCandidateCaptionProvenance): boolean {
    if (!/^[a-f0-9]{64}$/u.test(expected.sourceFingerprint) || !/^[a-f0-9]{64}$/u.test(expected.audioSha256)
      || (expected.transcriptSha256 !== null && !/^[a-f0-9]{64}$/u.test(expected.transcriptSha256))) return false;
    const changed = getDb().prepare(`UPDATE trailer_candidate_versions SET caption_status = ?, caption_reason_code = ?,
      caption_audio_sha256 = ?, caption_transcript_sha256 = ?, caption_aligner_version = ?, caption_model_id = ?,
      caption_model_revision = ?, caption_model_sha256 = ?, caption_profile_revision = ?, caption_output_sha256 = NULL,
      updated_at = ? WHERE candidate_id = ? AND source_fingerprint = ? AND audio_sha256 = ?
        AND COALESCE(trailer_transcript_sha256, '') = COALESCE(?, '') AND status = 'processing'`)
      .run(caption.status, caption.reasonCode, caption.audioSha256, caption.transcriptSha256,
        caption.alignerVersion ?? null, caption.modelId ?? null, caption.modelRevision ?? null, caption.modelSha256 ?? null,
        caption.profileRevision ?? null, nowIso(), candidateId, expected.sourceFingerprint, expected.audioSha256, expected.transcriptSha256).changes;
    return changed > 0;
  },

  setAttemptPartialPath(candidateId: string, attemptNumber: number, relativePath: string): boolean {
    return getDb().prepare(`UPDATE trailer_candidate_attempts SET output_partial_relative_path = ?
      WHERE candidate_id = ? AND attempt_number = ? AND status = 'processing'`).run(relativePath, candidateId, attemptNumber).changes > 0;
  },

  waitForCapacity(candidateId: string, category = "capacity"): boolean {
    const db = getDb(); const now = nowIso();
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'waiting_capacity', error_category = ?,
      error_message = NULL, updated_at = ? WHERE candidate_id = ? AND status IN ('pending', 'waiting_capacity')`).run(category, now, candidateId).changes;
    if (changed) db.prepare(`UPDATE trailer_candidate_attempts SET status = 'waiting_capacity', ended_at = ?
      WHERE candidate_id = ? AND attempt_number = (SELECT attempt_count FROM trailer_candidate_versions WHERE candidate_id = ?)
        AND status = 'processing'`).run(now, candidateId, candidateId);
    return changed > 0;
  },

  markReady(
    candidateId: string,
    output: { relativePath: string; sha256: string; bytes: number; durationSeconds: number; probeJson: string },
    caption?: TrailerCandidateCaptionProvenance,
    expected?: TrailerCandidateCaptionRevision,
  ): boolean {
    const db = getDb(); const now = nowIso();
    const existing = byId(candidateId);
    if (!existing) return false;
    const captionState = caption ?? {
      status: "waveform_only" as const,
      reasonCode: existing.captionMode === "disabled" ? "captions_disabled" as const : "quality_calibration_unavailable" as const,
      audioSha256: existing.audioSha256,
      transcriptSha256: existing.trailerTranscriptSha256,
    };
    const guard = expected
      ? " AND source_fingerprint = ? AND audio_sha256 = ? AND COALESCE(trailer_transcript_sha256, '') = COALESCE(?, '')"
      : "";
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'ready', progress = 100,
      output_relative_path = ?, output_sha256 = ?, output_bytes = ?, duration_seconds = ?, probe_json = ?,
      caption_status = ?, caption_reason_code = ?, caption_audio_sha256 = ?, caption_transcript_sha256 = ?,
      caption_aligner_version = ?, caption_model_id = ?, caption_model_revision = ?, caption_model_sha256 = ?,
      caption_profile_revision = ?, caption_output_sha256 = ?,
      error_category = NULL, error_message = NULL, ready_at = ?, updated_at = ?
      WHERE candidate_id = ? AND status = 'processing'${guard}`).run(
      output.relativePath, output.sha256, output.bytes, output.durationSeconds, output.probeJson,
      captionState.status, captionState.reasonCode, captionState.audioSha256, captionState.transcriptSha256,
      captionState.alignerVersion ?? null, captionState.modelId ?? null, captionState.modelRevision ?? null,
      captionState.modelSha256 ?? null, captionState.profileRevision ?? null,
      captionState.status === "included" ? captionState.outputSha256 ?? output.sha256 : null,
      now, now, candidateId,
      ...(expected ? [expected.sourceFingerprint, expected.audioSha256, expected.transcriptSha256] : []),
    ).changes;
    if (changed) db.prepare(`UPDATE trailer_candidate_attempts SET status = 'ready', ended_at = ?
      WHERE candidate_id = ? AND attempt_number = (SELECT attempt_count FROM trailer_candidate_versions WHERE candidate_id = ?)
        AND status IN ('processing', 'waiting_capacity')`).run(now, candidateId, candidateId);
    return changed > 0;
  },

  supersedeReady(candidateId: string): TrailerCandidateRow | null {
    getDb().prepare(`UPDATE trailer_candidate_versions SET status = 'superseded', output_relative_path = NULL, updated_at = ?
      WHERE candidate_id = ? AND status = 'ready'`).run(nowIso(), candidateId);
    return byId(candidateId);
  },

  supersedeTerminalAndQueueCleanup(episodeId: number, exceptCandidateId: string): void {
    const db = getDb();
    inImmediateTransaction(() => {
      const rows = db.prepare(`SELECT candidate_id, snapshot_relative_path FROM trailer_candidate_versions
        WHERE episode_id = ? AND candidate_id <> ? AND status IN ('ready', 'stale', 'superseded')`)
        .all(episodeId, exceptCandidateId) as Array<{ candidate_id: string; snapshot_relative_path: string }>;
      const now = nowIso();
      db.prepare(`UPDATE trailer_candidate_versions SET status = 'superseded', output_relative_path = NULL, updated_at = ?
        WHERE episode_id = ? AND candidate_id <> ? AND status = 'ready'`).run(now, episodeId, exceptCandidateId);
      const enqueue = db.prepare(`INSERT OR IGNORE INTO trailer_candidate_file_cleanup
        (candidate_id, relative_directory, created_at) VALUES (?, ?, ?)`);
      for (const row of rows) enqueue.run(row.candidate_id, row.snapshot_relative_path, now);
    });
  },

  queueFileCleanup(candidateId: string, relativeDirectory: string): void {
    getDb().prepare(`INSERT OR IGNORE INTO trailer_candidate_file_cleanup
      (candidate_id, relative_directory, created_at) VALUES (?, ?, ?)`)
      .run(candidateId, relativeDirectory, nowIso());
  },

  listFileCleanup(limit = 100): Array<{ candidateId: string; relativeDirectory: string }> {
    const bounded = Math.max(1, Math.min(1000, Math.trunc(limit)));
    return (getDb().prepare(`SELECT candidate_id, relative_directory FROM trailer_candidate_file_cleanup
      ORDER BY datetime(created_at), candidate_id LIMIT ?`).all(bounded) as Array<{ candidate_id: string; relative_directory: string }>)
      .map((row) => ({ candidateId: row.candidate_id, relativeDirectory: row.relative_directory }));
  },

  completeFileCleanup(candidateId: string): void {
    getDb().prepare("DELETE FROM trailer_candidate_file_cleanup WHERE candidate_id = ?").run(candidateId);
  },

  failFileCleanup(candidateId: string, message: string): void {
    getDb().prepare(`UPDATE trailer_candidate_file_cleanup SET attempts = attempts + 1, last_error = ?
      WHERE candidate_id = ?`).run(message.slice(0, 500), candidateId);
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
    const changed = db.prepare(`UPDATE trailer_candidate_versions SET status = 'pending', progress = 0, error_category = NULL,
      error_message = NULL, updated_at = ? WHERE candidate_id = ? AND status = 'retryable'`).run(nowIso(), candidateId).changes;
    return changed ? byId(candidateId) : null;
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
      db.prepare(`UPDATE trailer_candidate_versions SET trailer_transcript_status = 'not_started',
        trailer_transcript_progress = NULL, trailer_transcript_error_category = NULL, updated_at = ?
        WHERE trailer_transcript_status = 'processing' AND trailer_transcript_sha256 IS NULL`).run(now);
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
