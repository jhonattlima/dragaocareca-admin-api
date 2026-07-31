---
phase: 14-reconcile-artifact-job-contract-and-harden-zip-lifecycle
plan: 01
subsystem: api
tags: [express, sqlite, archiver, sha256, zip, openapi, verification]
requires:
  - phase: 13-return-zip-progress-to-user
    provides: Persisted artifact jobs, protected jobs routes, archive worker, and compiled direct-router verifier
provides:
  - Optional default-all JSON artifact-job creation
  - 24-hour SHA-256 and missing-marker validated ready-archive reuse
  - Archiver-source-byte progress capped below 100 until atomic publication
  - Generic public failure responses and reconciled API documentation
affects: [artifact-downloads, artifact-preparation-worker, v1.3]
tech-stack:
  added: []
  patterns: [selector-only SQLite source evidence, streamed final-source validation, atomic completion progress]
key-files:
  created: [14-01-PLAN.md, 14-VERIFICATION.md]
  modified: [src/services/episode-artifact-preparation.service.ts, src/database/repositories/artifact-job.repository.ts, src/docs/openapi.ts, src/scripts/verify-episode-artifact-downloads.ts]
key-decisions:
  - "Preserve the current artifact jobs routes; default-all is an omitted JSON body or artifacts property, not a CSV route."
  - "Invalidate a completed job by removing its server-derived output and row when streamed selector evidence no longer matches."
requirements-completed: [ART-01, ART-02, ART-03, ART-04, ART-05, ART-06, ART-07, ZIP-01, ZIP-02, ZIP-03, ZIP-04, ZIP-06, ZIP-07]
coverage:
  - id: D1
    description: Artifact-job POST accepts omitted JSON bodies and optional canonical selector arrays while retaining protected status and download routes.
    requirement: ART-01
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: Completed archives are retained for 24 hours and invalidated when streamed SHA-256 evidence or an explicit missing marker changes.
    requirement: ZIP-04
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D3
    description: Progress comes from Archiver source bytes, remains below 100 before publication, and failed jobs expose only a generic safe error.
    requirement: ZIP-03
    verification:
      - kind: integration
        ref: npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-07-31
status: complete
---

# Phase 14 Plan 01: Artifact Job Contract Reconciliation Summary

**The authoritative artifact-job API now supports default-all JSON requests, 24-hour source-evidence cache validation, byte-derived ZIP progress, and safe public failure behavior.**

## Accomplishments

- Preserved the protected POST, status, and download jobs routes while making an omitted JSON body or omitted `artifacts` property select the full catalog.
- Added a compatible SQLite migration that stores only selectors plus SHA-256 or explicit missing-marker evidence; ready status, reuse, and download all revalidate it.
- Replaced stage percentages with Archiver source-byte progress, capped processing at 99, and reserve 100 for post-rename completion.
- Updated OpenAPI and the compiled verifier to prove the reconciled route set and lifecycle behavior.

## Task Commits

1. **Task 1: Harden artifact-job cache lifecycle** — `d43cf87` (feat)
2. **Task 2: Align artifact-job documentation and verifier** — `9f1ea07` (docs)

## Validation

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm run verify:episode-artifact-downloads` — passed

## Decisions Made

- Jobs routes are authoritative; CSV and legacy migration routes were not restored.
- Evidence contains no source paths and a source mismatch removes the stale ready job before it can be reused or downloaded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Enforced generic failed-job persistence in the repository.**
- **Found during:** Task 1
- **Issue:** A future repository caller could otherwise persist a raw operational error even though the current service passed a generic message.
- **Fix:** The failure transition always stores the safe generic public message.
- **Files modified:** `src/database/repositories/artifact-job.repository.ts`
- **Verification:** `npm run verify:episode-artifact-downloads`
- **Committed in:** `d43cf87`

**2. [Rule 3 - Blocking] Used manual state reconciliation after the state helper could not parse the inherited Phase 14 placeholder.**
- **Found during:** metadata update
- **Issue:** `state.advance-plan` expects a numeric plan position, while STATE.md contained `Plan: Not started`.
- **Fix:** Updated the equivalent completion state directly.

## Known Stubs

None.

## Self-Check: PASSED

- Source files, Phase 14 plan, verification report, and both task commits exist.
