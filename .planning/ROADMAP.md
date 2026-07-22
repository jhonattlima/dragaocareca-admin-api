# Roadmap: dragaocareca-admin-api

## Overview

This roadmap preserves the implemented backend foundation and adds a new milestone that replaces legacy public PHP responses with backend-owned JSON endpoints. The work proceeds from the highest-volume public contract first (episode catalog), then the episode page contract, then shared people/site metadata, and finally supporters plus documentation and verification.

## Milestones

- ✅ **v1.0 Backend platform foundation** - Phases 1-4 (shipped 2026-06-27)
- 🚧 **v1.1 Public frontend API responses** - Phases 5-8 (planned)

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

## 🚧 v1.1 Public frontend API responses

**Milestone Goal:** Replace the legacy public PHP responses with distinct backend JSON endpoints for the public frontend.

## Phases

- [ ] **Phase 5: Public Episodes Catalog Endpoint** - Replace the legacy public catalog response with a backend JSON endpoint for the home page.
- [ ] **Phase 6: Public Episode Detail Endpoint** - Serve episode-page data from a dedicated backend JSON endpoint.
- [ ] **Phase 7: Public People and Site Metadata Endpoints** - Expose shared people/contact and site metadata contracts for public pages.
- [ ] **Phase 8: Public Supporters Endpoint and Verification** - Replace the legacy supporters source and finalize public API docs and validation.

## v1.1 Public frontend API responses (Phase Details)

### Phase 5: Public Episodes Catalog Endpoint
**Goal**: Replace the legacy public catalog response with a backend JSON endpoint for the home page.
**Depends on**: Phase 4
**Requirements**: CATALOG-01, CATALOG-02, CATALOG-03, CATALOG-04
**Success Criteria** (what must be TRUE):
  1. A public backend endpoint returns only published episodes in reverse chronological order.
  2. Each returned episode includes the fields required by the home page card, search, and navigation flows.
  3. Catalog consumers receive backend-owned media/page URLs instead of reconstructing legacy paths in the frontend.
**Plans**: 2 plans

Plans:
- [ ] 05-01: Define and document the catalog response contract from current frontend usage.
- [ ] 05-02: Implement the public catalog route, mapping, and verification.

### Phase 6: Public Episode Detail Endpoint
**Goal**: Serve episode-page data from a dedicated backend JSON endpoint.
**Depends on**: Phase 5
**Requirements**: DETAIL-01, DETAIL-02, DETAIL-03
**Success Criteria** (what must be TRUE):
  1. A public backend endpoint returns a single published episode by ID.
  2. The episode payload contains the media, summary, credits, citations, and related fields required by the current episode page.
  3. Missing or unpublished episode IDs return a clear not-found response.
**Plans**: 2 plans

Plans:
- [ ] 06-01: Define the episode-detail contract and field mapping from current frontend usage.
- [ ] 06-02: Implement the public episode-detail route and verification.

### Phase 7: Public People and Site Metadata Endpoints
**Goal**: Expose shared people/contact and site metadata contracts for public pages.
**Depends on**: Phase 6
**Requirements**: PEOPLE-01, PEOPLE-02, SITE-01, SITE-02
**Success Criteria** (what must be TRUE):
  1. A public people endpoint returns author/contact records usable by the frontend.
  2. A public site metadata endpoint returns shared page configuration such as email, social links, support links, and character-sheet links.
  3. Public pages no longer depend on the legacy `contacts.php` payload shape or hardcoded support terminology.
**Plans**: 2 plans

Plans:
- [ ] 07-01: Implement the public people/contacts contract and route.
- [ ] 07-02: Implement the public site metadata contract and route.

### Phase 8: Public Supporters Endpoint and Verification
**Goal**: Replace the legacy supporters source and finalize public API docs and validation.
**Depends on**: Phase 7
**Requirements**: SUPPORT-01, SUPPORT-02, PUBLIC-01, PUBLIC-02
**Success Criteria** (what must be TRUE):
  1. A public supporters endpoint serves the guilda/supporters page with `supporters` terminology.
  2. The public endpoint suite is documented clearly enough for frontend integration.
  3. Backend verification covers at least build/type checks and endpoint-shape validation against current frontend needs.
**Plans**: 2 plans

Plans:
- [ ] 08-01: Implement the public supporters contract and route.
- [ ] 08-02: Document and verify the full public endpoint suite.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Public Episodes Catalog Endpoint | v1.1 | 0/2 | Not started | - |
| 6. Public Episode Detail Endpoint | v1.1 | 0/2 | Not started | - |
| 7. Public People and Site Metadata Endpoints | v1.1 | 0/2 | Not started | - |
| 8. Public Supporters Endpoint and Verification | v1.1 | 0/2 | Not started | - |

---
*Last updated: 2026-07-21 after milestone v1.1 definition*
