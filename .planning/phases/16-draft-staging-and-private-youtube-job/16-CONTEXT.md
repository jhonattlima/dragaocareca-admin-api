# Phase 16: Draft Staging and Private YouTube Job - Context

**Gathered:** 2026-08-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the API-owned lifecycle that reserves a New Episode before its MP4 is selected, stages and atomically promotes that video on the matching Save, then transfers the current finalized source to YouTube as a durable private-first job. This phase does not make videos public, expose provider credentials, implement Angular controls, or add title/hashtag APIs.

</domain>

<decisions>
## Implementation Decisions

### Draft reservation and staging
- **D-01:** The API issues the owner-bound draft reservation before the first trailer-video upload. It is tied to the form's episode ID, expires after 24 hours, and cleans abandoned staging.
- **D-02:** The matching authenticated Save consumes the reservation and atomically promotes the staged MP4 to canonical `episodes/{episodeId}/trailer.mp4`.
- **D-03:** Failed, canceled, disconnected, expired, or rolled-back work must not expose staged media as finalized or remove a last-known-good final trailer.

### Replacement during asynchronous work
- **D-04:** A local replacement makes any job for the previous source obsolete. The API must attempt to cancel it when safe, but it must never allow its late result to update the current episode.
- **D-05:** An accepted private provider video is retained for reconciliation rather than automatically deleted when replacement makes its job obsolete.

### Cancellation and recovery
- **D-06:** Cancellation reports the actual acceptance boundary: local/API cancellation cannot claim provider rollback after YouTube has accepted bytes or created a private video.
- **D-07:** Retry resumes the same persisted provider session or recorded provider video when the finalized source is unchanged and reconciliation is safe. A new private job is allowed only when the prior job is definitively unrecoverable or the trailer source changed.
- **D-08:** The job persists source identity, transfer and processing states, provider references, and recovery/error state so restart, reload, duplicate requests, and stale worker completion are safe.

### the agent's Discretion
- Exact reservation token format, cleanup scheduling, job-state names, retry bounds/backoff, and provider adapter decomposition, provided the owner/source/cancellation decisions above remain true.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### API milestone and existing final-video contract
- `.planning/PROJECT.md` — backend ownership, VPS constraints, and v1.4 boundaries.
- `.planning/REQUIREMENTS.md` — TRAILER-02, TRAILER-03, and TRAILER-09 acceptance requirements.
- `.planning/ROADMAP.md` — Phase 16 goal, dependencies, and success criteria.
- `.planning/STATE.md` — current milestone position and decisions.
- `.planning/phases/15-final-trailer-video-artifact/15-CONTEXT.md` — canonical MP4, final artifact, ZIP selector, replacement, and size-limit decisions already delivered.
- `src/routes/episodes.routes.ts` — protected episode creation and trailer-video route boundary.
- `src/services/episode-trailer-video.service.ts` — existing final-video replacement behavior.
- `src/services/episode-draft-reservation.service.ts` — in-progress reservation implementation that must be reviewed rather than replaced blindly.
- `src/database/repositories/episode.repository.ts` and `src/database/sqlite.ts` — SQLite persistence conventions and current in-progress schema changes.
- `src/services/youtube-metrics.service.ts` — existing API-owned Google OAuth refresh-token integration to assess for safe reuse.

### Sibling admin-web contract
- `../dragaocareca-admin-web/.planning/PROJECT.md` — operator workflow and backend/frontend ownership boundary.
- `../dragaocareca-admin-web/.planning/REQUIREMENTS.md` — local upload, YouTube lifecycle, operational-safety, and frontend requirements that this API contract enables.
- `../dragaocareca-admin-web/.planning/ROADMAP.md` — phased frontend dependency order.
- `../dragaocareca-admin-web/.planning/phases/07-final-trailer-video-upload/07-CONTEXT.md` — locked New Episode selection, staging, cancellation, retry, and replacement behavior.
- `../dragaocareca-admin-web/.planning/phases/07-final-trailer-video-upload/07-01-PLAN.md` — detailed requested sibling API reservation/staging/promotion contract; validate it against current API changes before implementation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/episodes.routes.ts`: protected multipart upload and episode save boundaries.
- `src/services/episode-trailer-video.service.ts`: server-derived canonical filename, replacement protection, and sync-state behavior.
- `src/services/youtube-metrics.service.ts`: existing server-side Google OAuth refresh-token setup.
- `src/database/sqlite.ts` and `src/database/repositories/episode.repository.ts`: SQLite-backed durable state pattern.

### Established Patterns
- Express routes remain thin while services/repositories own workflow and persistence.
- The server owns media paths and exposes only canonical relative references.
- `AUTH_BYPASS` maps development requests to a stable identity and must preserve the same reservation ownership semantics.
- Repository-native compiled verifiers are preferred over a new test framework and must avoid live provider calls.

### Integration Points
- Add authenticated draft issuance/consumption to the existing episode creation and trailer-video upload contract.
- Add a durable YouTube job service/repository/worker behind protected routes, using provider abstraction and source-version checks.
- Start/recover the worker from `src/server.ts` only after durable job semantics and safe shutdown behavior are defined.

</code_context>

<specifics>
## Specific Ideas

- The user accepted the private-first, reconciliation-oriented lifecycle inferred from the sibling admin-web documentation.
- A browser/API cancel is honest about what it can stop; it never promises to delete a provider resource already accepted by YouTube.

</specifics>

<deferred>
## Deferred Ideas

- Title suggestion/validation, hashtag-count lookup, explicit public publishing, persisted public URL, and retention belong to Phase 17.
- Angular controls, progress presentation, and browser request cancellation behavior belong to the sibling `admin-web` milestone.
- Automatic/scheduled publishing, playlist management, and browser-side OAuth remain out of scope.

</deferred>

---

*Phase: 16-draft-staging-and-private-youtube-job*
*Context gathered: 2026-08-04*
