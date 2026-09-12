import { getDb, nowIso } from "../sqlite";
import { publicationCheckpointSchema, publicationDestinationSchema, publicationLifecycleSchema, publicationMetadataSchema, publicationPreflightSchema, publicationRetirementStatusSchema, publicationSourceSchema, type PublicationCheckpoint, type PublicationDestination, type PublicationEffectProjection, type PublicationMetadata, type PublicationPreflight, type PublicationSource } from "../../schemas/episode-publication";

type Input = { episodeId: number; sourceRevision: string; source: PublicationSource; metadata: PublicationMetadata; destinations: PublicationDestination[]; preflight: PublicationPreflight; withinTransaction?: boolean };
type Row = { effect_key: string; episode_id: number; destination: PublicationDestination; source_revision: string; source_json: string; metadata_json: string; eligibility: "eligible" | "blocked"; lifecycle: string; diagnostics_json: string; preflight_json: string; remote_id: string | null; permalink: string | null; checkpoint_json: string; attempts: number; next_attempt_at: string | null; predecessor_remote_id: string | null; predecessor_permalink: string | null; retirement_status: string; retirement_actor_email: string | null; retirement_confirmed_at: string | null };

const map = (row: Row): PublicationEffectProjection => ({
  destination: publicationDestinationSchema.parse(row.destination),
  lifecycle: publicationLifecycleSchema.parse(row.lifecycle),
  sourceRevision: row.source_revision,
  source: publicationSourceSchema.parse(JSON.parse(row.source_json)),
  metadata: publicationMetadataSchema.parse(JSON.parse(row.metadata_json)),
  eligibility: row.eligibility,
  diagnostics: JSON.parse(row.diagnostics_json) as string[],
  remoteId: row.remote_id,
  permalink: row.permalink,
  preflight: publicationPreflightSchema.parse(JSON.parse(row.preflight_json)),
  checkpoint: publicationCheckpointSchema.parse(JSON.parse(row.checkpoint_json)),
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  predecessor: row.predecessor_remote_id ? { remoteId: row.predecessor_remote_id, permalink: row.predecessor_permalink } : null,
  retirementStatus: publicationRetirementStatusSchema.parse(row.retirement_status),
  retirementActorEmail: row.retirement_actor_email,
  retirementConfirmedAt: row.retirement_confirmed_at,
  replacementComplete: ["confirmed_manually", "retired_automatically", "not_applicable"].includes(row.retirement_status),
});

export const episodePublicationRepository = {
  createOrGet(input: Input): PublicationEffectProjection[] {
    const db = getDb();
    const now = nowIso();
    const intentId = `episode:${input.episodeId}:${input.sourceRevision}`;
    const persist = (): void => {
      db.prepare(`INSERT INTO episode_publication_intents (intent_id, episode_id, source_revision, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(episode_id, source_revision) DO UPDATE SET updated_at = excluded.updated_at`).run(intentId, input.episodeId, input.sourceRevision, JSON.stringify(input.source), now, now);
      for (const destination of input.destinations) {
        const blocked = destination !== "telegram" && input.preflight.status !== "ready";
        const effectKey = `${intentId}:${destination}`;
        const predecessor = db.prepare(`SELECT remote_id, permalink FROM episode_publication_effects
          WHERE episode_id = ? AND destination = ? AND source_revision <> ? AND lifecycle = 'published' AND remote_id IS NOT NULL
          ORDER BY created_at DESC, effect_key DESC LIMIT 1`).get(input.episodeId, destination, input.sourceRevision) as { remote_id: string; permalink: string | null } | undefined;
        db.prepare(`INSERT INTO episode_publication_effects (effect_key, intent_id, episode_id, destination, source_revision, source_json, metadata_json, eligibility, lifecycle, diagnostics_json, preflight_json, predecessor_remote_id, predecessor_permalink, retirement_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_for_successor', ?, ?)
          ON CONFLICT(intent_id, destination, source_revision) DO NOTHING`).run(effectKey, intentId, input.episodeId, destination, input.sourceRevision, JSON.stringify(input.source), JSON.stringify(input.metadata), blocked ? "blocked" : "eligible", blocked ? "blocked" : "eligible", JSON.stringify(blocked ? ["Finalized trailer/provider media preflight is not ready."] : []), JSON.stringify(input.preflight), predecessor?.remote_id ?? null, predecessor?.permalink ?? null, now, now);
      }
    };
    if (input.withinTransaction) {
      persist();
    } else {
      db.exec("BEGIN IMMEDIATE");
      try { persist(); db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    return this.list(input.episodeId, input.sourceRevision);
  },
  list(episodeId: number, sourceRevision?: string): PublicationEffectProjection[] {
    const rows = (sourceRevision
      ? getDb().prepare("SELECT * FROM episode_publication_effects WHERE episode_id = ? AND source_revision = ? ORDER BY destination").all(episodeId, sourceRevision)
      : getDb().prepare("SELECT * FROM episode_publication_effects WHERE episode_id = ? ORDER BY created_at DESC, destination").all(episodeId)) as Row[];
    return rows.map(map);
  },
  hasIntent(episodeId: number, sourceRevision: string): boolean {
    return Boolean(getDb().prepare("SELECT 1 AS found FROM episode_publication_intents WHERE episode_id = ? AND source_revision = ?").get(episodeId, sourceRevision));
  },
  confirmManualRetirement(input: { episodeId: number; sourceRevision: string; destination: Extract<PublicationDestination, "instagram_reel" | "facebook_native_video">; predecessorRemoteId: string; actorEmail: string }): { status: "confirmed" | "replayed" | "conflict" | "not_found"; effect: PublicationEffectProjection | null } {
    const db = getDb();
    const effectKey = `episode:${input.episodeId}:${input.sourceRevision}:${input.destination}`;
    const actorEmail = input.actorEmail.trim().toLowerCase();
    if (!actorEmail) return { status: "conflict", effect: null };
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare(`SELECT lifecycle, predecessor_remote_id, retirement_status, retirement_actor_email, retirement_confirmed_at
        FROM episode_publication_effects WHERE effect_key = ? AND episode_id = ? AND source_revision = ? AND destination = ?`)
        .get(effectKey, input.episodeId, input.sourceRevision, input.destination) as { lifecycle: string; predecessor_remote_id: string | null; retirement_status: PublicationEffectProjection["retirementStatus"]; retirement_actor_email: string | null; retirement_confirmed_at: string | null } | undefined;
      if (!current) { db.exec("COMMIT"); return { status: "not_found", effect: null }; }
      if (current.lifecycle !== "published" || current.predecessor_remote_id !== input.predecessorRemoteId) {
        db.exec("COMMIT");
        return { status: "conflict", effect: this.list(input.episodeId, input.sourceRevision).find((effect) => effect.destination === input.destination) ?? null };
      }
      if (current.retirement_status === "confirmed_manually") {
        db.exec("COMMIT");
        return { status: "replayed", effect: this.list(input.episodeId, input.sourceRevision).find((effect) => effect.destination === input.destination) ?? null };
      }
      if (current.retirement_status !== "manual_retirement_required") {
        db.exec("COMMIT");
        return { status: "conflict", effect: this.list(input.episodeId, input.sourceRevision).find((effect) => effect.destination === input.destination) ?? null };
      }
      const now = nowIso();
      const changed = db.prepare(`UPDATE episode_publication_effects SET retirement_status = 'confirmed_manually', retirement_actor_email = ?, retirement_confirmed_at = ?, updated_at = ?
        WHERE effect_key = ? AND episode_id = ? AND source_revision = ? AND destination = ? AND lifecycle = 'published'
          AND predecessor_remote_id = ? AND retirement_status = 'manual_retirement_required'`)
        .run(actorEmail, now, now, effectKey, input.episodeId, input.sourceRevision, input.destination, input.predecessorRemoteId).changes;
      if (changed !== 1) { db.exec("COMMIT"); return { status: "conflict", effect: this.list(input.episodeId, input.sourceRevision).find((effect) => effect.destination === input.destination) ?? null }; }
      const effect = this.list(input.episodeId, input.sourceRevision).find((item) => item.destination === input.destination) ?? null;
      db.exec("COMMIT");
      return { status: "confirmed", effect };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  },
  listDueSocialEffects(now = new Date(), limit = 20): Array<{ episodeId: number; effect: PublicationEffectProjection }> {
    const rows = getDb().prepare(`
      SELECT * FROM episode_publication_effects
      WHERE destination IN ('instagram_reel', 'facebook_native_video')
        AND eligibility = 'eligible'
        AND (lifecycle = 'eligible' OR lifecycle = 'failed' OR (lifecycle = 'delivering' AND datetime(updated_at) <= datetime(?, '-60 seconds')))
        AND attempts < 12
        AND (lifecycle = 'eligible' OR next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY COALESCE(next_attempt_at, updated_at), updated_at
      LIMIT ?
    `).all(now.toISOString(), now.toISOString(), limit) as Row[];
    return rows.map((row) => ({ episodeId: row.episode_id, effect: map(row) }));
  },
  claimSocialEffect(effectKey: string, now = new Date()): PublicationEffectProjection | null {
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db.prepare(`UPDATE episode_publication_effects
        SET lifecycle = 'delivering', updated_at = ?
        WHERE effect_key = ? AND destination IN ('instagram_reel', 'facebook_native_video')
          AND eligibility = 'eligible'
          AND (lifecycle = 'eligible'
            OR (lifecycle = 'failed' AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime(?)))
            OR (lifecycle = 'delivering' AND datetime(updated_at) <= datetime(?, '-60 seconds')))`)
        .run(now.toISOString(), effectKey, now.toISOString(), now.toISOString()).changes;
      if (changed !== 1) { db.exec("COMMIT"); return null; }
      const row = db.prepare("SELECT * FROM episode_publication_effects WHERE effect_key = ?").get(effectKey) as Row | undefined;
      db.exec("COMMIT");
      return row ? map(row) : null;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  },
  markTelegramDelivered(episodeId: number, sourceRevision: string): void {
    getDb().prepare("UPDATE episode_publication_effects SET lifecycle = 'published', updated_at = ? WHERE episode_id = ? AND source_revision = ? AND destination = 'telegram' AND lifecycle = 'eligible'").run(nowIso(), episodeId, sourceRevision);
  },
  updateCheckpoint(effectKey: string, checkpoint: PublicationCheckpoint, lifecycle: string, diagnostics: string[] = [], remoteId: string | null = null, permalink: string | null = null): void {
    publicationCheckpointSchema.parse(checkpoint);
    publicationLifecycleSchema.parse(lifecycle);
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT episode_id, destination, source_revision, predecessor_remote_id, retirement_status FROM episode_publication_effects WHERE effect_key = ?").get(effectKey) as { episode_id: number; destination: PublicationDestination; source_revision: string; predecessor_remote_id: string | null; retirement_status: PublicationEffectProjection["retirementStatus"] } | undefined;
      let predecessor = current?.predecessor_remote_id ?? null;
      let predecessorPermalink: string | null = null;
      let retirementStatus = current?.retirement_status;
      if (lifecycle === "published" && current) {
        if (!predecessor) {
          const previous = db.prepare(`SELECT remote_id, permalink FROM episode_publication_effects
            WHERE episode_id = ? AND destination = ? AND source_revision <> ? AND lifecycle = 'published' AND remote_id IS NOT NULL
            ORDER BY created_at DESC, effect_key DESC LIMIT 1`).get(current.episode_id, current.destination, current.source_revision) as { remote_id: string; permalink: string | null } | undefined;
          predecessor = previous?.remote_id ?? null;
          predecessorPermalink = previous?.permalink ?? null;
        } else {
          const previous = db.prepare("SELECT permalink FROM episode_publication_effects WHERE episode_id = ? AND destination = ? AND remote_id = ? ORDER BY created_at DESC LIMIT 1").get(current.episode_id, current.destination, predecessor) as { permalink: string | null } | undefined;
          predecessorPermalink = previous?.permalink ?? null;
        }
        if (retirementStatus === "waiting_for_successor") retirementStatus = predecessor ? "manual_retirement_required" : "not_applicable";
      }
      db.prepare(`UPDATE episode_publication_effects
        SET checkpoint_json = ?, lifecycle = ?, diagnostics_json = ?, remote_id = COALESCE(?, remote_id), permalink = COALESCE(?, permalink),
            predecessor_remote_id = COALESCE(predecessor_remote_id, ?), predecessor_permalink = COALESCE(predecessor_permalink, ?),
            retirement_status = COALESCE(?, retirement_status), updated_at = ? WHERE effect_key = ?`)
        .run(JSON.stringify(checkpoint), lifecycle, JSON.stringify(diagnostics), remoteId, permalink, predecessor, predecessorPermalink, retirementStatus ?? null, nowIso(), effectKey);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  },
  recordAttempt(effectKey: string, nextAttemptAt: string | null, diagnostics: string[]): number {
    const row = getDb().prepare("SELECT attempts FROM episode_publication_effects WHERE effect_key = ?").get(effectKey) as { attempts: number } | undefined;
    const attempts = (row?.attempts ?? 0) + 1;
    getDb().prepare("UPDATE episode_publication_effects SET attempts = ?, next_attempt_at = ?, diagnostics_json = ?, updated_at = ? WHERE effect_key = ?").run(attempts, nextAttemptAt, JSON.stringify(diagnostics), nowIso(), effectKey);
    return attempts;
  },
  resetSocialEffectForFixture(effectKey: string): boolean {
    const result = getDb().prepare(`UPDATE episode_publication_effects
      SET lifecycle = 'eligible', attempts = 0, next_attempt_at = NULL,
          diagnostics_json = '[]', remote_id = NULL, permalink = NULL,
          checkpoint_json = ?, updated_at = ?
      WHERE effect_key = ?
        AND destination IN ('instagram_reel', 'facebook_native_video')
        AND remote_id IS NULL
        AND json_extract(checkpoint_json, '$.providerId') IS NULL`).run(
      JSON.stringify({ stage: "none", providerId: null, uploadId: null, updatedAt: null }),
      nowIso(),
      effectKey,
    );
    return result.changes > 0;
  },
  resetInstagramEffectForFixture(effectKey: string): boolean {
    const result = getDb().prepare(`UPDATE episode_publication_effects
      SET lifecycle = 'eligible', attempts = 0, next_attempt_at = NULL,
          diagnostics_json = '[]', remote_id = NULL, permalink = NULL,
          checkpoint_json = ?, updated_at = ?
      WHERE effect_key = ?
        AND destination = 'instagram_reel'
        AND remote_id IS NULL`).run(
      JSON.stringify({ stage: "none", providerId: null, uploadId: null, updatedAt: null }),
      nowIso(),
      effectKey,
    );
    return result.changes > 0;
  },
  requeueSocialEffectForFixture(effectKey: string): boolean {
    const result = getDb().prepare(`UPDATE episode_publication_effects
      SET lifecycle = 'failed', next_attempt_at = ?, diagnostics_json = ?, updated_at = ?
      WHERE effect_key = ?
        AND destination IN ('instagram_reel', 'facebook_native_video')
        AND remote_id IS NULL
        AND json_extract(checkpoint_json, '$.providerId') IS NOT NULL`).run(
      nowIso(),
      JSON.stringify(["Fixture recovery requeued the persisted provider checkpoint."]),
      nowIso(),
      effectKey,
    );
    return result.changes > 0;
  },
};
