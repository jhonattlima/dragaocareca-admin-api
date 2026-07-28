# Wave 1 Summary

Implemented the shared episode draft-state and path contract for Phase 09.

- Added `config.summary` to `src/config/env.ts` and documented the `EPISODE_SUMMARY_*` env contract in `.env.example`.
- Added `src/schemas/episode-draft-state.ts` for the shared `episode.state.json` contract with `transcript` and `aiSummary` child state.
- Extended `src/services/episode-media-layout.service.ts` with draft summary/state helpers and legacy transcript-state fallback.

Verification:
- `npm run typecheck`
- `npm run build`
