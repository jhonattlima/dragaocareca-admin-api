import type { DatabaseSync } from "node:sqlite";

/** Read-only foundation. Credits/reversals require a later transactional domain service. */
export function listGuildXpLedger(db: DatabaseSync, limit: number, offset: number) {
  return db.prepare(`SELECT id,member_id,event_key,source_domain,source_type,source_id,
    delta_xp,reversal_of,created_at FROM guild_xp_ledger ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(limit, offset);
}
