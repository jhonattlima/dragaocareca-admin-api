import { getDb, nowIso } from "../sqlite";
import { publicationCheckpointSchema, publicationDestinationSchema, publicationLifecycleSchema, publicationMetadataSchema, publicationPreflightSchema, publicationSourceSchema, type PublicationCheckpoint, type PublicationDestination, type PublicationEffectProjection, type PublicationMetadata, type PublicationPreflight, type PublicationSource } from "../../schemas/episode-publication";

type Input = { episodeId: number; sourceRevision: string; source: PublicationSource; metadata: PublicationMetadata; destinations: PublicationDestination[]; preflight: PublicationPreflight };
type Row = { effect_key: string; episode_id: number; destination: PublicationDestination; source_revision: string; source_json: string; metadata_json: string; eligibility: "eligible" | "blocked"; lifecycle: string; diagnostics_json: string; preflight_json: string; remote_id: string | null; permalink: string | null; checkpoint_json: string; attempts: number; next_attempt_at: string | null };

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
});

export const episodePublicationRepository = {
  createOrGet(input: Input): PublicationEffectProjection[] {
    const db = getDb();
    const now = nowIso();
    const intentId = `episode:${input.episodeId}:${input.sourceRevision}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO episode_publication_intents (intent_id, episode_id, source_revision, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(episode_id, source_revision) DO UPDATE SET updated_at = excluded.updated_at`).run(intentId, input.episodeId, input.sourceRevision, JSON.stringify(input.source), now, now);
      for (const destination of input.destinations) {
        const blocked = destination !== "telegram" && input.preflight.status !== "ready";
        const effectKey = `${intentId}:${destination}`;
        db.prepare(`INSERT INTO episode_publication_effects (effect_key, intent_id, episode_id, destination, source_revision, source_json, metadata_json, eligibility, lifecycle, diagnostics_json, preflight_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(intent_id, destination, source_revision) DO NOTHING`).run(effectKey, intentId, input.episodeId, destination, input.sourceRevision, JSON.stringify(input.source), JSON.stringify(input.metadata), blocked ? "blocked" : "eligible", blocked ? "blocked" : "eligible", JSON.stringify(blocked ? ["Finalized trailer/provider media preflight is not ready."] : []), JSON.stringify(input.preflight), now, now);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return this.list(input.episodeId, input.sourceRevision);
  },
  list(episodeId: number, sourceRevision?: string): PublicationEffectProjection[] {
    const rows = (sourceRevision
      ? getDb().prepare("SELECT * FROM episode_publication_effects WHERE episode_id = ? AND source_revision = ? ORDER BY destination").all(episodeId, sourceRevision)
      : getDb().prepare("SELECT * FROM episode_publication_effects WHERE episode_id = ? ORDER BY created_at DESC, destination").all(episodeId)) as Row[];
    return rows.map(map);
  },
  listDueSocialEffects(now = new Date(), limit = 20): Array<{ episodeId: number; effect: PublicationEffectProjection }> {
    const rows = getDb().prepare(`
      SELECT * FROM episode_publication_effects
      WHERE destination IN ('instagram_reel', 'facebook_native_video')
        AND eligibility = 'eligible'
        AND lifecycle = 'failed'
        AND attempts < 4
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY COALESCE(next_attempt_at, updated_at), updated_at
      LIMIT ?
    `).all(now.toISOString(), limit) as Row[];
    return rows.map((row) => ({ episodeId: row.episode_id, effect: map(row) }));
  },
  markTelegramDelivered(episodeId: number, sourceRevision: string): void {
    getDb().prepare("UPDATE episode_publication_effects SET lifecycle = 'published', updated_at = ? WHERE episode_id = ? AND source_revision = ? AND destination = 'telegram' AND lifecycle = 'eligible'").run(nowIso(), episodeId, sourceRevision);
  },
  updateCheckpoint(effectKey: string, checkpoint: PublicationCheckpoint, lifecycle: string, diagnostics: string[] = [], remoteId: string | null = null, permalink: string | null = null): void {
    publicationCheckpointSchema.parse(checkpoint);
    publicationLifecycleSchema.parse(lifecycle);
    getDb().prepare("UPDATE episode_publication_effects SET checkpoint_json = ?, lifecycle = ?, diagnostics_json = ?, remote_id = COALESCE(?, remote_id), permalink = COALESCE(?, permalink), updated_at = ? WHERE effect_key = ?").run(JSON.stringify(checkpoint), lifecycle, JSON.stringify(diagnostics), remoteId, permalink, nowIso(), effectKey);
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
};
