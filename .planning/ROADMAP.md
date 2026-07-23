# Roadmap: dragaocareca-admin-api

## Overview

This roadmap tracks active and future milestone planning only. Shipped milestone details are archived under `.planning/milestones/` to keep the live roadmap short and stable.

## Milestones

- ✅ **v1.0 Backend platform foundation** - Phases 1-4 (shipped 2026-06-27)
- ✅ **v1.1 Public frontend API responses** - Phases 5-8 (shipped 2026-07-23, archive: `.planning/milestones/v1.1-ROADMAP.md`)
- 🚧 **v1.2 Episode AI authoring API** - Phases 9-11 (planned)

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

**v1.2 Episode AI authoring API** — backend-only transcript-to-summary drafting workflow.

## 🚧 v1.2 Episode AI authoring API

**Milestone Goal:** Add backend-only summary suggestion support on top of the existing transcript workflow.

## Phases

- [ ] **Phase 9: Summary Runtime and Draft Contract** - Define the backend summary-generation runtime and transcript-driven draft contract.
- [ ] **Phase 10: Summary Generation Workflow and Admin API** - Implement sequential summary generation, draft storage, and protected API endpoints.
- [ ] **Phase 11: Summary Quality Verification and Documentation** - Verify the summary workflow, document operations, and prepare for later frontend integration.

## v1.2 Episode AI authoring API (Phase Details)

### Phase 9: Summary Runtime and Draft Contract
**Goal**: Define the backend summary-generation runtime and transcript-driven draft contract.
**Depends on**: Phase 8
**Requirements**: SUMM-01, FLOW-02, OPS-01
**Success Criteria** (what must be TRUE):
  1. The backend has a concrete, configuration-driven summary-generation path that reads only the transcript.
  2. Summary generation is explicitly designed for sequential execution under the VPS memory constraint.
  3. The draft summary contract is defined without changing the existing transcription engine.
**Plans**: 2 plans

Plans:
- [ ] 09-01: Establish env-driven summary config and episode-level draft-state contract.
- [ ] 09-02: Implement transcript-only summary runtime primitives and contract verification.

### Phase 10: Summary Generation Workflow and Admin API
**Goal**: Implement sequential summary generation, draft storage, and protected API endpoints.
**Depends on**: Phase 9
**Requirements**: SUMM-03, FLOW-01, FLOW-03, API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. A protected backend flow can trigger or refresh summary generation for an episode with a transcript.
  2. Suggested summaries are stored as draft data beside the episode files.
  3. Backend endpoints expose summary content, status, and failures clearly enough for later frontend integration.
**Plans**: 2 plans

Plans:
- [ ] 10-01: Implement sequential summary-generation orchestration and draft storage.
- [ ] 10-02: Expose protected admin API endpoints for summary generation and retrieval.

### Phase 11: Summary Quality Verification and Documentation
**Goal**: Verify the summary workflow, document operations, and prepare for later frontend integration.
**Depends on**: Phase 10
**Requirements**: SUMM-02, OPS-02, DOC-01
**Success Criteria** (what must be TRUE):
  1. Summary outputs are constrained to short Portuguese-BR draft summaries.
  2. Backend verification includes executable workflow checks in addition to build/type checks.
  3. Documentation explains how the summary suggestion feature works and how it should be operated on the VPS.
**Plans**: 2 plans

Plans:
- [ ] 11-01: Add executable verification for the summary-suggestion workflow.
- [ ] 11-02: Document the backend summary-suggestion flow and operational constraints.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 9. Summary Runtime and Draft Contract | v1.2 | 0/2 | Not started | - |
| 10. Summary Generation Workflow and Admin API | v1.2 | 0/2 | Not started | - |
| 11. Summary Quality Verification and Documentation | v1.2 | 0/2 | Not started | - |

---
*Last updated: 2026-07-23 after defining milestone v1.2*
