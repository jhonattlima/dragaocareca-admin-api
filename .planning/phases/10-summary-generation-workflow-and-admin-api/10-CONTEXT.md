# Phase 10: Summary Generation Workflow and Admin API - Context

**Gathered:** 2026-07-23  
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase implements the backend summary-generation workflow on top of the transcript draft pipeline. It defines when summary generation starts, how it is retriggered when the transcript changes, how status/progress is exposed, and how draft summary data is stored so `admin-web` can consume it in a later milestone without changing the backend workflow again.

</domain>

<decisions>
## Implementation Decisions

### Trigger and rerun behavior
- **D-01:** Summary generation must start automatically when the transcript workflow completes successfully.
- **D-02:** If the transcript changes and the transcript update finishes again, summary generation must be triggered again automatically using the new transcript.
- **D-03:** There is no manual refresh action in the UI flow for v1.2; backend summary work is driven only by transcript completion/recompletion.

### Workflow shape
- **D-04:** Summary generation remains backend-owned and sequential so it fits the 4 GB VPS constraint.
- **D-05:** Summary generation only reads the saved transcript artifact as input; it does not transcribe audio and does not depend on frontend state.
- **D-06:** The summary job is a suggestion-only step: once the draft summary is produced, the backend job is done.

### Draft state and storage
- **D-07:** The shared episode state file stays the primary workflow state container, with child objects for transcript and AI summary state.
- **D-08:** Summary output should be stored as a draft artifact beside the episode files, not written directly into `episodes.summary`.
- **D-09:** The backend should keep the draft summary easy to reuse for later API reads, but it must remain separate from the final editable summary submitted by the user in `admin-web`.

### Status and progress contract
- **D-10:** Summary status/progress should mirror the transcript workflow shape so the admin UI can reuse the same mental model for background processing.
- **D-11:** The summary API should expose `idle`, `pending`, `processing`, `done`, and `error` states, along with progress and error details when available.
- **D-12:** If the summary is regenerated, the old draft suggestion is replaced, but the public episode summary field is not mutated automatically.

### Writing rules
- **D-13:** Summary text should stay short, discovery-friendly, and written in `pt-BR` using concrete terms from the transcript.
- **D-14:** The prompt contract should encourage natural search relevance without keyword stuffing, hype, or disconnected term lists.

### Later integration
- **D-15:** `admin-web` integration is deferred; this phase only establishes the backend storage and retrieval contract. Automatic triggering remains internal to the transcript lifecycle and is not exposed as a manual API control.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` - milestone goal, backend-only scope, VPS constraint, and excluded frontend work.
- `.planning/REQUIREMENTS.md` - requirement mapping for `SUMM-03`, `FLOW-01`, `FLOW-03`, `API-02`, and `API-03`.
- `.planning/ROADMAP.md` - v1.2 phase sequence and phase 10 dependencies.
- `.planning/STATE.md` - current milestone status and continuity constraints.
- `docs/SDD.md` - architecture source of truth, env/config conventions, media layout expectations, and backend ownership rules.

### Existing transcript and summary implementation
- `docs/features/003-episode-transcription/PLAN.md` - transcript workflow behavior and progress reporting pattern.
- `docs/features/004-episode-summary-suggestion/PLAN.md` - summary feature intent and backend-only output rules.
- `docs/TODO.md` - deferred transcription-engine re-evaluation that must stay out of v1.2.

### Backend runtime and integration points
- `src/services/episode-transcription.service.ts` - current transcript draft workflow, queueing, and state write pattern to extend.
- `src/services/episode-summary.service.ts` - summary runtime contract and draft state implementation that phase 10 must wire into routes/workers.
- `src/services/episode-media-layout.service.ts` - episode-scoped path helpers and shared state file location.
- `src/routes/episodes.routes.ts` - protected episode upload/update routes where transcript completion currently happens.
- `src/database/repositories/episode.repository.ts` - canonical episode persistence contract for final summary submission.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- `src/services/episode-summary.service.ts` already provides the sequential runtime, prompt generation, validation, draft summary write path, and status snapshot shape.
- `src/services/episode-transcription.service.ts` already shows how transcript completion is queued, persisted, and exposed with background progress.
- `src/services/episode-media-layout.service.ts` already centralizes the episode folder layout and the shared `episode.state.json` location.

### Established patterns
- Background AI-adjacent work stays inside backend services rather than route handlers.
- Draft workflow state is file-backed alongside the episode media layout, while the final editable episode summary remains in SQLite until the user submits the form.
- Long-running work should keep the status/progress contract simple enough to be surfaced later in `admin-web`.

### Integration points
- Phase 10 should connect transcript completion to summary queueing, including reruns when the transcript is regenerated.
- Summary status endpoints should read from the shared episode state file rather than inventing a separate persistence model.
- The route layer should stay thin and delegate orchestration to services.

</code_context>

<specifics>
## Specific Ideas

- Trigger summary generation from the same completion point that currently marks transcript success, so the summary follows the transcript lifecycle automatically.
- Reuse the transcript status/progress model as the reference for summary progress reporting; do not invent a separate UI contract unless the backend shape requires it.
- Keep the backend response focused on draft suggestion data and readiness state so later frontend integration only has to bind fields, not re-derive workflow logic.

</specifics>

<deferred>
## Deferred Ideas

- Manual refresh controls in `admin-web` are out of scope for this repo milestone, and there is no backend trigger endpoint for v1.2.
- Accept/reject controls for the generated summary belong to the later frontend milestone.
- Re-evaluating the transcription engine remains tech debt and should not be mixed into the summary workflow phase.

</deferred>

---
*Phase: 10-Summary Generation Workflow and Admin API*
*Context gathered: 2026-07-23*
