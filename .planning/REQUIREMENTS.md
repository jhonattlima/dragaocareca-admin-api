# Requirements: dragaocareca-admin-api

**Defined:** 2026-07-23
**Core Value:** Serve the public frontend with stable backend-owned data contracts so page rendering no longer depends on legacy PHP responses or client-side reconstruction rules.

## v1 Requirements

### Summary Generation

- [ ] **SUMM-01**: The backend can generate a suggested summary using only the episode transcript as source input.
- [ ] **SUMM-02**: Suggested summaries are produced in Portuguese-BR and stay short enough for publish-ready episode metadata.
- [ ] **SUMM-03**: Summary generation does not overwrite the saved episode summary automatically.

### Workflow and Runtime

- [ ] **FLOW-01**: Summary generation runs sequentially inside `admin-api` to fit the 4 GB VPS constraint.
- [ ] **FLOW-02**: Summary generation only starts when a transcript file already exists for the episode draft.
- [ ] **FLOW-03**: Generated summary text is stored as draft suggestion data inside the episode folder for later reuse.

### Admin API

- [ ] **API-01**: A protected backend endpoint can trigger or refresh summary suggestion generation for an episode.
- [ ] **API-02**: A protected backend endpoint can return the current summary suggestion and generation status for an episode.
- [ ] **API-03**: The admin API exposes generation failures and readiness state clearly enough for later frontend integration.

### Verification and Operations

- [ ] **OPS-01**: Summary generation model/runtime selection is configuration-driven inside the backend.
- [ ] **OPS-02**: Verification covers build/type safety plus an executable backend check of the summary-suggestion workflow.
- [ ] **DOC-01**: Backend docs describe the summary-suggestion flow, storage location, and operational constraints.

## v2 Requirements

### Deferred Follow-up

- **WEB-01**: `admin-web` pre-fills the episode summary field from the backend suggestion.
- **ASR-01**: Re-evaluate `whisper.cpp` versus `faster-whisper` or other Whisper-family runtimes for the transcription stage.
- **GEN-01**: Expand AI drafting beyond summary text into other episode metadata fields.

## Out of Scope

| Feature | Reason |
|---------|--------|
| `admin-web` integration in this repo | This milestone is backend-only |
| Replacing the current transcription engine | Deferred tech debt so v1.2 can reuse the existing transcript pipeline |
| Parallel multi-episode or multi-agent generation | 4 GB VPS target requires sequential execution |
| Auto-publishing AI summaries directly into final episode state | Suggestions must remain editable and reviewable |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SUMM-01 | Phase 9 | Pending |
| FLOW-02 | Phase 9 | Pending |
| OPS-01 | Phase 9 | Pending |
| SUMM-03 | Phase 10 | Pending |
| FLOW-01 | Phase 10 | Pending |
| FLOW-03 | Phase 10 | Pending |
| API-01 | Phase 10 | Pending |
| API-02 | Phase 10 | Pending |
| API-03 | Phase 10 | Pending |
| SUMM-02 | Phase 11 | Pending |
| OPS-02 | Phase 11 | Pending |
| DOC-01 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-23*
*Last updated: 2026-07-23 after milestone v1.2 definition*
