# Episode Transcription

This feature covers generating and storing a transcript for each uploaded episode.

Purpose:

- convert episode audio into text
- store the transcript with the episode's own files
- provide the transcript as the base input for later AI features

This track assumes the media layout refactor is completed first so the transcript can live beside the rest of the episode files.

Current implementation:

- the backend now queues transcription when episode audio is promoted into place
- transcription state is stored in the shared `episode.state.json` artifact; existing episode-row fields remain compatible with the prior flow
- the manage form can show the current transcription status
- transcripts are written as `data/media/episodes/<episodeId>/transcript.txt`
- completion automatically queues the summary suggestion job
- a transcript replacement or reprocessing also queues a new summary suggestion after the updated transcript is complete

Implementation plan:

- [PLAN.md](./PLAN.md)

## Runtime choices

- `internal`: local Whisper-family transcription through `whisper.cpp` and `ggml-small.bin`
- `gemini`: temporary audio upload to Gemini Files API followed by `gemini-3.6-flash` transcription
- both providers write the same `transcript.txt` and trigger the summary job after completion

The selected provider is controlled by `EPISODE_TRANSCRIPTION_PROVIDER`. The current development configuration uses `gemini`; keep `internal` configured as the local fallback for later quality, cost, and VPS comparisons.

## Output

- `transcript.txt`
- `episode.state.json`, containing both transcript and AI-summary progress

## Deferred follow-up

- Compare Gemini quality, cost, quota, and privacy behavior against the local runtime before finalizing the production default.
- See [TODO.md](../../TODO.md#td-001-re-evaluate-the-local-transcription-engine-before-changing-the-transcript-pipeline).
