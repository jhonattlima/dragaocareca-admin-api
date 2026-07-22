# dragaocareca-admin-api

## What This Is

An admin and public API service for Dragao Careca. It already manages podcast episodes, media, feed generation, notifications, and supporting backend workflows; this milestone adds backend-owned public JSON contracts so `dragaocareca_frontend` can render the live site without relying on legacy PHP endpoints.

## Current Milestone: v1.1 Public Frontend API Responses

**Goal:** Replace the legacy public PHP data sources with distinct backend JSON endpoints that serve the home page and the other public frontend pages.

**Target features:**
- Public episodes catalog endpoint for the home page
- Public episode detail endpoint for `/episode/:id`
- Public people/contacts endpoint for author and credit rendering
- Public site metadata endpoint for shared social/email/support links
- Public supporters endpoint for the guilda/supporters page

## Core Value

Serve the public frontend with stable backend-owned data contracts so page rendering no longer depends on legacy PHP responses or client-side reconstruction rules.

## Requirements

### Validated

- Feed generation is backend-owned and already uses SQLite as the source of truth.
- Episode management, media storage, Telegram launch notifications, and transcription workflows are already implemented in this backend.
- The current public site behavior and the `dragaocareca_frontend` repo provide a concrete reference for the required public data shapes.

### Active

- [ ] Expose a public episodes catalog endpoint that returns only published episodes in frontend-ready order.
- [ ] Expose a public episode detail endpoint that serves the episode page without fetching the full catalog.
- [ ] Expose a dedicated people/contacts endpoint for authors and credit resolution.
- [ ] Expose a dedicated site metadata endpoint for shared public-page configuration.
- [ ] Expose a dedicated supporters endpoint using `supporters` terminology instead of `patreon`.

### Out of Scope

- Moving feed generation or publication rules to the frontend — feed logic stays server-side.
- A single mega-endpoint for all public pages — the scope is distinct endpoints by concern.
- Public frontend redesign work — this milestone provides data contracts, not UI changes.
- Replacing the admin authentication model — auth bypass and admin auth behavior remain as-is.

## Context

The production site at `https://dragaocareca.com/#/` currently depends on legacy endpoints such as `index.php`, `contacts.php`, and `patreon.php`, plus hardcoded frontend config for social links and media URL conventions. The backend already owns the canonical episode data and media layout, so the public frontend should consume backend-defined JSON endpoints instead of reverse-engineering URLs and joining multiple legacy sources.

## Constraints

- **Architecture**: Keep feed generation server-side — the frontend must not own scheduling or feed assembly rules.
- **Source of truth**: SQLite episode data remains canonical for public episode responses.
- **Compatibility**: Use the existing production site and local `dragaocareca_frontend` repo as the behavioral contract to replace.
- **Scope**: Prefer minimal backend-focused changes that can be verified with `npm run typecheck` and `npm run build`.
- **Terminology**: Use `supporters` naming in public contracts instead of `patreon`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace legacy public PHP responses with backend-owned JSON endpoints | The backend already owns canonical content and media rules | — Pending |
| Keep public data split across distinct endpoints | Matches the requested scope and avoids one oversized contract | — Pending |
| Treat the live site and `dragaocareca_frontend` repo as the migration reference | They define the real public data needs better than a greenfield spec | — Pending |

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
*Last updated: 2026-07-21 after milestone v1.1 definition*
