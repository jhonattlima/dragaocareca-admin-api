# Phase 09 Coverage Matrix

Visible integration coverage for the Phase 09 local summary runtime contract.

## Integration Matrix

| Surface | Type | Planned owner | Config / Inputs | Guardrails | Verification target |
|---------|------|---------------|-----------------|------------|---------------------|
| `llama-cli` or equivalent `EPISODE_SUMMARY_COMMAND` binary | local runtime service | `src/services/episode-summary.service.ts` | `EPISODE_SUMMARY_COMMAND`, `EPISODE_SUMMARY_MODEL_PATH`, `EPISODE_SUMMARY_TIMEOUT_MS` | Use `execFile()` argument arrays only; no shell interpolation; fail closed when command or model path is missing | `npm run build`, `npm run verify:summary-runtime-contract` |
| GGUF model file | operator-managed runtime asset | `config.summary.modelPath` contract in `src/config/env.ts` | `EPISODE_SUMMARY_MODEL_PATH` | No hardcoded model path in service code; surface configuration errors in draft state instead of crashing unrelated flows | `npm run typecheck`, `npm run verify:summary-runtime-contract` |
| `transcript.txt` | transcript-only source artifact | `src/services/episode-media-layout.service.ts` and `src/services/episode-summary.service.ts` | Episode media path helpers only | Summary runtime reads transcript text only, never audio bytes or `episodes.summary`; transcript stays unchanged | `npm run verify:summary-runtime-contract` |
| `summary.txt` | generated draft artifact | `src/services/episode-summary.service.ts` | Generated output from transcript-only prompt | Regeneration replaces the prior suggestion; draft artifact stays separate from `transcript.txt` and SQLite `episodes.summary` | `npm run verify:summary-runtime-contract` |
| `episode.state.json` | shared workflow state | `src/schemas/episode-draft-state.ts`, `src/services/episode-transcription.service.ts`, `src/services/episode-summary.service.ts` | Transcript and summary child objects with versioned state | Canonical write target after Phase 09; legacy `transcript.state.json` is read-only fallback during migration | `npm run verify:summary-runtime-contract` |

## Assumption Delta

- Identity-model shift for this phase: draft workflow state is generalized from a transcript-only file (`transcript.state.json`) into an episode-level state document (`episode.state.json`) with sibling `transcript` and `aiSummary` objects.
- External-service scope for this matrix: the phase integrates an operator-managed local LLM runtime, not a hosted HTTP API. Coverage therefore focuses on command/config/artifact boundaries rather than remote endpoints.
