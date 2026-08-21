---
phase: 16-draft-staging-and-private-youtube-job
plan: "01"
subsystem: api
tags: [express, sqlite, multipart, media-promotion, verification]
requires:
  - phase: 15-final-trailer-video-artifact
    provides: rollback-safe canonical trailer-video storage and protected upload routes
provides:
  - owner-, episode-, state-, and expiry-conditional draft consumption
  - recoverable draft episode creation with final-media compensation
  - offline D-01/D-02/D-03 fault-injection lifecycle verification
affects: [16-02, 16-03, 16-04, 16-05, youtube-trailer-jobs]
tech-stack:
  added: []
  patterns: [conditional SQLite lifecycle transitions, final-media compensation, compiled route fault injection]
key-files:
  created: []
  modified:
    - src/routes/episodes.routes.ts
    - src/services/episode-draft-reservation.service.ts
    - src/services/episode-trailer-video.service.ts
    - src/database/repositories/episode.repository.ts
    - src/scripts/verify-trailer-video-upload-lifecycle.ts
key-decisions:
  - "Consume a draft only after all durable create, media, metadata, and post-create steps succeed."
  - "Use a conditional repository transition to bind consumption to the exact owner, episode, active state, and expiry."
  - "Restore the previous final trailer by atomic replacement so metadata rollback never removes it first."
patterns-established:
  - "Draft create compensation removes a new episode and canonical trailer, then resets the still-owner-bound reservation for retry."
  - "Compiled lifecycle verifiers inject repository failures through the direct protected router stack without provider/network access."
requirements-completed: [TRAILER-02, TRAILER-03, TRAILER-09]
coverage:
  - id: D1
    description: "Owner-bound trailer draft reservations are consumed only after matching durable episode creation and final media promotion."
    requirement: TRAILER-09
    verification:
      - kind: integration
        ref: "npm run verify:trailer-video-upload-lifecycle"
        status: pass
    human_judgment: false
  - id: D2
    description: "Create, promotion/metadata, consume, and post-create failures compensate rows/final media and leave the draft retryable."
    requirement: TRAILER-09
    verification:
      - kind: integration
        ref: "src/scripts/verify-trailer-video-upload-lifecycle.ts#D-01/D-02/D-03 fault injection"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-08-04
status: complete
---

# Phase 16 Plan 01: Draft Staging and Private YouTube Job Summary

**Owner-bound draft reservations now promote staged MP4 media through a recoverable episode-create unit, with offline proof of D-01 through D-03 compensation.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-04T21:55:05Z
- **Completed:** 2026-08-04T21:59:10Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Added deterministic fault-injected route verification for create, promotion/metadata, draft-consume, and post-create failures.
- Bound draft consumption to the normalized authenticated owner, episode ID, permitted lifecycle state, and unexpired timestamp in a single repository transition.
- Delayed consumption until all durable create work succeeds; failure removes the new row/final file and keeps the reservation retryable.
- Preserved the last-known-good final trailer during metadata rollback by atomically replacing it from a prepared recovery copy.

## Task Commits

1. **Task 1: Expand the compiled draft lifecycle verifier with compensation cases** - `2fe7494` (test, RED)
2. **Task 2: Make draft consumption and final promotion a recoverable create unit** - `9c1d03e` (feat, GREEN)

## Files Created/Modified

- `src/scripts/verify-trailer-video-upload-lifecycle.ts` - Offline D-01/D-02/D-03 fault-injection coverage.
- `src/routes/episodes.routes.ts` - Delays draft consumption and performs create-unit compensation.
- `src/services/episode-draft-reservation.service.ts` - Enforces normalized nonempty owner and retry restoration.
- `src/services/episode-trailer-video.service.ts` - Restores prior canonical media without a deletion window.
- `src/database/repositories/episode.repository.ts` - Adds conditional consumption and retry-state transitions.

## Decisions Made

- Consume only after the final response document is durable, leaving no later awaited operation that can invalidate an already-consumed draft.
- A failed new-episode create resets an unconsumed reservation to `reserved`; an operator can safely re-upload and retry using the same owner-bound draft.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Issues Encountered

- The expected RED verifier initially exposed that failed draft consumption was ignored and the route returned success. The GREEN implementation corrects that path and the verifier passes.

## User Setup Required

None - all verification runs against temporary SQLite/media fixtures and makes no live YouTube calls.

## Next Phase Readiness

- Canonical final trailer promotion is now safe for the private-first YouTube job plans.
- No blockers for downstream Phase 16 plans.

## Self-Check: PASSED

- Verified all five modified source files exist.
- Verified commits `2fe7494` and `9c1d03e` exist in Git history.

---
*Phase: 16-draft-staging-and-private-youtube-job*
*Completed: 2026-08-04*
