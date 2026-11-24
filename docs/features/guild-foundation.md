# Guild foundation — schema and read contracts

2026-11-24. Implemented locally; not deployed and not applied to a live database. No PocketBase records, credentials or files have been imported.

## Ownership and boundaries

This API owns Guild persistence. Games (`src/guild/games.ts`), achievements (`src/guild/achievements.ts`) and progression (`src/guild/progression.ts`) are independent modules. Games expose definitions; future game commands emit validated results. Achievement rules consume such results without games importing badge definitions. XP has its own ledger `guild_xp_ledger`, with `source_domain`, `source_type`, event key and optional source ID/reversal reference. Shared XP does not mean a shared gameplay/achievement table.

`guild_achievements.scope` distinguishes `guild` from `game`; `game_key` is mandatory only for game-scoped achievements. Grants track source domain/event key independently. Historical catalog entries default to Guild scope until the importer has an explicit reviewed classification; no inference by badge title. Game definitions are code-owned and not yet playable. No reward, grant, login or gameplay mutation is exposed in this foundation.

The schema uses the agreed shared SQLite, namespaced tables and references, without changing existing podcast tables or PRAGMAs at startup. The migration is explicit, not a server-start side effect. It preserves the intended source field inventory while replacing PocketBase auth fields with contacts, verified identities, sessions and fresh challenges. Import mapping, detailed transforms, source support totals and audit-format conversion remain importer work, not an implemented importer.

## Explicit migration

First prepare a consistent, isolated copy of the API SQLite using the operational backup procedure. Never copy an active WAL database as an uncoordinated main-file-only copy. Do not pass production until rehearsal/backup and deployment scope have been handled.

```sh
npm run migrate:guild -- --database /absolute/path/api-copy.sqlite
npm run migrate:guild -- --database /absolute/path/api-copy.sqlite --apply
```

The first command is a read-only inspection (not a full rehearsal of all DDL). The second applies `001-guild-foundation` in one transaction, records a checksum and validates FKs. An existing absolute file path is mandatory. No env-derived database defaults, provider calls, hooks, seeds, data import or external workers run. Already applied matching versions are a no-op; checksum mismatch/untracked partial Guild tables fail. Future schema changes must be new versioned migrations, not edits to a version already shipped. Do not manually drop tables to work around a mismatch.

Compiled deployment command after build: `node dist/scripts/migrate-guild.js --database /absolute/path/api-copy.sqlite [--apply]`. Use the exact application build whose migration is being applied. Existing non-Guild tables are neither rewritten nor dropped. Additive schema rollback does not mean restoring the entire shared database and losing new podcast writes.

## Read endpoints

Base `/v1/guild`; OpenAPI is included in `/docs.json` and `/docs`.

| GET suffix | Auth | Response |
|---|---|---|
| `/public/games` | Public | Game definitions; `playable:false`, `gameplayAvailable:false` |
| `/public/achievements` | Public | Active catalog with scope; no grants or member identity |
| `/public/members` | Public | Active admin/guilder IDs, names, slugs and character names only |
| `/public/films` | Public | Film catalog without storage paths or private metadata |
| `/admin/schema` | Existing podcast-admin auth | Version, 34 table names/counts and unavailable capabilities |
| `/admin/games/plays` | Existing podcast-admin auth | Bounded play summaries, without secret puzzle state |
| `/admin/achievements/awards` | Existing podcast-admin auth | Bounded grant summaries |
| `/admin/progression/ledger` | Existing podcast-admin auth | Bounded ledger entries with source and reversal reference |

Paginated endpoints accept only `limit` (1–100, default25) and `offset` (0–100000, default0); unsupported filters are rejected. Ordering has a deterministic ID tie-breaker. Public DTOs explicitly omit contacts, sessions, proof files, push keys and auth fields; local image IDs/paths are not exposed as working URLs before a media handler exists. Admin auth is not Guild-member auth; no public/member token is introduced. Development `AUTH_BYPASS` behavior remains that of existing middleware.

Responses use `Cache-Control:no-store`. Missing or incompatible schema returns503; protected paths check admin auth before readiness. Reads never apply the migration. All collections are empty immediately after provisioning, except the code-owned game catalog. These endpoints do not make the existing Guild frontend functional until adapters, member auth and domain mutations are implemented.

## Validation and deferred behavior

`npm run verify:guild-foundation` builds and tests a disposable SQLite and local HTTP server, with no external service or real data. Coverage: repeatable migration, dry-run preservation, rollback on partial state/checksum refusal, unchanged pre-existing episode fixture, FKs, unique daily games/events/reversals, rating steps, same-film discussion replies, public DTO privacy, inactive badges, authentication order, pagination, unavailable schema and absence of mutation routes. `npm run typecheck` is also required.

Schema constraints do not implement domain workflows: XP balance updates, reversal value/member checks, same-event first-discovery consistency, blood donation intervals, idempotent per-move processing, upload lifecycle, login rate limiting, push workers and full role policies remain later transactional services. Do not seed fake successes or enable workers to compensate for their absence. Load testing with ten active players is meaningful after actual gameplay exists, not against read-only scaffolding.
