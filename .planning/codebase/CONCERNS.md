# Codebase Concerns

**Analysis Date:** 2026-07-21

## Tech Debt

**Missing automated tests:**
- Issue: the backend has no implemented unit, integration, or E2E suite
- Why: validation currently relies on manual checks plus `npm run typecheck` / `npm run build`
- Impact: regressions in feed generation, uploads, workers, and auth can ship unnoticed
- Fix approach: introduce a test runner, start with repository/service tests, then add route-level integration coverage

**Mixed operational state and source-controlled artifacts under `data/`:**
- Issue: runtime DB/media-adjacent files and reference fixtures live in the same top-level area
- Why: local convenience and historical evolution of the project
- Impact: easy to couple code changes with mutable local state, harder to reason about what should be committed
- Fix approach: separate committed fixtures from runtime-only state more explicitly and tighten `.gitignore`

## Known Bugs

**Feed parity is intentionally imperfect:**
- Symptoms: generated feed is close to production but not guaranteed byte-identical
- Trigger: any comparison against legacy/reference XML
- Workaround: reuse `xmlSnapshot` when available; compare outputs using files under `data/feed/`
- Root cause: part of the item formatting still depends on legacy snapshot quality and rebuilt XML mapping

**Feature planning files were deleted locally while new feature work exists:**
- Symptoms: repo status already shows deleted `.planning/*.md` and older `features/*.md` plus newer docs/features work
- Trigger: running planning/onboarding workflows on the current working tree
- Workaround: keep new codebase-map work isolated to `.planning/codebase/`
- Root cause: planning artifacts in this repo are already in a transitional state

## Security Considerations

**Development auth bypass can disable protection entirely:**
- Risk: protected routes become open if `AUTH_BYPASS=true` is left enabled in a development-like environment
- Current mitigation: bypass is gated by both `NODE_ENV === "development"` and `AUTH_BYPASS`
- Recommendations: add stronger environment assertions and deployment-time checks to prevent accidental non-local use

**Sensitive integrations are env-driven without a secret manager abstraction:**
- Risk: Google, Telegram, Spotify, and YouTube credentials are all process env vars
- Current mitigation: values are not hardcoded in source
- Recommendations: standardize secret provisioning, reduce accidental local leakage, and avoid documenting concrete secrets in checked-in env files

## Performance Bottlenecks

**Synchronous SQLite access on the request path:**
- Problem: the app uses `DatabaseSync` from `node:sqlite`
- Measurement: no benchmark present
- Cause: repository calls are synchronous and execute inside the Node server process
- Improvement path: profile hot endpoints; if throughput becomes an issue, batch queries, reduce per-request work, or move to an async DB/client architecture

**Startup process bundles many side effects into one process boot:**
- Problem: DB connect, media migration, cover generation, transcription worker, launch worker, Spotify worker, YouTube worker, and Telegram bot all start from `src/server.ts`
- Measurement: no startup timing recorded
- Cause: monolithic bootstrap design
- Improvement path: make startup tasks independently controllable and observable; consider splitting optional workers

## Fragile Areas

**`src/routes/episodes.routes.ts`:**
- Why fragile: it mixes upload validation, file moves, staging/final media logic, repository updates, and transcription queueing
- Common failures: cross-device move issues, stale staged files, upload/type mismatches, partial updates
- Safe modification: change one upload kind or workflow at a time and verify with real staged media files
- Test coverage: none detected

**`src/services/feed.service.ts`:**
- Why fragile: it combines rebuilt XML generation with legacy `xmlSnapshot` import fallback
- Common failures: malformed legacy XML, title sanitization regressions, metadata drift
- Safe modification: compare generated output against `data/feed/reference-feed.xml` and local snapshots
- Test coverage: none detected

## Scaling Limits

**Single-process backend:**
- Current capacity: not measured
- Limit: HTTP traffic, worker polling, DB access, and asset generation all compete in one Node process
- Symptoms at limit: slower responses, worker lag, startup slowdown, SQLite contention
- Scaling path: separate workers, isolate heavy jobs, or move persistence to a more concurrent store

## Dependencies at Risk

**Python dependency for Spotify metrics:**
- Risk: feature depends on `python3` plus a separate script path outside the main TS runtime
- Impact: Spotify metrics can fail even when the Node app itself is healthy
- Migration plan: either package/validate the Python dependency explicitly or port the integration fully to TypeScript

## Missing Critical Features

**Automated verification around integrations and feed correctness:**
- Problem: the most business-critical and externally visible paths still lack executable regression checks
- Current workaround: manual smoke testing and snapshot/reference files
- Blocks: safer refactoring of feed, auth, metrics, uploads, and workers
- Implementation complexity: medium

## Test Coverage Gaps

**Auth and middleware path:**
- What's not tested: Google token exchange, JWT verification, dev bypass interactions
- Risk: route protection regressions or config mistakes
- Priority: High
- Difficulty to test: Medium because env and token verification seams need stubbing

**Media upload and transcription queue path:**
- What's not tested: multipart upload, file promotion, draft transcription queueing
- Risk: broken episode asset workflows or inconsistent DB/media state
- Priority: High
- Difficulty to test: High because it spans filesystem + DB + async orchestration

---

*Concerns audit: 2026-07-21*
*Update as issues are fixed or new ones discovered*
