import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getGuildSchemaState, guildTables, migrateGuildFoundation } from "../database/migrations/guild-foundation";

async function main() {
  const originalWorkingDirectory = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dc-guild-foundation-"));
  const filename = path.join(directory, "fixture.sqlite");
  const db = new DatabaseSync(filename);
  let server: import("node:http").Server | undefined;
  try {
    db.exec("CREATE TABLE episodes(id INTEGER PRIMARY KEY,title TEXT); INSERT INTO episodes VALUES(1,'existing episode');");
    const original = db.prepare("SELECT * FROM episodes").all();
    assert.equal(getGuildSchemaState(db), "missing");
    const hash = () => createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
    const before = hash();
    const dry = spawnSync(process.execPath,[path.join(__dirname,"migrate-guild.js"),"--database",filename],{encoding:"utf8"});
    assert.equal(dry.status,0,dry.stderr); assert.equal(hash(),before,"dry-run must not mutate the database");
    assert.equal(migrateGuildFoundation(db).applied,true);
    assert.equal(guildTables.length,34);
    assert.equal(getGuildSchemaState(db),"ready");
    assert.equal(migrateGuildFoundation(db).applied,false);
    assert.deepEqual(db.prepare("SELECT * FROM episodes").all(),original);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    db.prepare("INSERT INTO guild_members(id,display_name,slug,role,status) VALUES(?,?,?,?,?)").run("member1","Public Name","public-name","guilder","active");
    db.prepare("INSERT INTO guild_member_contacts(id,member_id,kind,normalized_value,purpose) VALUES('contact1','member1','email','private@example.invalid','contact')").run();
    db.exec("INSERT INTO guild_achievements(id,name,rarity,active) VALUES('badge1','Visible badge','Comum',1),('badge2','Hidden badge','Comum',0)");
    db.exec("INSERT INTO guild_game_plays(id,member_id,game,day,state) VALUES('play1','member1','palavra','2026-11-24','{}')");
    assert.throws(()=>db.exec("INSERT INTO guild_game_plays(id,member_id,game,day,state) VALUES('play2','member1','palavra','2026-11-24','{}')"));
    db.exec("INSERT INTO guild_xp_ledger(id,member_id,event_key,delta_xp,source_domain,source_type) VALUES('xp1','member1','game:palavra:2026-11-24',10,'game','daily-game')");
    assert.throws(()=>db.exec("INSERT INTO guild_xp_ledger(id,member_id,event_key,delta_xp,source_domain,source_type) VALUES('xp2','member1','game:palavra:2026-11-24',10,'game','daily-game')"));
    db.exec("INSERT INTO guild_xp_ledger(id,member_id,event_key,delta_xp,source_domain,source_type,reversal_of) VALUES('reverse1','member1','reverse:xp1',-10,'administrative','reversal','xp1')");
    assert.throws(()=>db.exec("INSERT INTO guild_xp_ledger(id,member_id,event_key,delta_xp,source_domain,source_type,reversal_of) VALUES('reverse2','member1','reverse-again:xp1',-10,'administrative','reversal','xp1')"));
    assert.throws(()=>db.exec("INSERT INTO guild_achievements(id,name,rarity,scope) VALUES('bad-game-badge','Bad','Comum','game')"));
    assert.throws(()=>db.exec("INSERT INTO guild_member_achievements(id,member_id,achievement_id,awarded_at) VALUES('award','missing','badge1','2026-11-24')"));
    db.exec("INSERT INTO guild_films(id,slug,title,year) VALUES('film1','one','One',2020),('film2','two','Two',2021)");
    assert.throws(()=>db.exec("INSERT INTO guild_film_reviews(id,film_id,member_id,rating) VALUES('review','film1','member1',7.3)"));
    db.exec("INSERT INTO guild_film_discussions(id,film_id,member_id,body,phase) VALUES('comment1','film1','member1','Comment','after')");
    assert.throws(()=>db.exec("INSERT INTO guild_film_discussions(id,film_id,member_id,body,phase,reply_to) VALUES('comment2','film2','member1','Reply','after','comment1')"));
    const untracked = new DatabaseSync(":memory:");
    try {
      untracked.exec("CREATE TABLE guild_members(id TEXT)");
      assert.throws(()=>migrateGuildFoundation(untracked),/Untracked/);
      assert.equal(untracked.prepare("SELECT name FROM sqlite_master WHERE name='guild_schema_migrations'").get(),undefined);
    } finally { untracked.close(); }
    const failing = new DatabaseSync(":memory:");
    try {
      failing.exec("CREATE TABLE episodes(id INTEGER); INSERT INTO episodes VALUES(7); CREATE INDEX guild_support_periods_lookup ON episodes(id)");
      assert.throws(()=>migrateGuildFoundation(failing),/already exists/);
      assert.equal(failing.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND substr(name,1,6)='guild_'").get()!.count,0);
      assert.equal(failing.prepare("SELECT id FROM episodes").get()!.id,7);
    } finally { failing.close(); }
    // Isolate config from developer .env files and supply only synthetic feed metadata.
    process.chdir(directory);
    Object.assign(process.env, {
      FEED_BASE_LINK: "https://fixture.invalid", FEED_AUDIO_BASE: "https://fixture.invalid/audio",
      FEED_IMAGE_BASE: "https://fixture.invalid/images", FEED_TITLE: "Fixture podcast",
      FEED_DESCRIPTION: "Synthetic verification fixture", FEED_SITE: "https://fixture.invalid",
      DISABLE_BACKGROUND_WORKERS: "true",
    });
    process.env.NODE_ENV="development";
    process.env.AUTH_BYPASS="false";
    process.env.SQLITE_PATH=path.join(directory,"unused.sqlite");
    const { guildOpenApiPaths } = await import("../docs/guild.openapi.js");
    assert.equal(Object.keys(guildOpenApiPaths).length,8);
    const express = (await import("express")).default;
    const { createGuildRouter } = await import("../routes/guild.routes.js");
    const app=express();
    app.use("/v1/guild",createGuildRouter(()=>db));
    // A synthetic auth seam permits isolated contract checks without real credentials.
    app.use("/authorized",createGuildRouter(()=>db,(_req,_res,next)=>next()));
    const missing = new DatabaseSync(":memory:");
    app.use("/missing",createGuildRouter(()=>missing,(_req,res)=>{res.sendStatus(401);}));
    app.use((error: unknown,_req: import("express").Request,res: import("express").Response,_next: import("express").NextFunction)=>res.status(400).json({code:"validation_failed"}));
    server=app.listen(0,"127.0.0.1");
    await new Promise<void>(resolve=>server!.once("listening",resolve));
    const address=server.address() as import("node:net").AddressInfo;
    const base=`http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(base+"/v1/guild/admin/schema")).status,401);
      assert.equal((await fetch(base+"/v1/guild/admin/schema",{headers:{authorization:"Bearer invalid-token"}})).status,401);
      assert.equal((await fetch(base+"/missing/admin/schema")).status,401);
      assert.equal((await fetch(base+"/missing/public/achievements")).status,503);
      const achievements=await (await fetch(base+"/v1/guild/public/achievements")).json() as {items: {id:string}[]};
      assert.deepEqual(achievements.items.map(i=>i.id),["badge1"]);
      const members=await (await fetch(base+"/v1/guild/public/members")).text();
      assert.ok(!members.includes("private@example.invalid"));
      assert.ok(!members.includes('"role"')); assert.ok(members.includes("Public Name"));
      assert.equal((await fetch(base+"/v1/guild/public/members?limit=101")).status,400);
      assert.equal((await fetch(base+"/v1/guild/public/members?sort=unknown")).status,400);
      const games=await (await fetch(base+"/v1/guild/public/games")).json() as {gameplayAvailable:boolean};
      assert.equal(games.gameplayAvailable,false);
      for(const route of ["schema","games/plays","achievements/awards","progression/ledger"]){
        assert.equal((await fetch(base+"/authorized/admin/"+route)).status,200,route);
      }
      assert.equal((await fetch(base+"/authorized/admin/progression/ledger",{method:"POST"})).status,404);
    } finally { missing.close(); }
    db.exec("UPDATE guild_schema_migrations SET checksum='tampered'");
    assert.equal(getGuildSchemaState(db),"incompatible");
    assert.throws(()=>migrateGuildFoundation(db),/checksum/);
    assert.deepEqual(db.prepare("SELECT * FROM episodes").all(),original);
    console.log("Guild foundation verified: 34 tables, repeatable migration, rollback, constraints, read-only routes, privacy and auth boundaries.");
  } finally {
    if(server) await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    process.chdir(originalWorkingDirectory);
    db.close(); fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
