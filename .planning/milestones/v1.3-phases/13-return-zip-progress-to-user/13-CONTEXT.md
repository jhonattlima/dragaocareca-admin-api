# Phase 13: return-zip-progress-to-user - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the direct-only artifact ZIP flow with an authenticated, server-side preparation workflow. It must report ZIP-construction progress before download, serialize preparation work for the VPS, and make a ready archive downloadable for a limited, safely invalidated period. It does not implement the admin-web interface, expose paths, or expand the Phase 12 artifact allowlist.

</domain>

<decisions>
## Implementation Decisions

### Preparation and Download Lifecycle
- **D-01:** ZIP construction is asynchronous: a preparation request creates or returns a job, a protected status endpoint reports progress, and a separate protected download endpoint delivers the completed ZIP.
- **D-02:** A normal `application/zip` response must not attempt to carry preparation-progress events. Progress is returned by the status contract before download begins.
- **D-03:** Only one ZIP preparation may run globally on the VPS. Later requests are accepted as `queued` and report their position.
- **D-04:** Preparation state must distinguish `queued`, `preparing`, `ready`, `failed`, and `expired`.
- **D-05:** A valid cache hit for the same episode and normalized artifact selection returns `ready` immediately and never enters the queue.

### Progress and Cache Validity
- **D-06:** While `preparing`, `progress` is an integer from 0 to 100 based on source artifact bytes processed into the ZIP; state text remains separate from the percentage.
- **D-07:** Status responses for queued work include `queuePosition`; ready work exposes the download URL only after the archive exists.
- **D-08:** A prepared ZIP remains available for 24 hours to support repeat downloads.
- **D-09:** A cached ZIP is discarded before reuse if any selected source artifact changes. Cache identity and validation must preserve the Phase 12 normalized selector semantics.

### Security and Compatibility
- **D-10:** All preparation, status, and download routes reuse `requireAuth` and its development-only `AUTH_BYPASS` behavior.
- **D-11:** Jobs retain the Phase 12 fixed final-artifact allowlist and partial-availability behavior. They must not accept paths or include draft, staging, backup, state, summary, or legacy files.
- **D-12:** The implementation must log preparation queued, started, completed, cache-hit, invalidated, expired, and failed events with episode ID and selector names, never filesystem paths.

### the agent's Discretion
- Choose the narrowest route names, HTTP methods, persisted job metadata, cleanup mechanism, polling guidance, and error payload shapes that preserve the decisions above.
- Decide whether a second identical request while work is already queued or preparing returns the existing job or an equivalent idempotent response; it must not create duplicate work.
- Preserve compatibility for existing direct download callers where possible, or document a deliberate replacement with a migration-safe contract.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and Prior Contract
- `.planning/PROJECT.md` - v1.3 scope, security boundary, and 4 GB VPS constraint.
- `.planning/REQUIREMENTS.md` - completed Phase 12 artifact requirements and explicit exclusions that Phase 13 must retain.
- `.planning/ROADMAP.md` - Phase 13 placement after the secure download endpoint.
- `.planning/phases/12-secure-episode-artifact-downloads/12-CONTEXT.md` - fixed selector, availability, authentication, logging, and canonical ZIP-entry decisions.
- `.planning/phases/12-secure-episode-artifact-downloads/12-VERIFICATION.md` - Phase 12 contract that must remain protected during the refactor.

### Existing Implementation
- `src/services/episode-artifact-download.service.ts` - selector normalization and final-only preflight data used as the cache-input boundary.
- `src/services/episode-media-layout.service.ts` - canonical final artifact locations; paths must stay server-owned.
- `src/routes/episodes.routes.ts` - existing protected direct ZIP route and route ordering conventions.
- `src/middleware/auth.middleware.ts` - existing admin authentication and `AUTH_BYPASS` behavior.
- `src/docs/openapi.ts` - OpenAPI documentation location for the protected contract.
- `src/scripts/verify-episode-artifact-downloads.ts` - repository-native validation pattern for artifact download behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseEpisodeArtifactSelectors` and `preflightEpisodeArtifactDownloads`: validate and resolve the fixed artifact catalog without accepting client paths.
- `getEpisodeMediaFinalPath`: derives canonical final media locations from the episode ID and artifact kind.
- `episodeRepository.findByEpisodeId` and `requireAuth`: existing existence and authorization boundaries for all new routes.

### Established Patterns
- The API is a single Express process with local filesystem media and process-local worker state; long-running jobs should be explicit and observable through protected routes.
- Episode AI work is already serialized for the 4 GB VPS and uses on-disk state beside media artifacts; ZIP preparation needs the same resource discipline without becoming an AI worker.
- Route handlers validate IDs and input before service work, return JSON errors, and document protected endpoints in `src/docs/openapi.ts`.

### Integration Points
- Refactor the current `/:episodeId/artifacts/download` route only after preserving its selector, availability, auth, and canonical naming guarantees.
- Add a preparation service/state boundary that can queue work, report status, serve only completed caches, invalidate changed sources, and clean expired files.
- Extend the existing repository-native verifier to exercise queue, progress, cache, invalidation, expiry, authorization, and final ZIP entries.

</code_context>

<specifics>
## Specific Ideas

- The user wants the percentage to mean ZIP assembly on the server, not browser transfer progress.
- The user explicitly accepted a two-request lifecycle after the technical constraint that a conventional ZIP response cannot also carry progress events.
- Queue visibility matters: queued work should report its position to the user.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-return-zip-progress-to-user*
*Context gathered: 2026-07-28*
