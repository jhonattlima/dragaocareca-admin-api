# Phase 17 Source Coverage Audit

| Source | ID | Feature or decision | Plan | Status |
|---|---|---|---|---|
| GOAL | — | Prepare safe trailer metadata, explicitly publish a private-ready video, and retain local versions after confirmed public publication | 17-01, 17-02, 17-03, 17-04 | COVERED |
| REQ | TRAILER-04 | Authenticated explicit publication, idempotent reconciliation, canonical URL persistence and protected return | 17-01, 17-02, 17-03 | COVERED |
| REQ | TRAILER-07 | Configurable retention default 12, cleanup only after successful public publication/update | 17-01, 17-02, 17-03 | COVERED |
| REQ | TRAILER-08 | Protected API/OpenAPI/configuration/verification plus typecheck/build coverage, including artifact-download and draft lifecycle regression evidence | 17-00, 17-03, 17-04 | COVERED |
| RESEARCH | R-01 | Extend Phase 16 ready job/provider boundary; no second upload path | 17-01, 17-02 | COVERED |
| RESEARCH | R-02 | Durable publication state with source/revision/lease guards and safe DTO | 17-01, 17-02, 17-03 | COVERED |
| RESEARCH | R-03 | Read-before-write reconciliation for video and playlist side effects | 17-01, 17-02, 17-03 | COVERED |
| RESEARCH | R-04 | Private-first compensation boundary; cleanup is post-publication and independently recoverable | 17-02, 17-03 | COVERED |
| RESEARCH | R-05 | Unicode title/invalid-character validation and exact final summary | 17-02, 17-03 | COVERED |
| RESEARCH | R-06 | Server-derived version retention with lstat/regular-file and malformed-entry filtering | 17-02, 17-03 | COVERED |
| RESEARCH | R-07 | Offline temporary SQLite/media fixtures, injected fake provider, network tripwire, compiled verifier | 17-00, 17-01, 17-02, 17-03, 17-04 | COVERED |
| RESEARCH | R-08 | `youtube.upload` plus `youtube.force-ssl` readiness, human channel/playlist checkpoint, redaction, no-store, authenticated route, no new dependency | 17-01, 17-03, 17-04 | COVERED |
| RESEARCH | R-09 | Preserve provider `snippet.categoryId` in complete metadata updates | 17-01, 17-02, 17-04 | COVERED |
| RESEARCH | R-10 | Deterministic legacy trailer-version discovery before retention deletion | 17-00, 17-02, 17-04 | COVERED |
| CONTEXT | D-01 | One explicit authenticated publication operation | 17-02, 17-03, 17-04 | COVERED |
| CONTEXT | D-02 | Playlist insertion while private, public only after playlist success, recoverable failure | 17-02, 17-03 | COVERED |
| CONTEXT | D-03 | Fixed Dragao Careca playlist and authenticated channel | 17-01, 17-03 | COVERED |
| CONTEXT | D-04 | Persist and return canonical YouTube URL after confirmed success | 17-01, 17-02, 17-03 | COVERED |
| CONTEXT | D-05 | Description exactly final saved summary | 17-01, 17-02, 17-03 | COVERED |
| CONTEXT | D-06 | Editable title plus selected hashtags within 100 Unicode characters and invalid-character policy | 17-02, 17-03 | COVERED |
| CONTEXT | D-07 | Reconcile same provider video without duplicates | 17-01, 17-02, 17-03 | COVERED |
| CONTEXT | D-08 | Preserve existing publication and mark local replacement manual-sync-required | 17-01, 17-02, 17-03 | COVERED |
| CONTEXT | D-11 | Retention only after confirmed public publication plus playlist insertion | 17-01, 17-02, 17-04 | COVERED |
| CONTEXT | D-12 | Keep current plus 12 newest prior versions; record cleanup failure without rollback | 17-01, 17-02, 17-04 | COVERED |

## Scope Exclusions

Phase 18 automatic/manual hashtag authoring and lookup are explicitly deferred and are not planned here. Frontend controls, scheduled publication, multiple-playlist management, analytics, provider deletion, and cloud retention remain outside this phase per the source artifacts.
