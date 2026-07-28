---
phase: 12-secure-episode-artifact-downloads
plan: 03
subsystem: api
tags: [typescript, filesystem, security, artifact-downloads, verification]
requires:
  - phase: 12-secure-episode-artifact-downloads
    provides: "Compiled artifact-download verifier scaffold from Plan 12-02"
provides:
  - "Closed public artifact selector catalog mapped to canonical final media filenames"
  - "Strict selector parsing that rejects malformed, empty, repeated-key, and unknown query input"
  - "Final-file regular-file preflight with catalog-ordered availability and missing selectors"
  - "Compiled verifier coverage for selector and preflight behavior"
affects: [12-04, episode-artifact-downloads, episodes-router]
tech-stack:
  added: []
  patterns:
    - "Artifact selection is normalized through a closed catalog before filesystem access."
    - "Preflight uses lstat on only canonical final paths and exposes archive paths solely to the future streaming route."
key-files:
  created:
    - "src/services/episode-artifact-download.service.ts"
  modified:
    - "src/scripts/verify-episode-artifact-downloads.ts"
key-decisions:
  - "Use lstat so only regular final files are eligible; directories and symlinks cannot enter an archive candidate list."
  - "Treat a single CSV's duplicate selector values as valid and deduplicate them into fixed catalog order, while rejecting Express repeated-key arrays."
patterns-established:
  - "Artifact verifier fixtures are created via canonical final-path helpers, asserted without path output, and removed in a finally block."
requirements-completed: [ART-01, ART-02, ART-03, ART-04, ART-05]
coverage:
  - id: D1
    description: "Selector parser and preflight service admit only known canonical final regular files."
    requirement: "ART-01"
    verification:
      - kind: other
        ref: "npm run typecheck && npm run build && npm run verify:episode-artifact-downloads"
        status: pass
    human_judgment: false
  - id: D2
    description: "Compiled verifier checks strict selector validation, catalog order, missing selectors, and canonical archive entry names."
    requirement: "ART-02, ART-03, ART-04, ART-05"
    verification:
      - kind: other
        ref: "npm run verify:episode-artifact-downloads"
        status: pass
    human_judgment: false
duration: 1min
completed: 2026-07-28
status: complete
---

# Phase 12 Plan 03: Final Artifact Selector and Preflight Summary

**A fixed five-item selector catalog now turns untrusted artifact queries into canonical final-file candidates, with compiled verification of the final-only preflight boundary.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-07-28T20:13:21-03:00
- **Completed:** 2026-07-28T23:14:44Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Added the closed selector catalog for `episode`, `trailer`, `transcript`, `image`, and `image-low`, each mapped to a canonical media kind and final filename.
- Added strict parsing for omitted/default selection, singular CSV input, empty values and segments, unknown selectors, non-string values, and repeated-key arrays.
- Added final-only availability preflight that uses `getEpisodeMediaFinalPath` and `lstat`, returns only regular files as archive candidates, and reports catalog-ordered missing selectors.
- Extended the compiled verifier with deterministic canonical fixtures and selector/preflight assertions; no HTTP route was introduced.

## Task Commits

1. **Task 1: Create the closed selector catalog and final-file availability preflight** - `54f7bd8` (feat)
2. **Task 2: Extend and run the verifier for selector and preflight behavior** - `96457ae` (test)

## Verification

- PASS: `npm run typecheck`
- PASS: `npm run build`
- PASS: `npm run verify:episode-artifact-downloads`
- PASS: service references `getEpisodeMediaFinalPath` and no legacy, staging, backup, draft, summary, directory, or glob resolver.
- PASS: task diff contains only the service and compiled verifier; route work remains for Plan 12-04.

## Decisions Made

- Use `lstat` so a symlink is not accepted as a regular final artifact.
- De-duplicate selector values only within one valid CSV, then return the fixed public catalog order.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - the selector and preflight implementation is fully wired to its compiled verifier. The HTTP route remains intentionally out of scope for Plan 12-04.

## Next Phase Readiness

Plan 12-04 can consume only `preflight.available` to stream the archive, use `missing` for its response header, and convert the typed parser failure into the documented `400` response.

## Self-Check: PASSED

- Confirmed the service, extended verifier, and summary exist on disk.
- Confirmed both task commits are present in Git history.
