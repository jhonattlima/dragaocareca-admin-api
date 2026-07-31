---
phase: 13-return-zip-progress-to-user
plan: 03
subsystem: api
tags: [openapi, express, zip, authentication, cache-control, verification]
requires:
  - phase: 13-return-zip-progress-to-user
    provides: Authenticated ZIP preparation routes, durable cache validation, and startup recovery
provides:
  - Public OpenAPI lifecycle contract for prepared episode-artifact ZIPs
  - Compiled direct-router coverage for lifecycle security, cache invalidation, and migration behavior
affects: [artifact-download-openapi, artifact-download-verifier, admin-api-clients]
tech-stack:
  added: []
  patterns: [no-store lifecycle middleware, compiled route-stack contract verification]
key-files:
  created: []
  modified: [src/docs/openapi.ts, src/routes/episodes.routes.ts, src/scripts/verify-episode-artifact-downloads.ts]
key-decisions:
  - "Document only public preparation status fields; cache and filesystem internals remain server-only."
  - "Apply Cache-Control: no-store before lifecycle authentication so error JSON cannot be cached."
patterns-established:
  - "Artifact lifecycle routes set no-store before auth, validation, status, download, and migration responses."
  - "The compiled verifier invokes actual Express route stacks and service seams without opening a listener."
requirements-completed: [ZIP-03, ZIP-04, ZIP-05, ZIP-07]
coverage:
  - id: D1
    description: Protected OpenAPI prepare, status, download, and deprecated direct-route migration contract.
    requirement: ZIP-05
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: Lifecycle verifier proves FIFO status/progress, ready-only ZIP streaming, expiration, restart recovery, and cache invalidation.
    requirement: ZIP-03
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D3
    description: Lifecycle responses and captured logs exclude media-root paths and internal cache details.
    requirement: ZIP-07
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
duration: 5min
completed: 2026-07-29
status: complete
---

# Phase 13 Plan 03: Lifecycle Contract and Verifier Summary

**Bearer-protected asynchronous ZIP preparation documentation and compiled route-stack coverage for no-store polling, cache safety, and deprecated direct-download migration.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-29T04:05:08Z
- **Completed:** 2026-07-29T04:10:21Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- Replaced the live-download OpenAPI operation with protected prepare, status, ready-download, and one-release deprecated direct-route migration operations.
- Defined a public-only preparation status schema covering normalized selectors, state, integer assembly progress, conditional queue/download fields, and expiry without filesystem or cache internals.
- Completed the compiled verifier for actual auth middleware, development bypass, FIFO queue position, progress state, cache invalidation, restart recovery, expiry, ZIP headers/entries, OpenAPI parity, and no-path disclosure.

## Task Commits

1. **Task 1: Replace the direct-download OpenAPI operation with the asynchronous lifecycle contract** - `16bad7c` (docs)
2. **Task 2 RED: Add failing lifecycle contract coverage** - `94f83c3` (test)
3. **Task 2 GREEN: Complete compiled direct-router verification of the lifecycle and migration contract** - `aacd945` (feat)

## Files Created/Modified

- `src/docs/openapi.ts` - Documents protected lifecycle operations, public status representation, headers, errors, expiry, and legacy 410 migration response.
- `src/routes/episodes.routes.ts` - Applies no-store before lifecycle authorization and error handling.
- `src/scripts/verify-episode-artifact-downloads.ts` - Verifies the compiled lifecycle contract without a network listener.

## Decisions Made

- The status schema exposes only job, selector, state, progress, polling, and expiry data; manifests, source evidence, cache keys, paths, and internal failures are excluded.
- `Cache-Control: no-store` is set before `requireAuth` for every lifecycle operation so authenticated and unauthenticated JSON outcomes follow the polling cache policy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Apply no-store before lifecycle auth and validation errors**
- **Found during:** Task 2
- **Issue:** Existing handlers set `Cache-Control: no-store` only on successful lifecycle responses, so auth, validation, unknown-job, non-ready, and expired JSON could be cached despite the documented polling contract.
- **Fix:** Added a narrow lifecycle middleware before `requireAuth` on prepare, status, download, and deprecated direct routes.
- **Files modified:** `src/routes/episodes.routes.ts`, `src/scripts/verify-episode-artifact-downloads.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:public-episodes && npm run verify:episode-artifact-downloads && npm run verify:summary-runtime-contract && npm run verify:summary-quality-contract`
- **Committed in:** `aacd945`

---

**Total deviations:** 1 auto-fixed (1 Rule 2 missing critical functionality)
**Impact on plan:** Required to make the documented no-store polling contract apply consistently to the real protected route stack.

## Known Stubs

None.

## Threat Flags

None.

## Issues Encountered

- The pre-existing verifier still asserted the retired direct ZIP OpenAPI shape after Task 1. Its expected failure became Task 2's RED gate and was replaced with lifecycle parity coverage.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 13 now has an executable, public documentation contract for prepared artifact downloads.

## Self-Check: PASSED

- `src/docs/openapi.ts`, `src/routes/episodes.routes.ts`, and `src/scripts/verify-episode-artifact-downloads.ts` exist.
- Task commits `16bad7c`, `94f83c3`, and `aacd945` exist.
