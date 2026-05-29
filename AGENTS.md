# AGENTS.md - dragaocareca-admin-api

## Mandatory Context Loading
1. Read `docs/SDD.md` before any implementation.
2. Use SDD as source of truth for architecture and constraints.

## High-Signal Rules
- Keep feed generation server-side.
- Do not move scheduling/feed rules to frontend.
- Respect auth toggles:
  - backend `.env`: `AUTH_BYPASS`
  - frontend env: `authBypass`
- Prefer minimal-scope changes and verify with `npm run typecheck` / `npm run build`.
