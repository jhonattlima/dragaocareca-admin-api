# External Integrations

**Analysis Date:** 2026-07-28

## APIs & External Services

**Authentication:**
- Google Identity / OAuth - verifies frontend-supplied ID tokens in `src/auth/auth.service.ts`
  - Client: `google-auth-library`
  - Auth: `GOOGLE_CLIENT_ID`
  - Used by route flow in `src/routes/auth.routes.ts`

**Messaging:**
- Telegram Bot API - launch notification delivery
  - Client: custom HTTP integration in `src/services/telegram.service.ts`
  - Auth: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  - Queue/orchestration: `src/services/launch-notification.service.ts`

**Episode AI:**
- Gemini API - optional audio transcription and summary drafting
  - Transcription: temporary Files API upload followed by `gemini-3.6-flash` in `src/services/episode-transcription.service.ts`
  - Summary: structured JSON generation through `gemini-3.6-flash` in `src/services/episode-summary.service.ts`
  - Auth: `GEMINI_API_KEY`
  - Provider switches: `EPISODE_TRANSCRIPTION_PROVIDER`, `EPISODE_SUMMARY_PRIMARY_PROVIDER`, `EPISODE_SUMMARY_PROVIDER`, `YOUTUBE_HASHTAG_PRIMARY_PROVIDER`, `YOUTUBE_HASHTAG_PROVIDER`
  - Gemini is primary for summary/hashtag authoring and Groq is the automatic fallback; actual provider identity is persisted in episode state and returned in protected status DTOs.

**Analytics:**
- Spotify podcaster metrics endpoint
  - Bridge: `src/services/spotify-metrics.service.ts`
  - Implementation detail: spawns `python3 src/scripts/spotify-metrics.py`
  - Credentials: `SPOTIFY_PODCAST_ID`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_SP_DC`, `SPOTIFY_SP_KEY`
- YouTube Analytics + YouTube Data API
  - Client flow: `src/services/youtube-metrics.service.ts`
  - Auth: OAuth refresh token via `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`

## Data Storage

**Databases:**
- SQLite - primary application store
  - Connection/bootstrap: `src/database/connect.ts`
  - Schema: `src/database/sqlite.ts`
  - Repository access: `src/database/repositories/episode.repository.ts`

**File Storage:**
- Local filesystem under `data/` and configured media roots
  - Public/static media exposed by `app.use("/media", express.static(...))` in `src/app.ts`
  - Generated assets include `data/generated/cover-mosaic.svg`

**Caching:**
- No dedicated cache layer detected
- Some service-level token caching exists in `src/services/youtube-metrics.service.ts`

## Authentication & Identity

**Auth Provider:**
- Google Sign-In token exchange followed by backend JWT issuance
  - Verification: `authenticateGoogleIdToken(...)` in `src/auth/auth.service.ts`
  - Session format: signed JWT via `signAccessToken(...)`
  - Enforcement: `requireAuth` middleware in `src/middleware/auth.middleware.ts`

**Development Bypass:**
- Local bypass path controlled by `AUTH_BYPASS=true` and `NODE_ENV=development`
- Injects `req.user = { email: "dev-bypass@local" }` instead of verifying a token

## Monitoring & Observability

**Logs:**
- Console/stdout logging only
  - Request logs: `morgan("dev")` in `src/app.ts`
  - Startup/error logs: `src/server.ts`
  - Worker/service warnings via `console.warn(...)`

**Error Tracking:**
- No external error tracker such as Sentry or Datadog detected

## CI/CD & Deployment

**Hosting:**
- VPS-style deployment documented in `.planning/codebase/OPERATIONS.md`, with `requirements-vps.txt` and `scripts/*.sh`
- Production runs compiled Node output from `dist/`

**CI Pipeline:**
- No GitHub Actions or other CI config detected in the repo root

## Environment Configuration

**Development:**
- Main local files: `.env.dev` and `.env.example`
- SQLite defaults to `data/database/dragaocareca-admin.sqlite`
- Auth bypass is supported for local iteration

**Production:**
- Main env file: `.env.production`
- Secrets are env-var based, not stored in committed config files

## Webhooks & Callbacks

**Incoming:**
- No inbound webhook endpoints detected

**Outgoing:**
- Telegram bot message delivery triggered by episode launch state transitions
- Spotify and YouTube polling workers pull data on intervals from external services

---

*Integration audit: 2026-07-28*
*Update when adding/removing external services*
