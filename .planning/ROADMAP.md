# Roadmap: dragaocareca-admin-api

## Phase 1 - Episode Detection

- Detect new podcast episode launches.
- Prevent duplicate notifications for the same episode.
- Reuse the existing episode source of truth in the backend.
- Verify detection logic against representative episode state changes.

## Phase 2 - Telegram Delivery

- Add Telegram group notification delivery.
- Make the target group configurable.
- Verify message formatting and successful delivery path.

## Phase 3 - VPS Integration

- Wire the bot into `dragaocareca-admin-api` runtime and deployment.
- Ensure environment-based configuration works on the VPS.
- Verify the integrated service starts cleanly and keeps notifications running.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EPISODE-01 | Phase 1 | Pending |
| EPISODE-02 | Phase 1 | Pending |
| EPISODE-03 | Phase 1 | Pending |
| TGRAM-01 | Phase 2 | Pending |
| TGRAM-02 | Phase 2 | Pending |
| OPS-01 | Phase 3 | Pending |
| OPS-02 | Phase 3 | Pending |
| OPS-03 | Phase 3 | Pending |

---
*Last updated: 2026-06-17 after Linux workspace alignment*
