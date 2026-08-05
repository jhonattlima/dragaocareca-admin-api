---
phase: 16-draft-staging-and-private-youtube-job
plan: "04"
subsystem: api
tags: [express, zod, openapi, youtube, sqlite, fake-provider, offline-verification]
requires:
  - phase: 16-draft-staging-and-private-youtube-job
    provides: durable private-first YouTube job service, worker, and fake-provider seam
provides:
  - protected no-store start, status, and cancellation contract for private trailer jobs
  - allowlisted safe job DTOs and matching OpenAPI schema
  - full offline fake-provider route, worker, recovery, and draft-lifecycle verification
affects: [16-06, youtube-trailer-jobs, trailer-video-api]
tech-stack:
  added: []
  patterns: [service-level safe DTO allowlist, direct protected-router verification, fake-provider worker lifecycle verification]
key-files:
  created: []
  modified:
    - src/routes/episodes.routes.ts
    - src/services/youtube-trailer-job.service.ts
    - src/docs/openapi.ts
    - src/scripts/verify-youtube-trailer-job-lifecycle.ts
    - src/scripts/verify-trailer-video-upload-lifecycle.ts
    - package.json
key-decisions:
  - "Expose only safe lifecycle, progress, cancellation, retry, and normalized error-category fields through a service DTO allowlist."
  - "Keep private-job route operations limited to start, status, and cancellation; public publication, metadata, URLs, and retention remain deferred."
  - "Run the compiled lifecycle verifier with DISABLE_BACKGROUND_WORKERS=true and temporary fake-provider fixtures only."
patterns-established:
  - "Apply Cache-Control: no-store before authentication on protected lifecycle routes."
  - "Use direct Express router-stack invocation plus an injected fake provider to prove protected contracts without an HTTP listener or live provider."
requirements-completed: [TRAILER-02, TRAILER-03, TRAILER-09]
coverage:
  - id: D1
    description: "Authenticated operators can start, poll, and request cancellation for a private trailer job through no-store, strict protected routes."
    requirement: TRAILER-02
    verification:
      - kind: integration
        ref: "npm run verify:youtube-trailer-job-lifecycle"
        status: pass
    human_judgment: false
  - id: D2
    description: "Route and OpenAPI snapshots omit provider sessions, credentials, provider IDs, raw errors, source evidence, lease data, and filesystem paths."
    requirement: TRAILER-03
    verification:
      - kind: integration
        ref: "src/scripts/verify-youtube-trailer-job-lifecycle.ts#verifyProtectedRouteAndOpenApiFocus"
        status: pass
    human_judgment: false
  - id: D3
    description: "Offline fake-provider lifecycle proves resume, private processing, cancellation boundaries, retryable OAuth readiness rejection, replacement stale-write rejection, and non-overlapping startup."
    requirement: TRAILER-09
    verification:
      - kind: integration
        ref: "src/scripts/verify-youtube-trailer-job-lifecycle.ts#verifyRealWorkerFocus"
        status: pass
    human_judgment: false
duration: 5min
completed: 2026-08-05
status: complete
---

# Phase 16 Plan 04: Protected Private YouTube Job Contract Summary

**Protected private trailer-job routes now return an allowlisted durable lifecycle DTO, with full fake-provider route/worker verification and no live YouTube access.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-05T21:51:23Z
- **Completed:** 2026-08-05T21:53:47Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Added authenticated, strict, no-store start/status/cancel routes for episode-scoped private YouTube trailer jobs.
- Added a service DTO allowlist and OpenAPI contract that expose safe lifecycle/progress/cancellation/retry fields only.
- Expanded compiled temporary-fixture verification through the real service, worker startup/stop seam, protected router stack, and OpenAPI schema without an HTTP listener, OAuth credential, or network call.
- Preserved every draft reservation/promotion compensation scenario while updating its boundary assertion for the new private-job routes.

## Task Commits

1. **Task 1: Add protected private-job start, status, and cancel contracts** - `b11d71c` (feat)
2. **Task 2: Build the fake-provider lifecycle verifier and close draft lifecycle coverage** - `17f5172` (test)

## Files Created/Modified

- `src/routes/episodes.routes.ts` - Private-job route boundary with auth, strict validation, and no-store headers.
- `src/services/youtube-trailer-job.service.ts` - Safe public DTO mapper that excludes internal persistence/provider data.
- `src/docs/openapi.ts` - Protected private-first lifecycle schema and endpoint documentation.
- `src/scripts/verify-youtube-trailer-job-lifecycle.ts` - Offline direct-router and fake-provider lifecycle assertions.
- `src/scripts/verify-trailer-video-upload-lifecycle.ts` - Retained draft compensation verification with private-job-only integration assertion.
- `package.json` - Lifecycle verifier command now disables unrelated background workers explicitly.

## Decisions Made

- Provider IDs, resumable session URIs, OAuth/session data, raw provider errors, source hashes/paths, and worker leases remain internal; route responses use a dedicated allowlist mapper.
- Cancellation returns the durable requested state and later reports the honest provider-video-retained boundary rather than claiming remote rollback.
- Public publishing, metadata/hashtags, persisted URL, and retention remain outside this plan's route and OpenAPI scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the promised service-side safe DTO mapper**
- **Found during:** Task 1
- **Issue:** Plan 16-03 exposed internal repository rows but did not provide the service DTO mapper required to prevent route exposure of provider/session/source data.
- **Fix:** Added an explicit allowlist mapper with only safe lifecycle, progress, cancellation, retry, and normalized error-category fields.
- **Files modified:** `src/services/youtube-trailer-job.service.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:youtube-trailer-job-lifecycle`
- **Committed in:** `b11d71c`

**2. [Rule 1 - Bug] Updated the existing draft verifier's stale no-YouTube assertion**
- **Found during:** Task 2
- **Issue:** The Plan 16-01 verifier rejected any YouTube reference in the route file, which became false after this plan deliberately added private-job endpoints.
- **Fix:** Kept all draft compensation checks and replaced the assertion with a private-job-only/no-publish route boundary check.
- **Files modified:** `src/scripts/verify-trailer-video-upload-lifecycle.ts`
- **Verification:** `npm run verify:trailer-video-upload-lifecycle`
- **Committed in:** `17f5172`

---

**Total deviations:** 2 auto-fixed (1 missing critical functionality, 1 bug)
**Impact on plan:** Both changes enforce the planned protected-contract and regression-verification requirements without expanding into public publishing or live provider scope.

## Known Stubs

None.

## Threat Flags

None - the only new network-adjacent surface is the protected lifecycle API already covered by T-16-11 and T-16-12; no new provider or trust boundary was introduced.

## Auth Gates

None. The verifier uses temporary SQLite/media fixtures and an injected deterministic fake provider; it does not read OAuth credentials or call YouTube.

## TDD Gate Compliance

Task 2's compiled verifier coverage was committed after the Task 1 implementation because the plan's pre-existing Plan 16-03 worker implementation was the subject under test. The final verifier passes, but there is no separate RED commit for Task 1's route contract.

## User Setup Required

None. Keep `YOUTUBE_TRAILER_JOB_ENABLED` disabled until the separate Plan 16-06 human OAuth/channel checkpoint.

## Next Phase Readiness

- Plan 16-06 can perform its explicit human OAuth/channel verification without exposing any credential or provider state through the API.
- No live YouTube calls were made and the worker remains disabled by default.

## Self-Check: PASSED

- Verified all six modified implementation/verifier files and this summary exist.
- Verified task commits `b11d71c` and `17f5172` exist in Git history.

---
*Phase: 16-draft-staging-and-private-youtube-job*
*Completed: 2026-08-05*
