# Milestones

## v1.4 Trailer Video Publishing (Shipped: 2026-08-21)

**Phases completed:** 4 phases, 20 plans, 36 tasks

**Key accomplishments:**

- SQLite-backed final trailer-video metadata and a closed `trailerVideo` media kind now resolve every MP4 to `episodes/{id}/trailer.mp4` without changing the audio trailer.
- Authenticated administrators can now upload or replace a canonical `trailer.mp4`, with a validated 500 MiB server limit and a persisted manual re-sync signal for later YouTube publication.
- The authenticated artifact ZIP lifecycle now accepts a closed `trailer-video` selector that archives only canonical final `trailer.mp4` files as `episode-{id}/trailer.mp4`.
- A compiled offline verifier now exercises the protected MP4 upload through Multer, proves replacement re-sync behavior and canonical ZIP output, and keeps the OpenAPI/operator contract synchronized.
- Owner-bound draft reservations now promote staged MP4 media through a recoverable episode-create unit, with offline proof of D-01 through D-03 compensation.
- SQLite-backed private trailer-job coordination now coalesces duplicate finalized sources and rejects stale worker writes through source, revision, and lease predicates.
- Private-first YouTube trailer jobs now persist resumable transfer evidence, recover safely through Range/provider reconciliation, and run only through an explicitly enabled single worker.
- Protected private trailer-job routes now return an allowlisted durable lifecycle DTO, with full fake-provider route/worker verification and no live YouTube access.
- A development-only compiled verifier now models the private YouTube job boundary with deterministic local fixtures and focused repository/worker seams.
- 1. [Rule 1 - Bug] Corrected fixture SQLite existence assertion
- Durable source-guarded publication milestones and a private-first YouTube Data API boundary with exact OAuth readiness checks
- Private-first YouTube trailer publication with exact summary metadata, idempotent playlist reconciliation, and success-gated twelve-version local retention
- Authenticated no-store trailer publication API with strict metadata validation, safe DTO/OpenAPI parity, disabled-by-default readiness configuration, and offline boundary proof
- Complete offline regression evidence for trailer publication, retention, artifact downloads, and draft/private-job safety
- Offline verifier coverage for private-first publication failures, Unicode metadata boundaries, and rollback-safe retention retry.
- Bounded YouTube hashtag-authoring configuration and durable normalized suggested-tags state in episode drafts
- SQLite-backed YouTube count caching with strict 90/10 quota admission, serial provider lookup, and validated Gemini 50-candidate relevance ranking.
- Restart-safe serialized hashtag authoring after summary completion, guarded persisted suggestions, protected manual lookup, and matching OpenAPI documentation.
- Compiled fake-provider verification for the complete 50-candidate authoring lifecycle, protected route DTO, and OpenAPI contract.

## v1.3 v1.3 (Shipped: 2026-07-31)

**Phases completed:** 3 phases, 11 plans, 19 tasks

**Key accomplishments:**

- Human approval authorizes `archiver` for the protected final-artifact ZIP route, with `@types/archiver` permitted only when the compiler proves it is needed.
- Archiver 8 is installed through the approved dependency path, and a compiled artifact-download verifier now runs before the security-critical selector and preflight work.
- A fixed five-item selector catalog now turns untrusted artifact queries into canonical final-file candidates, with compiled verification of the final-only preflight boundary.
- Authenticated administrators can now download allowlisted final episode artifacts as deterministic ZIP archives, with offline verification of auth, response, and archive contracts.
- Durable server-side ZIP preparation with opaque jobs, SHA-256 cache validation, final-artifact snapshots, atomic publishing, and compiled lifecycle verification.
- Guarded ZIP preparation recovery and an authenticated prepare → status → ready-download API that retires the direct live stream.
- Bearer-protected asynchronous ZIP preparation documentation and compiled route-stack coverage for no-store polling, cache safety, and deprecated direct-download migration.
- Concurrent normalized artifact-preparation retries now share one active job after a stale cache is invalidated, while valid ready archives remain evidence-checked cache hits.
- The protected artifact-preparation contract now documents fixed nonempty CSV selector lists and verifies `episode,transcript` through the OpenAPI schema, parser, and compiled route.
- The compiled artifact verifier now observes real Archiver source-byte progress through protected status polling and exercises actual worker-startup recovery without a network listener.
- The authoritative artifact-job API now supports default-all JSON requests, 24-hour source-evidence cache validation, byte-derived ZIP progress, and safe public failure behavior.

---

## v1.2: Episode AI authoring API

**Status:** Shipped 2026-07-23; Gemini provider hardening completed 2026-07-28.
**Archive:** [v1.2-ROADMAP.md](./milestones/v1.2-ROADMAP.md)
**Phase artifacts:** [v1.2-phases/](./milestones/v1.2-phases/)

---

## v1.1: Public frontend API responses

**Status:** Shipped 2026-07-23.
**Archive:** [v1.1-ROADMAP.md](./milestones/v1.1-ROADMAP.md)
**Phase artifacts retained:** [v1.1-phases/](./milestones/v1.1-phases/)

---

## v1.0: Backend platform foundation

**Status:** Shipped 2026-06-27.
**Archive:** [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)

---
