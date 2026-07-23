# Phase 11: Summary Quality Verification and Documentation - Context

**Gathered:** 2026-07-23  
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase hardens the implemented summary workflow by adding executable quality verification and durable operational documentation. It does not change the summary generation contract itself; it verifies that the current transcript-to-summary workflow stays short, Portuguese-BR, sequential, and safe to operate on the VPS.

</domain>

<decisions>
## Implementation Decisions

### Verification
- **D-01:** Summary quality verification must be executable from the repo, using backend service/script code rather than manual inspection.
- **D-02:** The quality contract should validate the generated summary shape, not just the runtime plumbing: short Portuguese-BR output, 2-4 sentences, transcript-only input, and rejection of invalid/overlong draft output.
- **D-03:** Verification should remain backend-only and not require live HTTP or frontend interaction.

### Documentation
- **D-04:** `docs/SDD.md` must reflect the summary runtime contract as a source-of-truth addition, including env configuration, file locations, and the summary workflow boundary.
- **D-05:** The summary feature README should explain the transcript-only input, output artifact location, and quality rules in operator-friendly language.
- **D-06:** VPS documentation should describe the summary worker/runtime dependencies and the sequential 4 GB deployment constraint.

### Scope fences
- **D-07:** The transcription engine remains deferred tech debt and must not be changed during phase 11.
- **D-08:** `admin-web` integration remains out of scope; phase 11 is backend verification and documentation only.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` - milestone goal, backend-only scope, VPS constraint, and excluded frontend work.
- `.planning/REQUIREMENTS.md` - requirement mapping for `SUMM-02`, `OPS-02`, and `DOC-01`.
- `.planning/ROADMAP.md` - v1.2 phase sequence and phase 11 dependency.
- `.planning/STATE.md` - current milestone status and continuity constraints.
- `docs/SDD.md` - architecture source of truth, env/config conventions, media layout expectations, and backend ownership rules.

### Existing summary implementation
- `src/services/episode-summary.service.ts` - summary runtime contract, validation rules, and artifact boundaries.
- `src/scripts/verify-summary-runtime-contract.ts` - existing executable verification surface that phase 11 should extend or complement.
- `src/services/episode-transcription.service.ts` - transcript prerequisite and lifecycle behavior that summary verification depends on.
- `src/routes/episodes.routes.ts` - protected summary read endpoint shape that should remain compatible with summary docs.

### Documentation sources
- `docs/features/004-episode-summary-suggestion/README.md` - current feature summary and reference choices.
- `docs/features/004-episode-summary-suggestion/PLAN.md` - feature intent and operational constraints.
- `docs/VPS-SETUP.md` - VPS runtime dependencies and worker bootstrap guidance.
- `docs/TODO.md` - deferred transcription-engine re-evaluation that must remain out of this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- `src/services/episode-summary.service.ts` already enforces the summary prompt, size bounds, sentence bounds, and transcript-only runtime contract.
- `src/scripts/verify-summary-runtime-contract.ts` already proves the backend runtime boundary and can be extended with stricter quality cases.
- `src/routes/episodes.routes.ts` already exposes the protected summary read endpoint and should stay backend-thin.

### Established patterns
- Backend verification in this repo favors compiled-output scripts rather than live localhost HTTP.
- Documentation should describe the current contract as implemented, not as a future wish list.
- The summary workflow remains backend-owned and sequential under VPS constraints.

### Integration points
- Phase 11 should add a quality-focused executable verifier or quality mode that exercises the existing summary service contract.
- Phase 11 should update durable docs to reflect summary env vars, file paths, runtime dependencies, and the sequential VPS operating model.

</code_context>

<specifics>
## Specific Ideas

- Use a fake runtime or focused helper cases to prove the summary validator rejects outputs that are too short, too long, or structurally invalid.
- Document the summary artifact as `summary.txt` alongside `episode.state.json`, and describe the final database summary as user-owned after form submit.
- Explain that the summary workflow is transcript-only and does not change the transcription engine.

</specifics>

<deferred>
## Deferred Ideas

- Re-evaluating `whisper.cpp` versus other transcription engines stays in `docs/TODO.md` and is not part of this phase.
- `admin-web` prefilling and review UX remain a later milestone in the frontend repo.

</deferred>

---
*Phase: 11-Summary Quality Verification and Documentation*
*Context gathered: 2026-07-23*
