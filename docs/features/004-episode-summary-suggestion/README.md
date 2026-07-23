# Episode Summary Suggestion

This feature covers generating a draft summary from the episode transcript.

Purpose:

- read the transcript as the only source of context
- generate a suggested summary in Portuguese-BR
- keep the result editable before publish
- keep the draft summary separate from the final database summary value
- reuse the backend summary endpoint from the API instead of inventing a frontend-only flow

Implementation plan:

- [PLAN.md](./PLAN.md)

## Reference choices

- transcript-only generation
- operator-configured local summary runtime via `EPISODE_SUMMARY_*`
- published summary quality rules from [docs/SDD.md](../../SDD.md)

## Deferred follow-up

- v1.2 should assume the current transcript pipeline stays unchanged.
- Any revisit of the transcription engine belongs to deferred tech debt, not this milestone.
- See [TODO.md](../../TODO.md#td-001-re-evaluate-the-local-transcription-engine-before-changing-the-transcript-pipeline).

## Runtime contract

- the backend reads `transcript.txt` as the only input
- the summary draft is stored beside the episode files as `summary.txt`
- `episode.state.json` tracks transcript and AI-summary status together
- the backend exposes `GET /v1/episodes/:episodeId/episodes-generated-summary`
- summary generation runs automatically after transcript completion and after transcript updates
- there is no manual refresh or requeue action in the current UI scope
- the generated draft must stay short, discovery-friendly, and written in `pt-BR`

## Output

- draft summary for the episode `summary` field
