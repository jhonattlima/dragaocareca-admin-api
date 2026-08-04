# Roadmap: dragaocareca-admin-api

## Overview

This roadmap tracks active and future milestone planning only. Completed milestones, requirements, and phase artifacts are archived under `.planning/milestones/`.

## Milestones

- ✅ **v1.0 Backend platform foundation** - Phases 1-4, shipped 2026-06-27. Archive: [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Public frontend API responses** - Phases 5-8, shipped 2026-07-23. Archive: [v1.1-ROADMAP.md](./milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Episode AI authoring API** - Phases 9-11, shipped 2026-07-23; Gemini hardening completed 2026-07-28. Archive: [v1.2-ROADMAP.md](./milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Episode Artifact Downloads** - Phases 12-14, shipped 2026-07-31. Archive: [v1.3-ROADMAP.md](./milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 Trailer Video Publishing** - Phases 15-17, planned 2026-08-03; aligned with the sibling `admin-web` private-first workflow on 2026-08-04.

## Phases

- [ ] **Phase 15: Final Trailer Video Artifact** - Give each episode a protected final trailer-video artifact that is safely available in artifact ZIPs.
- [ ] **Phase 16: Draft Staging and Private YouTube Job** - Let New Episode safely stage its MP4 before Save, then run one durable private-first YouTube job per finalized trailer source.
- [ ] **Phase 17: Trailer Metadata, Publication and Retention** - Validate title/hashtag metadata, explicitly publish private-ready videos, persist the URL, and prune local versions only after successful publication.

## Phase Details

### Phase 15: Final Trailer Video Artifact

**Goal**: Administrators can maintain one final trailer video for an episode and retrieve it through the existing controlled artifact-download workflow.
**Depends on**: Phase 14
**Requirements**: TRAILER-01, TRAILER-05
**Success Criteria** (what must be TRUE):

  1. An authenticated administrator can upload a final trailer video for an existing episode and replace it later without supplying a filesystem path.
  2. Protected episode responses identify the current final trailer-video artifact after upload or replacement.
  3. An authenticated artifact ZIP request can include the final trailer video through a fixed selector, while staging, retained prior versions, and arbitrary files remain unavailable.

**Plans**: 4/4 plans executed

Plans:

- [x] 15-01-PLAN.md — Establish durable final trailer-video metadata and canonical MP4 media layout.
- [x] 15-02-PLAN.md — Implement protected MP4 upload/replacement with configurable maximum and manual-sync state.
- [x] 15-03-PLAN.md — Add the fixed final-video selector to the controlled ZIP artifact workflow.
- [x] 15-04-PLAN.md — Verify the protected workflow offline and document its API/configuration contract.

### Phase 16: Draft Staging and Private YouTube Job

**Goal**: Administrators can safely stage a New Episode trailer before Save and start/recover one API-owned private YouTube job for each current finalized trailer source.
**Depends on**: Phase 15
**Requirements**: TRAILER-02, TRAILER-03, TRAILER-09
**Success Criteria** (what must be TRUE):

  1. A New Episode gets a server-issued, owner-bound reservation before local MP4 upload; it stages the video before Save and only the matching authenticated creation can atomically promote it to `trailer.mp4`.
  2. A failed, canceled, disconnected, expired, or rolled-back staged upload never removes a last-known-good final trailer or claims that draft media is finalized.
  3. An authenticated administrator can start one persisted YouTube job for a finalized current source; it transfers as `private` and exposes separate transfer, processing, private-ready, retry, cancellation, and failure states without browser-side OAuth.
  4. Source identity and provider reconciliation prevent duplicate active jobs/provider videos and stale completion after replacement, reload, or API restart.
  5. Protected API contracts and executable verification cover reservation ownership, staging/promotion/rollback, job persistence/recovery, provider error normalization, and no-path/no-credential boundaries.

**Plans**: TBD

### Phase 17: Trailer Metadata, Publication and Retention

**Goal**: Administrators can prepare safe trailer metadata, explicitly publish a private-ready video, and retain local versions safely after confirmed public publication.
**Depends on**: Phase 16
**Requirements**: TRAILER-04, TRAILER-06, TRAILER-07, TRAILER-08
**Success Criteria** (what must be TRUE):

  1. The API suggests and validates an editable title using episode naming and selected hashtags, enforces the shared 100-Unicode-character and invalid-character policy, and returns approximate normalized-hashtag counts with retrieval metadata or a recoverable unavailable state.
  2. Only an explicit authenticated publish command can change a private-ready provider video to `public`; repeated requests are idempotent/reconciled and use the final saved summary without exposing provider credentials.
  3. The protected episode contract persists and returns the canonical YouTube URL while retaining a clear `manual-sync-required` state after a local replacement.
  4. Successful public publication/update alone triggers retention, keeping the current video plus the configured newest versions with a default of 12.
  5. OpenAPI, environment documentation, and executable repository-native verification cover the complete API lifecycle and its failure boundaries.

**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 15. Final Trailer Video Artifact | 4/4 | Executed; frontend UAT deferred | 2026-08-03 |
| 16. Draft Staging and Private YouTube Job | 0/TBD | Not started | - |
| 17. Trailer Metadata, Publication and Retention | 0/TBD | Not started | - |

## Archive Index

- [MILESTONES.md](./MILESTONES.md) is the canonical completed-milestone index.
- [Pre-GSD feature history](./milestones/PRE-GSD-HISTORY.md) preserves completed work that predates retained GSD phase artifacts.

---
*Last updated: 2026-08-04 after reconciling v1.4 with the sibling admin-web workflow*
