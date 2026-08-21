# Phase 15 Context: Final Trailer Video Artifact

## Decisions

- **D-01:** Accept MP4 video uploads only.
- **D-02:** Use `trailer.mp4` as the canonical final filename.
- **D-03:** The fixed artifact selector `trailer-video` produces `episode-{id}/trailer.mp4`.
- **D-04:** Allow local replacement before or after YouTube publication and mark a later manual sync as required.
- **D-05:** Validate `EPISODE_TRAILER_VIDEO_MAX_BYTES` and default it to 500 MiB.

### D-01: Accept MP4 video uploads only

The protected final trailer-video upload accepts only MP4 content. The route must reject every other extension or MIME type at the upload boundary.

### D-02: Use `trailer.mp4` as the canonical final filename

The current final video for episode `{id}` is server-owned at `episodes/{id}/trailer.mp4`; neither a client filename nor a request path chooses its location.

### D-03: Expose the video through selector `trailer-video`

The existing ZIP artifact catalog gains the fixed selector `trailer-video`, which resolves only to the canonical final video and uses `episode-{id}/trailer.mp4` as its ZIP entry.

### D-04: A local replacement is always allowed and requests manual re-sync

The upload/replacement workflow works whether or not the video has been published to YouTube. It retains the existing publication reference but changes a protected episode-visible sync state so a later administrator-triggered YouTube update is required; the upload itself must not call YouTube.

### D-05: Make the video size limit configurable with a 500 MB default

`EPISODE_TRAILER_VIDEO_MAX_BYTES` controls the upload limit. When unset, it resolves to 500 MiB (500 * 1024 * 1024 bytes); invalid, zero, or negative values must fail configuration validation rather than silently weakening the boundary.

## Source Coverage Audit

| Source | ID | Required outcome | Plan | Status |
|--------|----|------------------|------|--------|
| GOAL | — | Administrators maintain a final trailer video and retrieve it through controlled artifact downloads. | 15-01 through 15-04 | COVERED |
| REQ | TRAILER-01 | Protected upload/replacement and protected episode exposure without arbitrary paths. | 15-01, 15-02, 15-04 | COVERED |
| REQ | TRAILER-05 | Fixed allowlist selector includes final video and excludes non-final/internal files. | 15-03, 15-04 | COVERED |
| CONTEXT | D-01 | Accept MP4 only. | 15-02, 15-04 | COVERED |
| CONTEXT | D-02 | Canonical final filename is `trailer.mp4`. | 15-01, 15-02, 15-03, 15-04 | COVERED |
| CONTEXT | D-03 | `trailer-video` archives `episode-{id}/trailer.mp4`. | 15-03, 15-04 | COVERED |
| CONTEXT | D-04 | Replacement works before/after publication and marks manual re-sync. | 15-01, 15-02, 15-04 | COVERED |
| CONTEXT | D-05 | Validated configured maximum defaults to 500 MiB. | 15-02, 15-04 | COVERED |

No RESEARCH.md exists. Discovery level is 0: the required Multer route, canonical media layout, closed artifact catalog, and offline compiled-verifier patterns already exist in this repository; this phase adds no dependency or external integration.

## Scope Boundaries

- Phase 15 is API-only and implements TRAILER-01 and TRAILER-05.
- Phase 16 owns actual YouTube create/update, published URL persistence, version retention, and its external-service setup.
- Do not alter the existing audio `trailer` artifact (`trailer.mp3`) or accept arbitrary filesystem paths.
- Do not add admin-web controls, automatic publication, or local-version pruning in this phase.

## Agent Discretion

- Name the protected episode fields and internal service functions consistently with existing camelCase conventions, while preserving the semantic distinction between the existing audio trailer and the final trailer video.
- Reuse the project’s compiled offline verifier pattern rather than introducing a general-purpose test framework.
