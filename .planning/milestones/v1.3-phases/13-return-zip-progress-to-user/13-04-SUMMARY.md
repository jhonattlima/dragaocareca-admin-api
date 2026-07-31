---
phase: 13-return-zip-progress-to-user
plan: 04
subsystem: api
tags: [zip, cache, idempotency, concurrency, verification]
requires:
  - phase: 13-return-zip-progress-to-user
    provides: Persisted ZIP preparation manifests, source evidence revalidation, and FIFO processing
provides:
  - Per-cache-key coalescing for concurrent artifact preparation requests
  - Active-manifest selection that is not shadowed by stale cache history
  - Compiled invalidation-and-retry regression coverage
affects: [artifact-download-preparation, artifact-download-verifier, ZIP-01]
tech-stack:
  added: []
  patterns: [per-cache-key in-process promise coalescing, active-before-ready cache candidate selection]
key-files:
  created: []
  modified: [src/services/episode-artifact-preparation.service.ts, src/scripts/verify-episode-artifact-downloads.ts]
key-decisions:
  - "Coalesce candidate lookup, ready-manifest revalidation, and manifest persistence with an in-process promise keyed by normalized episode selectors."
  - "Prefer queued or preparing manifests before revalidated ready candidates, so stale or expired history cannot create duplicate FIFO jobs."
patterns-established:
  - "Cache-key history is filtered by active state first; only ready candidates are revalidated for immediate reuse."
requirements-completed: [ZIP-01, ZIP-04, ZIP-07]
coverage:
  - id: D1
    description: Concurrent normalized retries after source invalidation share one queued or preparing preparation job.
    requirement: ZIP-01
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: Ready-cache evidence invalidation and active-manifest reuse preserve SHA-256 cache safety without duplicate FIFO work.
    requirement: ZIP-04
    verification:
      - kind: integration
        ref: npm run typecheck && npm run build && npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D3
    description: The compiled lifecycle verifier proves the invalidation-then-retry cache-key contract.
    requirement: ZIP-07
    verification:
      - kind: integration
        ref: src/scripts/verify-episode-artifact-downloads.ts#verifyPreparationLifecycle
        status: pass
    human_judgment: false
duration: 2min
completed: 2026-07-29
status: complete
---

# Phase 13 Plan 04: Cache-Key Idempotency Gap Closure Summary

**Concurrent normalized artifact-preparation retries now share one active job after a stale cache is invalidated, while valid ready archives remain evidence-checked cache hits.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-29T12:18:35Z
- **Completed:** 2026-07-29T12:20:37Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Added a real-service regression that invalidates a ready multi-selector archive, then proves concurrent normalized retries return one active job and persist one new active manifest.
- Replaced stale-first manifest selection with per-cache-key coalesced candidate handling that prefers queued/preparing work and revalidates ready candidates before reuse.
- Preserved final-only preflight, selector-only logs, SHA-256-or-missing evidence, and global FIFO processing.

## Task Commits

1. **Task 1: Add the invalidated-cache idempotency regression** - `5afd8b3` (test)
2. **Task 2: Select reusable active manifests across cache-key history** - `0486715` (fix)

## Files Created/Modified

- `src/scripts/verify-episode-artifact-downloads.ts` - Proves concurrent retry coalescing after real source-evidence invalidation.
- `src/services/episode-artifact-preparation.service.ts` - Coalesces per-cache-key preparation operations and selects active/valid-ready candidates safely.

## Decisions Made

- Used a module-local promise map keyed by normalized cache identity because this monolithic service processes requests in one Node runtime and the critical lookup-to-persistence race exists within that process.
- Kept active jobs ahead of ready candidates; ready candidates are revalidated only when no active work exists for the cache key.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Issues Encountered

- The new RED verifier correctly exposed four duplicate queued manifests before the coalescing implementation; it passed after Task 2.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The ZIP preparation lifecycle now satisfies the cache-key idempotency gap identified by phase verification.
- Remaining Phase 13 gap-closure plans can build on the corrected preparation service and compiled verifier.

## Self-Check: PASSED

- `src/services/episode-artifact-preparation.service.ts` and `src/scripts/verify-episode-artifact-downloads.ts` exist.
- Task commits `5afd8b3` and `0486715` exist.

---
*Phase: 13-return-zip-progress-to-user*
*Completed: 2026-07-29*
