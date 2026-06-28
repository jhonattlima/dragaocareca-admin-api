# 002 - SQLite API Implementation Plan

## Summary
Replaced the legacy persistence layer in `dragaocareca-admin-api` with SQLite while keeping the HTTP contract stable for the admin UI and feed consumers.

Status: implemented and verified in the backend codebase.

The implementation should preserve:
- current auth behavior
- current media upload behavior
- current RSS feed rules
- current episode identifiers
- current frontend request/response expectations where practical

The backend should expose the same routes, but read/write from SQLite tables and views instead of the previous ORM-backed models.

## Implementation Order

### 1. Add SQLite foundation
- Add a SQLite driver and a small persistence module.
- Initialize the database connection at startup.
- Enable WAL mode and foreign keys.
- Create a single source for the database file path via config/env.
- Keep the existing dev bypass and JWT auth logic intact.

### 2. Define SQL schema and migrations
- Create migrations for:
  - `episodes`
  - `episode_references`
  - `guests`
  - `guest_references`
  - `music`
  - `music_references`
  - `episode_guests`
  - `episode_music`
  - `settings`
- Add indexes for:
  - `episodes.episode_id`
  - `episodes.pub_date`
  - foreign keys on association/reference tables
- Add uniqueness constraints where needed:
  - `episode_id`
  - optional unique active reference ordering if useful later

### 3. Add read views
- Create a feed-oriented view for published episodes.
- Create an admin-oriented view that assembles the episode record and associated child rows into a queryable shape.
- Keep RSS XML generation in application code, using SQLite query results as input.

### 4. Replace repository access
- Replace `EpisodeModel` usage with a SQLite repository/service layer.
- Keep route handlers thin and preserve route names and response semantics.
- Translate nested arrays and associations into normalized rows on write.
- Translate normalized rows back into the current API shape on read.

### 5. Update feed generation
- Query SQLite for published episodes only in the public feed.
- Query all episodes for preview.
- Keep legacy `xmlSnapshot` fallback behavior.
- Keep feed metadata driven by app config/settings, not frontend code.

### 6. Update import/migration tooling
- Add an import path from the existing legacy JSON data into SQLite.
- Make imports idempotent by `episode_id`.
- Preserve media filenames, pub dates, and legacy XML when available.

### 7. Update docs and API schema
- Update README and SDD to describe SQLite as the source of truth.
- Update Swagger schemas to reflect the normalized backend behavior only where the API contract changes.
- Document the new settings model and entity/reference relationships.
- Completed for the current backend implementation.

## Data Model Rules

- `episodes` remains the canonical episode record.
- `guests` and `music` are distinct entities.
- `episode_references` stores episode-specific URLs and promotions.
- `guest_references` stores multiple links for a guest.
- `music_references` stores multiple links for a music item.
- History is preserved by deactivating references instead of overwriting them.
- `label` is the human-readable name for a reference row.

## API Compatibility Rules

- Keep `GET /health` unchanged.
- Keep `GET /v1/feed` public and dynamic.
- Keep auth routes unchanged.
- Keep episode route paths unchanged.
- Keep file upload/delete endpoints unchanged.
- Keep `AUTH_BYPASS` semantics unchanged in development.

If any response shape must change, prefer additive fields over breaking ones.

## Verification Plan

- Clean install and startup should create or migrate the SQLite schema successfully.
- `npm run typecheck` should pass.
- `npm run build` should pass.
- Public feed should exclude future episodes.
- Preview feed should include scheduled episodes.
- Episode CRUD should still support create, update, fetch, and list flows.
- Guest/music/reference relationships should round-trip correctly.
- Import should preserve legacy episode counts and key fields.
- Verification completed successfully in this workspace.

## Assumptions

- SQLite will run in a single-writer, low-volume deployment model.
- Existing media files remain on disk.
- The frontend should not require a major rewrite.
- Feed XML generation stays in Node.
- The old data can be treated as migration input rather than a live dependency.
