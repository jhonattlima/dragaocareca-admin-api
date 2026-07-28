# Architecture

**Analysis Date:** 2026-07-28

## Pattern Overview

**Overall:** Monolithic Express API with SQLite persistence, filesystem-backed media handling, and background worker startup inside the same Node process.

**Key Characteristics:**
- Single backend process bootstraps HTTP server, DB, migrations, and workers from `src/server.ts`
- Route layer is thin; business logic lives mostly in `src/services/` and `src/database/repositories/`
- Persistent state is split between SQLite tables/views and on-disk media/assets under `data/`
- External integrations are optional and feature-flagged through env vars

## Layers

**Bootstrap Layer:**
- Purpose: initialize dependencies and start the process
- Contains: `src/server.ts`, `src/database/connect.ts`
- Depends on: config, DB schema, workers, service startup hooks
- Used by: `npm run dev`, `npm run build` + `node dist/server.js`

**HTTP Interface Layer:**
- Purpose: expose public and authenticated API endpoints
- Contains: `src/app.ts`, `src/routes/*.routes.ts`, `src/middleware/auth.middleware.ts`, `src/docs/openapi.ts`
- Depends on: services, repository, config, schema validation
- Used by: frontend admin app and external feed consumers

**Business Service Layer:**
- Purpose: encapsulate feed generation, media layout, notifications, analytics, transcription, and asset generation
- Contains: `src/services/*.service.ts`, `src/services/telegram-bot.worker.ts`
- Depends on: repository, config, filesystem, external APIs
- Used by: routes and startup flow

**Persistence Layer:**
- Purpose: own SQLite schema, connections, and data access
- Contains: `src/database/sqlite.ts`, `src/database/repositories/episode.repository.ts`
- Depends on: Node built-ins and config
- Used by: routes, services, workers, health endpoint

## Data Flow

**HTTP Request Flow:**
1. Server starts from `src/server.ts` and imports the preconfigured `app` from `src/app.ts`
2. Express middleware applies `helmet`, `cors`, `morgan`, JSON parsing, and static `/media`
3. Route module matches the request under `/v1/auth`, `/v1/episodes`, `/v1/feed`, `/v1/assets`, or `/v1/metrics`
4. Protected routes pass through `requireAuth` in `src/middleware/auth.middleware.ts`
5. Route handler validates/parses input and delegates to repository/service functions
6. Error middleware in `src/app.ts` converts `ZodError`, auth config errors, and generic failures into JSON responses

**Episode Publication / Feed Flow:**
1. Episodes are created or updated through `src/routes/episodes.routes.ts`
2. SQLite records are stored via `episodeRepository`
3. Public feed route `GET /v1/feed` loads published episodes with `pubDate <= now`
4. `src/services/feed.service.ts` assembles RSS XML, optionally reusing legacy `xmlSnapshot`
5. XML is returned directly from Express

**Episode AI Worker Flow:**
1. Audio upload queues transcription through `src/services/episode-transcription.service.ts`
2. `EPISODE_TRANSCRIPTION_PROVIDER` selects Gemini Files API transcription or the internal Whisper-family CLI
3. The completed transcript is written to the episode folder as `transcript.txt`
4. `episode.state.json` records the transcript state and queues the sequential summary job
5. `EPISODE_SUMMARY_PROVIDER` selects Gemini or the local Llama fallback, writes draft `summary.txt`, and records `aiSummary` state
6. The protected summary endpoint returns draft text and status; final `episodes.summary` changes only through the normal episode form save

**Other Worker Flow:**
1. `src/server.ts` starts launch notification, transcription, Spotify, YouTube, Telegram bot, and cover mosaic tasks
2. Workers poll SQLite and env-configured integrations
3. Results are persisted back into SQLite or filesystem outputs

**State Management:**
- Persistent application state: SQLite database in `data/database/`
- Persistent binary/media state: filesystem under configured media roots
- Process-local transient state: cached OAuth token and worker interval state
- Episode AI state: `episode.state.json` beside the media artifacts, with separate `transcript` and `aiSummary` child states

## Key Abstractions

**Episode Repository:**
- Purpose: central data access boundary for episodes and related metadata
- Examples: `findByEpisodeId`, `listPublished`, `queueLaunchNotification` in `src/database/repositories/episode.repository.ts`
- Pattern: repository module over synchronous SQLite access

**Service Modules:**
- Purpose: isolate domain workflows from route handlers
- Examples: `src/services/feed.service.ts`, `src/services/launch-notification.service.ts`, `src/services/youtube-metrics.service.ts`
- Pattern: function-based service modules with shared config imports

**Feature Flags via Config:**
- Purpose: make optional integrations runtime-configurable
- Examples: `config.spotify.enabled`, `config.youtube.enabled`, `config.transcription.enabled` in `src/config/env.ts`
- Pattern: centralized env-derived configuration object

## Entry Points

**HTTP Server:**
- Location: `src/server.ts`
- Triggers: `npm run dev`, `npm start`, direct Node execution
- Responsibilities: connect DB, run startup tasks, start Express listener

**Legacy Import Script:**
- Location: `src/scripts/import-legacy-episodes.ts`
- Triggers: `npm run import:episodes`
- Responsibilities: ingest historical episode JSON into SQLite

**Metrics Scripts/Workers:**
- Location: `src/scripts/spotify-metrics.py`, `src/workers/*.worker.ts`
- Triggers: scheduled startup workers and manual `npm run spotify:metrics`
- Responsibilities: collect and persist external analytics snapshots

## Error Handling

**Strategy:** Throw or bubble errors upward, catch at HTTP boundaries or startup boundaries.

**Patterns:**
- Routes mostly wrap logic in `try/catch` and call `next(error)`
- `ZodError` becomes `400 Validation failed`
- Missing auth config can become `500` from the shared error middleware
- Startup catches in `src/server.ts` terminate the process on fatal bootstrap failure

## Cross-Cutting Concerns

**Logging:**
- `morgan` for request logging
- `console.log`, `console.warn`, `console.error` for bootstrap and worker/service logs

**Validation:**
- Zod schemas at request boundaries, especially episode payloads

**Authentication:**
- JWT on protected routes
- Optional dev-only bypass for local workflows

---

*Architecture analysis: 2026-07-28*
*Update when major patterns change*
