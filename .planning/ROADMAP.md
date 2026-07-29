# Roadmap: dragaocareca-admin-api

## Overview

This roadmap tracks active and future milestone planning only. Completed milestones, requirements, and phase artifacts are archived under `.planning/milestones/`.

## Milestones

- ✅ **v1.0 Backend platform foundation** - Phases 1-4, shipped 2026-06-27. Archive: [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Public frontend API responses** - Phases 5-8, shipped 2026-07-23. Archive: [v1.1-ROADMAP.md](./milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Episode AI authoring API** - Phases 9-11, shipped 2026-07-23; Gemini hardening completed 2026-07-28. Archive: [v1.2-ROADMAP.md](./milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Episode Artifact Downloads** - Phase 12, planned 2026-07-28.

## Next Up

### Phase 12: Secure Episode Artifact Downloads

**Goal:** Give authenticated administrators a safe ZIP download of final episode artifacts, with default-all and selected-artifact modes.

**Requirements:** ART-01, ART-02, ART-03, ART-04, ART-05, ART-06, ART-07

**Success criteria:**

1. An authenticated request without `artifacts` downloads a ZIP containing every available final file among `episode`, `trailer`, `transcript`, `image`, and `image-low`.
2. An authenticated request with valid `artifacts` values downloads only those available final artifacts, with deterministic English selector names and canonical ZIP entry names.
3. If none of the requested artifacts exists, the endpoint returns `404`; if only some exist, it returns a ZIP with `X-Missing-Artifacts` listing exactly the unavailable requested selectors.
4. Invalid selector shapes/values return `400`, and no request can retrieve staging, backups, state, summary, legacy, or arbitrary filesystem content.
5. The route remains behind the existing authentication middleware, is described in OpenAPI, and is covered by a built contract verifier alongside typecheck and build validation.

**Plans:** 0/4 plans complete

Plans:
**Wave 1**

- [x] 12-01-PLAN.md — Approve the flagged archive dependency before installation.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 12-02-PLAN.md — Install the approved dependency and bootstrap the runnable compiled verifier.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 12-03-PLAN.md — Create and verify the final-only selector/preflight service.

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 12-04-PLAN.md — Add the protected ZIP route, OpenAPI contract, and completed verifier.

## Archive Index

- [MILESTONES.md](./MILESTONES.md) is the canonical completed-milestone index.
- [Pre-GSD feature history](./milestones/PRE-GSD-HISTORY.md) preserves completed work that predates retained GSD phase artifacts.

<details>
<summary>✅ v1.2 archived phases (9-11)</summary>

### Phase 09: Summary Runtime and Draft Contract

**Status:** Complete. Archived artifacts: [09 summary](./milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-02-SUMMARY.md).

### Phase 10: Summary Generation Workflow and Admin API

**Status:** Complete. Archived artifacts: [10 summary](./milestones/v1.2-phases/10-summary-generation-workflow-and-admin-api/10-02-SUMMARY.md).

### Phase 11: Summary Quality Verification and Documentation

**Status:** Complete. Archived artifacts: [11 summary](./milestones/v1.2-phases/11-summary-quality-verification-and-documentation/11-02-SUMMARY.md).

</details>

### Phase 13: return zip progress to user

**Goal:** Let authenticated administrators prepare a final-artifact ZIP on the server, poll its queue and assembly progress, then download a validated cached archive.
**Requirements**: ZIP-01, ZIP-02, ZIP-03, ZIP-04, ZIP-05, ZIP-06, ZIP-07
**Depends on:** Phase 12
**Plans:** 1/3 plans executed

**Success criteria:**

1. An authenticated preparation request validates the Phase 12 selector contract and returns an idempotent queued, preparing, or ready job.
2. Status polling reports the global queue position, a 0-100 source-byte assembly percentage, and a ready-only download URL without internal paths.
3. A ready archive is reusable for 24 hours only while SHA-256 fingerprints and missing markers for every selected artifact still match.
4. Startup recovery, expiry cleanup, authenticated ready-only download, migration response, OpenAPI, and compiled verification preserve the Phase 12 final-only security boundary.

Plans:
**Wave 1**

- [x] 13-01-PLAN.md — preparation lifecycle verifier and persisted FIFO core.
- [ ] 13-02-PLAN.md — startup recovery worker and protected lifecycle routes.

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 13-03-PLAN.md — OpenAPI and compiled lifecycle contract verification.

---
*Last updated: 2026-07-28 after defining v1.3 Phase 12*
