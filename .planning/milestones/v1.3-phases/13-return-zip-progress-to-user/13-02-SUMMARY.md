---
phase: 13-return-zip-progress-to-user
plan: 02
subsystem: api
tags: [express, zip, authentication, worker, no-store, artifact-preparation]
requires:
  - phase: 13-return-zip-progress-to-user
    provides: Durable ZIP preparation manifests, FIFO processing, and revalidated ready archives
provides:
  - Guarded startup recovery and polling for durable artifact preparation work
  - Authenticated prepare, status, and ready-download HTTP lifecycle
  - Explicit authenticated migration response for the retired direct ZIP stream
affects: [13-03, artifact-download-openapi, artifact-download-verifier]
tech-stack:
  added: []
  patterns: [guarded worker pump, no-store lifecycle status, ready-only ZIP streaming]
key-files:
  created: [src/workers/episode-artifact-preparation.worker.ts]
  modified: [src/server.ts, src/services/episode-artifact-preparation.service.ts, src/routes/episodes.routes.ts, src/scripts/verify-episode-artifact-downloads.ts]
key-decisions:
  - "Run interrupted-job recovery only during worker startup so normal prepare/status traffic cannot requeue live work."
  - "Retire the legacy direct ZIP stream behind authenticated 410 JSON that names the prepare endpoint."
patterns-established:
  - "Artifact lifecycle routes use requireAuth, selector/episode validation, and Cache-Control: no-store."
  - "Ready ZIP downloads revalidate through the preparation service immediately before opening the stream."
requirements-completed: [ZIP-01, ZIP-02, ZIP-05, ZIP-06]
coverage:
  - id: D1
    description: Guarded worker recovers interrupted preparation work and keeps archive processing serialized.
    requirement: ZIP-01
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: Protected clients can prepare, poll no-store status, and stream only a revalidated ready ZIP.
    requirement: ZIP-02
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D3
    description: Legacy direct-download callers receive an authenticated 410 migration payload instead of live ZIP streaming.
    requirement: ZIP-06
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-07-29
status: complete
---

# Phase 13 Plan 02: Prepared Artifact Lifecycle Summary

**Guarded ZIP preparation recovery and an authenticated prepare → status → ready-download API that retires the direct live stream.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-29T03:58:00Z
- **Completed:** 2026-07-29T04:02:45Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Started a guarded, unref'd preparation worker after database/media initialization while preserving `DISABLE_BACKGROUND_WORKERS=true` for direct verifier seams.
- Added authenticated prepare, status, and revalidated ready-download routes with strict positive IDs, existing selector parsing, no-store lifecycle responses, and no filesystem-path logging.
- Replaced the legacy direct ZIP stream with an authenticated `410 Gone` JSON migration response naming `POST /v1/episodes/:episodeId/artifacts/prepare`.

## Task Commits

1. **Task 1: Start a guarded preparation worker with recovery and cleanup** - `30d205d` (feat)
2. **Task 2: Replace direct streaming with authenticated prepare, poll, and ready-download routes** - `916ee66` (feat)

## Files Created/Modified

- `src/workers/episode-artifact-preparation.worker.ts` - Coalesced startup recovery, cleanup, and FIFO pump worker.
- `src/server.ts` - Starts the preparation worker only when background workers are enabled.
- `src/services/episode-artifact-preparation.service.ts` - Separates startup recovery from recurring cleanup and removes orphan output/snapshots.
- `src/routes/episodes.routes.ts` - Protected preparation lifecycle, ready-only streaming, and legacy migration route.
- `src/scripts/verify-episode-artifact-downloads.ts` - Compiled route contract coverage for the replacement lifecycle.

## Decisions Made

- Startup recovery is deliberately one-time; regular worker and request cleanup passes leave a live `preparing` manifest intact.
- The obsolete endpoint is kept for one release only as an authenticated non-cacheable migration response, never as a second archive-preparation path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented normal cleanup from requeuing a live preparation**
- **Found during:** Task 1
- **Issue:** The existing initialization seam reset every `preparing` manifest, including a job actively being processed when a prepare/status operation or later worker pass invoked cleanup.
- **Fix:** Restricted interrupted-job recovery to the first worker pass and retained recurring cleanup for ready expiry and orphan temporary output/snapshots.
- **Files modified:** `src/services/episode-artifact-preparation.service.ts`, `src/workers/episode-artifact-preparation.worker.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads`
- **Committed in:** `30d205d`

**2. [Rule 3 - Blocking] Updated the compiled verifier for the retired direct route**
- **Found during:** Task 2
- **Issue:** The required verifier still asserted a `200` live ZIP response from the route this plan deliberately replaces with `410 Gone`.
- **Fix:** Replaced direct-stream assertions with auth, no-store, queued/not-ready, ready-download, and migration-response lifecycle assertions.
- **Files modified:** `src/scripts/verify-episode-artifact-downloads.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads`
- **Committed in:** `916ee66`

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking issue)
**Impact on plan:** Both fixes are necessary to preserve single-worker correctness and keep the mandated verifier aligned with the replacement contract.

## Known Stubs

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 13-03 can document the lifecycle in OpenAPI and extend the contract verifier further without preserving a direct live-stream path.

## Self-Check: PASSED

- `src/workers/episode-artifact-preparation.worker.ts` exists.
- Task commits `30d205d` and `916ee66` exist.

---
*Phase: 13-return-zip-progress-to-user*
*Completed: 2026-07-29*
