import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../sqlite";
import {
  promotionAcknowledgementSchema,
  promotionDestinationAcknowledgementSchema,
  promotionDestinationSchema,
  promotionEffectStatusSchema,
  promotionRequestSchema,
  type PromotionAcknowledgement,
  type PromotionDestination,
  type PromotionDestinationAcknowledgement,
  type PromotionEffectStatus,
  type PromotionRequest,
} from "../../schemas/episode-promotion";

export type PromotionNotificationRow = {
  notificationId: string;
  episodeId: number;
  contractVersion: string;
  sourceRevision: string;
  requestJson: string;
  requestFingerprint: string;
  sourceSha256: string;
  sourceBytes: number;
  status: "pending" | "partial" | "complete";
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PromotionEffectRow = {
  effectKey: string;
  notificationId: string;
  episodeId: number;
  destination: PromotionDestination;
  sourceRevision: string;
  requestFingerprint: string;
  status: PromotionEffectStatus;
  attemptCount: number;
  revision: number;
  leaseId: string | null;
  leaseClaimedAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  acknowledgedAt: string | null;
  messageId: string | null;
  fileId: string | null;
  topicId: string | null;
  messageThreadId: string | null;
  errorCategory: string | null;
  errorDescription: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PromotionIntent = {
  notification: PromotionNotificationRow;
  effects: PromotionEffectRow[];
};

export type UpsertPromotionIntentInput = {
  request: PromotionRequest;
  requestFingerprint: string;
};

export type ClaimDuePromotionEffectsInput = {
  notificationId?: string;
  limit?: number;
  now?: string;
  leaseDurationMs?: number;
};

export type RecordPromotionAcknowledgementInput = {
  notificationId: string;
  destination: PromotionDestination;
  sourceRevision: string;
  effectKey?: string;
  leaseId?: string;
  revision?: number;
  acknowledgement: PromotionDestinationAcknowledgement;
};

type SqlitePromotionNotificationRow = {
  notification_id: string;
  episode_id: number;
  contract_version: string;
  source_revision: string;
  request_json: string;
  request_fingerprint: string;
  source_sha256: string;
  source_bytes: number;
  status: PromotionNotificationRow["status"];
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

type SqlitePromotionEffectRow = {
  effect_key: string;
  notification_id: string;
  episode_id: number;
  destination: PromotionDestination;
  source_revision: string;
  request_fingerprint: string;
  status: PromotionEffectStatus;
  attempt_count: number;
  revision: number;
  lease_id: string | null;
  lease_claimed_at: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  acknowledged_at: string | null;
  message_id: string | null;
  file_id: string | null;
  topic_id: string | null;
  message_thread_id: string | null;
  error_category: string | null;
  error_description: string | null;
  created_at: string;
  updated_at: string;
};

const mapNotification = (row: SqlitePromotionNotificationRow | undefined): PromotionNotificationRow | null => {
  if (!row) return null;
  return {
    notificationId: row.notification_id,
    episodeId: row.episode_id,
    contractVersion: row.contract_version,
    sourceRevision: row.source_revision,
    requestJson: row.request_json,
    requestFingerprint: row.request_fingerprint,
    sourceSha256: row.source_sha256,
    sourceBytes: row.source_bytes,
    status: row.status,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapEffect = (row: SqlitePromotionEffectRow | undefined): PromotionEffectRow | null => {
  if (!row) return null;
  return {
    effectKey: row.effect_key,
    notificationId: row.notification_id,
    episodeId: row.episode_id,
    destination: promotionDestinationSchema.parse(row.destination),
    sourceRevision: row.source_revision,
    requestFingerprint: row.request_fingerprint,
    status: promotionEffectStatusSchema.parse(row.status),
    attemptCount: row.attempt_count,
    revision: row.revision,
    leaseId: row.lease_id,
    leaseClaimedAt: row.lease_claimed_at,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    acknowledgedAt: row.acknowledged_at,
    messageId: row.message_id,
    fileId: row.file_id,
    topicId: row.topic_id,
    messageThreadId: row.message_thread_id,
    errorCategory: row.error_category,
    errorDescription: row.error_description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const selectNotification = (notificationId: string): PromotionNotificationRow | null =>
  mapNotification(getDb().prepare("SELECT * FROM promotion_notifications WHERE notification_id = ?").get(notificationId) as SqlitePromotionNotificationRow | undefined);

const selectEffects = (notificationId: string, sourceRevision?: string): PromotionEffectRow[] => {
  const rows = sourceRevision === undefined
    ? getDb().prepare("SELECT * FROM promotion_effects WHERE notification_id = ? ORDER BY destination").all(notificationId)
    : getDb().prepare("SELECT * FROM promotion_effects WHERE notification_id = ? AND source_revision = ? ORDER BY destination").all(notificationId, sourceRevision);
  return (rows as SqlitePromotionEffectRow[]).map((row) => mapEffect(row) as PromotionEffectRow);
};

const refreshNotificationStatus = (notificationId: string, sourceRevision: string): void => {
  const rows = selectEffects(notificationId, sourceRevision);
  const complete = rows.length > 0 && rows.every((row) => row.status === "complete" || row.status === "replayed");
  const partial = rows.some((row) => row.status === "complete" || row.status === "replayed" || row.status === "permanent_failure");
  getDb().prepare("UPDATE promotion_notifications SET status = ?, updated_at = ? WHERE notification_id = ? AND source_revision = ?")
    .run(complete ? "complete" : partial ? "partial" : "pending", nowIso(), notificationId, sourceRevision);
};

const withImmediateTransaction = <T>(callback: () => T): T => {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const effectKeyFor = (notificationId: string, destination: PromotionDestination, sourceRevision: string): string =>
  `${notificationId}:${destination}:${sourceRevision}`;

type ClaimPromotionEffectsMode = "due" | "unknown";

const claimPromotionEffects = (
  input: ClaimDuePromotionEffectsInput = {},
  mode: ClaimPromotionEffectsMode = "due",
): PromotionEffectRow[] => {
  const now = input.now ?? nowIso();
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 2)));
  const claimed: PromotionEffectRow[] = [];
  withImmediateTransaction(() => {
    const conditions = [
      mode === "unknown"
        ? "e.status = 'unknown'"
        : "e.status IN ('pending', 'temporary_failure', 'unknown')",
      "e.source_revision = n.source_revision",
    ];
    const parameters: Array<string | number> = [];
    if (mode === "due") {
      conditions.push("(e.next_attempt_at IS NULL OR datetime(e.next_attempt_at) <= datetime(?))");
      parameters.push(now);
    }
    if (input.notificationId) {
      conditions.push("e.notification_id = ?");
      parameters.push(input.notificationId);
    }
    const candidates = getDb().prepare(`
      SELECT e.* FROM promotion_effects e
      JOIN promotion_notifications n ON n.notification_id = e.notification_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY datetime(e.created_at) ASC, e.effect_key ASC
      LIMIT ${limit}
    `).all(...parameters) as SqlitePromotionEffectRow[];
    for (const candidate of candidates) {
      const leaseId = randomUUID();
      const claimedAt = now;
      const result = getDb().prepare(`
        UPDATE promotion_effects
        SET status = 'in_progress', lease_id = ?, lease_claimed_at = ?, last_attempt_at = ?,
            next_attempt_at = ?, attempt_count = attempt_count + 1, revision = revision + 1, updated_at = ?
        WHERE effect_key = ? AND notification_id = ? AND source_revision = ? AND revision = ?
          AND status ${mode === "unknown" ? "= 'unknown'" : "IN ('pending', 'temporary_failure', 'unknown')"}
          ${mode === "due" ? "AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime(?))" : ""}
      `).run(
        leaseId,
        claimedAt,
        claimedAt,
        new Date(Date.parse(claimedAt) + leaseDurationMs).toISOString(),
        claimedAt,
        candidate.effect_key,
        candidate.notification_id,
        candidate.source_revision,
        candidate.revision,
        ...(mode === "due" ? [now] : []),
      );
      if (result.changes === 1) {
        const row = mapEffect(getDb().prepare("SELECT * FROM promotion_effects WHERE effect_key = ?").get(candidate.effect_key) as SqlitePromotionEffectRow);
        if (row) claimed.push(row);
      }
    }
  });
  return claimed;
};

export const episodePromotionRepository = {
  upsertPromotionIntent(input: UpsertPromotionIntentInput): PromotionIntent {
    const request = promotionRequestSchema.parse(input.request);
    const now = nowIso();
    const existing = selectNotification(request.notification_id);
    if (existing && existing.sourceRevision === request.source_revision && existing.requestFingerprint !== input.requestFingerprint) {
      throw new Error(`Conflicting promotion payload fingerprint for ${request.notification_id}.`);
    }

    withImmediateTransaction(() => {
      getDb().prepare(`
        INSERT INTO promotion_notifications (
          notification_id, episode_id, contract_version, source_revision, request_json,
          request_fingerprint, source_sha256, source_bytes, status, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
        ON CONFLICT(notification_id) DO UPDATE SET
          episode_id = excluded.episode_id,
          contract_version = excluded.contract_version,
          source_revision = excluded.source_revision,
          request_json = excluded.request_json,
          request_fingerprint = excluded.request_fingerprint,
          source_sha256 = excluded.source_sha256,
          source_bytes = excluded.source_bytes,
          updated_at = excluded.updated_at
      `).run(
        request.notification_id,
        request.episode_id,
        request.contract_version,
        request.source_revision,
        JSON.stringify(request),
        input.requestFingerprint,
        request.trailer.sha256,
        request.trailer.byte_count,
        now,
        now,
      );

      for (const destination of request.destinations) {
        const effectKey = effectKeyFor(request.notification_id, destination, request.source_revision);
        getDb().prepare(`
          INSERT INTO promotion_effects (
            effect_key, notification_id, episode_id, destination, source_revision, request_fingerprint,
            status, attempt_count, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
          ON CONFLICT(notification_id, destination, source_revision) DO NOTHING
        `).run(effectKey, request.notification_id, request.episode_id, destination, request.source_revision, input.requestFingerprint, now, now);
      }
    });

    const notification = selectNotification(request.notification_id);
    if (!notification) throw new Error("Promotion notification was not persisted.");
    return { notification, effects: selectEffects(request.notification_id, request.source_revision) };
  },

  findPromotionIntent(notificationId: string, sourceRevision?: string): PromotionIntent | null {
    const notification = selectNotification(notificationId);
    if (!notification) return null;
    const revision = sourceRevision ?? notification.sourceRevision;
    return { notification, effects: selectEffects(notificationId, revision) };
  },

  claimDuePromotionEffects(input: ClaimDuePromotionEffectsInput = {}): PromotionEffectRow[] {
    return claimPromotionEffects(input);
  },

  claimUnknownPromotionEffects(input: ClaimDuePromotionEffectsInput = {}): PromotionEffectRow[] {
    return claimPromotionEffects(input, "unknown");
  },

  recordPromotionAcknowledgement(input: RecordPromotionAcknowledgementInput): PromotionEffectRow | null {
    const acknowledgement = promotionDestinationAcknowledgementSchema.parse(input.acknowledgement);
    if (acknowledgement.destination !== input.destination) throw new Error("Acknowledgement destination does not match effect destination.");
    const status = acknowledgement.status;
    const acknowledgedAt = acknowledgement.acknowledged_at ?? ((status === "complete" || status === "replayed") ? nowIso() : null);
    const effectKey = input.effectKey ?? effectKeyFor(input.notificationId, input.destination, input.sourceRevision);
    const conditions = ["effect_key = ?", "notification_id = ?", "destination = ?", "source_revision = ?"];
    const parameters: Array<string | number> = [effectKey, input.notificationId, input.destination, input.sourceRevision];
    if (input.leaseId) { conditions.push("lease_id = ?"); parameters.push(input.leaseId); }
    if (input.revision !== undefined) { conditions.push("revision = ?"); parameters.push(input.revision); }
    const updatedAt = nowIso();
    const result = getDb().prepare(`
      UPDATE promotion_effects SET
        status = ?, acknowledged_at = ?, message_id = COALESCE(?, message_id), file_id = COALESCE(?, file_id),
        topic_id = COALESCE(?, topic_id), message_thread_id = COALESCE(?, message_thread_id),
        error_category = ?, error_description = ?, lease_id = NULL, lease_claimed_at = NULL,
        next_attempt_at = ?, revision = revision + 1, updated_at = ?
      WHERE ${conditions.join(" AND ")} AND status NOT IN ('complete', 'replayed')
    `).run(
      status,
      acknowledgedAt,
      acknowledgement.message_id ?? null,
      acknowledgement.file_id ?? null,
      acknowledgement.topic_id ?? null,
      acknowledgement.message_thread_id ?? null,
      acknowledgement.error?.category ?? null,
      acknowledgement.error?.description ?? null,
      status === "temporary_failure" || status === "unknown" ? new Date(Date.parse(updatedAt) + 30_000).toISOString() : null,
      updatedAt,
      ...parameters,
    );
    if (result.changes !== 1) {
      const current = mapEffect(getDb().prepare("SELECT * FROM promotion_effects WHERE effect_key = ?").get(effectKey) as SqlitePromotionEffectRow | undefined);
      return current?.status === "complete" || current?.status === "replayed" ? current : null;
    }
    const row = mapEffect(getDb().prepare("SELECT * FROM promotion_effects WHERE effect_key = ?").get(effectKey) as SqlitePromotionEffectRow);
    if (row) refreshNotificationStatus(input.notificationId, input.sourceRevision);
    return row;
  },

  recoverExpiredPromotionLeases(referenceTime = new Date(), leaseDurationMs = 60_000): PromotionEffectRow[] {
    const cutoff = new Date(referenceTime.getTime() - leaseDurationMs).toISOString();
    const now = referenceTime.toISOString();
    const rows = getDb().prepare(`
      SELECT * FROM promotion_effects
      WHERE status = 'in_progress' AND lease_claimed_at IS NOT NULL AND datetime(lease_claimed_at) <= datetime(?)
    `).all(cutoff) as SqlitePromotionEffectRow[];
    if (rows.length === 0) return [];
    const recovered: PromotionEffectRow[] = [];
    withImmediateTransaction(() => {
      for (const row of rows) {
        const result = getDb().prepare(`
          UPDATE promotion_effects SET status = 'unknown', lease_id = NULL, lease_claimed_at = NULL,
            next_attempt_at = ?, revision = revision + 1, updated_at = ?
          WHERE effect_key = ? AND notification_id = ? AND source_revision = ? AND revision = ?
            AND lease_id = ? AND status = 'in_progress'
            AND datetime(lease_claimed_at) <= datetime(?)
        `).run(now, now, row.effect_key, row.notification_id, row.source_revision, row.revision, row.lease_id, cutoff);
        if (result.changes === 1) {
          const recoveredRow = mapEffect(getDb().prepare("SELECT * FROM promotion_effects WHERE effect_key = ?").get(row.effect_key) as SqlitePromotionEffectRow);
          if (recoveredRow) recovered.push(recoveredRow);
        }
      }
    });
    return recovered;
  },

  listIncompletePromotionEffects(notificationId?: string): PromotionEffectRow[] {
    const rows = notificationId
      ? getDb().prepare(`
          SELECT e.* FROM promotion_effects e JOIN promotion_notifications n ON n.notification_id = e.notification_id
          WHERE e.notification_id = ? AND e.source_revision = n.source_revision
            AND e.status IN ('pending', 'temporary_failure', 'unknown') ORDER BY e.destination
        `).all(notificationId)
      : getDb().prepare(`
          SELECT e.* FROM promotion_effects e JOIN promotion_notifications n ON n.notification_id = e.notification_id
          WHERE e.source_revision = n.source_revision AND e.status IN ('pending', 'temporary_failure', 'unknown')
          ORDER BY datetime(e.created_at) ASC, e.effect_key ASC
        `).all();
    return (rows as SqlitePromotionEffectRow[]).map((row) => mapEffect(row) as PromotionEffectRow);
  },
};

export const parsePromotionAcknowledgement = (value: unknown): PromotionAcknowledgement => promotionAcknowledgementSchema.parse(value);
