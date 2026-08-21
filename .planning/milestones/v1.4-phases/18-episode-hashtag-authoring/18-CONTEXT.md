# Phase 18: Episode Hashtag Authoring - Context

**Gathered:** 2026-08-06; reconciled 2026-08-13
**Status:** Implemented and verified offline; frontend integration deferred to sibling admin-web milestone

<domain>
## Phase Boundary

Deliver the API-owned, transcript-to-summary-to-hashtag authoring pipeline and a protected manual hashtag relevance lookup. This work is independent from trailer-video upload, private YouTube jobs, publication, playlists, and retention.
</domain>

<decisions>
## Implementation Decisions

### Automatic authoring flow
- **D-01:** After transcript completion, preserve the existing sequential flow: generate the summary with Gemini, then ask Gemini for 50 candidate YouTube hashtags grounded only in the transcript and saved summary.
- **D-02:** The backend looks up all 50 normalized candidates on YouTube and returns three suggested tags for the future admin-web YouTube-tags field.
- **D-03:** Choose the three highest-count candidates only from tags Gemini assessed as relevant to the episode, so generic high-volume tags do not win merely by reach.

### Failure and persistence
- **D-04:** A Gemini or YouTube hashtag failure never fails transcript or summary generation. Persist an `unavailable` state with a recoverable error and retry automatically under the established job semantics.
- **D-05:** Persist suggestion state together with the existing summary state as a `suggestedTags` child object, so the protected API can recover it after reload without creating a second state file.

### Manual relevance lookup
- **D-06:** Provide a protected single-hashtag endpoint that normalizes a manually entered tag and returns its approximate YouTube count and retrieval metadata.
- **D-07:** Admin-web calls the manual lookup after two seconds without typing. The API owns cache and rate limiting; the UI only displays the returned approximate number.

### the agent's Discretion
- Select the precise relevance threshold/ranking formula, retry backoff, cache TTL, and safe error DTO fields.
- Reuse existing sequential worker/state patterns where feasible without coupling this flow to trailer-video lifecycle code.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` — TRAILER-06 acceptance requirement.
- `.planning/ROADMAP.md` — Phase 18 scope and dependency.
- `.planning/phases/09-episode-ai-authoring/09-CONTEXT.md` — transcript and summary authoring conventions, if retained.
- `src/services/episode-transcription.service.ts` — transcript completion trigger pattern.
- `src/services/episode-draft-summary.service.ts` — summary generation/state pattern.
- `src/routes/episodes.routes.ts` — protected episode contract conventions.
- `src/config/env.ts` — provider and operational configuration patterns.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing transcript and Gemini summary services, sequential queueing, draft state persistence, protected read routes, and summary state.
- YouTube OAuth configuration and provider boundary from Phase 16, while public search must remain independent from trailer publication.

### Established Patterns
- Long-running authoring work is stateful, server-owned, and exposed through protected polling contracts.
- The 4 GB VPS runs AI work sequentially; suggestions are advisory and never replace final operator-authored fields.

### Integration Points
- Transcript completion queues summary, then queues tag suggestion after a successful summary state write.
- The protected summary/episode contract exposes sanitized `suggestedTags` state for future admin-web population.

### Implementation Reconciliation
- The API implementation and four Phase 18 plans are complete and verified through the repository-native offline suite.
- The API exposes persisted suggestions and protected manual lookup; Gemini, YouTube search, OAuth, and network writes were replaced by fake-provider seams and live-boundary tripwires in automated verification.
- Remaining work is frontend-only: consume `suggestedTags`, debounce manual lookup, display approximate counts, and integrate the existing YouTube job/publication and artifact contracts in `admin-web`.
</code_context>

<specifics>
## Specific Ideas

UI flow: transcript -> summary -> Gemini creates 50 candidates -> backend checks YouTube counts -> UI receives three suggestions. A user can type a tag manually and, after two seconds idle, see its approximate relevance count.
</specifics>

<deferred>
## Deferred Ideas

- Admin-web controls and automatic field population are owned by the sibling frontend project.
- Trailer title composition, private/public video lifecycle, playlist insertion, URL persistence, and local retention remain Phase 17.
</deferred>

---

*Phase: 18-episode-hashtag-authoring*
*Context gathered: 2026-08-06*
