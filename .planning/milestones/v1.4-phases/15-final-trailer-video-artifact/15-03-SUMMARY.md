---
phase: 15-final-trailer-video-artifact
plan: "03"
subsystem: api
tags: [typescript, express, zip, artifact-downloads, openapi]
requires:
  - phase: 15-01
    provides: Canonical trailerVideo media kind resolving to final trailer.mp4
provides:
  - Closed trailer-video selector for final trailer-video ZIP artifacts
  - Verified canonical video ZIP entries and source-evidence invalidation
affects: [15-04, phase-16-youtube-publication, artifact-downloads]
tech-stack:
  added: []
  patterns:
    - Fixed selector catalog entries map server-owned media kinds to deterministic ZIP names
    - Route and OpenAPI selector allowlists stay synchronized with the artifact catalog
key-files:
  created: []
  modified:
    - src/services/episode-artifact-download.service.ts
    - src/routes/episodes.routes.ts
    - src/docs/openapi.ts
    - src/scripts/verify-episode-artifact-downloads.ts
key-decisions:
  - Keep trailer-video separate from the existing audio trailer selector and filename.
  - Use the same canonical-final lstat and SHA-256-or-missing evidence lifecycle as other artifact selectors.
patterns-established:
  - Artifact selector changes require synchronized route, OpenAPI, and compiled verifier coverage.
requirements-completed: [TRAILER-05]
coverage:
  - id: D1
    description: Authenticated artifact ZIP jobs select only the canonical final trailer video under the fixed trailer-video selector.
    requirement: TRAILER-05
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: Default-all missing markers, fixed trailer.mp4 archive entries, and changed-or-appearing video source evidence invalidate stale ZIP jobs.
    requirement: TRAILER-05
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-08-03
status: complete
---

# Phase 15 Plan 03: Trailer-Video ZIP Selector Summary

**The authenticated artifact ZIP lifecycle now accepts a closed `trailer-video` selector that archives only canonical final `trailer.mp4` files as `episode-{id}/trailer.mp4`.**

## Performance

- **Duration:** 12min
- **Started:** 2026-08-03T22:15:07Z
- **Completed:** 2026-08-03T22:27:00Z
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments

- Added the distinct `trailer-video` catalog selector, mapped solely to the server-owned `trailerVideo` final-media kind and fixed `trailer.mp4` archive name.
- Kept final-only `lstat` preflight and source-evidence collection intact, so directories, symlinks, history, staging files, filenames, and paths cannot enter a ZIP.
- Extended compiled route verification and OpenAPI parity for parsing, default-all missing behavior, canonical ZIP entry naming, and source-evidence invalidation while retaining audio `trailer` coverage.

## Task Commits

1. **RED verifier: trailer-video selector check** - `54e9433` (test)
2. **Task 1: Add trailer-video to the fixed artifact catalog** - `0218e22` (feat)
3. **Task 2: Extend compiled ZIP verification for final trailer video** - `a4700e0` (feat)

## Files Created/Modified

- `src/services/episode-artifact-download.service.ts` - Defines the closed selector-to-canonical-video mapping.
- `src/routes/episodes.routes.ts` - Keeps protected route validation aligned with the closed catalog.
- `src/docs/openapi.ts` - Documents trailer-video consistently in job request and snapshot enums.
- `src/scripts/verify-episode-artifact-downloads.ts` - Proves canonical video ZIP lifecycle behavior offline.

## Decisions Made

- `trailer-video` is a distinct selector and fixed `trailer.mp4` ZIP entry; the existing `trailer` selector remains audio-only (`trailer.mp3`).
- Video source changes and missing-marker transitions use the existing revalidation lifecycle instead of adding a separate cache policy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Synchronized the route and OpenAPI selector allowlists**
- **Found during:** Task 2
- **Issue:** The artifact route's static Zod enum rejected `trailer-video` before the authoritative catalog could preflight it, and OpenAPI still advertised the old fixed set.
- **Fix:** Added only `trailer-video` to the route and OpenAPI closed enums, with compiled parity assertions.
- **Files modified:** `src/routes/episodes.routes.ts`, `src/docs/openapi.ts`, `src/scripts/verify-episode-artifact-downloads.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads`
- **Committed in:** `a4700e0`

### State Tracking

**2. [Rule 3 - Blocking issue] Aligned duplicate Plan position metadata**
- **Found during:** Final state update
- **Issue:** `state.advance-plan` advanced the prose position to Plan 4 but left the duplicate frontmatter `current_plan` at 3.
- **Fix:** Updated the duplicate field and activity line to match the completed Plan 15-03 state.
- **Files modified:** `.planning/STATE.md`

**Total deviations:** 2 auto-fixed (Rule 2: 1, Rule 3: 1)
**Impact on plan:** Both fixes preserve the closed artifact boundary and accurate continuation state without expanding product scope.

## Known Stubs

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 15-04 can rely on the authenticated artifact lifecycle to download canonical final trailer-video artifacts without exposing filesystem paths.

## Self-Check: PASSED

- Confirmed all four implementation/verifier files and this summary exist.
- Confirmed RED and both task commits exist: `54e9433`, `0218e22`, and `a4700e0`.

---
*Phase: 15-final-trailer-video-artifact*
*Completed: 2026-08-03*
