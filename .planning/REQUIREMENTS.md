# Requirements: dragaocareca-admin-api

**Defined:** 2026-06-17
**Core Value:** Notify the right Telegram group quickly and reliably whenever a new podcast episode is launched.

## v1 Requirements

### Episode Detection

- [ ] **EPISODE-01**: The service detects when a new podcast episode has been launched.
- [ ] **EPISODE-02**: The service does not send duplicate notifications for the same episode.
- [ ] **EPISODE-03**: The service uses the existing episode source of truth in `dragaocareca-admin-api`.

### Telegram Notifications

- [ ] **TGRAM-01**: The service sends a Telegram message to the configured group when a new episode is detected.
- [ ] **TGRAM-02**: The Telegram target group can be configured without code changes.

### Deployment and Operation

- [ ] **OPS-01**: The bot runs as part of the `dragaocareca-admin-api` VPS deployment.
- [ ] **OPS-02**: Bot runtime configuration is available through environment variables or deployment config.
- [ ] **OPS-03**: The notification process starts and stops with the backend service.

## v2 Requirements

### Expansion

- **TGRAM-03**: Support notification delivery to additional Telegram groups or channels.
- **EPISODE-03**: Support richer episode metadata in notifications.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Manual notification sending | The goal is automatic alerts only |
| Podcast content management | Not needed for notification integration |
| Multiple notification platforms | Telegram is the only required channel |
| Standalone bot service | The integration should live inside `dragaocareca-admin-api` |

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

**Coverage:**
- v1 requirements: 8 total
- Mapped to phases: 8
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-17*
*Last updated: 2026-06-17 after Linux workspace alignment*
