# Wave 2 Summary

Exposed the protected summary read endpoint for Phase 10.

- Added `GET /v1/episodes/:episodeId/episodes-generated-summary` in `src/routes/episodes.routes.ts`.
- Returned the summary draft suggestion together with its status, progress, and error details from the shared backend contract.
- Kept the route backend-owned and read-only, with no manual refresh or frontend coupling.

Verification:
- `npm run build && npm run verify:summary-runtime-contract`
