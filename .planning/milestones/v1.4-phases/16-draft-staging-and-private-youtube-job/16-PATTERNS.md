# Phase 16: Draft Staging and Private YouTube Job - Pattern Map

**Mapped:** 2026-08-04  
**Files analyzed:** 15 likely created or modified files  
**Analogs found:** 15 / 15

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| \`src/routes/episodes.routes.ts\` | route | request-response | same file trailer-video/artifact routes | exact |
| \`src/services/episode-draft-reservation.service.ts\` | service | CRUD, file-I/O | same file + trailer-video service | exact |
| \`src/services/episode-trailer-video.service.ts\` | service | file-I/O, event-driven | same file | exact |
| \`src/database/repositories/episode.repository.ts\` | repository | CRUD, transaction | same file draft methods | exact |
| \`src/database/sqlite.ts\` | migration/config | CRUD | same file artifact/draft schema | exact |
| \`src/database/repositories/youtube-trailer-job.repository.ts\` | repository | CRUD, event-driven | \`artifact-job.repository.ts\` | exact role/data-flow |
| \`src/services/youtube-trailer-job.service.ts\` | service | streaming, event-driven | \`episode-artifact-preparation.service.ts\` | role-match |
| \`src/services/youtube-trailer-upload.provider.ts\` | service/provider | streaming, request-response | \`youtube-metrics.service.ts\` | role-match |
| \`src/workers/youtube-trailer-job.worker.ts\` | worker | event-driven, streaming | \`episode-artifact-preparation.worker.ts\` | exact |
| \`src/server.ts\` | bootstrap | event-driven | same file | exact |
| \`src/config/env.ts\` | config | transform | same file \`youtube\` block | exact |
| \`src/docs/openapi.ts\` | API contract | request-response | same file trailer/video contracts | exact |
| \`src/scripts/verify-trailer-video-upload-lifecycle.ts\` | test/verifier | file-I/O, request-response | same file | exact |
| \`src/scripts/verify-youtube-trailer-job-lifecycle.ts\` | test/verifier | streaming, event-driven | trailer-video lifecycle verifier | role-match |
| \`package.json\` | config | batch | same file verifier scripts | exact |

Likely companion config documentation: \`.env.example\` should extend its existing \`YOUTUBE_*\` block for job enablement/poll/retry values and reuse the current credential names. It is not a second credential family.

## Pattern Assignments

### \`src/routes/episodes.routes.ts\` (route, request-response)

**Analog:** same file

Keep handlers thin: validate identifiers/Zod input, call services, choose HTTP statuses, and call \`next(error)\`. Put no provider polling or streaming loop in routes.

**Imports and auth** ([lines 1-41](../../../../src/routes/episodes.routes.ts#L1-L41)):

\`\`\`typescript
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";

export const episodesRouter = Router();
\`\`\`

**Protected job-route shape** ([lines 569-616](../../../../src/routes/episodes.routes.ts#L569-L616)):

\`\`\`typescript
episodesRouter.post("/:episodeId/artifacts/jobs", noStoreArtifactPreparation, requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }
    // delegate to service
  } catch (error) {
    next(error);
  }
});
\`\`\`

Add start/status/cancel routes beside artifact jobs. Return only sanitized service DTOs: never canonical absolute paths, session URIs, access tokens, or provider response bodies.

**Owner check and upload cleanup** ([lines 432-513](../../../../src/routes/episodes.routes.ts#L432-L513)):

\`\`\`typescript
const checked = checkTrailerVideoDraft(draftId, episodeId, req.user?.email ?? "", { allowStaged: true });
if (!checked.ok) {
  res.status(checked.status).json({ message: checked.message });
  return;
}
await fs.promises.rm(getEpisodeMediaStagingPath(episodeId, "trailerVideo"), { force: true }).catch(() => undefined);
\`\`\`

### \`src/services/episode-draft-reservation.service.ts\` (service, CRUD/file-I/O)

**Analog:** same file plus \`episode-trailer-video.service.ts\`

Preserve UUID reservations, lowercase owner binding, 24-hour expiry, and both pre-upload and post-upload checks. Harden the create/promote/consume path as a recoverable unit: consume only after final media and episode metadata are durable.

**Reservation/expiry** ([lines 6-54](../../../../src/services/episode-draft-reservation.service.ts#L6-L54)):

\`\`\`typescript
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const normalizeOwner = (email: string): string => email.trim().toLowerCase();

for (const draft of episodeRepository.expireTrailerVideoDrafts(now)) {
  await cleanupEpisodeMediaStaging(draft.episodeId).catch(() => undefined);
}
\`\`\`

**Atomic final replacement and rollback** ([\`episode-trailer-video.service.ts\` lines 45-81](../../../../src/services/episode-trailer-video.service.ts#L45-L81)):

\`\`\`typescript
if (await fileExists(finalPath)) {
  await fs.promises.copyFile(finalPath, previousPath);
  previousCopied = true;
}
await fs.promises.copyFile(stagedFilePath, preparedPath);
await fs.promises.rename(preparedPath, finalPath);
promoted = true;
// catch: remove promoted file and rename prior copy back
\`\`\`

### \`src/services/episode-trailer-video.service.ts\` (service, file-I/O/event-driven)

**Analog:** same file

After a successful local replacement, delegate to the YouTube job service to obsolete jobs for the old source and request local stop. The job service owns provider reconciliation; retain accepted private videos.

**Canonical staging guard and metadata update** ([lines 20-64](../../../../src/services/episode-trailer-video.service.ts#L20-L64)):

\`\`\`typescript
const expectedStagingPath = getEpisodeMediaStagingPath(episodeId, "trailerVideo");
if (path.resolve(stagedFilePath) !== path.resolve(expectedStagingPath)) {
  throw new Error("Invalid trailer-video upload staging file");
}
const updated = episodeRepository.updateMedia(episodeId, {
  trailerVideoFileName: getEpisodeMediaRelativePath(episodeId, "trailerVideo"),
  trailerVideoSyncStatus: episode.trailerVideoFileName || episode.youtube ? "manual-sync-required" : "unpublished",
});
\`\`\`

### \`src/database/repositories/episode.repository.ts\` and \`src/database/sqlite.ts\` (repository/migration, CRUD)

**Analogs:** same files

Keep reservations in the episode repository. Add a narrow conditional consume/compensation operation; do not send raw SQL from routes. Add the YouTube table/indexes and idempotent migration in \`sqlite.ts\`.

**Draft query/update convention** ([\`episode.repository.ts\` lines 531-568](../../../../src/database/repositories/episode.repository.ts#L531-L568)):

\`\`\`typescript
getDb().prepare("UPDATE episode_trailer_video_drafts SET state = ? WHERE draft_id = ?")
  .run(state, draftId).changes > 0;
\`\`\`

**Schema/migration convention** ([\`sqlite.ts\` lines 136-176, 300-327](../../../../src/database/sqlite.ts#L136-L327)):

\`\`\`typescript
CREATE TABLE IF NOT EXISTS artifact_jobs (...);
CREATE INDEX IF NOT EXISTS idx_artifact_jobs_pending_fifo
  ON artifact_jobs(status, created_at, job_id);

db.exec(schema);
ensureArtifactJobColumns(db);
ensureEpisodeTrailerVideoDraftTable(db);
\`\`\`

The job table needs: job/episode IDs; canonical relative filename; SHA-256 and byte length; state, revision/lease and cancellation/obsolete timestamps; session URI and confirmed bytes; provider ID/status/processing details; retry/error evidence; timestamps.

### \`src/database/repositories/youtube-trailer-job.repository.ts\` (repository, CRUD/event-driven)

**Analog:** [\`artifact-job.repository.ts\` lines 3-103, 127-186](../../../../src/database/repositories/artifact-job.repository.ts#L3-L186)

Copy typed public-row/SQLite-row mapping, JSON helpers, opaque ID lookups, and conditional transitions. Strengthen all worker writes with job ID + source fingerprint + lease/revision + expected state.

\`\`\`typescript
type SqliteArtifactJobRow = { job_id: string; episode_id: number; status: ArtifactJobStatus; /* ... */ };

const mapRow = (row: SqliteArtifactJobRow | undefined): ArtifactJobRow | null => {
  if (!row) return null;
  return { jobId: row.job_id, episodeId: row.episode_id, status: row.status };
};

getDb().prepare("UPDATE artifact_jobs SET status = 'processing' WHERE job_id = ? AND status = 'pending'")
  .run(jobId);
\`\`\`

### \`src/services/youtube-trailer-job.service.ts\` (service, streaming/event-driven)

**Analog:** [\`episode-artifact-preparation.service.ts\` lines 88-108, 246-284, 319-363](../../../../src/services/episode-artifact-preparation.service.ts#L88-L363)

Use the service for source-fingerprint idempotency, public DTO mapping, claim/recovery, provider calls, error normalization, and stale-source rejection. Rehash/re-stat the canonical final file before each provider-result update. A source mismatch becomes \`obsolete\`; late worker results must fail their compare-and-set.

\`\`\`typescript
const existingCreation = activeCreationByCacheKey.get(selectorKey);
if (existingCreation) return existingCreation;

const active = artifactJobRepository.findActive(episodeId, selectorKey);
if (active) return toStatus(active);

if (activeProcess) return activeProcess;
activeProcess = (async () => {
  const pending = artifactJobRepository.listPending()[0];
  const processing = artifactJobRepository.transitionToProcessing(pending.jobId);
  // durable claim before side effect
})().finally(() => { activeProcess = null; });
\`\`\`

### \`src/services/youtube-trailer-upload.provider.ts\` (provider, streaming/request-response)

**Analog:** [\`youtube-metrics.service.ts\` lines 90-167, 337-349](../../../../src/services/youtube-metrics.service.ts#L90-L349)

Provide a narrow injectable interface for fake/offline and live implementations. Reuse the existing OAuth refresh/cache and timeout/error approach. The live provider owns documented resumable initiation/status/chunk/poll HTTP; the service owns persisted business state.

\`\`\`typescript
const youtubeClient = new OAuth2Client(config.youtube.clientId || "", config.youtube.clientSecret || "");
youtubeClient.setCredentials({ refresh_token: config.youtube.refreshToken });

const response = await fetch(url, {
  headers: { Authorization: \`Bearer \${token}\`, Accept: "application/json" },
  signal: AbortSignal.timeout(config.youtube.timeoutMs),
});
if (!response.ok) throw new Error("YouTube Data API request failed");
\`\`\`

Persist \`Location\` before byte transfer; persist confirmed offset or provider video ID before the next call. Do not expose session URI/token in any DTO/log.

### \`src/workers/youtube-trailer-job.worker.ts\` and \`src/server.ts\` (worker/bootstrap, event-driven)

**Analogs:** [\`episode-artifact-preparation.worker.ts\` lines 7-51](../../../../src/workers/episode-artifact-preparation.worker.ts#L7-L51), [\`server.ts\` lines 22-60](../../../../src/server.ts#L22-L60)

Use a single non-overlapping run, one recovery pass at startup, then unref'd polling. Start after DB/media initialization; preserve \`DISABLE_BACKGROUND_WORKERS\` so an upload provider is external/credential-dependent.

\`\`\`typescript
if (activeRun) return activeRun;
activeRun = (async () => {
  try {
    await initializeEpisodeArtifactPreparations({ recoverInterrupted: !recoveredAtStartup });
    recoveredAtStartup = true;
    await processNextEpisodeArtifactPreparation();
  } catch (_error) {
    console.error("Episode artifact preparation worker failed");
  }
})().finally(() => { activeRun = null; });
\`\`\`

### \`src/config/env.ts\`, \`src/docs/openapi.ts\`, and \`package.json\` (config/API contract/batch)

**Analogs:** [\`env.ts\` lines 67-78](../../../../src/config/env.ts#L67-L78), [\`openapi.ts\` lines 882-903](../../../../src/docs/openapi.ts#L882-L903), [\`package.json\` lines 13-20](../../../../package.json#L13-L20)

Nest job enablement, polling, timeout/chunk/retry settings with the existing YouTube credentials. Document protected start/status/cancel OpenAPI operations with safe status fields only. Add a build-output verifier script using isolated \`/tmp\` SQLite/media roots; add no test framework/package.

### \`src/scripts/verify-trailer-video-upload-lifecycle.ts\` and \`src/scripts/verify-youtube-trailer-job-lifecycle.ts\` (test/verifier)

**Analog:** [\`verify-trailer-video-upload-lifecycle.ts\` lines 94-198](../../../../src/scripts/verify-trailer-video-upload-lifecycle.ts#L94-L198)

Expand existing verifier fault injection through draft/create/promote/consume compensation. New verifier uses fake provider injection and proves session persistence/resume, 308 offset, private provider ID/poll, cancel boundary, duplicate start, restart recovery, replacement obsoletion, rejected late lease, and DTO redaction.

\`\`\`typescript
if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");
await connectDb();
try {
  // force failure and assert DB/files/public response
} finally {
  episodeRepository.delete(fixtureEpisodeId);
}
\`\`\`

## Shared Patterns

### Authentication and validation

**Sources:** [\`auth.middleware.ts\` lines 5-24](../../../../src/middleware/auth.middleware.ts#L5-L24), [\`app.ts\` lines 83-96](../../../../src/app.ts#L83-L96)

All lifecycle routes use \`requireAuth\`; \`AUTH_BYPASS\` gets the same stable owner identity and must pass the same reservation checks. Routes either \`safeParse\` for custom 400s or send errors to the app's Zod/generic middleware.

### Durable ownership and filesystem safety

**Sources:** [\`artifact-job.repository.ts\` lines 144-186](../../../../src/database/repositories/artifact-job.repository.ts#L144-L186), [\`episode-artifact-preparation.service.ts\` lines 110-124](../../../../src/services/episode-artifact-preparation.service.ts#L110-L124)

Persist before external side effects; recover interrupted work at worker startup. Persisted paths are metadata, not authority: derive every file location from episode/job IDs. YouTube updates add source evidence and lease/revision predicates.

### Offline compiled verification

**Sources:** [\`package.json\` lines 13-20](../../../../package.json#L13-L20), [\`verify-trailer-video-upload-lifecycle.ts\` lines 165-173](../../../../src/scripts/verify-trailer-video-upload-lifecycle.ts#L165-L173)

Compile first, run \`dist\` verifiers with temporary roots, fake provider, and cleanup. No live Google calls or new framework.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| None | — | — | Existing artifact-job, trailer-video, OAuth, worker, and verifier patterns cover every role. Resumable protocol details are new but fit the existing provider pattern. |

## Metadata

**Analog search scope:** \`src/routes\`, \`src/services\`, \`src/database\`, \`src/workers\`, \`src/scripts\`, \`src/config\`, \`src/docs\`, planning/codebase docs, \`package.json\`, \`.env.example\`  
**Files scanned:** 24 source/config/planning files  
**Pattern extraction date:** 2026-08-04  
**Worktree state during mapping:** clean; no application files changed.

