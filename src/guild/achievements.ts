import type { DatabaseSync } from "node:sqlite";

/** Achievement catalog/awards are independent of game state and XP balances. */
export function listPublicGuildAchievements(db: DatabaseSync, limit: number, offset: number) {
  return db.prepare(`SELECT id, name, description, category, rarity, scope, game_key, image_url, badge_image_url
    FROM guild_achievements WHERE active=1 ORDER BY name,id LIMIT ? OFFSET ?`).all(limit, offset);
}
