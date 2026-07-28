# Phase 11: Summary Quality Verification and Documentation - Research

**Gathered:** 2026-07-23  
**Status:** Ready for planning

## Research Summary

The summary workflow is already implemented in the backend. Phase 11 should harden it in two ways:

- add executable quality checks that prove the generated output stays short, Portuguese-BR, transcript-only, and structurally valid
- update durable docs so operators know how the summary workflow is configured and run on the VPS

## Recommended Route

1. Extend or complement the existing summary verifier with a quality-focused script that tests valid and invalid summary outputs against the service contract.
2. Update `.planning/PROJECT.md` so the summary env vars, artifact paths, and workflow boundary are documented alongside the rest of the backend contract.
3. Update the summary feature README and VPS setup guide so operators can see the runtime dependencies, sequence constraints, and output ownership rules.

## Backend Wiring Points

- `src/scripts/verify-summary-runtime-contract.ts`
  - candidate base for additional quality assertions or quality-mode reuse
- `src/services/episode-summary.service.ts`
  - source of truth for prompt, validation, and draft artifact boundaries
- `.planning/PROJECT.md`
  - canonical source-of-truth doc for runtime config and workflow ownership
- `.planning/milestones/v1.2-ROADMAP.md`
  - operator-facing feature summary and reference choices
- `.planning/codebase/OPERATIONS.md`
  - VPS runtime dependencies and bootstrap guidance

## Gray Areas / Risks

- The quality contract needs to check behavior, not just text length; otherwise it will miss regressions where the summary becomes structurally weak or loses the transcript-only prompt contract.
- Documentation should reflect the current implementation, including the env-driven summary runtime and the actual file locations used by the backend.
- The transcription runtime stays out of scope and should not be edited as part of phase 11.

## Locked Assumptions

- Summary outputs must remain 2-4 sentences and 80-420 characters, in Portuguese-BR, and derived only from the transcript.
- The summary suggestion is draft data stored beside the episode files, not the final saved episode summary.
- No frontend integration is needed in this repo phase.

