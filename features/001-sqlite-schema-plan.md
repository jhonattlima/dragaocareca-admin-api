# 001 - SQLite Schema Migration Plan

## Summary
Replaced the legacy database layer with SQLite while keeping the API surface and feed behavior stable.

Status: implemented and verified in the backend codebase.

The schema should reflect the domain explicitly:
- `episodes` as the central table
- `guests` and `music` as separate entities
- `episode_references` for episode-level URLs and promotions
- `guest_references` and `music_references` for multiple external links per entity
- `episode_guests` and `episode_music` join tables for episode associations
- `settings` for static feed/app metadata
- SQLite views for feed/admin read models

This model preserves history, avoids a generic polymorphic reference table, and keeps the database readable.

## Recommended Schema

### `episodes`
Core podcast episode record.

Suggested fields:
- `id` integer primary key
- `episode_id` unique integer, matching the current public/admin identifier
- `title`
- `description` or `summary`
- `episode_number`
- `episode_type`
- `pub_date`
- `duration`
- `bytes`
- `explicit`
- `file_name`
- `cover_file_name`
- `cover_low_file_name`
- `trailer_file_name`
- `youtube`
- `spotify_id`
- `xml_snapshot`
- timestamps

### `episode_references`
Links attached to an episode.

Suggested fields:
- `id` primary key
- `episode_id` foreign key
- `label`
- `url`
- `is_active`
- `sort_order`
- timestamps

Use this for:
- other episode URLs
- promotions
- external sites
- episode-specific references

### `guests`
People invited to participate in a podcast episode.

Suggested fields:
- `id` primary key
- `name`
- `notes`
- timestamps

### `guest_references`
Multiple social/profile links for a guest.

Suggested fields:
- `id` primary key
- `guest_id` foreign key
- `label`
- `url`
- `is_primary`
- `is_active`
- `sort_order`
- timestamps

This supports:
- multiple social media profiles
- replacing old links without deleting history
- primary link selection

### `music`
Music references used by the editor in an episode.

Suggested fields:
- `id` primary key
- `name`
- `notes`
- timestamps

### `music_references`
Multiple links for a music item.

Suggested fields:
- `id` primary key
- `music_id` foreign key
- `label`
- `url`
- `is_primary`
- `is_active`
- `sort_order`
- timestamps

### Join tables
Use join tables for episode associations.

`episode_guests`:
- `episode_id`
- `guest_id`
- optional `sort_order`
- optional `role_label`

`episode_music`:
- `episode_id`
- `music_id`
- optional `sort_order`
- optional `usage_note`

### `settings`
Static configuration and feed metadata.

Suggested fields:
- `key` unique text
- `value` text
- `updated_at`

Use this for feed metadata currently coming from `FEED_*` env vars when you want it editable in-app.

## Views

Use SQLite views for read models, not for RSS XML generation.

Suggested views:
- `v_episode_feed`
  - episode rows suitable for feed generation
  - live feed still filters by `pub_date <= now`
- `v_episode_admin`
  - episode rows with aggregated references and associations
  - useful for returning the current admin API shape

The RSS XML should still be rendered in Node from database rows.

## Migration Approach

- Introduce SQLite with a small data-access layer.
- Add SQL migrations for tables, foreign keys, indexes, and views.
- Keep file storage on disk unchanged.
- Preserve the current API contract so the frontend does not need a rewrite.
- Add a one-time importer from the existing legacy dataset into SQLite.
- Keep auth config in environment variables:
  - `GOOGLE_CLIENT_ID`
  - `JWT_SECRET`
  - `ALLOWED_GOOGLE_EMAILS`
  - `AUTH_BYPASS`
- Verified with `npm run typecheck` and `npm run build`.

## Why This Model

This structure is a better fit than a single generic credits table because:
- guests and music are different entities with different meaning and lifecycle
- episode-level links are distinct from guest/music profile links
- history matters for external links, so references should be first-class rows
- SQLite stays simple when the schema mirrors the domain directly

## Test Plan

- Verify migrations create all tables, indexes, and views from a clean database.
- Verify episode CRUD still round-trips the current API payload shape.
- Verify guest and music references support multiple active links.
- Verify old references remain in history when replaced or deactivated.
- Verify feed output still excludes future episodes in the public endpoint.
- Verify preview includes scheduled episodes.
- Verify imported data preserves IDs, titles, pub dates, and media filenames.
- Run `npm run typecheck` and `npm run build` after the migration work.

## Assumptions

- SQLite will be used in a single-writer, low-volume deployment model.
- `label` is the only human-readable name column needed on reference rows.
- References are history-preserving and should not be overwritten in place.
- Feed generation remains in application code.
- The current admin/frontend API shape should stay stable where practical.
