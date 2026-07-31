---
phase: 13-return-zip-progress-to-user
plan: 01
subsystem: api
tags: [zip, archiver, sha-256, filesystem, fifo, verification]
requires:
  - phase: 12-secure-episode-artifact-downloads
    provides: Fixed final-artifact selector parsing and regular-file preflight boundary
provides:
  - Persisted opaque ZIP preparation jobs with FIFO processing and restart recovery
  - SHA-256-or-missing-marker cache validation, snapshots, and atomic ZIP publishing
  - Compiled Wave 0 lifecycle verifier coverage
affects: [13-02, artifact-download-routes, artifact-preparation-worker]
tech-stack:
  added: []
  patterns: [atomic JSON manifests, SHA-256 source evidence, job-local snapshots, ready-only archive access]
key-files:
  created: [src/services/episode-artifact-preparation.service.ts]
  modified: [src/scripts/verify-episode-artifact-downloads.ts]
key-decisions:
  - "Persist selector names, generated basenames, and SHA-256-or-missing evidence only; never persist source paths."
  - "Revalidate the complete evidence map before ready reuse, status exposure, and archive streaming."
  - "Publish ZIP output only after same-directory temporary output closes and renames successfully."
patterns-established:
  - "Preparation lifecycle: queued -> preparing -> ready/failed/expired, persisted before exposure."
  - "Single module-local processing promise coalesces concurrent FIFO pump requests."
requirements-completed: [ZIP-01, ZIP-02, ZIP-03, ZIP-04, ZIP-06]
coverage:
  - id: D1
    description: Durable FIFO preparation lifecycle with opaque identities, recovery, and expiry
    requirement: ZIP-01
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: Snapshot-only atomic ZIP publication with validated download access
    requirement: ZIP-02
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D3
    description: SHA-256 and missing-marker invalidation, including same-size timestamp-preserved mutation
    requirement: ZIP-03
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
duration: 24min
completed: 2026-07-29
status: complete
---

# Phase 13 Plan 01: ZIP Preparation Core Summary

**Durable server-side ZIP preparation with opaque jobs, SHA-256 cache validation, final-artifact snapshots, atomic publishing, and compiled lifecycle verification.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-29T03:30:00Z
- **Completed:** 2026-07-29T03:54:44Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Added a persisted five-state preparation lifecycle with opaque IDs, normalized-selector idempotency, FIFO serialization, recovery, and 24-hour expiry.
- Snapshots only Phase 12 preflight-approved final files, fingerprints every requested selector with SHA-256 or an explicit missing marker, and atomically publishes completed ZIPs.
- Extended the compiled verifier from the intentional runtime RED gate to green coverage for cache reuse, canonical ZIP entries, mutation invalidation, missing-artifact appearance, recovery, and expiry.

## Task Commits

1. **Task 1: Write the Wave 0 compiled preparation-lifecycle contract** - `9a37ff5` (test)
2. **Task 2: Implement persisted FIFO preparation, snapshots, atomic publish, and recovery** - `46db0c0` (feat)

## Files Created/Modified

- `src/services/episode-artifact-preparation.service.ts` - Durable manifest, FIFO, snapshot, archive publication, revalidation, and recovery service.
- `src/scripts/verify-episode-artifact-downloads.ts` - Dynamic RED gate and compiled lifecycle contract coverage.

## Decisions Made

- Kept the Phase 12 selector parser and preflight as the sole source boundary, so no legacy, staging, draft, backup, or request path can reach a ZIP.
- Used only generated basenames in manifests and archive paths internally; public status objects and lifecycle logs contain no filesystem paths.
- Used same-directory `.part` output followed by rename before a manifest can become ready.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored lifecycle fixtures after the existing route verifier removes them**
- **Found during:** Task 2
- **Issue:** The pre-existing direct-route verification intentionally deletes its media fixtures before the new lifecycle assertions ran.
- **Fix:** Recreated deterministic final-artifact fixtures immediately before lifecycle verification.
- **Files modified:** `src/scripts/verify-episode-artifact-downloads.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads`
- **Committed in:** `46db0c0`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** Required for deterministic Wave 0 verification; no production scope expanded.

## Known Stubs

None.

## Issues Encountered

- The installed Archiver package is ESM-facing while this project compiles CommonJS. The service follows the established route pattern: a resolution-mode type import plus runtime `require`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 13-02 can wire the preparation worker and protected routes to the typed preparation, status, processing, and validated-download seams.
- The current direct ZIP endpoint remains untouched until Plan 13-02 replaces it.

## Self-Check: PASSED

- `src/services/episode-artifact-preparation.service.ts` exists.
- `src/scripts/verify-episode-artifact-downloads.ts` exists.
- Task commits `9a37ff5` and `46db0c0` exist.

---
*Phase: 13-return-zip-progress-to-user*
*Completed: 2026-07-29*
