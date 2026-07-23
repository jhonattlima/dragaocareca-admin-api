# Episode Summary Suggestion

This feature covers generating a draft summary from the episode transcript.

Purpose:

- read the transcript as the only source of context
- generate a suggested summary in Portuguese-BR
- keep the result editable before publish

Implementation plan:

- [PLAN.md](./PLAN.md)

## Reference choices

- transcript-only generation
- `Qwen2.5-3B-Instruct q3_k_m`

## Deferred follow-up

- v1.2 should assume the current transcript pipeline stays unchanged.
- Any revisit of the transcription engine belongs to deferred tech debt, not this milestone.
- See [TODO.md](../../TODO.md#td-001-re-evaluate-the-local-transcription-engine-before-changing-the-transcript-pipeline).

## Output

- draft summary for the episode `summary` field
