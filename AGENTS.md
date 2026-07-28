# AGENTS.md - dragaocareca-admin-api

## Mandatory Context Loading
1. Read `.planning/PROJECT.md` and `.planning/STATE.md` before any implementation.
2. Read the relevant `.planning/codebase/*.md` files before changing an established subsystem.
3. Use `.planning/` as the source of truth for architecture, constraints, milestone history, and deferred work.

## High-Signal Rules
- Keep feed generation server-side.
- Do not move scheduling/feed rules to frontend.
- Respect auth toggles:
  - backend `.env.dev`: `AUTH_BYPASS`
  - frontend env: `authBypass`
- Prefer minimal-scope changes and verify with `npm run typecheck` / `npm run build`.
- Telegram launch notifications live in the backend service:
  - queue + dedupe in `src/services/launch-notification.service.ts`
  - delivery in `src/services/telegram.service.ts`
  - startup worker in `src/workers/launch-notification.worker.ts`
- Use the WSL workspace layout:
  - `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api`
  - `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-web`
