# SQLite Migration Plan

## Goal

Replace the legacy database layer with SQLite while keeping the API, feed behavior, and admin workflows stable.

## Scope

- add the SQLite persistence layer
- define the normalized schema
- add read views for feed/admin usage
- replace repository access with SQLite-backed code
- update import tooling
- keep route contracts stable

## Technical checklist

- create tables for episodes, guests, music, references, and join tables
- preserve `episode_id` as the public/admin identifier
- keep RSS generation in application code
- keep media files on disk
- preserve legacy XML snapshots when available
- add tests and build verification

## Notes

- The migration is already implemented in the current backend.
- These notes remain useful as architectural reference and historical context.

