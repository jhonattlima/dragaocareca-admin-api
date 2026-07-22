# Episode Media Layout Refactor Plan

## Goal

Move episode assets into one canonical folder per episode.

## Scope

- reorganize episode media into `data/media/episodes/<episodeId>/`
- keep staging folders only for temporary upload handling in `data/media/staging/<episodeId>/`
- keep audio, trailer, cover, webp cover, and transcript together
- preserve backward compatibility while migrating existing files

## Technical checklist

- define the new per-episode media path structure
- update upload and delete flows to read and write the new layout
- keep old file roots readable during the transition migration only
- migrate existing media into the new structure
- update documentation and environment variable references

## Notes

- This feature should be completed before transcription and summary generation fully depend on the new layout.
- The backend implementation is now in place and the startup migration runs automatically.
