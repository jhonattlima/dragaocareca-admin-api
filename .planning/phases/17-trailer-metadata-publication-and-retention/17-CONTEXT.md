# Phase 17: Trailer Metadata, Publication and Retention - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver API-owned trailer metadata validation, explicit private-to-public publication, playlist insertion, canonical YouTube URL persistence, and success-gated local-video retention. The browser remains free of YouTube credentials and the user retains final editorial control.
</domain>

<decisions>
## Implementation Decisions

### Publication and playlist transaction
- **D-01:** One explicit authenticated publication operation must publish the ready private video and insert it into the configured Dragao Careca playlist.
- **D-02:** Insert the ready video into the configured playlist while it is still `private`, then change visibility to `public` only after playlist insertion succeeds. If either operation fails, abort the publication and expose a recoverable failure state; the video must not be left public after a failed operation.
- **D-03:** The target playlist is `PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t`; the authenticated channel is `UCq-TjauoYJrr3po121gA6iw` (`Dragao Careca Oficial`).
- **D-04:** After confirmed public publication and playlist insertion, persist and return the canonical YouTube video URL in the protected episode/publication response so admin-web can populate its YouTube URL field.
- **D-07:** Repeated publication requests reconcile against the same provider video and do not create a duplicate YouTube video.
- **D-08:** When the local trailer is replaced, preserve the existing published YouTube video and mark the replacement `manual-sync-required`; the replacement must complete the private-ready workflow before any later publication.

### Metadata
- **D-05:** The YouTube description is exactly the episode's final saved summary; no automatic channel boilerplate is appended.
- **D-06:** The trailer title remains operator-editable. Its intended UI format is `Trailer - <title> <hashtag1> <hashtag2> <hashtag3>` and title plus retained hashtags must stay within YouTube's 100-character limit.

### Retention and failure behavior
- **D-11:** Only confirmed successful public publication plus playlist insertion may trigger local retention cleanup.
- **D-12:** Retain the current final trailer and the configured twelve newest prior local versions by default. If cleanup fails, preserve publication and record a recoverable cleanup error; never attempt to undo public publication.

### the agent's Discretion
- Choose the safe idempotency, compensation, and reconciliation mechanics for public visibility and playlist insertion.
- Define API DTOs and error categories that expose useful recovery states without provider credentials, session data, or filesystem paths.
</decisions>

<canonical_refs>
## Canonical References

### Milestone scope
- `.planning/ROADMAP.md` — Phase 17 goal and success criteria.
- `.planning/REQUIREMENTS.md` — TRAILER-04, TRAILER-07, and TRAILER-08 acceptance requirements.
- `.planning/phases/16-draft-staging-and-private-youtube-job/VERIFICATION.md` — verified private-job contract and the default-disabled worker boundary.

### Existing implementation
- `src/services/youtube-trailer-job.service.ts` — durable private job lifecycle and safe DTO boundary.
- `src/services/youtube-trailer-upload.provider.ts` — OAuth provider boundary and private transfer/processing operations.
- `src/services/episode-trailer-video.service.ts` — canonical trailer artifact and replacement behavior.
- `src/routes/episodes.routes.ts` — protected episode route patterns.
- `src/config/env.ts` and `.env.example` — YouTube and retention configuration patterns.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Durable SQLite trailer-job repository, source fingerprinting, lease/revision guards, and safe public DTOs from Phase 16.
- Protected authenticated/no-store episode routes, offline compiled verifier scripts, and canonical final trailer-video storage from Phases 15-16.

### Established Patterns
- External provider work is server-owned, private-first, idempotent/reconciled, and tested through an injected fake provider.
- Live YouTube work stays opt-in; no test may invoke a live provider.

### Integration Points
- Publication extends the ready job/provider state, episode trailer-video metadata, protected episode response, OpenAPI, and existing lifecycle verifier.
</code_context>

<specifics>
## Specific Ideas

- Publication remains an explicit authenticated API operation; the browser never receives YouTube credentials or calls the provider directly.
- The publication transaction should prefer provider operations that preserve the invariant that a failed playlist operation cannot leave a public video.
</specifics>

<deferred>
## Deferred Ideas

- Admin-web controls for publication, title editing, and hashtags remain owned by the sibling frontend project.
- Automatic hashtag generation, candidate lookup, and manual hashtag relevance lookup are owned by Phase 18 and are not part of this phase.
</deferred>

---

*Phase: 17-trailer-metadata-publication-and-retention*
*Context gathered: 2026-08-09*
