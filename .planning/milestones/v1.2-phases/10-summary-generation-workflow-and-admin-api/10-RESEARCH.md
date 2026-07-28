# Phase 10: Summary Generation Workflow and Admin API - Research

**Gathered:** 2026-07-23  
**Status:** Ready for planning

## Research Summary

The repository already contains the core summary runtime in `src/services/episode-summary.service.ts`. The missing work is orchestration and exposure:

- summary generation can already be queued, run sequentially, validated, and written to `summary.txt`
- the shared draft state already has `aiSummary` and versioned status/progress fields
- transcript completion is already the natural integration point for auto-triggering summary generation
- the route layer still lacks protected summary endpoints for status and draft retrieval

## Recommended Route

1. Hook summary queueing into transcript completion and transcript invalidation paths so the backend retriggers automatically when the transcript changes.
2. Add a service helper that can return both the current summary text and its status snapshot so routes do not read files directly.
3. Add a protected summary endpoint in `episodes.routes.ts` for returning the current summary suggestion and generation state.
4. Keep the final saved summary in SQLite untouched until `admin-web` submits the form later.

## Backend Wiring Points

- `src/services/episode-transcription.service.ts`
  - trigger summary generation on transcript completion
  - abort or reset summary state when the transcript is cleared or regenerated
- `src/services/episode-summary.service.ts`
  - expose a read helper for draft summary text
  - keep the existing queue/status/sync/abort contract
- `src/routes/episodes.routes.ts`
  - add the protected summary read endpoint
  - return summary status in the same backend-first style as transcription

## Gray Areas / Risks

- The summary service currently exposes status, but not the suggestion text, so a dedicated read helper is needed before the API can return the draft content cleanly.
- Version-based stale-run protection already exists, but there is no summary startup worker yet. If a run is interrupted mid-job, the implementation should rely on the existing versioned state model and avoid introducing unnecessary background complexity.
- Progress is intentionally coarse. `pending` and `processing` are enough for backend status, but the plan should not pretend the service can report granular percentage steps if it cannot.
- Transcript replacement must invalidate the previous summary suggestion immediately, otherwise the backend will present stale draft text after regeneration.

## Locked Assumptions

- Summary status mirrors transcript workflow states: `idle`, `pending`, `processing`, `done`, `error`.
- The summary suggestion is backend-owned draft data stored beside the episode files, not the final edited database summary.
- No manual refresh UI is needed in v1.2, and there is no backend trigger endpoint in this repo milestone.
