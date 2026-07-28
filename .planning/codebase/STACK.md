# Technology Stack

**Analysis Date:** 2026-07-28

## Languages

**Primary:**
- TypeScript 6.x - all backend application code under `src/`

**Secondary:**
- JavaScript - compiled runtime output in `dist/`
- Python - Spotify metrics helper script in `src/scripts/spotify-metrics.py`
- SQL - SQLite schema and views embedded in `src/database/sqlite.ts`
- Shell - VPS bootstrap scripts in `scripts/bootstrap-vps.sh` and `scripts/install-vps-deps.sh`

## Runtime

**Environment:**
- Node.js runtime - API server started from `src/server.ts` or `dist/server.js`
- SQLite via Node built-in `node:sqlite` - local persistent store configured by `src/config/env.ts`
- Python 3 - required by `src/services/spotify-metrics.service.ts` to execute `src/scripts/spotify-metrics.py`

**Package Manager:**
- npm - project scripts and dependency management via `package.json`
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express 5.2 - HTTP server, middleware, routing in `src/app.ts` and `src/routes/*.routes.ts`
- Zod 4.4 - request and payload validation via `src/schemas/episode.ts`
- Swagger (`swagger-jsdoc` + `swagger-ui-express`) - API docs served from `src/docs/openapi.ts` and `/docs`

**Testing:**
- No real test framework configured
- `npm test` is still the placeholder script from `package.json`

**Build/Dev:**
- TypeScript 6.0 - compilation via `tsc -p tsconfig.json`
- `tsx` 4.22 - local dev runtime via `npm run dev`
- `dotenv` 17.4 - environment loading in `src/config/env.ts`

## Key Dependencies

**Critical:**
- `express` 5.2.1 - API routing and middleware pipeline
- `jsonwebtoken` 9.0.3 - backend-issued JWT auth in `src/auth/auth.service.ts`
- `google-auth-library` 10.6.2 - Google ID token verification and YouTube OAuth access
- `xmlbuilder2` 4.0.3 - RSS feed generation in `src/services/feed.service.ts`
- `zod` 4.4.3 - episode schema validation at the HTTP boundary

**Infrastructure:**
- `helmet`, `cors`, `morgan` - HTTP hardening and request logging in `src/app.ts`
- `multer` - media upload handling in `src/routes/episodes.routes.ts`

## Configuration

**Environment:**
- `.env.dev`, `.env.production`, `.env.example` drive runtime configuration
- `src/config/env.ts` centralizes feature flags, feed metadata, media paths, auth, Telegram, Spotify, YouTube, transcription, and summary settings
- Feed settings are hard-required at startup through `required(...)` in `src/config/env.ts`

**Build:**
- `tsconfig.json` controls compilation
- `package.json` defines `dev`, `build`, `start`, `typecheck`, import, and metrics scripts

## Platform Requirements

**Development:**
- Cross-platform Node.js environment
- Local writable filesystem for `data/database/`, `data/feed/`, `data/generated/`, and media folders
- Python 3 available if Spotify metrics are enabled

**Production:**
- Long-running Node.js host or VPS
- Writable SQLite and media storage paths
- Env-var based secret/config injection for Google auth, JWT, Telegram, Spotify, YouTube, Gemini, feed metadata, transcription, and summary generation
- Episode AI providers: Gemini Files API / `gemini-3.6-flash` or local Whisper/Llama fallbacks; jobs are sequential for the 4 GB VPS target

---

*Stack analysis: 2026-07-28*
*Update after major dependency changes*
