# dragaocareca-admin-api

## What This Is

An admin API service for Dragao Careca that already manages podcast episodes and generates the public feed. The next step is to integrate the `dona-sonja-turbo` bot behavior into this backend so it can notify a specific Telegram group when a new episode is published.

## Core Value

Notify the right Telegram group quickly and reliably whenever a new podcast episode is launched.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Detect new podcast episode launches without duplicate notifications.
- [ ] Send a Telegram message to the configured group when a new episode is detected.
- [ ] Run the bot logic as part of the `dragaocareca-admin-api` backend process on the VPS.
- [ ] Allow bot and Telegram configuration to be set through the service environment or config.

### Out of Scope

- Manual notification sending — the project is for automatic episode alerts.
- Multiple Telegram groups or channels — the current need is a specific group only.
- Full podcast management features — this work only covers launch detection and notification.

## Context

This project integrates the existing `dona-sonja-turbo` bot behavior into `dragaocareca-admin-api`. The current codebase already stores episodes in MongoDB and serves a feed from the backend, so the new work should hook into that backend lifecycle instead of creating a separate service.

## Constraints

- **Deployment**: Must run on the VPS alongside `dragaocareca-admin-api` — the integration is part of the server deployment model.
- **Messaging**: Telegram notifications must go to a specific group — the target audience is fixed for v1.
- **Reliability**: Episode detection must avoid duplicate alerts — repeated notifications would reduce trust.
- **Architecture**: Prefer backend-internal integration over a second standalone service — the repo already owns episode state and publish rules.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat `dragaocareca-admin-api` as the project root | The integration is being added to that service | — Pending |
| Keep notification scope to one Telegram group | Matches the stated need and limits complexity | — Pending |

---
*Last updated: 2026-06-17 after Linux workspace alignment*
