# Episode Transcription

This feature covers generating and storing a transcript for each uploaded episode.

Purpose:

- convert episode audio into text
- store the transcript with the episode's own files
- provide the transcript as the base input for later AI features

This track assumes the media layout refactor is completed first so the transcript can live beside the rest of the episode files.

Current implementation:

- the backend now queues transcription when episode audio is promoted into place
- transcript state is stored on the episode row
- the manage form can show the current transcription status
- transcripts are written as `data/media/episodes/<episodeId>/transcript.txt`
- the feature is implemented and ready for VPS testing once the runtime dependencies are installed

Implementation plan:

- [PLAN.md](./PLAN.md)

## Reference choices

- local Whisper-family transcription
- `whisper.cpp`
- `ggml-small.bin`

## Output

- `transcript.txt`
