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

## Output

- draft summary for the episode `summary` field

