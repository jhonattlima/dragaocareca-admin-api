# Pre-GSD Feature History

This archive preserves the completed feature notes that predated the current GSD phase artifacts. Current architecture lives in `.planning/codebase/`; active work lives in `ROADMAP.md` and `STATE.md`.

## SQLite migration

The backend moved from the legacy persistence layer to SQLite while preserving feed and admin behavior. The normalized schema covers episodes, guests, music, references, and join tables; `episode_id` remains the public/admin identifier. RSS remains application-generated and legacy XML snapshots remain available when present.

## Episode media layout

Episode media uses `data/media/episodes/<episodeId>/` as its canonical layout. Audio, trailer, covers, transcripts, and AI draft artifacts stay together. Staging uses `data/media/staging/<episodeId>/`; backups use `data/media/backups/<episodeId>/`. Startup migration preserves compatibility with legacy type-based roots while new writes target the episode folder.

## Earlier feature mapping

| Retired feature document | GSD authority |
|---|---|
| Telegram launch notifications | `.planning/ROADMAP.md` phases 1-4 and current codebase maps |
| SQLite migration | this archive and `.planning/codebase/ARCHITECTURE.md` |
| Episode media layout | this archive and `.planning/codebase/STRUCTURE.md` |
| Episode transcription | `.planning/milestones/v1.2-ROADMAP.md`, phases 9-11, and `.planning/codebase/OPERATIONS.md` |
| Episode summary suggestion | `.planning/milestones/v1.2-ROADMAP.md`, phases 9-11, and `.planning/codebase/OPERATIONS.md` |
| Public frontend API | `.planning/milestones/v1.1-ROADMAP.md` and OpenAPI source |
