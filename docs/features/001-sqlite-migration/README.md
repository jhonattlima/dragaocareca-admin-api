# SQLite Migration

This feature covers the move from the legacy persistence layer to SQLite as the source of truth.

Purpose:

- keep the API surface stable
- preserve feed behavior
- normalize episodes, guests, music, and references into explicit tables
- keep the migration readable and maintainable

Implementation plan:

- [PLAN.md](./PLAN.md)

## Status

- implemented and verified in the backend codebase

