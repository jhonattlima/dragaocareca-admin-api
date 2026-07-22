---
phase: 05-public-episodes-catalog-endpoint
plan: 01
subsystem: api
tags: [express, openapi, public-api, episodes]
requires: []
provides:
  - Public episode catalog DTO mapper for frontend-ready home-page data
  - Thin public catalog route for published episodes
  - OpenAPI schema for the catalog array contract
affects: [05-02, public frontend API, home page]
tech-stack:
  added: []
  patterns: [thin public router, backend-owned public DTO mapping]
key-files:
  created:
    - src/services/public-episode-catalog.service.ts
    - src/routes/public-episodes.routes.ts
  modified:
    - src/docs/openapi.ts
key-decisions:
  - "Return a plain JSON array rather than an envelope."
  - "Keep page and media URL construction in the backend."
  - "Normalize guests to `{ name }[]` for existing frontend search behavior."
patterns-established:
  - "Public endpoints should expose frontend-ready DTOs instead of raw storage fields."
  - "Anonymous catalog routes stay thin and delegate response shaping to a dedicated service."
requirements-completed: [CATALOG-03, CATALOG-04]
coverage:
  - id: D1
    description: "Public catalog items expose the frontend compatibility fields and normalized guests."
    requirement: "CATALOG-03"
    verification:
      - kind: integration
        ref: "GET /v1/public/episodes smoke check"
        status: pass
      - kind: other
        ref: "npm run typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "Public catalog items expose backend-owned absolute page and media URLs."
    requirement: "CATALOG-04"
    verification:
      - kind: integration
        ref: "GET /v1/public/episodes smoke check"
        status: pass
      - kind: other
        ref: "npm run build"
        status: pass
    human_judgment: false
duration: unknown
completed: 2026-07-21
status: complete
---

# Phase 5: Public Episodes Catalog Endpoint Summary

**Frontend-ready public catalog DTOs with backend-owned absolute URLs and OpenAPI coverage for the home-page episode feed**

## Performance

- **Duration:** unknown
- **Started:** unknown
- **Completed:** 2026-07-21
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added `src/services/public-episode-catalog.service.ts` to map published episode rows into the public catalog contract expected by the frontend.
- Added `src/routes/public-episodes.routes.ts` as the thin anonymous route that reads published episodes and returns the plain array response.
- Documented `GET /v1/public/episodes` and the catalog item schema in OpenAPI.

## Task Commits

No atomic task commits were created during this execution.

## Files Created/Modified
- `src/services/public-episode-catalog.service.ts` - Maps episode rows into public DTOs and assembles page/media URLs.
- `src/routes/public-episodes.routes.ts` - Exposes the public catalog route.
- `src/docs/openapi.ts` - Documents the public catalog endpoint and response schema.

## Decisions Made

- Kept the response as a plain JSON array to match the current frontend consumption path.
- Exposed absolute `pageUrl`, `audioUrl`, `coverUrl`, and `trailerUrl` so the frontend does not rebuild paths.
- Returned `null` for missing media URLs instead of leaking raw filename fields.

## Deviations from Plan

One implementation hardening was required: `FEED_BASE_LINK` loses the `#/episode/` fragment when parsed from env, so the mapper now falls back to `${config.feed.site}/#/episode/` when needed to preserve correct public page URLs.

## Issues Encountered

- Sandbox socket restrictions blocked the original local curl-based smoke check path. Verification was completed with an escalated local Node smoke check instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The backend now has a stable public catalog contract for the home page. Phase 6 can build the episode detail payload on top of the same backend-owned public URL and publication rules.

---
*Phase: 05-public-episodes-catalog-endpoint*
*Completed: 2026-07-21*
