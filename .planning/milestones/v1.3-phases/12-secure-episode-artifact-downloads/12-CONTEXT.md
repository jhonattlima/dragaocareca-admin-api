# Phase 12: Secure Episode Artifact Downloads - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a protected API endpoint that exports only the final, approved media artifacts for one existing episode as a streamed ZIP. It supports the agreed default-all and selected-artifact contract, accurately reports partial availability, and includes API documentation and executable verification. It does not add a frontend, new authentication, arbitrary file access, background export jobs, or non-final artifacts.

</domain>

<decisions>
## Implementation Decisions

### Archive Organization
- **D-01:** Every successful response is a ZIP archive, including a request that resolves to one file.
- **D-02:** ZIP entries must live under a deterministic `episode-<episodeId>/` directory, so extracting an archive cannot scatter files into the destination directory.
- **D-03:** The download filename must be `episode-<episodeId>-artifacts.zip`.
- **D-04:** ZIP entries use canonical final filenames (`audio.mp3`, `trailer.mp3`, `transcript.txt`, `cover.jpeg`, `cover.webp`) rather than selector names or stored database paths.

### Availability and Errors
- **D-05:** An omitted `artifacts` query selects all five supported selector values; a valid CSV query selects only the requested types.
- **D-06:** If no requested final artifacts exist for an existing episode, return `404` JSON with `{ "message": "No requested artifacts found" }`.
- **D-07:** If an episode does not exist, return `404` JSON with `{ "message": "Episode not found" }`.
- **D-08:** If at least one requested final artifact exists, stream the ZIP and set `X-Missing-Artifacts` to the canonical comma-separated selector list for unavailable requested items.
- **D-09:** Malformed, empty, repeated-query, and unknown selector input returns `400`; never silently omit an invalid requested selector.

### Security and Operations
- **D-10:** Reuse the existing `requireAuth` middleware and its development-only `AUTH_BYPASS` behavior.
- **D-11:** Resolve artifacts from a fixed allowlist using final media paths only. Do not use legacy, draft, staging, backup, state, summary, directory, glob, filename, or arbitrary-path inputs.
- **D-12:** Log each download attempt with episode ID and requested, available, and missing selector names. Do not log absolute filesystem paths.

### the agent's Discretion
- Choose the smallest typed helper/service boundary that keeps selector parsing, final-only resolution, and availability preflight testable.
- Choose safe archive stream-error handling consistent with existing route error conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Contract
- `.planning/PROJECT.md` - milestone goal, constraints, and explicit exclusion of staging, backup, and arbitrary-path downloads.
- `.planning/REQUIREMENTS.md` - ART-01 through ART-07 are the complete, traceable v1.3 requirements.
- `.planning/ROADMAP.md` - Phase 12 success criteria and scope boundary.

### Research
- `.planning/research/SUMMARY.md` - chosen streamed ZIP architecture and roadmap implications.
- `.planning/research/ARCHITECTURE.md` - route, final media layout, and preflight data-flow guidance.
- `.planning/research/PITFALLS.md` - security and stream-response failure modes that must be prevented.
- `.planning/research/STACK.md` - Archiver dependency rationale and official references.

### Existing Implementation
- `src/services/episode-media-layout.service.ts` - canonical final media filenames and the legacy/staging lookup that must not be reused for this endpoint.
- `src/routes/episodes.routes.ts` - authenticated route style, episode ID validation, repository use, and route ordering.
- `src/middleware/auth.middleware.ts` - auth and development-bypass contract.
- `src/docs/openapi.ts` - existing protected episode endpoint documentation format.
- `src/scripts/verify-public-episodes.ts` - repository-native executable route-contract verification pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getEpisodeMediaFinalPath(episodeId, kind)` in `episode-media-layout.service.ts`: fixed canonical final paths for audio, trailer, cover, low cover, and transcript.
- `episodeRepository.findByEpisodeId(episodeId)`: existing episode-existence check used by episode routes.
- `requireAuth`: protects existing admin routes and applies `AUTH_BYPASS` only in development.

### Established Patterns
- `episodes.routes.ts` validates numeric route IDs and returns JSON `{ message }` errors before entering asynchronous workflows.
- `src/docs/openapi.ts` documents protected episode routes with bearer security and status-specific response descriptions.
- Built verifier scripts directly invoke router handlers after compilation instead of requiring an exposed localhost listener.

### Integration Points
- Add the download route to `episodesRouter` before the generic `/:episodeId` route.
- Add the archive library and an npm verification script to `package.json`.
- Extend `src/docs/openapi.ts` and add a focused verifier under `src/scripts/`.

</code_context>

<specifics>
## Specific Ideas

- Public selector values are English: `episode`, `trailer`, `transcript`, `image`, `image-low`.
- Partial downloads must surface absent selectors in `X-Missing-Artifacts`, not expose local paths.
- Console logging should make operator troubleshooting possible without leaking filesystem layout.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-secure-episode-artifact-downloads*
*Context gathered: 2026-07-28*
