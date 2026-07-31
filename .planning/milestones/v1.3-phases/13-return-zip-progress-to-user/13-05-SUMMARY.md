---
phase: 13-return-zip-progress-to-user
plan: 05
subsystem: api
tags: [openapi, csv, selector, express, verification]
requires:
  - phase: 13-return-zip-progress-to-user
    provides: Fixed artifact selector parser, protected preparation route, and compiled lifecycle verifier
provides:
  - OpenAPI grammar for nonempty fixed-selector CSV preparation queries
  - Compiled OpenAPI/parser/route selector parity coverage
affects: [artifact-download-openapi, artifact-download-verifier, ZIP-07]
tech-stack:
  added: []
  patterns: [anchored OpenAPI CSV grammar, compiled schema-parser-route parity assertions]
key-files:
  created: []
  modified: [src/docs/openapi.ts, src/scripts/verify-episode-artifact-downloads.ts]
key-decisions:
  - "Use an anchored OpenAPI string pattern for the fixed selector CSV grammar, preserving duplicate-tolerant parser normalization without permitting arbitrary values."
  - "Evaluate the emitted OpenAPI pattern in the compiled verifier and send the same representative CSV through the actual protected route."
patterns-established:
  - "OpenAPI parameter grammar changes must be verified against both the parser and the compiled route stack."
requirements-completed: [ZIP-01, ZIP-07]
coverage:
  - id: D1
    description: OpenAPI documents nonempty fixed-selector CSV preparation values while preserving omission-as-all semantics and no internal fields.
    requirement: ZIP-07
    verification:
      - kind: integration
        ref: npm run typecheck && npm run build && npm run verify:episode-artifact-downloads
        status: pass
    human_judgment: false
  - id: D2
    description: The compiled verifier proves a representative CSV is accepted by OpenAPI, normalized by the parser, and accepted by the protected preparation route, while an outside selector is rejected.
    requirement: ZIP-01
    verification:
      - kind: integration
        ref: src/scripts/verify-episode-artifact-downloads.ts#verifyOpenApiContract and #verifyRouteContract
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-07-29
status: complete
---

# Phase 13 Plan 05: OpenAPI Selector Parity Summary

**The protected artifact-preparation contract now documents fixed nonempty CSV selector lists and verifies `episode,transcript` through the OpenAPI schema, parser, and compiled route.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-29T12:23:04Z
- **Completed:** 2026-07-29T12:27:03Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- Replaced the incorrect single-selector OpenAPI enum with an anchored fixed-selector CSV pattern and representative multi-selector example.
- Added executable verifier coverage for a schema-valid `episode,transcript`, parser catalog-order normalization, and compiled protected POST behavior.
- Preserved bearer security, no-store headers, public-only status fields, all-artifacts omission behavior, and the fixed Phase 12 selector allowlist.

## Task Commits

1. **Task 1: Express the fixed selector CSV grammar in OpenAPI** - `8d78b17` (docs)
2. **Task 2: Enforce OpenAPI selector parity in the compiled verifier** - `66e597b` (feat)

## Files Created/Modified

- `src/docs/openapi.ts` - Describes the protected preparation query as a nonempty fixed-selector CSV grammar.
- `src/scripts/verify-episode-artifact-downloads.ts` - Evaluates that grammar and proves parser and direct-router parity offline against compiled exports.

## Decisions Made

- Used an anchored OpenAPI-compatible pattern because it precisely accepts one or more fixed selector tokens separated by commas, including duplicate values that the parser normalizes.
- Kept verifier selector values representative rather than duplicating the selector catalog outside the parser and documentation schema.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Align generated verifier expectations with the required multi-selector route probe**
- **Found during:** Task 2
- **Issue:** Existing ZIP-entry and ready-cache assertions assumed the previous single-selector `transcript` request, so changing the route probe to `episode,transcript` exposed incorrect expectations and shared fixture cache history.
- **Fix:** Expected both normalized archive entries, reused the same multi-selector cache key for the ready-cache probe, cleared generated preparation fixtures between route and lifecycle scenarios, and processed the retry queue before testing a missing-only job.
- **Files modified:** `src/scripts/verify-episode-artifact-downloads.ts`
- **Verification:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads`
- **Committed in:** `66e597b`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** The correction keeps the compiled verifier deterministic after its route coverage moved to the required representative CSV; production behavior and scope are unchanged.

## TDD Gate Compliance

The verifier task is marked TDD, but no standalone RED commit was possible after Task 1: the corrected OpenAPI grammar, existing parser, and existing route already accepted the required CSV before the verifier implementation was added. The final compiled verifier assertions pass and will fail on future documentation/parser/route drift.

## Known Stubs

None.

## Issues Encountered

- The sandbox initially prevented Git metadata writes; the requested scoped Git commit permission resolved it.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ZIP-07 now has executable selector-contract parity coverage without exposing filesystem or cache internals.
- Plan 13-06 remains untouched and can proceed independently.

## Self-Check: PASSED

- `src/docs/openapi.ts`, `src/scripts/verify-episode-artifact-downloads.ts`, and this summary exist.
- Task commits `8d78b17` and `66e597b` exist.

---
*Phase: 13-return-zip-progress-to-user*
*Completed: 2026-07-29*
