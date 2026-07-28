# Phase 5: Public Episodes Catalog Endpoint - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the first backend-owned public JSON contract for `dragaocareca_frontend`: a public episodes catalog endpoint for the home page. The endpoint replaces the legacy `index.php` catalog behavior for published episodes only and stops the frontend from reconstructing media and page URLs on its own.

</domain>

<decisions>
## Implementation Decisions

### Catalog response shape
- **D-01:** The Phase 5 endpoint should return a plain JSON array, not an `{ items, meta }` envelope.
- **D-02:** The backend should return only published episodes; the frontend should not filter unpublished items by `pubDate` anymore.
- **D-03:** The backend should return the catalog already ordered in reverse chronological order for home-page consumption.

### Link and media ownership
- **D-04:** Catalog items should include fully-qualified public URLs for page and media-related fields instead of relying on frontend path reconstruction.
- **D-05:** Public URL assembly is backend-owned contract logic and should be derived from the current media/storage conventions already managed in this repo.

### Scope and compatibility
- **D-06:** The endpoint should return the full published catalog in one response for now; pagination is deferred.
- **D-07:** The production site and the local `dragaocareca_frontend` repo are the canonical behavior references for the required catalog fields.

### the agent's Discretion
Route naming, exact field normalization, and internal mapper/service boundaries are left to the agent as long as the response remains a plain array, contains published episodes only, returns full public URLs, and fits the current home-page usage.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` — milestone goal, scope boundaries, and current public API direction
- `.planning/REQUIREMENTS.md` — Phase 5 requirement mapping for the catalog endpoint
- `.planning/ROADMAP.md` — Phase 5 goal, dependencies, and success criteria
- `.planning/STATE.md` — current milestone focus and current blockers/concerns
- `.planning/PROJECT.md` — architecture and mandatory backend constraints, especially server-side feed ownership and auth toggles

### Public frontend catalog behavior
- `../dragaocareca_frontend/src/config.js` — legacy public endpoint and media URL conventions currently used by the site
- `../dragaocareca_frontend/src/components/PageHome/EpisodeGrid/EpisodeGrid.js` — current home-page fetch/filter/reverse/infinite-scroll behavior
- `../dragaocareca_frontend/src/components/PageHome/EpisodeGrid/EpisodeCard/EpisodeCard.js` — current card fields and legacy image/trailer conventions
- `../dragaocareca_frontend/src/components/PageHome/EpisodeGrid/SearchBar/SearchBar.js` — current search behavior over title and guest names
- `../dragaocareca_frontend/src/components/PageEpisode/EpisodePage.js` — adjacent public-page field expectations that influence catalog compatibility

### Backend integration points
- `src/app.ts` — public route registration and `/media` static exposure
- `src/routes/feed.routes.ts` — existing public-route pattern for published content responses
- `src/database/repositories/episode.repository.ts` — canonical episode read paths, publication filtering, and media-related fields

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/feed.routes.ts`: already exposes a public endpoint that reads only published episodes through the repository and returns a transformed response.
- `src/database/repositories/episode.repository.ts`: already contains published-episode reads and canonical episode/media fields that should anchor the catalog mapping.
- `src/app.ts`: already exposes public routing and static media delivery under `/media`, which can support fully-qualified public URLs.

### Established Patterns
- Public content should come from repository-backed backend routes, not frontend filtering or feed parsing.
- Media and feed behavior already live in backend-owned services and route handlers; the catalog endpoint should follow the same ownership model.
- The repo uses thin routes with mapping/service logic behind them; Phase 5 should preserve that pattern instead of putting transformation logic in the frontend.

### Integration Points
- Add a new unauthenticated public route under the existing Express app and `/v1` route structure.
- Reuse episode repository published-data queries as the source for catalog items.
- Align response fields with the current frontend’s home-page card, search, and navigation needs while removing legacy PHP/path assumptions.

</code_context>

<specifics>
## Specific Ideas

- Use the current production site and `dragaocareca_frontend` behavior as the compatibility target for the first public catalog contract.
- Keep the initial Phase 5 response intentionally simple: plain array, full catalog, full URLs.

</specifics>

<deferred>
## Deferred Ideas

- Add pagination or cursor metadata in a later phase if catalog size or client needs justify it.
- Introduce envelope-style response metadata or public API versioning in a future public API milestone.
- Broader public-page contracts for contacts/site metadata/supporters belong to Phases 7 and 8, not this phase.

</deferred>

---

*Phase: 5-Public Episodes Catalog Endpoint*
*Context gathered: 2026-07-21*
