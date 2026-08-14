# Phase 17: Trailer Metadata, Publication and Retention - Pattern Map

**Mapped:** 2026-08-11  
**Files analyzed:** 15 new/modified files  
**Analogs found:** 14 / 15 (retention has no exact existing analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/services/youtube-trailer-publication.service.ts` | service | request-response + event-driven external side effects | `src/services/youtube-trailer-job.service.ts` | role-match |
| `src/services/youtube-trailer-upload.provider.ts` | service/provider | request-response + external reconciliation | same file, existing upload boundary | exact extension |
| `src/services/episode-trailer-retention.service.ts` | service | file-I/O + batch | `src/services/episode-media-layout.service.ts` | role-match |
| `src/database/repositories/youtube-trailer-job.repository.ts` | repository/model | CRUD + guarded state machine | same file, existing CAS repository | exact extension |
| `src/database/repositories/episode.repository.ts` | repository/model | CRUD | same file, existing media update methods | exact extension |
| `src/database/sqlite.ts` | config/schema | CRUD/persistence | same file, existing `youtube_trailer_jobs` schema | exact extension |
| `src/schemas/episode.ts` | schema/model | transform/validation | same file, existing sync-state schema | exact extension |
| `src/services/episode-trailer-video.service.ts` | service | file-I/O + CRUD | same file, replacement/rollback service | exact extension |
| `src/services/episode-media-layout.service.ts` | utility | file-I/O | same file, server-derived media paths | exact extension |
| `src/routes/episodes.routes.ts` | route/controller | request-response | same file, protected YouTube job routes | exact extension |
| `src/docs/openapi.ts` | config/documentation | transform | same file, private-job OpenAPI contract | exact extension |
| `src/config/env.ts` | config | transform | same file, bounded YouTube/media config | exact extension |
| `.env.example` | config/documentation | transform | same file, documented defaults | exact extension |
| `src/scripts/verify-youtube-trailer-publication.ts` | test/verifier | event-driven + file-I/O + request-response | `src/scripts/verify-youtube-trailer-job-lifecycle.ts` | role/data-flow match |
| `package.json` | config/test entrypoint | batch | existing compiled verifier scripts | exact extension |

## Pattern Assignments

### `src/services/youtube-trailer-publication.service.ts` (service, request-response + external side effects)

**Analog:** `src/services/youtube-trailer-job.service.ts`

Use the existing service’s source fingerprint and provider-ID ownership rules. The service starts from the persisted ready job, not from a browser-supplied provider ID or path. Keep the provider ID, source evidence, revision, and raw provider errors internal.

**Safe DTO boundary** (`youtube-trailer-job.service.ts:21-80`):

```ts
export type YoutubeTrailerJobStatusDto = {
  jobId: string;
  episodeId: number;
  status: YoutubeTrailerJobRow["status"];
  progress: { confirmedBytes: number; totalBytes: number; processingPartsProcessed: number | null; processingPartsTotal: number | null; processingTimeLeftMs: number | null };
  cancellation: { requestedAt: string | null; cancelledAt: string | null; boundary: string | null };
  error: { category: string | null; occurredAt: string | null };
  retry: { count: number; nextAttemptAt: string | null };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

The publication DTO should apply the same explicit allowlist: publication state, safe error category/timestamps, canonical YouTube URL after confirmation, and cleanup outcome only. Do not expose `providerVideoId`, session URI, source fingerprint, filesystem path, OAuth scope/token, raw reason, or provider response.

**Stale-source/CAS pattern** (`youtube-trailer-job.service.ts:148-169, 277-305`):

```ts
const guardedProviderUpdate = async (job, lease, update, status) => {
  if (await obsoleteIfSourceChanged(job)) return null;
  return youtubeTrailerJobRepository.updateProvider(lease, update, status);
};

const latest = youtubeTrailerJobRepository.findByJobId(job.episodeId, job.jobId);
if (!latest || latest.status === "cancel_requested") return;
```

Apply the same exact job/source/revision guard to publication persistence so a replacement cannot publish or persist the URL for an obsolete source. Repeated requests must load and reconcile the same ready job/provider video.

**Publication operation order:**

1. Validate title/hashtags server-side and use the episode’s saved `summary` verbatim as description.
2. Re-read the provider video and require the recorded video to remain private-ready.
3. Read playlist membership by configured playlist and provider video ID; insert only when absent.
4. Re-read private video and playlist membership; only then update privacy with a narrow `status` update.
5. Re-read public state, persist canonical `https://www.youtube.com/watch?v={id}`, then invoke retention.

Persist each milestone with the job revision/source fingerprint. On an ambiguous timeout, read provider video and playlist membership before retrying. A playlist failure leaves the video private/retryable; a post-publication cleanup failure records recovery state and never rolls public visibility back.

### `src/services/youtube-trailer-upload.provider.ts` (provider boundary, request-response reconciliation)

**Analog:** existing provider, exact extension.

**Imports and internal-only contract** (`youtube-trailer-upload.provider.ts:1-5, 43-55`):

```ts
import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env";

export interface YoutubeTrailerUploadProvider {
  checkReadiness(): Promise<void>;
  beginPrivateSession(sourceBytes: number): Promise<YoutubeTrailerPrivateSession>;
  resumeRange(sessionUri: string, sourceBytes: number): Promise<YoutubeTrailerRangeResume>;
  uploadChunk(sessionUri: string, sourceBytes: number, offset: number, chunk: Buffer): Promise<YoutubeTrailerChunkResult>;
  pollProcessing(providerVideoId: string): Promise<YoutubeTrailerProcessingState>;
  cancel(sessionUri: string, providerVideoId: string | null): Promise<YoutubeTrailerCancellationResult>;
  normalizeFailure(error: unknown): YoutubeTrailerUploadProviderError;
}
```

Extend this injected interface with operations shaped around the publication service, such as `getVideo`, `updateMetadata`, `findPlaylistMembership`, `insertPlaylistItem`, and `publishVideo`. Keep private session/access-token/raw response types out of route DTOs.

**Existing OAuth/error pattern** (`youtube-trailer-upload.provider.ts:83-97, 172-211`):

```ts
const token = await this.getAccessToken();
const info = await this.client.getTokenInfo(token);
if (!info.scopes.includes(uploadScope)) {
  throw this.error("authorization", "YouTube trailer upload authorization is missing the required upload scope.");
}
```

Preserve `authorizedFetch`’s timeout, bearer header, normalized provider error categories, and redacted safe messages. Publication readiness must check an edit-capable YouTube scope in addition to the existing upload scope; live tests must not use this provider.

### `src/services/episode-trailer-retention.service.ts` (service, file-I/O + batch)

**Analog:** `src/services/episode-media-layout.service.ts` (`:47-57, 168-229`) and the replacement service (`episode-trailer-video.service.ts:43-92`). No exact retention-history analog exists.

Use only server-derived episode/version directories. Reuse `getEpisodeMediaFinalPath`, `getEpisodeMediaBackupDirectory`, and `lstat` regular-file checks. Retention must calculate a keep-set before deletion: current final trailer plus the configured newest 12 prior versions by deterministic timestamp/version ordering. Ignore staging, arbitrary paths, symlinks, directories, malformed entries, and unrelated artifacts.

**Server-derived path pattern** (`episode-media-layout.service.ts:47-57`):

```ts
export const getEpisodeMediaRelativePath = (episodeId: number, kind: EpisodeMediaKind): string =>
  path.posix.join("episodes", String(episodeId), kindFileName(episodeId, kind));

export const getEpisodeMediaDirectory = (episodeId: number): string =>
  path.resolve(config.media.storageRoot, "episodes", String(episodeId));

export const getEpisodeMediaBackupDirectory = (episodeId: number): string =>
  path.resolve(config.media.backupEpisodesDir, String(episodeId));
```

Cleanup is a post-publication operation, not part of the external transaction. On deletion failure, preserve all remaining files, return/record a retryable cleanup error, and leave the confirmed public URL/state intact.

### `src/database/repositories/youtube-trailer-job.repository.ts` (repository, CRUD + guarded state machine)

**Analog:** same file, exact extension.

Add publication metadata/state fields or a related publication table using the current row mapping and CAS style. Prefer a related table if the job row would become overloaded, but key it by job ID/source revision and preserve the provider video ID. Include playlist-confirmed, public-confirmed, canonical URL, retention state/error, metadata snapshot/digest as appropriate.

**Row mapping and guarded update** (`youtube-trailer-job.repository.ts:125-180`):

```ts
const mapRow = (row: SqliteYoutubeTrailerJobRow | undefined): YoutubeTrailerJobRow | null => {
  if (!row) return null;
  return { jobId: row.job_id, episodeId: row.episode_id, sourceFileName: row.source_file_name,
    sourceSha256: row.source_sha256, sourceBytes: row.source_bytes, sourceCapturedAt: row.source_captured_at,
    status: row.status, revision: row.revision, workerLeaseId: row.worker_lease_id,
    providerVideoId: row.provider_video_id, providerPrivacyStatus: row.provider_privacy_status,
    /* map all persisted fields explicitly */
  } as YoutubeTrailerJobRow;
};

const updateWithLease = (lease, setClause, values, expectedStatuses = leaseOwnedStatuses) => {
  const result = getDb().prepare(`UPDATE youtube_trailer_jobs SET ${setClause}, revision = revision + 1, updated_at = ?
    WHERE job_id = ? AND episode_id = ? AND source_file_name = ? AND source_sha256 = ? AND source_bytes = ?
      AND revision = ? AND worker_lease_id = ? AND status IN (${expectedStatuses})`)
    .run(...values, nowIso(), lease.jobId, lease.episodeId, lease.sourceFileName, lease.sourceSha256, lease.sourceBytes, lease.revision, lease.leaseId);
  if (result.changes !== 1) return null;
  return selectAfterCas(lease);
};
```

Publication requests need an equivalent conditional transition/lease so concurrent clicks cannot race playlist insertion or public persistence. Keep source replacement behavior aligned with `obsoletePriorSource` (`:308-320`): old active work is obsoleted, but an already published provider video is retained and the replacement is `manual-sync-required`.

### `src/database/repositories/episode.repository.ts` and `src/schemas/episode.ts` (model, CRUD/validation)

**Analogs:** same files, exact extension.

Preserve the existing `youtube` URL and `trailerVideoSyncStatus` fields. Add only publication-facing fields needed by the protected response/history contract; keep provider internals in the job/publication repository if possible.

**Existing model mapping** (`episode.repository.ts:386-407`, `src/schemas/episode.ts:3-27`):

```ts
trailerVideoFileName: row.trailer_video_file_name ?? undefined,
trailerVideoSyncStatus: row.trailer_video_sync_status,
youtube: row.youtube ?? undefined,
```

```ts
export const trailerVideoSyncStatusSchema = z.enum(["unpublished", "manual-sync-required", "synced"]);
```

Use strict Zod request schemas for operator metadata. Validate title Unicode length and forbidden `<`/`>` before provider calls; preserve the final saved episode summary exactly, and do not add automatic boilerplate or Phase 18 hashtag generation.

### `src/services/episode-trailer-video.service.ts` (service, file-I/O + CRUD)

**Analog:** same file, exact extension.

**Replacement/manual-sync behavior** (`episode-trailer-video.service.ts:47-69`):

```ts
if (await fileExists(finalPath)) {
  await fs.promises.copyFile(finalPath, previousPath);
  previousCopied = true;
}
await fs.promises.copyFile(stagedFilePath, preparedPath);
await fs.promises.rename(preparedPath, finalPath);

const updated = episodeRepository.updateMedia(episodeId, {
  trailerVideoFileName: getEpisodeMediaRelativePath(episodeId, "trailerVideo"),
  trailerVideoSyncStatus: episode.trailerVideoFileName || episode.youtube
    ? "manual-sync-required" : "unpublished",
});
```

Retain this rollback-safe promotion. When a published video already exists, preserve its URL/provider publication and mark the new local source `manual-sync-required`; invalidate old-source jobs only after the media metadata write succeeds.

### `src/routes/episodes.routes.ts` (route/controller, request-response)

**Analog:** existing protected private-job routes (`episodes.routes.ts:66-74, 763-812`).

**No-store before auth and safe delegation:**

```ts
const noStoreYoutubeTrailerJobs: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

episodesRouter.get("/:episodeId/youtube-trailer-jobs/:jobId", noStoreYoutubeTrailerJobs, requireAuth, (req, res, next) => {
  // validate positive episodeId and UUID, repository lookup, safe DTO
});
```

Add the explicit authenticated publication route beside the job routes. Validate positive episode ID, UUID/job ownership, strict metadata body, and no client provider ID/playlist/path. Return the sanitized publication/episode response and use `next(error)` for the existing error boundary. The route must expose retryable recovery states without raw provider or filesystem details.

### `src/docs/openapi.ts` (documentation/config, transform)

**Analog:** private job schemas/routes (`openapi.ts:92-109, 894-930`).

Extend, do not replace, the existing `YoutubeTrailerJobSnapshot` contract. Document the publish operation as protected, no-store, explicit, private-first, idempotent/reconciling, and separate from upload. Add request constraints for title/hashtags and response fields for publication state, canonical URL, and cleanup recovery. Omit provider/session/source/path fields exactly as the existing schema description requires.

Existing contract language to preserve (`openapi.ts:92-99`):

```ts
description: "Safe protected snapshot for an API-owned private YouTube trailer transfer. Provider credentials, resumable session locations, provider identifiers, raw provider responses/errors, source fingerprints, and filesystem paths are never returned."
```

### `src/config/env.ts` and `.env.example` (config, transform)

**Analogs:** bounded YouTube job config (`env.ts:152-173`) and media roots (`env.ts:271-286`).

Add documented non-secret configuration for playlist ID, authenticated channel ID/readiness, publication scope/category as needed, and retention keep count defaulting to 12. Reuse `boundedPositiveInteger` for retention limits and keep live publication opt-in/disabled by default. Do not log or expose OAuth secrets.

```ts
trailerJob: {
  enabled: (process.env.YOUTUBE_TRAILER_JOB_ENABLED ?? "false").toLowerCase() === "true",
  providerTimeoutMs: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_PROVIDER_TIMEOUT_MS, 30_000, ...),
  retryAttempts: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_RETRY_ATTEMPTS, 5, ...),
}
```

Document the target playlist/channel as non-secret defaults or deployment configuration, plus the twelve-version retention default and the requirement for an edit-capable OAuth grant. Keep `.env.example` aligned with the config shape.

### `src/database/sqlite.ts` (schema/config, CRUD)

**Analog:** existing `youtube_trailer_jobs` schema (`sqlite.ts:168-207`) and indexes (`:237-243`).

Extend the durable schema with publication/retention state, using `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` conventions. Preserve existing rows and URLs; do not reset or migrate by deleting data. Any publication history table should foreign-key the episode/job and index retry/recovery lookup fields.

```sql
CREATE TABLE IF NOT EXISTS youtube_trailer_jobs (
  job_id TEXT PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(episode_id) ON DELETE CASCADE,
  source_file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (...),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  provider_video_id TEXT,
  ...
);
```

### `src/scripts/verify-youtube-trailer-publication.ts` (verifier, event-driven + file-I/O + request-response)

**Analog:** `src/scripts/verify-youtube-trailer-job-lifecycle.ts` (`:18-107, 330-389, 399-430`) and `verify-trailer-video-upload-lifecycle.ts`.

Use a deterministic injected fake provider with event recording and a live-network tripwire. Initialize temporary SQLite/media fixtures before dynamic imports, invoke the actual router/service/repository/OpenAPI, and clean up in `finally`.

**Fake-provider pattern** (`verify-youtube-trailer-job-lifecycle.ts:18-29, 32-44`):

```ts
export class FakeYoutubeTrailerUploadProvider implements YoutubeTrailerUploadProvider {
  readonly events: string[] = [];
  async checkReadiness(): Promise<void> { this.events.push("readiness"); }
  async beginPrivateSession(sourceBytes: number): Promise<YoutubeTrailerPrivateSession> {
    assert.ok(sourceBytes > 0);
    this.events.push("begin-session");
    return { sessionUri: "fake-provider://private-session-1", privacyStatus: "private" };
  }
}
```

Assert metadata validation, exact summary, call order `playlist-read → playlist-insert-if-absent → private-read → public-update → public-read`, repeated publication with no duplicate video/playlist item, replacement/manual-sync behavior, canonical URL persistence, current-plus-12 retention, failure before cleanup, cleanup failure without rollback, DTO redaction, protected no-store routes, OpenAPI parity, and no live fetch/OAuth.

Follow the existing direct-router assertions (`:348-388`): unauthorized requests must be 401 with `cache-control: no-store`, invalid input must be rejected, and sensitive fields must be absent from response/schema.

### `package.json` (config, batch verification)

**Analog:** existing compiled verifier command (`package.json:9-21`).

Add a script that builds before running the new verifier under `NODE_ENV=development DISABLE_BACKGROUND_WORKERS=true`, matching the established offline command shape. The phase gate is:

```text
npm run typecheck
npm run build
npm run verify:youtube-trailer-publication
```

## Shared Patterns

### Authentication and cache control

**Source:** `src/routes/episodes.routes.ts:66-74, 763-812`  
**Apply to:** publication/status routes.

Set `Cache-Control: no-store` in a route middleware before `requireAuth`; validate route IDs with positive integer/UUID schemas; return generic safe JSON; delegate unexpected failures to `next(error)`.

### Source ownership and stale-write protection

**Source:** `src/services/youtube-trailer-job.service.ts:102-145, 148-155`; `src/database/repositories/youtube-trailer-job.repository.ts:172-180`  
**Apply to:** publication persistence, replacement handling, job/provider updates.

Fingerprint the canonical final MP4 with SHA-256/bytes, recheck it before provider side effects, and require exact job/source/revision/lease predicates for every worker or publication mutation.

### Provider error normalization and redaction

**Source:** `src/services/youtube-trailer-upload.provider.ts:167-211`; `src/services/youtube-trailer-job.service.ts:158-169`  
**Apply to:** provider and publication services/routes.

Keep machine categories internally, expose only safe categories/timestamps, classify retryable/session-expired errors for retry, and never expose raw provider messages, reasons, HTTP details, tokens, session URIs, or paths.

### Private-first compensation boundary

**Source:** locked D-02/D-11/D-12; `src/services/youtube-trailer-job.service.ts:189-200`; `src/services/episode-trailer-video.service.ts:72-92`  
**Apply to:** publication and retention.

Playlist insertion must complete while private. Before public confirmation, failures remain retryable and must not trigger cleanup. After public confirmation, retention errors are independently recoverable and must not undo publication.

### Offline verification

**Source:** `src/scripts/verify-youtube-trailer-job-lifecycle.ts:18-29, 330-389, 399-430` and Phase 16 `VERIFICATION.md`  
**Apply to:** all Phase 17 behavior.

Use temporary fixtures, fake provider injection, compiled scripts, direct-router/OpenAPI assertions, `npm run typecheck`, and `npm run build`. No automated test may call the live YouTube provider.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/services/episode-trailer-retention.service.ts` | service | file-I/O + batch | Existing code has one backup/rollback copy, not a twelve-version retention catalog; use media-layout helpers and explicit keep-set logic. |

## Metadata

**Analog search scope:** `src/services`, `src/database/repositories`, `src/database/sqlite.ts`, `src/routes`, `src/docs`, `src/config`, `src/scripts`, `.planning/phases/16-draft-staging-and-private-youtube-job`, `.planning/codebase`  
**Files scanned:** 15 primary analogs plus Phase 16 verification/context artifacts  
**Pattern extraction date:** 2026-08-11
