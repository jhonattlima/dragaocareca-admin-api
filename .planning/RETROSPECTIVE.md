# Project Retrospective

## Milestone: v1.4 — Trailer Video Publishing

**Shipped:** 2026-08-21
**Phases:** 4 | **Plans:** 20 | **Tasks:** 36

### What Was Built

- Canonical final trailer-video storage, protected replacement, and artifact ZIP support.
- Owner-bound draft staging and compensating promotion/rollback.
- Durable private-first YouTube transfer, publication, URL persistence, and retention.
- Advisory transcript/summary-grounded hashtag authoring with cached approximate lookup.

### What Worked

- Compiled offline verifiers and injected fake providers kept security-sensitive lifecycle testing deterministic.
- Source fingerprints, revision/lease guards, and server-derived media paths made recovery boundaries explicit.
- Provider identity and advisory hashtag state remained visible without leaking credentials or raw payloads.

### What Was Inefficient

- Several verifier contracts lagged behind legitimate response and provider-fallback changes and required closeout reconciliation.
- Phase 16 initially used a legacy unnumbered verification filename that milestone tooling did not discover.

### Patterns Established

- Use no-store-before-auth protected routes and explicit DTO allowlists.
- Keep external provider writes behind server-owned durable jobs and offline fake-provider seams.
- Treat AI authoring failures as advisory state when the completed summary remains valid.

### Key Lessons

- Run the milestone tooling readiness query after creating verification artifacts, not only the domain-specific audit.
- Keep provider fallback tests isolated from unrelated post-summary workers.

### Cost Observations

- Model mix and session cost are not tracked in repository artifacts.
- Live provider quota and OAuth behavior remain deployment follow-up.
