# Episode Transcription Plan

## Goal

Add a transcript generation step for uploaded episode audio and store the result with the episode files.

## Scope

- run local transcription after upload
- save the transcript as `transcript.txt`
- clean the raw output before persisting it
- show background progress in the manage UI

## Prerequisite

- [Episode Media Layout Refactor](../002-episode-media-layout-refactor/README.md)

## Technical checklist

- keep episode transcripts beside the audio for the current implementation
- keep staging only for temporary upload handling
- generate transcript with `whisper.cpp`
- use `ggml-small.bin` as the baseline model
- remove timestamps and noise markers from the saved transcript
- keep the transcript editable or replaceable if the episode is reprocessed
- surface transcription progress in the UI

## Notes

- This feature intentionally stops at transcription.
- Summary generation belongs to the next feature track.
