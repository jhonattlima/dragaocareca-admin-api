# Phase 17: Trailer Metadata, Publication and Retention - Research

**Researched:** 2026-08-11  
**Domain:** YouTube Data API metadata/publication orchestration and filesystem retention  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

- Admin-web controls for publication, title editing, and hashtags remain owned by the sibling frontend project.
- Automatic hashtag generation, candidate lookup, and manual hashtag relevance lookup are owned by Phase 18 and are not part of this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAILER-04 | Authenticated explicit publication of a private-ready video, safe repeated requests, canonical URL persistence and protected return. | Extend the Phase 16 ready job/provider boundary with server-side metadata update, playlist membership reconciliation, private-first ordering, guarded persistence, and a sanitized publication DTO. |
| TRAILER-07 | Configurable local retention defaulting to 12, triggered only after successful public publication/update. | Add a bounded retention config and version-directory/repository policy; cleanup runs after the external success gate and reports cleanup failure without compensating the public release. |
| TRAILER-08 | OpenAPI, environment documentation, executable verification, typecheck and build cover the complete lifecycle. | Follow existing protected no-store routes, OpenAPI assertions, temporary SQLite/media fixtures, injected fake providers, `npm run typecheck`, and `npm run build`. |
</phase_requirements>

## Summary

Phase 17 should extend the existing Phase 16 private-ready job rather than create a second upload path. The repository already fingerprints the canonical MP4, coalesces active work, persists the provider video ID, polls `videos.list`, and exposes only sanitized job state. The missing boundary is a server-owned publication service/provider contract that accepts operator metadata, reconciles the same provider video, records publication progress, and updates the episode URL only after external success. [VERIFIED: codebase grep]

YouTube's documented update semantics make request construction important: `videos.update` with `part=status` can change privacy without sending snippet fields; if `part=snippet` is included, the request must send the title and category, and omitted mutable properties may be deleted. Use `part=snippet,status` only when deliberately sending the complete mutable metadata snapshot, or use separate narrowly scoped updates. YouTube limits title to 100 characters and description to 5000 bytes; the title policy must count Unicode code points according to the project's shared validator and reject `<`/`>` before the provider call. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/videos]

The safe publication sequence is: verify the current job/source and provider video are still private-ready; reconcile playlist membership; insert the video into the configured playlist only when absent; re-read provider state; then update privacy to `public`; re-read and persist the canonical `https://www.youtube.com/watch?v={id}` URL; only then prune older local versions. If a request times out after an external side effect, retry by reading provider state and playlist membership rather than creating a new video or blindly repeating an insert. The ordering is a project-level safety recommendation derived from the locked invariant and the provider's separate playlist/update operations. [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/list] [CITED: https://developers.google.com/youtube/v3/docs/videos/list] [VERIFIED: codebase grep]

**Primary recommendation:** Add a durable publication state machine keyed to the existing job/provider video ID, use an edit-capable OAuth grant, make playlist insertion idempotent by `playlistItems.list(videoId, playlistId)`, publish only after confirmed private playlist membership, and make retention a post-publication filesystem operation with an independently recoverable error. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Metadata validation and title/hashtag assembly | API / Backend | Browser / Client | The API must enforce the 100-character and invalid-character policy even when the frontend is bypassed. [VERIFIED: REQUIREMENTS.md] |
| YouTube metadata update and privacy transition | API / Backend | External YouTube boundary | Credentials and provider side effects stay server-owned; the browser never calls YouTube. [VERIFIED: AGENTS.md] [CITED: https://developers.google.com/youtube/v3/guides/authentication] |
| Playlist membership reconciliation | API / Backend | External YouTube boundary | The provider playlist item is an external durable side effect requiring authenticated read/write reconciliation. [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/list] |
| Publication state, URL, and recovery error | Database / Storage | API / Backend | SQLite is the application source of truth and must survive retries/restarts without exposing provider internals. [VERIFIED: ARCHITECTURE.md] [VERIFIED: codebase grep] |
| Local version retention | Database / Storage | API / Backend | Version files live under configured media roots; cleanup must preserve current/retained files and be independently retryable. [VERIFIED: codebase grep] |

## Project Constraints (from AGENTS.md)

- Keep feed generation server-side.
- Do not move scheduling/feed rules to frontend.
- Respect auth toggles: backend `.env.dev`: `AUTH_BYPASS`; frontend env: `authBypass`.
- Prefer minimal-scope changes and verify with `npm run typecheck` / `npm run build`.
- Telegram launch notifications live in the backend service: queue + dedupe in `src/services/launch-notification.service.ts`; delivery in `src/services/telegram.service.ts`; startup worker in `src/workers/launch-notification.worker.ts`.
- Use the WSL workspace layout: `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api` and `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-web`.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (`fetch`, `fs`, `crypto`, `URL`) | v24.17.0 available | Provider HTTP calls, URL construction, hashing and filesystem retention. | Phase 16 already uses built-in fetch/filesystem/crypto and no new provider SDK is required. [VERIFIED: environment probe] [VERIFIED: codebase grep] |
| `google-auth-library` | ^10.6.2 in package.json | Refresh server-side access tokens and inspect granted scopes. | It is already the project's OAuth boundary; do not add a second Google client. [VERIFIED: package.json] |
| SQLite via `node:sqlite` | Node v24.17.0 | Durable publication fields/state, source/job guards, and retention outcome. | Existing episode/job repositories and migrations use SQLite as canonical persistence. [VERIFIED: ARCHITECTURE.md] [VERIFIED: codebase grep] |
| Express 5 + Zod 4 | ^5.2.1 / ^4.4.3 | Protected no-store routes and strict request validation. | Existing episode routes use this stack and shared error middleware. [VERIFIED: package.json] [VERIFIED: codebase grep] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing compiled verifier scripts | repository pattern | Offline fake-provider and direct-router lifecycle proof. | Add a Phase 17 verifier that exercises provider call order, retries, redaction, persistence and retention failures without live YouTube. [VERIFIED: phase16 VERIFICATION.md] |
| Existing `episodeRepository` and media-layout helpers | repository code | Persist URL/sync state and resolve only server-derived canonical/backup paths. | Reuse rather than accepting filesystem paths or duplicating episode persistence. [VERIFIED: codebase grep] |

**Installation:** No new external package is recommended or required. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
Authenticated publish request
        |
        v
Route: no-store + auth + Zod metadata validation
        |
        v
Publication service: load current episode/job/source + verify private-ready
        |
        +--> provider videos.list(id, status,snippet) ----------------+
        |                                                             |
        +--> playlistItems.list(playlistId, videoId)                 |
        |        |                                                    |
        |        +--> absent --> playlistItems.insert(private video)  |
        |                                                             v
        +--> provider re-read private + playlist membership ---------+
        |
        +--> videos.update(part=status, privacyStatus=public)
        |
        +--> provider re-read public --> SQLite URL/sync/publication state
        |
        +--> retention service: preserve current + newest N versions
                         |
                         +--> success: record complete
                         +--> failure: keep publication, record cleanup-retryable
```

The diagram represents provider boundaries and side-effect order, not file layout. Every provider result must be associated with the exact job revision/source fingerprint so a replacement cannot be updated by stale work. [VERIFIED: codebase grep]

### Recommended Project Structure

```text
src/
├── database/repositories/youtube-trailer-job.repository.ts   # guarded publication fields/transitions
├── services/youtube-trailer-publication.service.ts           # metadata, reconciliation, state machine
├── services/youtube-trailer-upload.provider.ts               # injected provider contract + live Data API calls
├── services/episode-trailer-retention.service.ts             # version discovery, keep/delete policy, errors
├── routes/episodes.routes.ts                                 # protected publish/status contract
├── docs/openapi.ts                                            # endpoint/schema/config contract
└── scripts/verify-youtube-trailer-publication.ts              # compiled offline behavioral proof
```

This is a recommended extension of the existing service/repository/route layout. [VERIFIED: ARCHITECTURE.md] [VERIFIED: codebase grep]

### Pattern 1: Durable provider-side-effect state machine

**What:** Persist a publication intent and each external milestone (`metadata-ready`, `playlist-confirmed`, `public-confirmed`, `retention-complete` or recoverable failure) with job ID, source fingerprint, provider video ID, revision and safe error category. [VERIFIED: codebase grep]

**When to use:** Any request can be retried, interrupted after an external side effect, or run after a local replacement. [VERIFIED: CONTEXT.md]

**Example:**

```ts
// Source: https://developers.google.com/youtube/v3/docs/videos/update
await provider.updateVideo({
  videoId,
  part: "status",
  status: { privacyStatus: "public" },
});
```

Use `part=status` for the final visibility transition so snippet fields are not accidentally overwritten. If metadata is updated in the same request, first retrieve/preserve the full mutable snippet required by YouTube, including `snippet.categoryId`. [CITED: https://developers.google.com/youtube/v3/docs/videos/update]

### Pattern 2: Read-before-write reconciliation

**What:** For every retry, inspect the recorded provider video and configured playlist before writing. Query playlist membership by both playlist ID and video ID; insert only if absent; after an ambiguous insert response, query again before retrying. [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/list] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]

**When to use:** Duplicate publish clicks, request timeouts, worker restarts, and a provider response lost after a successful side effect. [ASSUMED]

### Pattern 3: Compensation boundary, not fake rollback

**What:** The playlist insertion happens while private. A playlist failure leaves the video private and retryable. Once privacy update is confirmed public, cleanup failure is recorded but never triggers a visibility rollback. [VERIFIED: CONTEXT.md] [CITED: https://developers.google.com/youtube/v3/docs/videos/update]

**When to use:** Any multi-provider-operation workflow without a true atomic transaction. [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth token refresh/scope handling | Custom JWT/token exchange | Existing `google-auth-library` OAuth2Client and `getTokenInfo` readiness check | Google OAuth tokens and scope grants have provider semantics; existing code already centralizes refresh. [VERIFIED: codebase grep] [CITED: https://developers.google.com/youtube/v3/guides/authentication] |
| Provider publication state | Local boolean as sole truth | `videos.list` with `status,snippet` plus guarded SQLite snapshot | Provider state can change between requests and after uncertain responses. [CITED: https://developers.google.com/youtube/v3/docs/videos/list] |
| Playlist duplicate detection | Blind repeated `playlistItems.insert` | `playlistItems.list` filtered by playlist/video, then conditional insert | The API exposes a direct membership query and insert is a separate 50-unit write. [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/list] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert] |
| Unicode/byte limits | JavaScript `.length` alone | Shared project validator plus explicit code-point/UTF-8-byte tests | YouTube documents title in characters and description in bytes; provider rejects invalid metadata. [CITED: https://developers.google.com/youtube/v3/docs/videos] |
| Retention history | Delete from the canonical directory by glob | Server-derived version directory/catalog with keep-set calculation and post-publication deletion | Canonical current file and twelve newest prior versions must survive failures and never be selected by artifact allowlists. [VERIFIED: CONTEXT.md] [VERIFIED: codebase grep] |

## Common Pitfalls

### Pitfall 1: Reusing `youtube.upload` as publication authorization

**What goes wrong:** Phase 16 readiness accepts only the upload scope, but the official `videos.update` and `playlistItems.insert` references list `youtube`, `youtube.force-ssl`, or `youtubepartner`, not `youtube.upload`. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]

**How to avoid:** Treat `youtube.upload` as mandatory for the existing upload job and require `youtube.force-ssl` as the Phase 17 edit-capable publication scope. The readiness assertion must inspect the granted scope set and fail closed unless both exact scopes are present. The live checkpoint must have the operator re-consent or replace the refresh token, confirm the token belongs to channel `UCq-TjauoYJrr3po121gA6iw`, and confirm the configured playlist is owned by that channel before enabling publication. The official `videos.update` and `playlistItems.insert` references accept `youtube.force-ssl` for the edit operations. [CITED: https://developers.google.com/youtube/v3/guides/authentication] [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]

### Pitfall 2: Making public before playlist insertion

**What goes wrong:** A playlist failure after a successful public transition violates the locked invariant and creates a public video outside the intended playlist transaction. [VERIFIED: CONTEXT.md]

**How to avoid:** Insert/reconcile while private, re-read, then set public. Never compensate a post-publication retention error by changing visibility. [VERIFIED: CONTEXT.md]

### Pitfall 3: Blindly retrying an uncertain insert/update

**What goes wrong:** A lost HTTP response does not prove the provider side effect failed; retrying without reading can create duplicate playlist items or lose track of an already-public video. [ASSUMED]

**How to avoid:** Persist the provider video ID before publication, query `videos.list` and `playlistItems.list` at each retry, and make local transitions conditional on job ID/source/revision. [CITED: https://developers.google.com/youtube/v3/docs/videos/list] [VERIFIED: codebase grep]

### Pitfall 4: Updating `snippet` without a complete valid payload

**What goes wrong:** `videos.update` replaces mutable properties in specified parts; when `snippet` is included, title and category are required and omitted existing properties can be deleted. [CITED: https://developers.google.com/youtube/v3/docs/videos/update]

**How to avoid:** Keep final privacy update to `part=status`; for metadata, send title, description, category ID, and only intentionally managed fields in a separate explicit operation. [CITED: https://developers.google.com/youtube/v3/docs/videos/update]

### Pitfall 5: Treating title characters and description bytes as the same limit

**What goes wrong:** A title may pass a byte-length check but violate the 100-character policy, or a multibyte description may exceed 5000 bytes while appearing short in characters. [CITED: https://developers.google.com/youtube/v3/docs/videos]

**How to avoid:** Test astral Unicode, combining marks, accents, `<`, `>`, empty/whitespace values, and UTF-8 byte boundaries. The user-facing shared 100-character policy remains the phase gate even though YouTube's description limit is byte-based. [CITED: https://developers.google.com/youtube/v3/docs/videos] [VERIFIED: REQUIREMENTS.md]

### Pitfall 6: Retaining only one generic backup

**What goes wrong:** The current media layout has a single backup path helper and the trailer-video replacement currently preserves/rolls back a temporary previous copy, not a twelve-version history. [VERIFIED: codebase grep]

**How to avoid:** Discover legacy local trailer versions before any deletion using a deterministic ordered migration rule: inspect only the server-derived canonical final directory and the existing backup location, accept only regular files after `lstat`, classify the canonical current file separately, parse only the established backup/version filename forms, order recognized legacy entries by embedded timestamp/version then normalized basename, and report malformed/ambiguous entries without deleting them. The retention keep-set must be computed from this complete discovery result, and deletion remains disabled until the discovery fixture passes. Never let retention scan staging or arbitrary paths. [VERIFIED: codebase grep] [VERIFIED: CONTEXT.md]

## Code Examples

### Metadata update with exact final summary

```ts
// Source: https://developers.google.com/youtube/v3/docs/videos/update
const metadata = {
  id: providerVideoId,
  snippet: {
    title: validatedTitle,
    description: episode.summary, // exact final saved summary; no boilerplate
    categoryId: configuredCategoryId,
  },
};
await provider.updateVideo({ part: "snippet", video: metadata });
```

The category ID must be available whenever `snippet` is updated, and the service should not add any description suffix. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [VERIFIED: CONTEXT.md]

### Playlist membership reconciliation

```ts
// Source: https://developers.google.com/youtube/v3/docs/playlistItems/list
const existing = await provider.findPlaylistItem({
  playlistId: config.youtube.trailerPlaylistId,
  videoId: providerVideoId,
});
if (!existing) {
  await provider.insertPlaylistItem({
    playlistId: config.youtube.trailerPlaylistId,
    videoId: providerVideoId,
  });
}
```

The insert body must contain `snippet.playlistId` and `snippet.resourceId` with the video resource ID; do not set a playlist position unless the target playlist is known to use manual sorting. [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]

### Final privacy transition

```ts
// Source: https://developers.google.com/youtube/v3/docs/videos/update
await provider.updateVideo({
  videoId: providerVideoId,
  part: "status",
  status: { privacyStatus: "public" },
});
const confirmed = await provider.getVideo(providerVideoId, ["status", "snippet"]);
if (confirmed.status.privacyStatus !== "public") {
  throw new Error("YouTube public transition was not confirmed");
}
```

Only the confirmed provider response should unlock the local URL persistence and retention trigger. [VERIFIED: CONTEXT.md] [CITED: https://developers.google.com/youtube/v3/docs/videos/update]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | SQLite `episodes.youtube` and `trailer_video_sync_status`; `youtube_trailer_jobs` stores provider video ID/privacy/processing but no publication or playlist state. [VERIFIED: codebase grep] | Add durable publication/playlist/retention fields or a related table; migrate existing rows safely and preserve existing published URLs. This is a data migration plus repository code. |
| Live service config | `YOUTUBE_DATA_BASE_URL`, channel ID, OAuth values, and job enable flag are env-derived; no playlist or publication-specific config exists. [VERIFIED: codebase grep] | Add documented playlist/channel/publication configuration and keep live work opt-in; verify the configured token belongs to channel `UCq-TjauoYJrr3po121gA6iw`. [VERIFIED: CONTEXT.md] |
| OS-registered state | No systemd/pm2/task-scheduler registration was found in the requested codebase audit; startup workers are process-local. [VERIFIED: codebase grep] | None for code planning; deployment checkpoint should confirm the production process is restarted with the new env/config. |
| Secrets/env vars | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_CHANNEL_ID`, and `YOUTUBE_TRAILER_JOB_ENABLED` exist; no publication scope/playlist/retention variables exist. [VERIFIED: codebase grep] | Document new non-secret playlist/retention values and require OAuth re-consent/refresh-token replacement if the current grant lacks edit scope. Never expose secrets in DTOs/logs. |
| Build artifacts / installed packages | `dist/` is generated by `npm run build`; `google-auth-library` is already installed. [VERIFIED: package.json] | Rebuild before compiled verifier execution; no package installation is needed. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, SQLite, provider adapter | ✓ | v24.17.0 | — |
| npm | Build and verifier scripts | ✓ | 12.0.1 | — |
| ffmpeg | Existing media operations only; not a Phase 17 provider dependency | ✓ | version not queried | — |
| Google OAuth grant with edit-capable YouTube scope | Live publication/playlist writes | ? | Human/operator checkpoint required | Offline fake provider for automated verification |
| Authenticated Dragao Careca channel/playlist | Live publication target | ? | Must verify channel and playlist ownership | Offline fake provider; no live publish |

**Missing dependencies with no fallback:** None for offline planning/verification. Live publication is blocked until the OAuth/channel checkpoint passes. [VERIFIED: phase16 VERIFICATION.md]

**Missing dependencies with fallback:** Live YouTube API access has an offline injected fake-provider fallback for tests; it is not a substitute for production OAuth validation. [VERIFIED: phase16 VERIFICATION.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node `assert/strict` in compiled repository-native verifier scripts; no test runner configured. [VERIFIED: package.json] |
| Config file | None — use `src/scripts/verify-*.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm run build && NODE_ENV=development DISABLE_BACKGROUND_WORKERS=true node dist/scripts/verify-youtube-trailer-publication.js` |
| Full suite command | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle && npm run verify:youtube-trailer-publication` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---------|----------|-----------|-------------------|--------------|
| TRAILER-04 | Metadata validation rejects invalid/over-limit title; exact summary is sent; private playlist reconciliation precedes public update; repeated calls reuse same provider video and persist canonical URL. | service/provider/route integration with fake provider | `npm run build && npm run verify:youtube-trailer-publication` | Wave 2-4 |
| TRAILER-07 | Publication success triggers keep-current-plus-12 cleanup; playlist/provider failure prevents cleanup; cleanup failure preserves public publication and records retryable error. | filesystem/repository fault-injection integration | `npm run build && npm run verify:youtube-trailer-publication` | Wave 2-4 |
| TRAILER-08 | Protected no-store routes, OpenAPI schemas, environment docs, redaction, typecheck/build and no live network, plus existing artifact-download and draft lifecycle regression. | Wave 0 fixtures plus route/OpenAPI contract and compiled final suite | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle && npm run verify:youtube-trailer-publication` | Wave 0-4 |

### Sampling Rate

- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run build && NODE_ENV=development DISABLE_BACKGROUND_WORKERS=true node dist/scripts/verify-youtube-trailer-publication.js`
- **Phase gate:** Full suite green before `$gsd-verify-work`; the fake provider must fail if live HTTP/OAuth is attempted. [VERIFIED: phase16 VERIFICATION.md]

### Wave 0 Coverage

- [x] 17-00 creates `src/scripts/verify-youtube-trailer-publication.ts` with isolated SQLite/media fixtures, a fake provider, and a network/OAuth tripwire.
- [x] 17-00 explicitly runs the existing artifact-download verifier and Phase 16 draft staging/promotion/rollback verifier before publication implementation.
- [x] Plans 01-03 extend the same fixture set for publication guards, category preservation, route/OpenAPI parity, legacy version ordering, and deletion failure.
- [x] The compiled verifier package command is registered in 17-00; no dependency installation is required.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `requireAuth`; publication route remains authenticated. [VERIFIED: codebase grep] |
| V3 Session Management | yes | Keep OAuth refresh/access tokens, granted scopes, provider IDs and any session details server-side; never include them in DTOs. [CITED: https://developers.google.com/youtube/v3/guides/authentication] |
| V4 Access Control | yes | Reuse protected episode route and server-owned channel/playlist configuration; do not accept provider IDs, playlist IDs or filesystem paths from an untrusted browser as authority. [VERIFIED: AGENTS.md] |
| V5 Input Validation | yes | Zod request schema plus shared title/hashtag normalization; reject invalid characters and Unicode-over-limit values before provider calls. [CITED: https://developers.google.com/youtube/v3/docs/videos] |
| V6 Cryptography | yes | Reuse SHA-256 source fingerprints for stale-source guards; do not invent cryptography for OAuth or URLs. [VERIFIED: codebase grep] |

### Known Threat Patterns for Node/Express + YouTube OAuth

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged publish request or cross-episode job ID | Tampering / Elevation | Authenticated route, positive episode ID/job UUID validation, repository lookup and source/revision predicate. [VERIFIED: codebase grep] |
| Provider credential/session/ID leakage | Information Disclosure | Explicit DTO allowlist, no-store headers before auth, safe normalized errors, no raw provider response/path logging. [VERIFIED: phase16 VERIFICATION.md] |
| Duplicate playlist/publication side effect after timeout | Tampering / Repudiation | Read-before-write reconciliation and durable side-effect milestones keyed to provider video ID. [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/list] [VERIFIED: codebase grep] |
| Premature local deletion | Denial of Service / Data Loss | Cleanup only after confirmed public+playlist success; keep current and twelve newest prior versions; record cleanup failure without rollback. [VERIFIED: CONTEXT.md] |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Private job route stops before public metadata/publication | Explicit separate publication operation with playlist and privacy milestones | Phase 17 | The private-ready video remains reviewable and publication is operator-triggered. [VERIFIED: phase16 VERIFICATION.md] |
| Single `youtube` URL/sync field as implicit state | Provider video ID plus durable publication state and canonical URL confirmation | Phase 17 planning | Repeated requests and local replacements become reconcilable. [VERIFIED: codebase grep] |
| One backup path for media replacement | Versioned local trailer history with configurable keep count | Phase 17 planning | Retention can be success-gated and independently retried. [VERIFIED: codebase grep] [VERIFIED: CONTEXT.md] |

**Deprecated/outdated:** Do not treat `YOUTUBE_TRAILER_JOB_ENABLED=true` or an upload-capable token as proof that publication is safe; Phase 16 explicitly left public publication out of its contract. [VERIFIED: phase16 VERIFICATION.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The current OAuth refresh token may require re-consent or replacement to add `youtube.force-ssl` while retaining `youtube.upload`. | Common Pitfalls / Environment | The blocking human checkpoint must fail closed and live publication remains disabled until replacement succeeds. |
| A2 | A read-before-write playlist reconciliation is sufficient for the project's retry/idempotency needs; provider-side concurrent duplicate inserts are not otherwise coordinated. | Architecture Patterns | Concurrent publish requests could race; the plan may need a local publication lease/unique state transition. |
| A3 | Existing local trailer backups, if any, are not a complete twelve-version history and require the resolved deterministic discovery rule. | Runtime State / Retention | Malformed or ambiguous entries remain preserved and non-deletable until classified. |

## Resolved Questions

1. **Which OAuth scopes are required? — RESOLVED**
   - Decision: Preserve the existing `youtube.upload` requirement for private transfer and add `youtube.force-ssl` as the required edit-capable scope for `videos.update` and `playlistItems.insert`. Readiness is true only when both exact scopes are granted; missing, unreadable, or mismatched scope data fails closed before any live provider write. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]
   - Operational evidence: A blocking human checkpoint must re-consent/replace the refresh token if necessary, verify the token's channel is `UCq-TjauoYJrr3po121gA6iw`, verify the configured playlist is owned by that channel, and record the verified scope/channel/playlist result before `YOUTUBE_TRAILER_JOB_ENABLED` or publication is enabled. Offline tests use a fake provider and must never claim this checkpoint passed.

2. **What category ID should metadata updates preserve? — RESOLVED**
   - Decision: Every complete `snippet` update must preserve the `snippet.categoryId` returned by the provider's authoritative `videos.list` read for the same video. A configured fallback category may be used only when the provider read has no category and the bounded configuration is present; otherwise the metadata update fails before the provider write. The route never accepts or invents a category. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/videos/list]
   - Evidence: YouTube requires `snippet.categoryId` when `part=snippet` is updated, and the research code example already models a complete snippet payload. [CITED: https://developers.google.com/youtube/v3/docs/videos/update]

3. **How are pre-Phase-17 local trailer versions migrated? — RESOLVED**
   - Decision: Before retention deletion, discover legacy history from only the server-derived canonical final and existing backup/version directories. Use `lstat` to admit regular files only; classify the canonical current file separately; recognize the existing backup/version naming forms; order recognized legacy files deterministically by embedded version/timestamp and then normalized basename; preserve and report malformed or ambiguous entries as non-deletable. The resulting catalog is the input to the current-plus-configured-newest-N keep-set, so no deletion runs against an unclassified legacy file.
   - Evidence: Phase 16 replacement preserves a prior local copy and marks replacement `manual-sync-required`, while the inspected code has no complete version catalog. The Wave 0 verifier will fixture recognized, malformed, symlink, directory, and ambiguous entries and assert discovery completes before cleanup. [VERIFIED: phase16 VERIFICATION.md] [VERIFIED: codebase grep]

## Sources

### Primary (HIGH confidence)

- [YouTube videos.update](https://developers.google.com/youtube/v3/docs/videos/update) - accepted scopes, `part` overwrite semantics, required snippet fields, privacy update behavior, and error categories. [CITED]
- [YouTube playlistItems.insert](https://developers.google.com/youtube/v3/docs/playlistItems/insert) - accepted scopes, required playlist/resource IDs, quota, and playlist/video errors. [CITED]
- [YouTube playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list) - playlist/video filters and membership response. [CITED]
- [YouTube video resource](https://developers.google.com/youtube/v3/docs/videos) - title/description limits and privacy/processing fields. [CITED]
- [YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list) - provider re-read of status/snippet by video ID. [CITED]
- [YouTube OAuth authentication](https://developers.google.com/youtube/v3/guides/authentication) - server-side OAuth and unsupported service-account flow. [CITED]

### Secondary (MEDIUM confidence)

- `.planning/phases/16-draft-staging-and-private-youtube-job/VERIFICATION.md` - verified private-job boundary and offline verifier pattern. [VERIFIED: codebase grep]
- `.planning/codebase/ARCHITECTURE.md`, `INTEGRATIONS.md`, `src/services/youtube-trailer-job.service.ts`, `src/services/youtube-trailer-upload.provider.ts`, `src/services/episode-trailer-video.service.ts`, `src/routes/episodes.routes.ts`, `src/config/env.ts`, `src/database/sqlite.ts`, `src/database/repositories/episode.repository.ts`, and `src/scripts/verify-youtube-trailer-job-lifecycle.ts` - local integration seams and current retention gap. [VERIFIED: codebase grep]

### Tertiary (LOW confidence)

- No tertiary source was used for provider behavior. The only LOW-confidence items are explicitly listed in the Assumptions Log. [VERIFIED: research protocol]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing package/runtime/config inspected; no new package recommendation. [VERIFIED: package.json] [VERIFIED: environment probe]
- Architecture: MEDIUM - local lifecycle is verified, while Phase 17 publication/retention design is a prescriptive extension of locked decisions. [VERIFIED: codebase grep] [VERIFIED: CONTEXT.md]
- Provider behavior: HIGH - official Google reference pages fetched and checked on 2026-08-11. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [CITED: https://developers.google.com/youtube/v3/docs/playlistItems/insert]
- Pitfalls: MEDIUM - provider pitfalls are official; concurrency/retention recommendations are project-specific and assumptions are flagged. [CITED: https://developers.google.com/youtube/v3/docs/videos/update] [VERIFIED: codebase grep]

**Research date:** 2026-08-11  
**Valid until:** 2026-09-10 for stable project architecture; recheck Google OAuth/API behavior before live enablement.
