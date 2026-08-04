# Phase 16 Capability and Source Coverage

## YouTube capability decision matrix

| Capability | Phase 16 decision | Implementation boundary | Evidence |
|---|---|---|---|
| OAuth refresh-token access | Included, server-only | Reuse `google-auth-library`; validate upload authorization before a job starts and return a safe configuration failure when unavailable. | TRAILER-02; D-08 |
| OAuth `youtube.upload` scope readiness | Included | Obtain an access token and use the provider readiness path to reject an absent upload grant before creating a session or transferring bytes. Operator credentials remain outside the repository. | TRAILER-02; research Pitfall 1 |
| `videos.insert` resumable session initiation | Included | Start with `uploadType=resumable`, `snippet,status`, and `privacyStatus: private`; persist the returned session URI before bytes transfer. | TRAILER-02; D-07, D-08 |
| Resumable status query and range resume | Included | Reconcile the persisted session and confirmed byte offset after interruption; stream canonical media in bounded chunks. | TRAILER-03; D-07 |
| Private upload completion | Included | Persist provider video ID and private upload state; transfer completion is not publication or readiness. | TRAILER-02; D-05 |
| `videos.list` processing polling | Included | Poll authorized `status,processingDetails` until private-ready or a normalized terminal/retryable outcome. | TRAILER-02, TRAILER-03; D-08 |
| One active job per source | Included | SQLite source fingerprint, unique active-source lookup, lease/revision conditional transitions, and stale-source obsoletion. | TRAILER-03; D-04, D-08 |
| Local cancellation | Included | Persist cancel request and stop local work at safe boundaries; report the actual provider-acceptance boundary. | TRAILER-03; D-06 |
| Provider-resource deletion | Explicitly unsupported | Retain an accepted private provider video for reconciliation; this phase does not promise rollback or delete remote video resources. | D-05, D-06 |
| Public publish/update (`videos.update`) | Explicitly deferred to Phase 17 | No endpoint, worker transition, provider adapter mutation, or DTO field may make a video public. | Phase 17; deferred ideas |
| Title, description, category, tags, hashtags | Explicitly deferred to Phase 17 | Phase 16 only supplies the minimal private-upload metadata required to establish the job; no editable title or hashtag API is exposed. | TRAILER-06; deferred ideas |
| Persisted public URL | Explicitly deferred to Phase 17 | Do not set/update the episode public YouTube URL in this phase. | TRAILER-04; deferred ideas |
| Local version retention/pruning | Explicitly deferred to Phase 17 | Preserve current and recovery media; do not delete local versions based on private upload, cancellation, or processing state. | TRAILER-07; deferred ideas |
| Playlist management | Unsupported | No playlist reads or mutations. | TRAILER-F03; deferred ideas |
| Captions, thumbnails, comments, community posts | Unsupported | No provider endpoints or routes for these capabilities. | Out of phase scope |
| Analytics/metrics changes | Unsupported in this phase | Existing metrics integration is not altered. | Minimal-scope boundary |
| Browser-side OAuth or direct YouTube calls | Explicitly prohibited | Credentials, session URI, and provider responses stay server-side; protected DTOs are sanitized. | TRAILER-02, TRAILER-03; deferred ideas |
| Automatic or scheduled publication | Explicitly prohibited | The worker transfers/reconciles private jobs only; it never publishes. | TRAILER-F02; deferred ideas |

## Multi-source coverage audit

| Source | ID | Required outcome | Plans | Status |
|---|---|---|---|---|
| GOAL | — | Safe New Episode staging plus one durable private-first job per current finalized source. | 16-01 through 16-04 | COVERED |
| REQ | TRAILER-02 | Protected, private-first durable start and processing lifecycle. | 16-02, 16-03, 16-04 | COVERED |
| REQ | TRAILER-03 | Fingerprint, progress, cancellation, retry, recovery, replacement, and stale-write safety. | 16-02, 16-03, 16-04 | COVERED |
| REQ | TRAILER-09 | Owner-bound reservation, staging, atomic creation promotion, and compensation. | 16-01, 16-04 | COVERED |
| RESEARCH | — | Persist before provider effects; session reconciliation, Range resume, polling, bounded single worker, OAuth readiness, and no package additions. | 16-02, 16-03, 16-04 | COVERED |
| CONTEXT | D-01 | Owner-bound, 24-hour, pre-upload reservation with abandonment cleanup. | 16-01 | COVERED |
| CONTEXT | D-02 | Matching authenticated Save atomically promotes to canonical final MP4. | 16-01 | COVERED |
| CONTEXT | D-03 | Failed/cancelled/disconnected/expired work preserves final media and never claims staging final. | 16-01 | COVERED |
| CONTEXT | D-04 | Replacement obsoletes prior source work and blocks late results. | 16-03 | COVERED |
| CONTEXT | D-05 | Accepted private provider videos remain available for reconciliation. | 16-03 | COVERED |
| CONTEXT | D-06 | Cancel DTO reflects the local/provider acceptance boundary honestly. | 16-03, 16-04 | COVERED |
| CONTEXT | D-07 | Retry resumes recorded session/video when source remains current and recovery is safe. | 16-03 | COVERED |
| CONTEXT | D-08 | Durable source, state, provider, and recovery evidence makes restart/duplicate/stale work safe. | 16-02, 16-03, 16-04 | COVERED |

Deferred Phase 17 concerns and unsupported provider capabilities in the matrix are exclusions, not plan gaps.
