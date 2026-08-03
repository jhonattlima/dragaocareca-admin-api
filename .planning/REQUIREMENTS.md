# Milestone v1.4 Requirements

## Trailer Video Publishing

- [x] **TRAILER-01**: An authenticated administrator can upload or replace one final trailer video for an existing episode through the protected API; the episode exposes the current final trailer-video artifact without accepting arbitrary server paths.
- [ ] **TRAILER-02**: An authenticated administrator can manually publish a final trailer video to the configured YouTube playlist as `public`, or update the already published YouTube video for that episode when one is recorded.
- [ ] **TRAILER-03**: YouTube publication uses the episode title with its hashtags and the final saved episode summary; publication rejects an episode that lacks the required final video or final metadata before calling YouTube.
- [ ] **TRAILER-04**: After a successful YouTube create or update, the API persists the canonical published YouTube URL on that episode and returns it through the existing protected episode contract.
- [x] **TRAILER-05**: An authenticated administrator can include the final trailer video in an episode artifact ZIP through the fixed artifact allowlist; the archive never exposes staging, backup, version-history, or arbitrary filesystem files.
- [ ] **TRAILER-06**: The configured local trailer-video retention count is controlled by an environment variable that defaults to `12`; older local trailer-video versions are removed only after a YouTube create/update succeeds, while the current final video and the configured number of newest retained versions remain available.
- [ ] **TRAILER-07**: The protected upload, publication/update, URL persistence, artifact-download, configuration, authentication, and retention behavior is documented in OpenAPI/env documentation and covered by a repository-native executable verifier alongside typecheck and build validation.

## Future Requirements

- **TRAILER-F01**: Admin-web controls for trailer-video upload, publishing, and publication status.
- **TRAILER-F02**: Automatic or scheduled YouTube trailer publishing.
- **TRAILER-F03**: Publishing to multiple playlists, playlist management, or video analytics beyond the existing metrics connector.
- **TRAILER-F04**: Cloud/object-storage retention or restoration of locally pruned trailer-video versions.

## Out of Scope

- Frontend work; this milestone is API-only.
- Moving feed, schedule, or publication rules to the frontend.
- Removing any local trailer-video version before a successful YouTube create/update.
- Changing existing admin authentication or the development-only `AUTH_BYPASS` behavior.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRAILER-01 | 15 | Complete |
| TRAILER-02 | 16 | Pending |
| TRAILER-03 | 16 | Pending |
| TRAILER-04 | 16 | Pending |
| TRAILER-05 | 15 | Complete |
| TRAILER-06 | 16 | Pending |
| TRAILER-07 | 16 | Pending |

---
*Last updated: 2026-08-03*
