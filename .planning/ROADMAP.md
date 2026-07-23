# Roadmap: dragaocareca-admin-api

## Overview

This roadmap tracks active and future milestone planning only. Shipped milestone details are archived under `.planning/milestones/` to keep the live roadmap short and stable.

## Milestones

- ✅ **v1.0 Backend platform foundation** - Phases 1-4 (shipped 2026-06-27)
- ✅ **v1.1 Public frontend API responses** - Phases 5-8 (shipped 2026-07-23, archive: `.planning/milestones/v1.1-ROADMAP.md`)

<details>
<summary>✅ v1.0 Backend platform foundation (Phases 1-4) - SHIPPED 2026-06-27</summary>

### Phase 1: Episode Detection
**Goal**: Detect new podcast episode launches from backend-owned episode state.
**Depends on**: Nothing (foundational)
**Requirements**: EPISODE-01, EPISODE-02, EPISODE-03
**Success Criteria** (what must be TRUE):
  1. Backend logic can detect a newly launched episode from canonical episode data.
  2. Launch detection does not create duplicate notification work for the same episode.
  3. Detection runs inside `dragaocareca-admin-api` rather than a separate service.
**Plans**: Completed

Plans:
- [x] 01-01: Implement launch detection from backend episode state.

### Phase 2: Telegram Delivery
**Goal**: Deliver launch notifications to the configured Telegram group.
**Depends on**: Phase 1
**Requirements**: TGRAM-01, TGRAM-02
**Success Criteria** (what must be TRUE):
  1. The backend can send a Telegram message for a launched episode.
  2. Delivery targets are configuration-driven.
  3. Notification formatting supports the required launch message flow.
**Plans**: Completed

Plans:
- [x] 02-01: Implement Telegram delivery service and queue handling.

### Phase 3: VPS Integration
**Goal**: Run notification behavior inside the backend runtime and deployment flow.
**Depends on**: Phase 2
**Requirements**: OPS-01, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. Notification startup hooks run with the backend service.
  2. Runtime configuration is env-driven.
  3. Backend startup and shutdown control the notification worker lifecycle.
**Plans**: Completed

Plans:
- [x] 03-01: Wire notification startup into backend runtime.

### Phase 4: Health Menu Status
**Goal**: Surface notification runtime and queue status for operators.
**Depends on**: Phase 3
**Requirements**: HEALTH-01, HEALTH-02
**Success Criteria** (what must be TRUE):
  1. Operators can see whether the notification workflow is running.
  2. Operators can inspect pending launch-notification count.
  3. Status is exposed without direct VPS access.
**Plans**: Completed

Plans:
- [x] 04-01: Expose health/status data for notification operations.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Episode Detection | v1.0 | 1/1 | Complete | 2026-06-27 |
| 2. Telegram Delivery | v1.0 | 1/1 | Complete | 2026-06-27 |
| 3. VPS Integration | v1.0 | 1/1 | Complete | 2026-06-27 |
| 4. Health Menu Status | v1.0 | 1/1 | Complete | 2026-06-27 |

</details>

## Next Up

No active milestone is defined.

Use `$gsd-new-milestone` to define the next milestone and create a fresh `.planning/REQUIREMENTS.md`.

---
*Last updated: 2026-07-23 after closing milestone v1.1*
