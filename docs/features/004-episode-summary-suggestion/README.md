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
- provider selection via `EPISODE_SUMMARY_PROVIDER` (`gemini` or `llama`)
- current development configuration uses Gemini; the local Llama runtime remains a fallback
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
- the generated draft does not overwrite `episodes.summary`; the final database value is saved only when the admin form is submitted

## Editorial contract

The active prompt version is `4`. Gemini receives the complete transcript and uses it as the only source of facts.

- The output is in `pt-BR`, between 550 and 1800 characters, and has 3 to 8 complete editorial sentences before the highlights.
- The format follows the style observed in the production feed: emoji opening, short thematic hook, natural editorial paragraphs, `Destaques do episódio:` with 3 to 6 `•` items, audience recommendation, and an optional community CTA.
- Search terms are included only when central to the transcript. The prompt rejects keyword stuffing, invented themes, unsupported names, ads, credits, calls to social networks, and isolated jokes.
- The production feed is a static style reference used while designing the prompt. The worker never fetches the feed at generation time and never uses previous episodes as factual context.

## Verification

Run these checks after changing the workflow or prompt:

```bash
npm run typecheck
npm run build
npm run verify:summary-runtime-contract
npm run verify:summary-quality-contract
```

## Output

- `summary.txt`, a draft suggestion for the episode `summary` field
- `episode.state.json`, with `aiSummary` status, progress, timestamps, error, and prompt version
