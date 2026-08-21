# Phase 16: Draft Staging and Private YouTube Job - Research

**Researched:** 2026-08-04
**Domain:** Server-owned draft-media promotion and durable YouTube Data API resumable-upload orchestration
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Draft reservation and staging
- **D-01:** The API issues the owner-bound draft reservation before the first trailer-video upload. It is tied to the form's episode ID, expires after 24 hours, and cleans abandoned staging.
- **D-02:** The matching authenticated Save consumes the reservation and atomically promotes the staged MP4 to canonical `episodes/{episodeId}/trailer.mp4`.
- **D-03:** Failed, canceled, disconnected, expired, or rolled-back work must not expose staged media as finalized or remove a last-known-good final trailer.

#### Replacement during asynchronous work
- **D-04:** A local replacement makes any job for the previous source obsolete. The API must attempt to cancel it when safe, but it must never allow its late result to update the current episode.
- **D-05:** An accepted private provider video is retained for reconciliation rather than automatically deleted when replacement makes its job obsolete.

#### Cancellation and recovery
- **D-06:** Cancellation reports the actual acceptance boundary: local/API cancellation cannot claim provider rollback after YouTube has accepted bytes or created a private video.
- **D-07:** Retry resumes the same persisted provider session or recorded provider video when the finalized source is unchanged and reconciliation is safe. A new private job is allowed only when the prior job is definitively unrecoverable or the trailer source changed.
- **D-08:** The job persists source identity, transfer and processing states, provider references, and recovery/error state so restart, reload, duplicate requests, and stale worker completion are safe.

### the agent's Discretion
- Exact reservation token format, cleanup scheduling, job-state names, retry bounds/backoff, and provider adapter decomposition, provided the owner/source/cancellation decisions above remain true.

### Deferred Ideas (OUT OF SCOPE)
- Title suggestion/validation, hashtag-count lookup, explicit public publishing, persisted public URL, and retention belong to Phase 17.
- Angular controls, progress presentation, and browser request cancellation behavior belong to the sibling `admin-web` milestone.
- Automatic/scheduled publishing, playlist management, and browser-side OAuth remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAILER-02 | Start one durable API-owned job for the current final source; transfer starts private. | Private `status.privacyStatus`, persisted resumable session, provider ID, and protected start/status/cancel routes. [CITED: https://developers.google.com/youtube/v3/docs/videos/insert] |
| TRAILER-03 | Persist identity, state, progress, cancellation boundary, and recoverable errors so replacement/restart cannot duplicate or stale-update. | SQLite source fingerprint plus lease/token guarded worker transitions, session reconciliation, and provider polling design. [VERIFIED: codebase grep] |
| TRAILER-09 | Issue owner-bound, expiring reservation; stage before Save and atomically promote only on matching authenticated creation. | Existing in-progress reservation/staging implementation and verifier must be completed through an atomic create/promotion boundary, not replaced. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 16 should preserve the existing draft-reservation surface, then harden its create/promotion boundary before adding YouTube work. The checked-out implementation already has a UUID-backed SQLite reservation, owner comparison, 24-hour expiry cleanup, MP4 staging, canonical `episodes/{id}/trailer.mp4` replacement rollback, and a compiled offline verifier. Its create route presently creates the episode and performs filesystem promotion as separate operations, so the plan must make the observable outcome atomic: on any promotion or later-create failure, remove the new row/final file, retain or clean staged media according to the reservation state, and consume the reservation only after durable success. [VERIFIED: codebase grep]

Use one SQLite-backed job per exact finalized source fingerprint, not a browser-owned upload. Begin YouTube `videos.insert` with `uploadType=resumable`, `snippet,status`, and `status.privacyStatus: "private"`; save the returned session URI before any file bytes transfer. The worker streams the server-owned canonical MP4 in resumable chunks, persists confirmed provider byte offsets, then polls the returned provider video ID using `videos.list(part=status,processingDetails)` until private-ready or terminal provider failure. Google documents upload completion and processing as different states. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] [CITED: https://developers.google.com/youtube/v3/docs/videos]

Keep the provider adapter small and injectable, reuse the installed `google-auth-library` only for OAuth refresh/access-token acquisition, and use Node's built-in HTTP/stream primitives for the upload protocol. Do not add `googleapis`, a queue package, or a test framework in this phase. The repo already uses SQLite repositories, a single-process non-overlapping worker pattern, and compiled scripts against temporary SQLite/media roots. [VERIFIED: codebase grep]

**Primary recommendation:** Complete reservation/promotion atomically, then implement one source-fingerprinted SQLite job state machine with a single streaming worker, a persisted resumable-session URI, provider-ID polling, and offline fake-provider verification. [VERIFIED: codebase grep] [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Draft reservation, owner check, expiry | API / Backend | Database / Storage | Authenticated API identity and durable reservation state decide whether staging is permitted. [VERIFIED: codebase grep] |
| MP4 staging and final promotion | API / Backend | Database / Storage | Server-derived filesystem paths and SQLite metadata must change as one recoverable workflow. [VERIFIED: codebase grep] |
| Source fingerprint and job idempotency | Database / Storage | API / Backend | SQLite is the durable coordination point across retries, reloads, and process restart. [VERIFIED: codebase grep] |
| Resumable upload and OAuth refresh | API / Backend | External YouTube boundary | Credentials and the resumable session must remain server-side; browser OAuth is out of scope. [CITED: https://developers.google.com/youtube/v3/guides/authentication] |
| Processing polling and reconciliation | API / Backend | External YouTube boundary | The worker maps provider `status`/`processingDetails` into persisted job state. [CITED: https://developers.google.com/youtube/v3/docs/videos/list] |
| Start/status/cancel API contract | API / Backend | — | Protected routes expose sanitized lifecycle state, never paths, session URIs, refresh tokens, or provider credentials. [VERIFIED: codebase grep] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fetch`, `fs`, `crypto`, streams | Node v24.17.0 available | Stream canonical MP4 bytes, SHA-256 source evidence, and call YouTube's documented resumable HTTP protocol. | No added dependency is needed for the documented POST/PUT protocol. [VERIFIED: codebase grep] |
| `google-auth-library` | Installed in project lock/package manifest | Refresh OAuth access tokens for the server-owned Google account. | It is already the codebase's Google OAuth client dependency. [VERIFIED: codebase grep] |
| Node built-in `node:sqlite` | Existing project persistence layer | Persist reservations/jobs and coordinate state transitions. | Existing repositories and workers use SQLite as durable application state. [VERIFIED: codebase grep] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Express 5.x and Zod | Installed in project manifest | Protected lifecycle routes and strict request parsing. | Use for start/status/cancel endpoints, retaining thin route/service/repository layering. [VERIFIED: codebase grep] |
| Existing compiled verifier scripts | Repository-native pattern | Exercise service/route/worker transitions with temporary SQLite and media roots. | Use instead of adding a test runner or making live YouTube calls. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct documented resumable HTTP adapter | A new Google API SDK wrapper | A wrapper can hide protocol details, but this phase must persist/query the session URI and prove retry/cancellation boundaries; no new package is needed. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] |
| SQLite durable worker | External job queue | The project is a single Express/SQLite process and the VPS target is 4 GB; an added broker is out of scope without an operational need. [VERIFIED: codebase grep] |

**Installation:** No external packages should be installed for Phase 16. [VERIFIED: codebase grep]

## Architecture Patterns

### System Architecture Diagram

```text
Admin browser
  │ authenticated API calls; no provider credential or server path
  ▼
Express protected routes ──► reservation service ──► SQLite draft row
  │                                      │
  │ multipart MP4                        ▼
  └──────────────────────────────► server staging directory
                                           │ matching owner + draft ID on Save
                                           ▼
                                    atomic final promotion
                                           │ canonical final file + source fingerprint
                                           ▼
POST job ───────────────────────► SQLite YouTube job (queued; unique active source)
                                           │ one non-overlapping worker
                                           ▼
                                 provider adapter / OAuth refresh
                                   │ initiate private resumable session
                                   │ persist Location session URI
                                   │ stream/resume canonical source
                                   ▼
                              YouTube Data API (private provider video)
                                   │ provider ID + status/processingDetails poll
                                   ▼
                             SQLite normalized job state ──► protected polling API

Replacement ──► new fingerprint ──► obsolete old job; stale worker token cannot write current state
```

### Recommended Project Structure

```text
src/
├── database/repositories/youtube-trailer-job.repository.ts # SQLite CAS/claim/query operations
├── services/episode-draft-reservation.service.ts           # complete existing owner/expiry lifecycle
├── services/youtube-trailer-job.service.ts                 # start, reconcile, normalize provider state
├── services/youtube-trailer-upload.provider.ts             # injected resumable HTTP adapter
├── workers/youtube-trailer-job.worker.ts                   # one non-overlapping start/recovery loop
├── routes/episodes.routes.ts                               # draft and job route boundary
└── scripts/verify-youtube-trailer-job-lifecycle.ts         # compiled fake-provider proof
```

### Pattern 1: Atomic reservation consumption and promotion

**What:** Treat reservation validation, new episode creation, canonical MP4 promotion, media metadata update, and reservation consumption as one recoverable unit with an explicit compensation record/order. [VERIFIED: codebase grep]

**When to use:** Only for a new episode using the exact authenticated draft reservation; existing persisted-episode replacement continues through the final-video service. [VERIFIED: codebase grep]

**Prescriptive steps:**

1. Validate owner, episode ID, non-expiry, and `reserved|staged` state before create. [VERIFIED: codebase grep]
2. Create the episode and record enough pre-state to delete it if subsequent promotion fails. [VERIFIED: codebase grep]
3. Promote only the server-derived staging path through the existing prepared-file/rollback routine. [VERIFIED: codebase grep]
4. Mark reservation consumed only after final file and episode media metadata are durable; on failure, remove the new row/final file and leave the reservation retryable or mark an explicit terminal cleanup state. [VERIFIED: codebase grep]

### Pattern 2: Source-fingerprinted, compare-and-set job ownership

**What:** Define `sourceFingerprint` as `sha256 + byteLength + canonical relative filename` of the regular final trailer file, captured when the job is created. Store a `workerLeaseId`/monotonic `revision` on each claimed row; every provider result update must require the same lease/revision and re-check current episode source evidence. [VERIFIED: codebase grep]

**When to use:** On start, every retry/recovery, provider completion, provider processing poll, cancel request, and local trailer replacement. [VERIFIED: codebase grep]

**Why:** A source hash prevents a same-path replacement from being mistaken for the original source; a compare-and-set claim prevents a late async completion from overwriting an obsolete job. [VERIFIED: codebase grep]

### Pattern 3: Persist before provider side effect, reconcile after uncertainty

**What:** Persist `starting` before session initiation, then atomically persist the returned session URI before sending bytes. After a timeout/restart, query the recorded resumable URI first; after provider video ID exists, poll `videos.list` before considering a new upload. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] [CITED: https://developers.google.com/youtube/v3/docs/videos/list]

**State machine:**

```text
queued → starting → transferring ⇄ retry_wait → uploaded_private → processing → private_ready
                    │                   │                  │                  │
                    └→ cancel_requested ┴→ canceled         └→ provider_failed ┴→ obsolete

Any nonterminal state on restart → reconcile_session or reconcile_video → one of the states above.
```

`uploaded_private` means YouTube accepted a video resource with `privacyStatus=private`; it is not public-ready. `private_ready` requires the provider ID, `status.privacyStatus=private`, `status.uploadStatus=processed`, and `processingDetails.processingStatus=succeeded`. [CITED: https://developers.google.com/youtube/v3/docs/videos]

### Pattern 4: Honest cancellation

**What:** `POST cancel` must immediately persist `cancel_requested`; the worker observes it before initiating a session or each new chunk, stops local transfer, and reports whether bytes/video had already crossed the provider acceptance boundary. Retain session URI and provider video ID for reconciliation. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

**Boundary:** Google documents session status querying, resumption, expiry, and completion responses, but this research did not find an official client-side resumable-session cancellation operation. Therefore never report that provider rollback/deletion occurred merely because the local worker stopped. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

### Data Model (required fields)

| Field group | Required persisted values | Rationale |
|-------------|---------------------------|-----------|
| Identity | `job_id`, `episode_id`, `source_fingerprint`, `source_bytes`, canonical relative filename, `source_captured_at` | Makes start idempotent and detects replacement at every boundary. [VERIFIED: codebase grep] |
| Ownership/concurrency | lifecycle state, `revision` or `worker_lease_id`, claimed/heartbeat timestamps, `cancel_requested_at`, `obsolete_at` | Allows restart recovery and suppresses late worker updates. [VERIFIED: codebase grep] |
| Resumable transfer | encrypted-or-redacted-at-API session URI, total bytes, confirmed uploaded bytes, chunk size, retry count, `next_attempt_at` | Google returns a resumable session URI and Range-based progress; it must survive restart but never be returned to clients. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] |
| Provider reconciliation | `youtube_video_id`, `privacy_status`, `upload_status`, `processing_status`, progress estimates, last checked timestamp | `videos.list` exposes the selected `status` and `processingDetails` parts. [CITED: https://developers.google.com/youtube/v3/docs/videos/list] |
| Failure evidence | normalized category, HTTP status/reason, safe message, provider failure/rejection/processing reason, occurrence/retry timestamps | YouTube exposes upload, rejection, and processing failure reasons; preserve enough to decide retry safely. [CITED: https://developers.google.com/youtube/v3/docs/videos] |

### Anti-Patterns to Avoid

- **In-memory job/session state:** A restart loses the upload position and allows duplicate provider sessions. Persist before each external side effect. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]
- **Path-only identity:** `episodes/{id}/trailer.mp4` remains the same after replacement; hash and byte count are necessary to reject stale work. [VERIFIED: codebase grep]
- **Marking ready on HTTP 201:** A provider video must still be processed and private before it is ready for the later explicit-public phase. [CITED: https://developers.google.com/youtube/v3/docs/videos]
- **Deleting a provider video on local cancellation/replacement:** D-05 requires retention for reconciliation, and a local stop does not prove provider rollback. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]
- **Polling from request handlers:** Polling/retry belongs to the worker; routes only create, read, or request cancellation. [VERIFIED: codebase grep]
- **Buffering a 500 MiB MP4 in memory:** Stream from the canonical file with one worker on the 4 GB VPS. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider upload protocol | Ad-hoc one-shot multipart upload/retry | YouTube's documented resumable POST/PUT/Range protocol | It explicitly defines session URI, resume query, 308 progress, retryable failures, and session expiry. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] |
| Provider processing interpretation | A guessed time-based "ready" delay | `videos.list` with `status,processingDetails` | YouTube provides upload, processing, and failure states and owner-visible estimates. [CITED: https://developers.google.com/youtube/v3/docs/videos/list] |
| OAuth credential handling | Browser OAuth or a service account | Existing server-side refresh-token OAuth flow with `youtube.upload` scope | The YouTube Data API does not support service accounts; the browser must not receive provider credentials. [CITED: https://developers.google.com/youtube/v3/guides/authentication] [CITED: https://developers.google.com/youtube/v3/docs/videos/insert] |
| Durable queue | An in-memory promise list | SQLite job rows plus repository compare-and-set claims | Existing project architecture is SQLite-backed and process-local workers are restartable only when state is persisted. [VERIFIED: codebase grep] |

**Key insight:** The custom code should orchestrate durable business state, while Google owns resumable-transfer and processing semantics. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

## Common Pitfalls

### Pitfall 1: Existing OAuth refresh token lacks upload scope

**What goes wrong:** The current metrics refresh token may authenticate analytics calls but not authorize `videos.insert`. [VERIFIED: codebase grep]

**How to avoid:** Add an explicit configuration/credential readiness check that obtains an access token and verifies the deployment refresh token was granted `https://www.googleapis.com/auth/youtube.upload` (or a documented broader insert scope) before enabling the worker; retain the result as an operator-visible disabled/recoverable configuration error. [CITED: https://developers.google.com/youtube/v3/docs/videos/insert]

### Pitfall 2: Duplicating a private video after an uncertain timeout

**What goes wrong:** Starting a new `videos.insert` after a lost response can create another provider video. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

**How to avoid:** Persist `starting` before initiation, persist the `Location` URI immediately after initiation, query the recorded URI after uncertain transfer, and reconcile recorded provider IDs before authorizing a new job. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

### Pitfall 3: Treating processing percentages as monotonic

**What goes wrong:** `partsTotal` can be refined, so a calculated provider processing percentage can go down. [CITED: https://developers.google.com/youtube/v3/docs/videos]

**How to avoid:** Store raw `partsProcessed`, `partsTotal`, and `timeLeftMs`; return an optional/approximate processing percentage, never use it as a completion predicate. [CITED: https://developers.google.com/youtube/v3/docs/videos]

### Pitfall 4: Allowing a stale worker to update a replacement

**What goes wrong:** A worker that started on source A finishes after source B replaces the same canonical filename. [VERIFIED: codebase grep]

**How to avoid:** Re-check source fingerprint and job lease at each provider result and only mutate the job row when both still match. Mark source-A jobs obsolete and request local stop without deleting an accepted private provider video. [VERIFIED: codebase grep]

### Pitfall 5: Promotion is not actually atomic today

**What goes wrong:** The checked-out create route creates the row, promotes the file, runs additional side effects, and consumes the reservation later; its catch compensates only some state. [VERIFIED: codebase grep]

**How to avoid:** Plan a focused hardening task first: isolate reservation/create/promote/consume from unrelated launch/transcript work, define compensation for each fault point, and extend the compiled verifier to force each failure. [VERIFIED: codebase grep]

## Code Examples

Verified patterns from official sources:

### Start a private resumable session

```typescript
// Source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
const response = await fetch(
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(sourceBytes),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: { title, categoryId: 22 },
      status: { privacyStatus: "private" },
    }),
  }
);
const sessionUri = response.headers.get("location"); // persist before PUT bytes
```

### Recover transfer position before resuming

```typescript
// Source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
const status = await fetch(job.sessionUri, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Length": "0",
    "Content-Range": `bytes */${job.sourceBytes}`,
  },
});

// 308 + Range => resume at upperRange + 1; completed response => persist video ID instead.
```

### Poll provider processing separately from transfer

```typescript
// Source: https://developers.google.com/youtube/v3/docs/videos/list
const response = await fetch(
  `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(job.youtubeVideoId)}`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
// Map status.uploadStatus and processingDetails.processingStatus into the durable job row.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One request assumes all bytes were accepted | Resumable session URI plus Range-based status query/resume | Current Google documentation | Survives network interruption and restart without guessing byte position. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] |
| Upload success means video ready | Poll `status` and `processingDetails` after upload | Current Google documentation | Private transfer completion and processing completion are distinct lifecycle gates. [CITED: https://developers.google.com/youtube/v3/docs/videos] |

**Deprecated/outdated:** Do not use a service-account design for YouTube channel uploads; the YouTube Data API documentation says service accounts are unsupported for this use. [CITED: https://developers.google.com/youtube/v3/guides/authentication]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A 256 KiB-or-larger consistent resumable chunk size will be chosen for the 4 GB VPS worker. | Architecture Patterns | A different size may be operationally better; validate with production bandwidth and timeout limits before locking it. [ASSUMED] |
| A2 | Existing `YOUTUBE_REFRESH_TOKEN` can be renewed with, or replaced by, a grant containing `youtube.upload`. | Common Pitfalls | Operator credential rotation/setup may be required before uploads can run. [ASSUMED] |

## Operational Enablement Resolution

The live worker is disabled by default and remains disabled until the dedicated pre-enable checkpoint is approved. This resolves the two deployment-dependent questions without putting any live provider call in automated verification.

1. **Production OAuth grant, token, and channel:** An operator must validate that the configured refresh token belongs to the intended production channel and that its grant authorizes server-side `youtube.upload` readiness before setting the worker enable flag. The human check may inspect the OAuth grant/channel through operator-controlled credentials, but it must not upload a test video. [CITED: https://developers.google.com/youtube/v3/docs/videos/insert]

2. **Conservative VPS poll/retry limits:** Phase 16 documents and ships opt-in settings with these defaults: one worker, 60-second processing poll interval, 30-second provider request timeout, 60-second initial retry delay, exponential backoff capped at 15 minutes, and five retry attempts. The operator records the production values at the checkpoint and may only enable the worker after accepting those limits for the VPS bandwidth and channel quota. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol]

The fake-provider verifier remains the only automated provider exercise. It uses temporary fixtures and never accesses OAuth credentials, a channel, or the YouTube network.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Streaming worker and compiled verifier | ✓ | v24.17.0 | — |
| npm | Build/typecheck/verifier execution | ✓ | 12.0.1 | — |
| SQLite through Node built-in | Durable reservation/job state | ✓ | Project uses `node:sqlite` | — [VERIFIED: codebase grep] |
| Google OAuth credentials with upload scope | Real provider transfer | Operator checkpoint required | — | Keep the worker disabled until the operator approves the documented OAuth/token/channel and operational-limit gate. |
| Outbound Google API access | Real provider transfer/polling | ✗ unverified | — | Offline provider adapter verifier covers all local state transitions. [ASSUMED] |

**Missing dependencies with no fallback:** A Google account OAuth grant with an upload-capable scope is required before live uploads can execute. [CITED: https://developers.google.com/youtube/v3/docs/videos/insert]

**Missing dependencies with fallback:** Live Google connectivity/credentials are not required to compile and run the repository-native fake-provider verifier. [VERIFIED: codebase grep]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Repository-native compiled Node assertion scripts; no general test runner. [VERIFIED: codebase grep] |
| Config file | none — use the established `src/scripts/verify-*.ts` pattern. [VERIFIED: codebase grep] |
| Quick run command | `npm run typecheck` |
| Full suite command | `npm run build && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAILER-02 | Persisted job begins private resumable transfer and exposes sanitized progress/state. | compiled service/worker integration | `npm run build && npm run verify:youtube-trailer-job-lifecycle` | ✅ Wave 1 foundation |
| TRAILER-03 | Duplicate/restart/cancel/retry/replacement reconciliation cannot create stale or duplicate active work. | compiled service/worker integration | `npm run build && npm run verify:youtube-trailer-job-lifecycle` | ✅ Wave 1 foundation |
| TRAILER-09 | Reservation owner/expiry/stage/promote/rollback boundary. | compiled route/service integration | `npm run build && npm run verify:trailer-video-upload-lifecycle` | ✅ Wave 1 expansion |

### Sampling Rate

- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run build && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle`
- **Phase gate:** Full suite green before `$gsd-verify-work`.

### Wave 1 Verification Foundation

- [ ] Plan 16-05 creates `src/scripts/verify-youtube-trailer-job-lifecycle.ts` and its compiled npm command before repository or worker implementation.
- [ ] Plan 16-01 expands `src/scripts/verify-trailer-video-upload-lifecycle.ts` for post-create/promotion/consume compensation in the same wave.
- [ ] Plans 16-02 and 16-03 extend and run focused fake-provider checks; the full suite runs after every wave without live network access.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth`; preserve `AUTH_BYPASS` only as the stable development identity, with identical owner checks. [VERIFIED: codebase grep] |
| V3 Session Management | yes | Keep Google refresh token/server session URI server-only; never put either in job DTOs or browser requests. [CITED: https://developers.google.com/youtube/v3/guides/authentication] |
| V4 Access Control | yes | Bind reservation to normalized authenticated email and validate it on staging/create; make job routes protected. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Zod positive IDs, fixed route shapes, server-derived media paths, MP4/mime/size checks, and no raw provider URI input. [VERIFIED: codebase grep] |
| V6 Cryptography | yes | Use Node SHA-256 for source identity and existing Google OAuth transport; do not invent token or encryption schemes. [VERIFIED: codebase grep] |

### Known Threat Patterns for Express + SQLite + YouTube upload

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unreserved ID stages media | Elevation/Tampering | Require a non-expired owner-bound reservation before Multer retains draft MP4 bytes. [VERIFIED: codebase grep] |
| Provider credential/session URI leaks in status API or logs | Information Disclosure | Persist server-only values and expose only sanitized state/progress/error DTOs. [CITED: https://developers.google.com/youtube/v3/guides/authentication] |
| Replacement races old upload | Tampering | Source fingerprint + lease/revision conditional updates; mark old work obsolete. [VERIFIED: codebase grep] |
| Large-file memory exhaustion | Denial of Service | One streaming worker, bounded chunk/read size, and existing server upload size limits. [VERIFIED: codebase grep] |
| Forged completion / duplicate provider resource | Repudiation/Tampering | Persist provider ID/session before/after side effects and reconcile through authorized `videos.list`. [CITED: https://developers.google.com/youtube/v3/docs/videos/list] |

## Project Constraints (from AGENTS.md)

- Keep feed generation server-side. [VERIFIED: AGENTS.md]
- Do not move scheduling/feed rules to frontend. [VERIFIED: AGENTS.md]
- Respect backend `.env.dev` `AUTH_BYPASS` and frontend `authBypass`. [VERIFIED: AGENTS.md]
- Prefer minimal-scope changes and verify with `npm run typecheck` / `npm run build`. [VERIFIED: AGENTS.md]
- Preserve backend-owned Telegram locations: queue/dedupe in `launch-notification.service.ts`, delivery in `telegram.service.ts`, startup worker in `launch-notification.worker.ts`. [VERIFIED: AGENTS.md]
- Use the stated WSL API/admin-web workspace paths. [VERIFIED: AGENTS.md]

## Sources

### Primary (official Google / YouTube documentation)

- [YouTube resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) - session initiation, Location persistence, 308/Range resume, retryable failures, and session expiry.
- [YouTube videos.insert reference](https://developers.google.com/youtube/v3/docs/videos/insert) - private status, upload scopes, upload constraints, and quota information.
- [YouTube video resource](https://developers.google.com/youtube/v3/docs/videos) - upload/processing states, progress estimates, privacy status, and provider failure reasons.
- [YouTube videos.list reference](https://developers.google.com/youtube/v3/docs/videos/list) - owner-authorized polling of `status` and `processingDetails`.
- [YouTube OAuth authorization guide](https://developers.google.com/youtube/v3/guides/authentication) - refresh-token flow and unsupported service-account model.

### Codebase evidence

- Existing `episode-draft-reservation.service.ts`, `episode-trailer-video.service.ts`, `episodes.routes.ts`, SQLite repository/schema, artifact worker, verifier scripts, environment config, and `youtube-metrics.service.ts`. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - internal stack is verified in the codebase; live upload-scope readiness is not yet verified. [VERIFIED: codebase grep] [ASSUMED]
- Architecture: MEDIUM - provider protocol/processing behavior is official documentation; local transactional/lease design is an evidence-backed project recommendation. [CITED: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol] [VERIFIED: codebase grep]
- Pitfalls: MEDIUM - provider lifecycle is official; deployment credentials/bandwidth are intentionally left open. [CITED: https://developers.google.com/youtube/v3/docs/videos] [ASSUMED]

**Research date:** 2026-08-04
**Valid until:** 2026-08-11 (YouTube API behavior and operator credentials should be rechecked before live enablement).
