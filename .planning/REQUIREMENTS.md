# Milestone v1.3 Requirements

## Episode Artifact Downloads

- [x] **ART-01**: An authenticated administrator can download every available final artifact for an existing episode as one ZIP archive when no artifact selector is supplied.
- [x] **ART-02**: An authenticated administrator can request a ZIP containing selected final artifact types through the English `artifacts` query parameter: `episode`, `trailer`, `transcript`, `image`, and `image-low`.
- [x] **ART-03**: A request for unavailable items returns `404` when none of its requested artifacts exists; when at least one exists, it returns a ZIP and identifies unavailable requested selector names in `X-Missing-Artifacts`.
- [x] **ART-04**: The download contract rejects malformed, empty, repeated-query, or unknown artifact selectors with `400` rather than silently omitting them.
- [x] **ART-05**: The endpoint exposes only fixed final artifact paths and canonical ZIP entry names; it never accepts client filesystem paths or includes staging, backup, state, summary, or legacy artifacts.
- [ ] **ART-06**: The endpoint uses the existing admin authentication middleware, preserving development-only `AUTH_BYPASS` behavior.
- [x] **ART-07**: The endpoint is documented in OpenAPI and has executable repository-native validation for default, selected, missing, invalid, authentication, and ZIP-entry behavior.

## Future Requirements

- **ART-F01**: Admin-web controls for starting artifact downloads, to be planned in the frontend repository.
- **ART-F02**: Download audit records, if operational compliance requires them.
- **ART-F03**: Cached/resumable archives, only if observed download volume makes streamed generation insufficient.

## Out of Scope

- Downloading staging, backups, AI state, `summary.txt`, legacy media locations, or arbitrary filesystem paths. These do not belong to the final-artifact contract and would weaken the security boundary.
- Changing authentication behavior. The endpoint reuses `requireAuth`.
- Frontend integration. This milestone is API-only.

## Traceability

| Requirement | Phase | Status |
|---|---:|---|
| ART-01 | 12 | Planned |
| ART-02 | 12 | Planned |
| ART-03 | 12 | Planned |
| ART-04 | 12 | Planned |
| ART-05 | 12 | Planned |
| ART-06 | 12 | Planned |
| ART-07 | 12 | Planned |

---
*Last updated: 2026-07-28*
