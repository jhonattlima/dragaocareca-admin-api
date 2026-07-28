---
phase: 12-secure-episode-artifact-downloads
plan: 04
subsystem: api
tags: [typescript, express, archiver, openapi, security, artifact-downloads]
requires:
  - phase: 12-secure-episode-artifact-downloads
    provides: "Final-only selector catalog, canonical archive names, and regular-file preflight"
provides:
  - "Authenticated final-artifact ZIP download endpoint"
  - "OpenAPI contract for artifact download responses and errors"
  - "Offline direct-router verifier for auth, ZIP, and OpenAPI behavior"
affects: [episode-artifact-downloads, episodes-router, admin-api]
tech-stack:
  added: ["@types/archiver"]
  patterns:
    - "Preflight all final artifacts before emitting ZIP headers."
    - "Use an in-memory response and ZIP central-directory reader for offline route verification."
key-files:
  created: []
  modified:
    - "src/routes/episodes.routes.ts"
    - "src/docs/openapi.ts"
    - "src/scripts/verify-episode-artifact-downloads.ts"
    - "package.json"
    - "package-lock.json"
key-decisions:
  - "Use Archiver v8's ZipArchive export because its legacy callable factory is not available at runtime."
  - "Install @types/archiver only after the first production import proved compiler declarations were required."
patterns-established:
  - "Stream failures after archive piping are logged without filesystem paths and destroy the response instead of entering JSON middleware."
requirements-completed: [ART-01, ART-02, ART-03, ART-04, ART-05, ART-06, ART-07]
coverage:
  - id: D1
    description: "Protected endpoint streams only preflight-approved final artifacts with deterministic ZIP metadata and partial-availability reporting."
    requirement: "ART-01, ART-02, ART-03, ART-04, ART-05, ART-06"
    verification:
      - kind: integration
        ref: "npm run verify:episode-artifact-downloads"
        status: pass
    human_judgment: false
  - id: D2
    description: "OpenAPI documents the bearer-protected artifact ZIP endpoint, selector contract, headers, and response conditions."
    requirement: "ART-07"
    verification:
      - kind: other
        ref: "npm run verify:episode-artifact-downloads"
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-07-28
status: complete
---

# Phase 12 Plan 04: Protected Artifact Download Summary

**Authenticated administrators can now download allowlisted final episode artifacts as deterministic ZIP archives, with offline verification of auth, response, and archive contracts.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-28T23:17:10Z
- **Completed:** 2026-07-28T23:25:42Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Added `GET /v1/episodes/:episodeId/artifacts/download` before the generic episode route and protected it with `requireAuth`.
- Streams only Plan 12-03 preflight-approved final files into `episode-<id>/` ZIP entries, with documented JSON error branches and selector-only missing header.
- Added OpenAPI coverage and a compiled direct-router verifier that validates auth, bypass, query errors, ZIP headers, entries, partial availability, and 404 bodies without a listener or extraction command.

## Task Commits

1. **Task 1: Add the authenticated final-artifact ZIP route with safe stream handling** - `08527e6` (feat)
2. **Task 2 RED: Add failing direct-router contract verifier** - `f28f959` (test)
3. **Rule 1 fix: Use Archiver v8 ZIP export** - `d18126c` (fix)
4. **Task 2 GREEN: Document artifact download contract** - `bc6e39f` (feat)

## Verification

- PASS: `npm run typecheck`
- PASS: `npm run build`
- PASS: `npm run verify:episode-artifact-downloads`
- PASS: route is registered before generic `/:episodeId`; the new route contains no legacy, staging, backup, directory, glob, or request-derived path resolution.

## Decisions Made

- Construct `ZipArchive` from Archiver v8's runtime export instead of the removed callable factory.
- Keep ZIP-entry parsing confined to the verifier's narrow central-directory reader.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the Archiver v8 runtime construction API**
- **Found during:** Task 2 (compiled direct-router verification)
- **Issue:** The type-compatible legacy factory call failed at runtime because Archiver v8 exports `ZipArchive` instead.
- **Fix:** Constructed the supported `ZipArchive` class while retaining explicit preflighted file entries.
- **Files modified:** `src/routes/episodes.routes.ts`
- **Verification:** Full typecheck, build, and direct-router verifier passed.
- **Committed in:** `d18126c`

---

**Total deviations:** 1 auto-fixed (Rule 1).
**Impact on plan:** Required runtime compatibility correction; no scope expansion or security-boundary change.

## Issues Encountered

- The compiler proved Archiver declarations were absent, so the plan-authorized `@types/archiver` development dependency was installed with npm-generated lockfile changes.
- The initial sandboxed npm install could not resolve the registry; the same approved package install succeeded with elevated network access.

## Known Stubs

None - the endpoint, documentation, and compiled verifier are fully wired.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 12 requirements ART-01 through ART-07 are implemented and verified. The endpoint remains backend-only and uses the existing development auth-bypass toggle.

## Self-Check: PASSED

- Confirmed the route, OpenAPI contract, verifier, package metadata, and this summary exist on disk.
- Confirmed task commits `08527e6`, `f28f959`, `d18126c`, and `bc6e39f` are present in Git history.
