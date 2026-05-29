# dragaocareca-admin-api

## Context First (AI / Agent)
Before making changes, read:
- `docs/SDD.md`

This is the canonical compressed context for architecture, auth toggles, feed rules, env vars, and runbook.

Node.js backend for Dragao Careca admin, with MongoDB episode storage and dynamic RSS feed generation.

## Setup

1. Copy `.env.example` to `.env` and set values.
2. Ensure MongoDB is running.
3. Install deps: `npm install`
4. Run dev server: `npm run dev`

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

## Legacy Import

Import old `all_episodes.json` into MongoDB:

```bash
npm run import:episodes -- "E:/path/to/all_episodes.json"
```

The importer supports both array and object JSON shapes and upserts by `episodeId`.
