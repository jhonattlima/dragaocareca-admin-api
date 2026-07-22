# Episode Media Layout Refactor

This feature covers reorganizing episode-related files into a single episode-centric folder structure.

Purpose:

- keep audio, trailer, cover, webp cover, and transcript together
- make cleanup and reprocessing easier
- simplify future AI features that operate on a full episode bundle

Implementation plan:

- [PLAN.md](./PLAN.md)

## Scope

- refactor the episode media layout
- keep compatibility with the existing type-based roots during migration
- make new writes target the episode folder structure

Current implementation:

- startup migration moves existing media files into the episode folder layout
- new uploads, deletions, and backups resolve episode-relative paths
- transcript storage now follows the same episode-folder convention
- legacy top-level trailer/image folders are no longer used by new writes
- staging now lives under `data/media/staging/<episodeId>/`
- backups now live under `data/media/backups/<episodeId>/`
