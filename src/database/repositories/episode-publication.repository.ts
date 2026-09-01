import { getDb, nowIso } from "../sqlite";
import { publicationDestinationSchema, publicationLifecycleSchema, publicationMetadataSchema, publicationPreflightSchema, publicationSourceSchema, type PublicationDestination, type PublicationEffectProjection, type PublicationMetadata, type PublicationPreflight, type PublicationSource } from "../../schemas/episode-publication";

type Input = { episodeId: number; sourceRevision: string; source: PublicationSource; metadata: PublicationMetadata; destinations: PublicationDestination[]; preflight: PublicationPreflight };
type Row = { effect_key: string; destination: PublicationDestination; source_revision: string; source_json: string; metadata_json: string; eligibility: "eligible" | "blocked"; lifecycle: string; diagnostics_json: string; preflight_json: string; remote_id: string | null; permalink: string | null };

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
  markTelegramDelivered(episodeId: number, sourceRevision: string): void {
    getDb().prepare("UPDATE episode_publication_effects SET lifecycle = 'published', updated_at = ? WHERE episode_id = ? AND source_revision = ? AND destination = 'telegram' AND lifecycle = 'eligible'").run(nowIso(), episodeId, sourceRevision);
  },
};
