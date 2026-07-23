# Phase 9: Summary Runtime and Draft Contract - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase defines the backend summary-generation runtime contract on top of the existing transcript workflow. It locks how `admin-api` reads the transcript, how summary generation is configured, and how draft summary output/state are stored so Phase 10 can expose the workflow through protected endpoints without changing the transcription engine.

</domain>

<decisions>
## Implementation Decisions

### Runtime contract
- **D-01:** Summary generation must stay configuration-driven inside `admin-api`; the implementation should use env-based runtime settings instead of hardwiring one model or CLI shape into service code.
- **D-02:** The summary runtime should read only the saved transcript as input and must preserve the current transcription engine unchanged for v1.2.
- **D-03:** Summary generation is a single sequential job per episode, designed to finish and stop once the suggestion text is produced.

### Draft artifact contract
- **D-04:** The generated draft summary should be persisted as its own text artifact, such as `summary.txt`, beside the episode files so later phases can return it directly to `admin-web`.
- **D-05:** The current draft state file should be renamed from a transcript-specific artifact into an episode-level file such as `episode.state.json`, so multiple workflow steps can share one state document.
- **D-06:** The shared episode state file should store child objects per workflow step, such as `transcript` and `aiSummary`, instead of creating separate state files for each step.
- **D-07:** Regenerating a summary should replace the previous draft suggestion artifact, but it must never overwrite the final `episodes.summary` database field automatically.
- **D-08:** `transcript.txt` must remain a pure transcript source file; summary text must not be prepended or appended into the transcript artifact.

### Final ownership and review flow
- **D-09:** After generation, the backend job is done; review, editing, replacement, or deletion of the text happens in `admin-web` before form submit.
- **D-10:** The final summary saved to the database is only the value submitted from the admin form, not the generated draft artifact itself.

### Summary writing rules
- **D-11:** Generated summaries must follow short, discovery-friendly `pt-BR` writing rules intended to improve natural internet search relevance without keyword stuffing.
- **D-12:** The prompt and validation contract should enforce: `2-4` short sentences, main topic in the opening sentence, `1-3` concrete searchable terms when supported by the transcript, explicit naming of relevant guests/franchises/games/themes when present, and a concise explanation of what the listener will hear or learn.
- **D-13:** The summary contract should explicitly avoid vague hype language, disconnected keyword lists, and any behavior that mixes SEO goals with unnatural writing.

### the agent's Discretion
Exact env var names and internal service boundaries are left to the agent, as long as the runtime stays env-driven, sequential, and consistent with the existing transcript workflow.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` — milestone goal, backend-only scope, VPS constraint, and locked out-of-scope items for v1.2.
- `.planning/REQUIREMENTS.md` — Phase 9 requirement mapping for `SUMM-01`, `FLOW-02`, and `OPS-01`.
- `.planning/ROADMAP.md` — Phase 9 goal, success criteria, and follow-on dependency into Phases 10 and 11.
- `.planning/STATE.md` — current milestone state and archive-related cautions that affect planning continuity.
- `docs/SDD.md` — architecture source of truth, env/config conventions, media layout expectations, and backend ownership rules.

### Existing transcript and summary feature intent
- `docs/features/003-episode-transcription/README.md` — current transcript workflow behavior and output location.
- `docs/features/003-episode-transcription/PLAN.md` — transcript implementation expectations that summary generation must build on top of.
- `docs/features/004-episode-summary-suggestion/README.md` — summary feature intent and current model-direction note.
- `docs/features/004-episode-summary-suggestion/PLAN.md` — draft summary workflow expectations, including transcript-only input and publish-friendly output.
- `docs/TODO.md` — deferred tech debt note confirming that transcription engine re-evaluation is out of scope for v1.2.

### Backend runtime and integration points
- `src/config/env.ts` — existing env-driven runtime configuration pattern that Phase 9 should follow for summary settings.
- `src/services/episode-transcription.service.ts` — current sequential/draft transcription workflow, state handling, and CLI execution pattern to mirror where appropriate.
- `src/services/episode-media-layout.service.ts` — episode-scoped final/staging path helpers, transcript path helpers, and storage conventions that should be extended for a shared episode-level state artifact.
- `src/routes/episodes.routes.ts` — current protected admin route patterns and transcription status exposure that Phase 10 will likely extend.
- `src/database/repositories/episode.repository.ts` — current episode persistence contract, especially the rule that final summary persists only through normal episode save/update paths.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/episode-transcription.service.ts`: already implements a local CLI-backed, sequential background workflow with draft-state persistence that can anchor the summary runtime design.
- `src/services/episode-media-layout.service.ts`: already centralizes episode-scoped transcript and staging/final path helpers; the summary feature should extend this path ownership rather than hardcoding file paths.
- `src/config/env.ts`: already groups feature-specific env config blocks, making it the right place for summary runtime/model settings.

### Established Patterns
- Long-running AI-adjacent work is backend-owned and env-driven rather than frontend-owned.
- Draft workflow state is file-backed around the episode media layout, while the final editable episode document remains in SQLite.
- Input and output artifacts should stay separated by role: transcript as source, summary as generated suggestion, shared state as operational metadata.
- Protected episode operations use thin Express routes that delegate runtime behavior to services.

### Integration Points
- Phase 9 should add summary-runtime primitives in backend services, not in route handlers.
- The summary workflow should read the existing `transcript.txt` artifact from the episode folder or draft path conventions already owned by the media-layout service.
- The current `transcript.state.json` pattern should evolve into a shared episode-level state file, likely `episode.state.json`, with separate child objects for transcript and summary-generation state.
- The persisted draft summary text should be shaped so Phase 10 can return it to a protected admin endpoint without also mutating `episodes.summary`.

</code_context>

<specifics>
## Specific Ideas

- Use the existing transcription workflow as the implementation reference for runtime shape and file ownership, but do not change the transcription engine itself.
- Keep the generated summary as a backend-managed suggestion artifact that `admin-web` can load into the form; the saved database summary remains whatever the user submits afterward.
- Treat “CEO best practices” here as natural discovery-friendly writing rules inside the prompt contract, not as literal SEO keyword stuffing.

</specifics>

<deferred>
## Deferred Ideas

- `admin-web` behavior for prefilling, editing UX, and acceptance/rejection controls belongs to a later frontend milestone.
- Any change to the transcription runtime or broader AI drafting beyond summary text remains deferred outside Phase 9.

</deferred>

---
*Phase: 9-Summary Runtime and Draft Contract*
*Context gathered: 2026-07-23*
