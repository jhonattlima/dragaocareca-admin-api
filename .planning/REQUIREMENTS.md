# Milestone v1.4 Requirements

## Trailer Video Publishing

- [x] **TRAILER-01**: An authenticated administrator can upload or replace one finalized trailer video for an existing episode through the protected API; the episode exposes the current final trailer-video artifact without accepting arbitrary server paths.
- [x] **TRAILER-02**: An authenticated administrator can start one durable, API-owned YouTube job for the current finalized trailer source; the provider transfer begins as `private`, never as an implicit public release.
- [x] **TRAILER-03**: The API persists source identity, provider identifiers, state, transfer/processing progress, cancellation boundary, and recoverable failure data so polling, restart recovery, retry, and replacement cannot create duplicate jobs or let stale work update a newer trailer.
- [x] **TRAILER-04**: An authenticated administrator can explicitly publish a private-ready trailer video as `public`; repeated publish requests reconcile safely, persist the canonical YouTube URL, and return it through the protected episode contract.
- [x] **TRAILER-05**: An authenticated administrator can include the final trailer video in an episode artifact ZIP through the fixed artifact allowlist; the archive never exposes staging, backup, version-history, or arbitrary filesystem files.
- [x] **TRAILER-06**: After transcript completion, the API generates the saved summary and then independently asks Gemini for 50 transcript/summary-grounded YouTube hashtag candidates. It looks up their normalized, cached/rate-limited approximate public YouTube search counts, returns the three most relevant candidates with retrieval metadata through a protected episode contract for an admin-web YouTube-tags field, and does not depend on trailer-video upload or publication. A protected single-hashtag lookup endpoint returns the same normalized approximate count for a manually entered UI tag after debounce. The operator may edit or discard the returned tags; trailer-title validation enforces the shared 100-Unicode-character and invalid-character policy separately.
- [x] **TRAILER-07**: The configured local trailer-video retention count is controlled by an environment variable that defaults to `12`; older local trailer-video versions are removed only after a successful public YouTube publication/update, while the current final video and the configured number of newest retained versions remain available.
- [x] **TRAILER-08**: The API documents and verifies protected upload, draft staging/promotion, YouTube job/publication, URL persistence, metadata, artifact-download, configuration, authentication, and retention behavior alongside typecheck and build validation.
- [x] **TRAILER-09**: A New Episode can receive a server-issued, owner-bound, expiring draft reservation, stage a validated MP4 before Save, and atomically promote it to the final artifact only when the same authenticated reservation is consumed by episode creation; failed, canceled, or abandoned work preserves any last-known-good final video.

## Future Requirements

- **TRAILER-F01**: Angular controls for trailer-video upload, publishing, and publication status; the sibling `admin-web` milestone owns those screens.
- **TRAILER-F02**: Automatic or scheduled YouTube trailer publishing.
- **TRAILER-F03**: Publishing to multiple playlists, playlist management, or video analytics beyond the existing metrics connector.
- **TRAILER-F04**: Cloud/object-storage retention or restoration of locally pruned trailer-video versions.

## Out of Scope

- Frontend work; this milestone is API-only and the browser never calls YouTube or receives provider credentials.
- Moving feed, schedule, or publication rules to the frontend.
- Removing any local trailer-video version before a successful public YouTube publication/update.
- Changing existing admin authentication or the development-only `AUTH_BYPASS` behavior.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRAILER-01 | 15 | Complete |
| TRAILER-02 | 16 | Complete |
| TRAILER-03 | 16 | Complete |
| TRAILER-04 | 17 | Complete |
| TRAILER-05 | 15 | Complete |
| TRAILER-06 | 18 | Complete |
| TRAILER-07 | 17 | Complete |
| TRAILER-08 | 17 | Complete |
| TRAILER-09 | 16 | Complete |

---
*Last updated: 2026-08-04 after reconciling the sibling admin-web workflow*
