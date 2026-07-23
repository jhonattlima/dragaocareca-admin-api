# Phase 5 Validation - Public Episodes Catalog Endpoint

**Created:** 2026-07-21
**Status:** Required before execution

## Scope

This validation artifact covers only Phase 5 requirements `CATALOG-01` through `CATALOG-04` and locked decisions `D-01` through `D-07`.

Phase boundary:
- Validate the new public catalog array contract.
- Validate published-only visibility, newest-first ordering, and backend-owned absolute URLs.
- Do not expand into Phase 6 detail pages or Phase 7/8 public metadata.

## Automated Commands

### Baseline compile checks

```bash
npm run typecheck
npm run build
```

### Route smoke check

Run the dedicated verification script, which invokes the real `GET /v1/public/episodes` route handler and asserts the current frontend compatibility contract without depending on sandboxed localhost networking:

```bash
npm run verify:public-episodes
```

## Requirement Traceability

| Requirement | Validation |
|-------------|------------|
| `CATALOG-01` | Route smoke check fails if any returned `pubDate` is in the future. |
| `CATALOG-02` | Route smoke check fails if the array is not newest-first by `pubDate`. |
| `CATALOG-03` | Route smoke check fails unless the frontend compatibility fields exist: `episodeId`, `title`, `pubDate`, `guests[].name`, `pageUrl`, `coverUrl`, `trailerUrl`, `audioUrl`. |
| `CATALOG-04` | Route smoke check fails if any non-null page or media URL is not absolute. |

## Manual Review

1. Open `http://127.0.0.1:3000/docs` and confirm `GET /v1/public/episodes` is documented as a plain array response.
2. Inspect one response item and confirm it does not expose raw filename fields such as `fileName`, `coverFileName`, `coverLowFileName`, or `trailerFileName`.
3. Compare the item contract against the current frontend references used in Phase 5 planning:
   - `EpisodeGrid` consumes the full published array without frontend filtering or reversing.
   - `SearchBar` still has `guests[].name` available.
   - `EpisodeCard` can navigate via `episodeId` and/or `pageUrl` without reconstructing legacy media paths.

## Exit Criteria

- `npm run typecheck` passes.
- `npm run build` passes.
- The route smoke command passes.
- OpenAPI and runtime response agree on the Phase 5 plain-array contract.
