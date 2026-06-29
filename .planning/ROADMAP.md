# Roadmap: dragaocareca-admin-api

## Phase 1 - Episode Detection

- Detect new podcast episode launches.
- Prevent duplicate notifications for the same episode.
- Reuse the existing episode source of truth in the backend.
- Verify detection logic against representative episode state changes.
- Completed in backend implementation and committed.

## Phase 2 - Telegram Delivery

- Add Telegram group notification delivery.
- Make the target group configurable.
- Verify message formatting and successful delivery path.
- Completed in backend implementation and committed.

## Phase 3 - VPS Integration

- Wire the bot into `dragaocareca-admin-api` runtime and deployment.
- Ensure environment-based configuration works on the VPS.
- Verify the integrated service starts cleanly and keeps notifications running.
- Completed in backend implementation and committed.

## Phase 4 - Health Menu Status

- Expose bot running state in the admin health menu.
- Show how many episodes are pending notification.
- Surface the backend health and launch-queue state without requiring VPS access.
- Verify the health screen reflects the live bot condition for operators.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EPISODE-01 | Phase 1 | Done |
| EPISODE-02 | Phase 1 | Done |
| EPISODE-03 | Phase 1 | Done |
| TGRAM-01 | Phase 2 | Done |
| TGRAM-02 | Phase 2 | Done |
| OPS-01 | Phase 3 | Done |
| OPS-02 | Phase 3 | Done |
| OPS-03 | Phase 3 | Done |
| HEALTH-01 | Phase 4 | Verify |
| HEALTH-02 | Phase 4 | Verify |

---
*Last updated: 2026-06-17 after Linux workspace alignment*
