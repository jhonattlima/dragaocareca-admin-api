# dragaocareca-admin-api

## Context First (AI / Agent)
Before making changes, read:
- `docs/SDD.md`

This is the canonical compressed context for architecture, auth toggles, feed rules, env vars, and runbook.

Node.js backend for Dragao Careca admin, with SQLite episode storage, dynamic RSS feed generation, and shared media/reference assets.

Workspace layout:
- `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api`
- `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-web`

Telegram launch notifications:
- queueing/deduping happens in the backend episode lifecycle
- delivery uses `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- the worker polls pending launches on startup and every `TELEGRAM_POLL_INTERVAL_MS`

Spotify metrics:
- authenticated snapshot endpoint: `GET /v1/metrics/spotify`
- connector is enabled with `SPOTIFY_METRICS_ENABLED=true`
- credentials come from the `SPOTIFY_*` env vars in `.env.example`

YouTube metrics:
- authenticated snapshot endpoint: `GET /v1/metrics/youtube`
- connector is enabled with `YOUTUBE_METRICS_ENABLED=true`
- uses YouTube Analytics OAuth credentials from the `YOUTUBE_*` env vars in `.env.example`
- the worker stores one completed-day sample per day in SQLite so the dashboard can compare 7/30/90-day windows instantly

## Setup

1. Copy `.env.example` to `.env.dev` for local development, or `.env.production` for production deployment, and set values.
2. SQLite is created automatically on startup under `data/database/`.
3. Install deps: `npm install`
4. Run dev server: `npm run dev`

## Production Checklist

- `NODE_ENV=production`
- `AUTH_BYPASS=false`
- `GOOGLE_CLIENT_ID` and `JWT_SECRET` set
- `ALLOWED_GOOGLE_EMAILS` populated if you want to restrict login
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_POLL_INTERVAL_MS>0` set for launch notifications

## Google Authentication

Required env vars:
- `GOOGLE_CLIENT_ID`: OAuth client id used by Google Identity Services in frontend.
- `JWT_SECRET`: secret used to sign backend access tokens.
- `JWT_EXPIRES_IN`: optional, default `12h`.
- `ALLOWED_GOOGLE_EMAILS`: optional comma-separated allowlist; if empty, any verified Google email is accepted.

Login flow:
1. Frontend gets Google ID token (`credential`) from Google Sign-In.
2. Frontend sends `POST /v1/auth/google` with `{ "idToken": "..." }`.
3. Backend verifies token with Google, checks allowlist, returns `{ accessToken, user }`.
4. Frontend sends `Authorization: Bearer <accessToken>` on protected routes.

## Endpoints

Public:
- `GET /health`
- `GET /v1/feed` (dynamic: only episodes with `pubDate <= now`)

Authenticated:
- `POST /v1/auth/google`
- `GET /v1/auth/me`
- `GET /v1/episodes`
- `GET /v1/episodes/:episodeId`
- `POST /v1/episodes`
- `PUT /v1/episodes/:episodeId`
- `GET /v1/feed/preview` (includes future episodes)
- `GET /v1/feed/status`
- `GET /v1/assets/cover-mosaic.json`
- `GET /v1/assets/cover-mosaic.svg`

## Legacy Import

Import old `all_episodes.json` into SQLite:

```bash
npm run import:episodes -- "/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api/data/all_episodes.json"
```

The importer supports both array and object JSON shapes and upserts by `episodeId`.

## Shared Data Folders

- `data/database/`: SQLite database files and WAL sidecars
- `data/feed/`: feed comparison snapshots and reference XML exports
- `data/generated/`: derived assets such as the cover mosaic SVG

## Telegram Bot

Required env vars:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_API_BASE_URL` (optional, defaults to `https://api.telegram.org`)
- `TELEGRAM_POLL_INTERVAL_MS` (optional, defaults to `60000`; set `0` to disable the worker)

Notes:
- keep launch notifications backend-side only
- do not move feed or scheduling rules into the frontend

## Spotify Metrics

Use the authenticated `GET /v1/metrics/spotify` route to fetch a live snapshot from Spotify creator analytics.
Pass `?days=90`, `?days=30`, or `?days=7` to switch the lookback window.

Required env vars:
- `SPOTIFY_METRICS_ENABLED`
- `SPOTIFY_PODCAST_ID`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_SP_DC`
- `SPOTIFY_SP_KEY`

Optional env vars:
- `SPOTIFY_METRICS_BASE_URL`
- `SPOTIFY_METRICS_TIMEOUT_MS`

If the connector is disabled or credentials are missing, the route returns a structured error snapshot instead of failing the request.

## YouTube Metrics

Use the authenticated `GET /v1/metrics/youtube` route to fetch a live snapshot from YouTube Studio analytics.
Pass `?days=90`, `?days=30`, or `?days=7` to control the current comparison window; the response includes a longer history so the frontend can switch ranges without another backend call.

Required env vars:
- `YOUTUBE_METRICS_ENABLED`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

Optional env vars:
- `YOUTUBE_CHANNEL_ID`
- `YOUTUBE_ANALYTICS_BASE_URL`
- `YOUTUBE_DATA_BASE_URL`
- `YOUTUBE_METRICS_TIME_ZONE`
- `YOUTUBE_METRICS_TIMEOUT_MS`
- `YOUTUBE_METRICS_SAMPLE_INTERVAL_MS`

Suggested metrics in the dashboard:
- views
- estimated watch time
- net subscribers
- average view duration
- likes
- comments
- shares

If the connector is disabled or credentials are missing, the route returns a structured error snapshot instead of failing the request.
