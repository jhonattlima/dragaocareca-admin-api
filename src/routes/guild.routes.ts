import { Router, type RequestHandler } from "express";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getDb } from "../database/sqlite";
import { getGuildSchemaState, guildTables, GUILD_SCHEMA_VERSION } from "../database/migrations/guild-foundation";
import { requireAuth } from "../middleware/auth.middleware";
import { guildGameCatalog } from "../guild/games";
import { listPublicGuildAchievements } from "../guild/achievements";
import { listGuildXpLedger } from "../guild/progression";

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();

export function createGuildRouter(database: () => DatabaseSync = getDb, adminAuth: RequestHandler = requireAuth) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  // Admin authentication precedes readiness checks and all protected reads.
  router.use("/admin", adminAuth);
  router.use((_req, res, next) => {
    try {
      const state = getGuildSchemaState(database());
      if (state !== "ready") {
        res.status(503).json({ code: "guild_schema_unavailable", message: "Guild schema has not been provisioned for this release." });
        return;
      }
      next();
    } catch (error) { next(error); }
  });
  router.get("/public/games", (_req, res) => res.json({ items: guildGameCatalog, gameplayAvailable: false }));
  router.get("/public/achievements", (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    res.json({ items: listPublicGuildAchievements(database(), limit, offset), limit, offset });
  });
  router.get("/public/members", (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    const items = database().prepare(`SELECT id,display_name,slug,character_name FROM guild_members
      WHERE status='active' AND role IN ('admin','guilder') ORDER BY display_name,id LIMIT ? OFFSET ?`).all(limit, offset);
    res.json({ items, limit, offset });
  });
  router.get("/public/films", (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    const items = database().prepare("SELECT id,slug,title,year,synopsis,poster_url,runtime FROM guild_films ORDER BY title,id LIMIT ? OFFSET ?").all(limit, offset);
    res.json({ items, limit, offset });
  });
  router.get("/admin/schema", (_req, res) => {
    const db = database();
    const tables = guildTables.map((name) => ({ name, rows: Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()!.count) }));
    res.json({ version: GUILD_SCHEMA_VERSION, tables, capabilities: { memberAuthentication: false, gameplay: false, rewards: false, imports: false } });
  });
  router.get("/admin/games/plays", (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    const items = database().prepare("SELECT id,member_id,game,day,finished,xp,version FROM guild_game_plays ORDER BY day DESC,id LIMIT ? OFFSET ?").all(limit, offset);
    res.json({ items, limit, offset });
  });
  router.get("/admin/achievements/awards", (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    const items = database().prepare("SELECT id,member_id,achievement_id,awarded_at,awarded_by FROM guild_member_achievements ORDER BY awarded_at DESC,id LIMIT ? OFFSET ?").all(limit, offset);
    res.json({ items, limit, offset });
  });
  router.get("/admin/progression/ledger", (req, res) => {
    const { limit, offset } = pagination.parse(req.query);
    res.json({ items: listGuildXpLedger(database(), limit, offset), limit, offset });
  });
  return router;
}

export const guildRouter = createGuildRouter();
