# Milestones

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
