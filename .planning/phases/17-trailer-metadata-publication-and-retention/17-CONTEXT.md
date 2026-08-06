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
- **D-02:** If playlist insertion fails, abort the operation and do not leave the video public. The implementation must compensate visibility back to private when public visibility was already changed, and expose a recoverable failure state.
- **D-03:** The target playlist is `PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t`; the authenticated channel is `UCq-TjauoYJrr3po121gA6iw` (`Dragao Careca Oficial`).

### Metadata
- **D-04:** The YouTube description is exactly the episode's final saved summary; no automatic channel boilerplate is appended.
- **D-05:** The trailer title remains operator-editable. Its intended UI format is `Trailer - <title> <hashtag1> <hashtag2> <hashtag3>` and title plus retained hashtags must stay within YouTube's 100-character limit.

### Retention and failure behavior
- **D-06:** Only confirmed successful public publication plus playlist insertion may trigger local retention cleanup.
- **D-07:** Retain the current final trailer and the configured twelve newest prior local versions by default. If cleanup fails, preserve publication and record a recoverable cleanup error; never attempt to undo public publication.

### the agent's Discretion
- Choose the safe idempotency, compensation, and reconciliation mechanics for public visibility and playlist insertion.
- Define API DTOs and error categories that expose useful recovery states without provider credentials, session data, or filesystem paths.
</decisions>

<canonical_refs>
## Canonical References

### Milestone scope
- `.planning/ROADMAP.md` — Phase 17 goal and success criteria.
- `.planning/REQUIREMENTS.md` — TRAILER-04, TRAILER-06, TRAILER-07, and TRAILER-08 acceptance requirements.
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

The upcoming hashtag-discovery button is a separate future requirement: Gemini may generate candidates and a backend search endpoint may return approximate counts after debounce. It is not part of this phase's implementation scope.
</specifics>

<deferred>
## Deferred Ideas

- Gemini-generated candidate hashtags and approximate public YouTube search counts, invoked from an admin-web button, require a separate GSD requirement/phase.
- Admin-web controls for publication, title editing, and hashtags remain owned by the sibling frontend project.
</deferred>

---

*Phase: 17-trailer-metadata-publication-and-retention*
*Context gathered: 2026-08-06*
