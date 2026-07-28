# SDD - Dragao Careca Admin Platform

## 1. Purpose
This document captures the **minimum high-value project context** for AI-assisted development with low token usage.

Scope:
- Backend: `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api`
- Frontend: `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-web`

## 2. System Overview
The old client-heavy Angular + PHP flow was replaced by:
- Node.js API + SQLite as source of truth
- New Angular admin UI consuming API endpoints

Core rule:
- Feed is generated dynamically by backend from SQLite episodes and release-time rules (`pubDate`).

## 3. Architecture
### 3.1 Backend (`dragaocareca-admin-api`)
Stack:
- Node.js + TypeScript + Express
- SQLite
- Zod validation
- Swagger (`/docs`)

Main modules:
- `src/config/env.ts`: runtime configuration and feature flags
- `src/database/repositories/episode.repository.ts`: episode persistence
- `src/routes/*.routes.ts`: auth/feed/episode routes
- `src/services/feed.service.ts`: RSS feed generation
- `src/services/episode-summary.service.ts`: transcript-only Gemini/Llama summary drafting, shared draft-state updates, and summary runtime verification
- `src/services/episode-transcription.service.ts`: sequential Gemini/internal transcription and summary handoff
- `src/services/launch-notification.service.ts`: launch queue and Telegram delivery workflow
- `src/services/telegram.service.ts`: Telegram Bot API sender
- `src/middleware/auth.middleware.ts`: JWT auth + dev bypass
- `src/scripts/import-legacy-episodes.ts`: legacy data import
- `src/workers/launch-notification.worker.ts`: startup poller for pending launch notifications

### 3.2 Frontend (`dragaocareca-admin-web`)
Stack:
- Angular 15
- Bootstrap styling

Main modules:
- `src/environments/*`: API URL + auth toggle
- `src/app/core/auth.service.ts`: auth + bypass logic
- `src/app/core/auth.guard.ts`: route guard
- `src/app/core/auth.interceptor.ts`: Bearer token injection
- `src/app/core/api.service.ts`: endpoint client
- `src/app/pages/login/*`: Google login page
- `src/app/pages/dashboard/*`: episode management + status view

## 4. Authentication Model
### 4.1 Production
- Google ID token is exchanged via `POST /v1/auth/google`
- Backend returns JWT
- Frontend stores JWT and sends `Authorization: Bearer <token>`

### 4.2 Local Development Bypass
Backend flag:
- `.env.dev`: `AUTH_BYPASS=true` with `NODE_ENV=development`

Frontend flag:
- `environment.ts`: `authBypass: true`

When both are enabled:
- User can access protected flows without Google login

## 5. Feed Rules
- Public endpoint: `GET /v1/feed`
- Includes episodes with `pubDate <= now`
- Feed channel metadata mostly static via env vars (`FEED_*`)
- Item-level XML can be sourced from legacy `xmlSnapshot` when present
- Staging logic is internal (no external staging-promotion endpoint)
- Reference feed snapshots are kept under `data/feed/` for comparison and debugging

## 6. Data Model (Episode)
Table: `episodes`
Key fields:
- `episodeId` (unique)
- `title`, `summary`, `pubDate`, `explicit`
- `duration`, `bytes`
- `fileName`, `coverFileName`
- `authors`, `guests`, `tags`, `citations`
- `musicCredits`, `coverCredits`
- `xmlSnapshot` (legacy item XML)

## 7. API Surface (Current)
Public:
- `GET /health`
- `GET /v1/feed`

Auth:
- `POST /v1/auth/google`
- `GET /v1/auth/me`

Episodes (protected unless backend bypass):
- `GET /v1/episodes`
- `GET /v1/episodes/:episodeId`
- `POST /v1/episodes`
- `PUT /v1/episodes/:episodeId`
- `GET /v1/episodes/:episodeId/episodes-generated-summary`

Feed admin (protected unless backend bypass):
- `GET /v1/feed/preview`
- `GET /v1/feed/status`
- `GET /v1/metrics/spotify`
- `GET /v1/metrics/youtube`

Episode media upload (protected unless backend bypass):
- `POST /v1/episodes/:episodeId/audio`
- `POST /v1/episodes/:episodeId/trailer`
- `POST /v1/episodes/:episodeId/cover`
- `POST /v1/episodes/:episodeId/cover-webp`
- `DELETE /v1/episodes/:episodeId/audio`
- `DELETE /v1/episodes/:episodeId/trailer`
- `DELETE /v1/episodes/:episodeId/cover`
- `DELETE /v1/episodes/:episodeId/cover-webp`

Media storage defaults:
- episodes: `data/media/episodes`
- staging: `data/media/staging`
- episode backups: `data/media/backups`
- SQLite database files: `data/database/`

Upload flow:
- uploads land in episode-scoped staging folders first
- save/update promotes staged files into `data/media/episodes/<episodeId>/`
- delete moves staged or promoted files into the episode backup folder

Docs:
- `GET /docs`
- `GET /docs.json`
- `GET /v1/assets/cover-mosaic.json`
- `GET /v1/assets/cover-mosaic.svg`

## 8. Critical Environment Variables
### 8.1 Backend `.env.dev` / `.env.production`
- `NODE_ENV`
- `PORT`
- `SQLITE_PATH`
- `SQLITE_RESET`
- `GOOGLE_CLIENT_ID`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `ALLOWED_GOOGLE_EMAILS`
- `AUTH_BYPASS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_POLL_INTERVAL_MS`
- `TELEGRAM_YTDLP_COMMAND`
- `MEDIA_STORAGE_ROOT`
- `MEDIA_EPISODES_DIR`
- `MEDIA_EPISODES_STAGING_DIR`
- `MEDIA_TRAILERS_DIR`
- `MEDIA_TRAILERS_STAGING_DIR`
- `MEDIA_COVERS_DIR`
- `MEDIA_COVERS_STAGING_DIR`
- `MEDIA_COVERS_LOW_DIR`
- `MEDIA_COVERS_LOW_STAGING_DIR`
- `FEED_*` static feed metadata vars

### 8.2 Frontend environment
- `apiBaseUrl`
- `googleClientId`
- `authBypass`

### 8.3 Spotify Metrics Connector
- `SPOTIFY_METRICS_ENABLED`
- `SPOTIFY_PODCAST_ID`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_SP_DC`
- `SPOTIFY_SP_KEY`
- `SPOTIFY_METRICS_BASE_URL`
- `SPOTIFY_METRICS_TIMEOUT_MS`

### 8.4 YouTube Metrics Connector
- `YOUTUBE_METRICS_ENABLED`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
- `YOUTUBE_CHANNEL_ID`
- `YOUTUBE_ANALYTICS_BASE_URL`
- `YOUTUBE_DATA_BASE_URL`
- `YOUTUBE_METRICS_TIME_ZONE`
- `YOUTUBE_METRICS_TIMEOUT_MS`
- `YOUTUBE_METRICS_SAMPLE_INTERVAL_MS`

### 8.5 Episode Transcription
- `EPISODE_TRANSCRIPTION_ENABLED`
- `EPISODE_TRANSCRIPTION_PROVIDER` (`internal` or `gemini`)
- `EPISODE_TRANSCRIPTION_COMMAND`
- `EPISODE_TRANSCRIPTION_MODEL_PATH`
- `EPISODE_TRANSCRIPTION_LANGUAGE`
- `EPISODE_TRANSCRIPTION_TIMEOUT_MS`
- `EPISODE_TRANSCRIPTION_POLL_INTERVAL_MS`
- `EPISODE_TRANSCRIPTION_GEMINI_MODEL`
- `EPISODE_TRANSCRIPTION_GEMINI_MAX_OUTPUT_TOKENS`
- `EPISODE_TRANSCRIPTION_GEMINI_THINKING_LEVEL`

### 8.6 Episode Summary Drafting
- `EPISODE_SUMMARY_ENABLED`
- `EPISODE_SUMMARY_PROVIDER` (`llama` or `gemini`)
- `EPISODE_SUMMARY_COMMAND`
- `EPISODE_SUMMARY_MODEL_PATH`
- `EPISODE_SUMMARY_CONTEXT_SIZE`
- `EPISODE_SUMMARY_MAX_TOKENS`
- `EPISODE_SUMMARY_TIMEOUT_MS`
- `EPISODE_SUMMARY_PROMPT_VERSION`
- `GEMINI_API_KEY`
- `EPISODE_SUMMARY_GEMINI_MODEL`
- `GEMINI_API_BASE_URL`
- `EPISODE_SUMMARY_GEMINI_THINKING_LEVEL`

### 8.7 Episode AI Workflow
- Uploading audio queues transcription. The selected provider is `EPISODE_TRANSCRIPTION_PROVIDER` (`gemini` or `internal`).
- A completed transcript is written to `transcript.txt`; `episode.state.json` records the transcript state and automatically queues summary generation.
- The selected summary provider is `EPISODE_SUMMARY_PROVIDER` (`gemini` or `llama`). Both providers run sequentially after transcription, suitable for the 4 GB VPS constraint.
- The generated `summary.txt` is a suggestion only. It is exposed through `GET /v1/episodes/:episodeId/episodes-generated-summary` and never overwrites the final SQLite `episodes.summary` value.
- Prompt version `4` uses the production feed's editorial structure as a static style reference while keeping the current transcript as the sole source of facts.

## 9. Local Runbook
### 9.1 Backend
```powershell
cd E:\Jhonatt\Development\Projects\node\dragaocareca-admin-api
npm install
npm run dev
```
Swagger: `http://localhost:3000/docs`

### 9.2 Frontend
```powershell
cd E:\Jhonatt\Development\Projects\angular\dragaocareca-admin-web
npm install
npm start
```
UI: `http://localhost:4200/`

## 10. Legacy Import
Use when local DB needs full historical episodes:
```powershell
cd E:\Jhonatt\Development\Projects\node\dragaocareca-admin-api
npm run import:episodes -- "E:/Jhonatt/Development/Projects/node/dragaocareca-admin-api/data/all_episodes.json"
```

## 11. Known Constraints / Current Gaps
- Feed parity with production feed is close but not byte-identical.
- Some episode item formatting depends on legacy `xmlSnapshot` quality.
- Frontend layout has been modernized with old-project section structure, but not all legacy subfeatures are reintroduced yet.
- Spotify metrics are exposed through an authenticated backend snapshot endpoint, not directly from the frontend.
- YouTube metrics use authenticated YouTube Analytics access plus daily SQLite sampling for range comparisons.
- Episode transcription and summary generation are backend-owned, sequential jobs. Gemini avoids local model memory for the configured remote steps, but requires outbound access and a configured API key.

## 12. Documentation Layout
- Master feature registry lives at `docs/FEATURES.md`
- Feature-specific durable docs live under `docs/features/<NNN-feature-name>/README.md`
- Feature-specific implementation plans live under `docs/features/<NNN-feature-name>/PLAN.md`
- Current feature reference:
  - `docs/features/002-episode-media-layout-refactor/README.md`
  - `docs/features/003-episode-transcription/README.md`
  - `docs/features/004-episode-summary-suggestion/README.md`

## 13. AI Prompt Starter (Low Token)
Use this block in future sessions:

```text
Project: Dragao Careca Admin Platform
Backend: /home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api
Frontend: /home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-web
Read docs/SDD.md first.
Respect env toggles: backend AUTH_BYPASS, frontend authBypass.
Do not reintroduce client-side feed generation.
Prefer backend-first logic changes and keep frontend as API client.
Telegram launch notifications live inside the backend service.
```

## 14. Episode AI Track Reference

Current implementation and follow-up work for the episode media layout, transcription, and summary tracks is documented in:

- `docs/features/002-episode-media-layout-refactor/PLAN.md`
- `docs/features/003-episode-transcription/PLAN.md`
- `docs/features/004-episode-summary-suggestion/PLAN.md`

Use those files as the implementation references for the next feature set.

## 15. VPS Runtime Dependencies

Install these on the VPS before enabling the full stack:

- Node.js 18+ and npm
- `ffmpeg`
- `python3`
- Python package `spotifyconnector` for the Spotify metrics script
- either Gemini transcription (`EPISODE_TRANSCRIPTION_PROVIDER=gemini` with `GEMINI_API_KEY`) or `whisper.cpp`/a compatible binary exposed through `EPISODE_TRANSCRIPTION_COMMAND`
- a Whisper model file such as `ggml-small.bin` for `EPISODE_TRANSCRIPTION_MODEL_PATH` only when `EPISODE_TRANSCRIPTION_PROVIDER=internal`
- either a Gemini API key (`GEMINI_API_KEY`) with `EPISODE_SUMMARY_PROVIDER=gemini`, or a local summary runtime command exposed through `EPISODE_SUMMARY_COMMAND`
- a local model file for summary drafting only when `EPISODE_SUMMARY_PROVIDER=llama`, exposed through `EPISODE_SUMMARY_MODEL_PATH`
- a writable filesystem location for `data/database/`, `data/media/`, and `data/generated/`
- enough memory headroom to run transcription and summary jobs sequentially on a 4 GB VPS

Optional but recommended for production:

- a process manager such as systemd, PM2, or Docker
- a dedicated virtual environment for Python dependencies

Summary workers are transcript-driven and should stay sequential on the target VPS. The summary job runs after the transcript is ready, reads `transcript.txt`, and writes the draft `summary.txt` plus the shared `episode.state.json` metadata. Do not plan parallel transcription and summary execution on the same 4 GB host. With the Gemini provider, summary generation is remote and does not load the VPS CPU or RAM beyond the HTTP request.

Bootstrap references:

- [`docs/VPS-SETUP.md`](./VPS-SETUP.md)
- [`scripts/install-vps-deps.sh`](../scripts/install-vps-deps.sh)
- [`requirements-vps.txt`](../requirements-vps.txt)
