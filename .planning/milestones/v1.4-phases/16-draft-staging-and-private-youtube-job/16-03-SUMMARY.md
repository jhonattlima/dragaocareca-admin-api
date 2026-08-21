---
phase: 16-draft-staging-and-private-youtube-job
plan: "03"
subsystem: api
tags: [youtube, oauth, sqlite, resumable-upload, worker, offline-verification]
requires:
  - phase: 16-draft-staging-and-private-youtube-job
    provides: source-fingerprinted SQLite job rows with revision and lease guards
provides:
  - private-first resumable YouTube provider contract with server-only OAuth readiness
  - durable source-fingerprinted transfer, retry, cancellation, reconciliation, and replacement obsoletion
  - one opt-in, non-overlapping startup worker with offline fake-provider verification
affects: [16-04, 16-06, youtube-trailer-jobs]
tech-stack:
  added: []
  patterns: [persist-before-provider-effect, Range-based resumable reconciliation, source-and-lease guarded writes, disabled-by-default external worker]
key-files:
  created:
    - src/services/youtube-trailer-upload.provider.ts
    - src/services/youtube-trailer-job.service.ts
    - src/workers/youtube-trailer-job.worker.ts
  modified:
    - src/config/env.ts
    - .env.example
    - src/database/repositories/youtube-trailer-job.repository.ts
    - src/services/episode-trailer-video.service.ts
    - src/server.ts
    - src/scripts/verify-youtube-trailer-job-lifecycle.ts
key-decisions:
  - "Keep private resumable sessions, provider IDs, OAuth tokens, and raw responses inside internal provider/service types."
  - "A local cancellation after any accepted bytes or provider video reports provider-video-retained, never a claimed remote rollback."
  - "Only enable the live worker with YOUTUBE_TRAILER_JOB_ENABLED=true after the Plan 16-06 human OAuth/channel checkpoint."
patterns-established:
  - "Persist a session URI before sending bytes, re-query Range after interruption, and reconcile an accepted provider video before any further upload action."
  - "Rehash canonical final media before provider-result writes and obsolete prior source rows before a replacement can accept late results."
requirements-completed: [TRAILER-02, TRAILER-03, TRAILER-09]
coverage:
  - id: D1
    description: "Private resumable uploads gate on server-only OAuth readiness and retain all session and credential data internally."
    requirement: TRAILER-02
    verification:
      - kind: integration
        ref: "npm run typecheck && npm run build && npm run verify:youtube-trailer-job-lifecycle -- --focus=worker"
        status: pass
    human_judgment: false
  - id: D2
    description: "A single durable worker resumes persisted sessions, polls private processing separately, backs off retryable failures, and rejects stale replacement writes."
    requirement: TRAILER-03
    verification:
      - kind: integration
        ref: "src/scripts/verify-youtube-trailer-job-lifecycle.ts#verifyRealWorkerFocus"
        status: pass
    human_judgment: false
  - id: D3
    description: "Trailer replacement obsoletes old source jobs, while cancellation honestly retains provider-accepted media for reconciliation."
    requirement: TRAILER-09
    verification:
      - kind: integration
        ref: "npm run verify:youtube-trailer-job-lifecycle -- --focus=worker"
        status: pass
    human_judgment: false
duration: 11min
completed: 2026-08-04
status: complete
---

# Phase 16 Plan 03: Private YouTube Job Worker Summary

**Private-first YouTube trailer jobs now persist resumable transfer evidence, recover safely through Range/provider reconciliation, and run only through an explicitly enabled single worker.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-04T22:25:05Z
- **Completed:** 2026-08-04T22:36:09Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments

- Added a narrow injectable provider that checks server-side OAuth upload scope, starts private resumable sessions, reconciles Range progress, streams bounded chunks, and polls processing without exposing secrets or raw provider data.
- Added source-fingerprinted orchestration that persists session/provider evidence before subsequent effects, retries safely, rechecks canonical media before updates, and distinguishes upload acceptance from private-ready processing.
- Added an opt-in non-overlapping worker, replacement-driven source obsoletion, and fake-provider coverage for recovery, cancellation, processing, and stale-write safety.

## Task Commits

1. **Task 1: Add a private resumable provider adapter and safe OAuth readiness configuration** - `3f71b3c` (test, RED), `008edab` (feat, GREEN)
2. **Task 2: Orchestrate durable transfer, recovery, cancellation, replacement, and startup work** - `815f04f` (test, RED), `00881a5` (feat, GREEN)

## Files Created/Modified

- `src/services/youtube-trailer-upload.provider.ts` - Private resumable protocol adapter and normalized safe errors.
- `src/services/youtube-trailer-job.service.ts` - Canonical-file fingerprinting, durable transfer/retry/reconciliation orchestration.
- `src/workers/youtube-trailer-job.worker.ts` - Unref'd, one-run-at-a-time startup and polling worker.
- `src/database/repositories/youtube-trailer-job.repository.ts` - Recovery claims and terminal ready transitions.
- `src/services/episode-trailer-video.service.ts` - Obsoletes prior-source jobs after a successful replacement.
- `src/config/env.ts` and `.env.example` - Disabled-by-default worker, conservative timeout/poll/retry/chunk defaults.
- `src/server.ts` - Starts the worker only when explicitly enabled and background workers are allowed.
- `src/scripts/verify-youtube-trailer-job-lifecycle.ts` - Real service/worker checks with a deterministic local fake provider.

## Decisions Made

- Reuse the existing YouTube OAuth credential family and validate `youtube.upload` through token information; no second credential scheme or package was added.
- Treat any accepted bytes as a reconciliation boundary: local cancellation can stop future work but cannot state that YouTube rolled it back.
- Keep live execution disabled by default; the Plan 16-06 approval remains required before enabling it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected terminal compare-and-set row lookup after clearing a lease**
- **Found during:** Task 2
- **Issue:** `recordError` and `markCancelled` cleared `worker_lease_id`, while the generic post-update lookup still required that lease, causing successful transitions to appear as failures.
- **Fix:** Made the post-CAS lookup rely on the guarded source identity and incremented revision, which remains stale-write safe after a lease is intentionally cleared.
- **Files modified:** `src/database/repositories/youtube-trailer-job.repository.ts`
- **Verification:** Focused repository and worker lifecycle verifiers pass.
- **Committed in:** `00881a5`

**2. [Rule 2 - Missing Critical] Added explicit recovery claims and ready transition persistence**
- **Found during:** Task 2
- **Issue:** The repository foundation lacked the guarded operations needed to reclaim interrupted nonterminal work and to persist the private-ready terminal state.
- **Fix:** Added recovery claim/requeue operations and a lease-guarded `markReady` transition.
- **Files modified:** `src/database/repositories/youtube-trailer-job.repository.ts`
- **Verification:** `npm run verify:youtube-trailer-job-lifecycle -- --focus=worker`
- **Committed in:** `00881a5`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical functionality)
**Impact on plan:** Both changes were necessary to make the planned durable recovery and cancellation semantics truthful; no public publishing, metadata, retention, browser OAuth, package, or live-provider scope was added.

## Known Stubs

None.

## Auth Gates

None. Verification uses only the injected fake provider and temporary SQLite/media fixtures. Live OAuth is intentionally deferred to the Plan 16-06 human checkpoint.

## TDD Gate Compliance

Both tasks completed the RED then GREEN sequence: `3f71b3c` → `008edab` and `815f04f` → `00881a5`.

## User Setup Required

Before an operator enables `YOUTUBE_TRAILER_JOB_ENABLED=true`, complete Plan 16-06's OAuth upload-scope/channel verification and confirm the conservative worker limits. No credential or live YouTube call is required for normal development verification.

## Next Phase Readiness

- Plan 16-04 can expose protected start/status/cancel routes using the durable service and sanitized status DTOs.
- Plan 16-06 owns the explicit human approval to enable the live worker.

## Self-Check: PASSED

- Verified the provider, service, worker, and summary files exist.
- Verified commits `3f71b3c`, `008edab`, `815f04f`, and `00881a5` exist in Git history.

---
*Phase: 16-draft-staging-and-private-youtube-job*
*Completed: 2026-08-04*
