# Roadmap: dragaocareca-admin-api

## Overview

This roadmap tracks active and future milestone planning only. Completed milestones, requirements, and phase artifacts are archived under `.planning/milestones/`.

## Milestones

- ✅ **v1.0 Backend platform foundation** - Phases 1-4, shipped 2026-06-27. Archive: [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Public frontend API responses** - Phases 5-8, shipped 2026-07-23. Archive: [v1.1-ROADMAP.md](./milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Episode AI authoring API** - Phases 9-11, shipped 2026-07-23; Gemini hardening completed 2026-07-28. Archive: [v1.2-ROADMAP.md](./milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Episode Artifact Downloads** - Phases 12-14, shipped 2026-07-31. Archive: [v1.3-ROADMAP.md](./milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 Trailer Video Publishing** - Phases 15-16, planned 2026-08-03.

## Phases

- [ ] **Phase 15: Final Trailer Video Artifact** - Give each episode a protected final trailer-video artifact that is safely available in artifact ZIPs.
- [ ] **Phase 16: YouTube Trailer Publication** - Let administrators publish or update that final video publicly in the configured playlist, persist its URL, and retain local versions safely.

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

### Phase 16: YouTube Trailer Publication

**Goal**: Administrators can explicitly make an episode’s final trailer video public in the configured YouTube playlist and keep a recoverable local publication history.
**Depends on**: Phase 15
**Requirements**: TRAILER-02, TRAILER-03, TRAILER-04, TRAILER-06, TRAILER-07
**Success Criteria** (what must be TRUE):

  1. An authenticated administrator can manually publish an episode’s final trailer video as `public` in the configured YouTube playlist, using the episode title plus hashtags and the final saved summary.
  2. Repeating publication for an episode with a recorded YouTube video updates that public video instead of creating an untracked duplicate.
  3. A successful create or update persists and returns the canonical YouTube URL on the episode; missing final video or required final metadata prevents an external publication call.
  4. Local trailer-video cleanup keeps the current final video and the newest configured retained versions, defaults to 12 retained versions, and runs only after successful YouTube publication/update.
  5. The protected API, environment configuration, OpenAPI contract, and executable verification demonstrate upload, publish/update, URL persistence, artifact inclusion, authentication, and success-gated retention behavior.

**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 15. Final Trailer Video Artifact | 4/4 | In Progress|  |
| 16. YouTube Trailer Publication | 0/TBD | Not started | - |

## Archive Index

- [MILESTONES.md](./MILESTONES.md) is the canonical completed-milestone index.
- [Pre-GSD feature history](./milestones/PRE-GSD-HISTORY.md) preserves completed work that predates retained GSD phase artifacts.

---
*Last updated: 2026-08-03 after defining v1.4 Trailer Video Publishing*
