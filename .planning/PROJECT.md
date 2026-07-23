# dragaocareca-admin-api

## What This Is

An admin and public API service for Dragao Careca. It manages podcast episodes, media, feed generation, notifications, supporting backend workflows, and backend-owned public JSON contracts for the live/public frontend.

## Current State

- Latest shipped milestone: **v1.1 Public frontend API responses** on 2026-07-23
- Public API surface now includes episode catalog, episode detail, site metadata, contacts/social/about, and supporters endpoints under `/v1/public/*`
- Next planning step: execute **v1.2 Episode AI authoring API**

## Current Milestone: v1.2 Episode AI authoring API

**Goal:** Add backend-only summary suggestion support so episode metadata can be prepared faster from the existing transcript workflow.

**Target features:**
- Summary suggestion generation from the transcript `.txt` already produced by the current transcription workflow
- Sequential transcript-to-summary processing inside `admin-api`
- Suggested summary persisted in the episode folder for reuse/review before episode save
- Backend API surface only for this milestone; `admin-web` integration will be a later milestone

## Core Value

Serve the public frontend with stable backend-owned data contracts so page rendering no longer depends on legacy PHP responses or client-side reconstruction rules.

## Requirements

### Validated

- Feed generation is backend-owned and already uses SQLite as the source of truth.
- Episode management, media storage, Telegram launch notifications, and transcription workflows are already implemented in this backend.
- The current public site behavior and the `dragaocareca_frontend` repo provide a concrete reference for the required public data shapes.
- Public episodes catalog and episode-detail endpoints are implemented under `/v1/public/episodes` and `/v1/public/episodes/:episodeId`.
- Public site endpoints are implemented under `/v1/public/about`, `/v1/public/contact`, `/v1/public/social`, `/v1/public/contacts`, and `/v1/public/site-config`.
- Public supporters data is implemented under `/v1/public/supporters` with `supporters` terminology and documented in the backend OpenAPI/feature docs.

### Active

- [ ] Generate a suggested episode summary from the existing transcript only.
- [ ] Keep summary generation sequential and lightweight enough for the 4 GB VPS target.
- [ ] Persist the suggested summary as backend-managed draft data beside the episode files.
- [ ] Expose protected backend APIs to trigger, inspect, and reuse summary suggestions.

### Out of Scope

- Moving feed generation or publication rules to the frontend — feed logic stays server-side.
- A single mega-endpoint for all public pages — the scope is distinct endpoints by concern.
- Public frontend redesign work — this milestone provides data contracts, not UI changes.
- Replacing the admin authentication model — auth bypass and admin auth behavior remain as-is.
- `admin-web` integration for pre-filling the summary field — defer to a later milestone in the frontend project.
- Replacing the current Whisper-family transcription engine during v1.2 — tracked as deferred tech debt in `docs/TODO.md`.
- Generating anything beyond summary text (title, tags, guests, etc.) — summary only in this milestone.

## Context

The backend already owns episode media layout and transcript generation. Transcripts are written into the episode folder and are now the source input for the next AI feature track: generating a summary suggestion inside `admin-api`. This milestone intentionally focuses on the backend workflow only; the frontend integration that consumes the suggestion will happen later in the frontend project.

## Constraints

- **Architecture**: Keep feed generation server-side — the frontend must not own scheduling or feed assembly rules.
- **Source of truth**: SQLite episode data remains canonical for public episode responses.
- **Compatibility**: Use the existing production site and local `dragaocareca_frontend` repo as the behavioral contract to replace.
- **Scope**: Prefer minimal backend-focused changes that can be verified with `npm run typecheck` and `npm run build`.
- **Terminology**: Use `supporters` naming in public contracts instead of `patreon`.
- **Runtime**: The Hostinger VPS target has 4 GB RAM — AI work must run sequentially and stay lightweight.
- **Integration**: Reuse the existing transcript workflow rather than redesigning transcription in this milestone.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace legacy public PHP responses with backend-owned JSON endpoints | The backend already owns canonical content and media rules | ✓ Good |
| Keep public data split across distinct endpoints | Matches the requested scope and avoids one oversized contract | ✓ Good |
| Treat the live site and `dragaocareca_frontend` repo as the migration reference | They define the real public data needs better than a greenfield spec | ✓ Good |
| Add a repo-native public-catalog verification script | Sandbox networking made localhost validation unreliable | ✓ Good |
| Defer transcription-engine re-evaluation out of v1.2 | Summary generation can proceed on top of the existing transcript pipeline | — Pending |

## Archived Milestones

<details>
<summary>v1.1 Public frontend API responses</summary>

Goal:
Replace the legacy public PHP data sources with distinct backend JSON endpoints that serve the home page and the other public frontend pages.

Target features:
- Public episodes catalog endpoint for the home page
- Public episode detail endpoint for `/episode/:id`
- Public people/contacts endpoint for author and credit rendering
- Public site metadata endpoint for shared social/email/support links
- Public supporters endpoint for the guilda/supporters page

</details>

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-23 after defining milestone v1.2*
