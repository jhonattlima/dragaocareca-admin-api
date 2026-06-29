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
- episodes staging: `data/media/episodes/staging`
- trailers: `data/media/trailers`
- trailers staging: `data/media/trailers/staging`
- covers: `data/media/images`
- covers staging: `data/media/images/staging`
- cover low: `data/media/images/low`
- cover low staging: `data/media/images/low/staging`
- SQLite database files: `data/database/`

Upload flow:
- uploads land in staging folders first
- save/update promotes staged files into the hot folders
- delete removes staged or promoted files for the current episode ID

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

## 12. AI Prompt Starter (Low Token)
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
