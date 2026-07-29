# Phase 13: return-zip-progress-to-user - Pattern Map

**Mapped:** 2026-07-28  
**Files analyzed:** 6 likely production/planning-verification changes  
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/services/episode-artifact-preparation.service.ts` (new) | service | file-I/O, event-driven | `src/services/episode-artifact-download.service.ts`, `src/services/episode-transcription.service.ts` | role/data-flow composite |
| `src/workers/episode-artifact-preparation.worker.ts` (new) | worker | event-driven, batch | `src/workers/launch-notification.worker.ts` | role-match |
| `src/routes/episodes.routes.ts` | route | request-response, streaming | existing artifact download handler in the same file | exact lifecycle boundary |
| `src/server.ts` | bootstrap/config | event-driven | existing worker startup block | exact |
| `src/docs/openapi.ts` | documentation/config | request-response contract | existing artifact download operation | exact |
| `src/scripts/verify-episode-artifact-downloads.ts` | test/verifier | file-I/O, request-response | existing artifact verifier | exact |

`src/config/env.ts` was inspected but is **not a likely change**: its `config.media.storageRoot` (lines 158-172) already provides a server-owned root for generated manifests, snapshots, and ready archives. Do not add a path supplied by the client or an unnecessary environment toggle.

## Pattern Assignments

### `src/services/episode-artifact-preparation.service.ts` (new service; file-I/O, event-driven)

**Primary analog:** `src/services/episode-artifact-download.service.ts`  
**Secondary analog:** `src/services/episode-transcription.service.ts`

Keep the Phase 12 artifact service as the selector/final-only boundary. The preparation service should import and compose it; it must not duplicate the catalog or call the permissive legacy resolver.

**Security/preflight contract to reuse** — `src/services/episode-artifact-download.service.ts:37-53,68-106`:

```ts
export const parseEpisodeArtifactSelectors = (artifacts: unknown): EpisodeArtifactCatalogEntry[] => {
  if (artifacts === undefined) return [...artifactCatalog];
  if (typeof artifacts !== "string" || artifacts.length === 0) {
    throw new EpisodeArtifactSelectorValidationError("artifacts must be one nonempty CSV query value");
  }
  // validate fixed selectors, dedupe within the CSV, then return catalog order
  const selectedSelectors = new Set(requestedSelectors);
  return artifactCatalog.filter((entry) => selectedSelectors.has(entry.selector));
};

const stat = await fs.promises.lstat(finalPath);
if (!stat.isFile()) {
  missing.push(artifact.selector);
  continue;
}
available.push({ ...artifact, archiveEntryName: `episode-${episodeId}/${artifact.fileName}`, path: finalPath });
```

Copy these semantics exactly for cache identity and source fingerprints: `requested` is the normalized catalog-order selector array, all file resolution starts with `getEpisodeMediaFinalPath`, and non-regular entries count as missing. Persist only selector names, generated basenames/job IDs, and fingerprints—never the returned `path`.

**Persistent state and serialized work pattern** — `src/services/episode-transcription.service.ts:631-648,851-893`:

```ts
export const queueEpisodeTranscription = async (episodeId: number): Promise<{ queued: boolean; alreadyQueued: boolean }> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) return { queued: false, alreadyQueued: false };
  if (episode.transcriptStatus === "pending" || episode.transcriptStatus === "processing") {
    return { queued: false, alreadyQueued: true };
  }
  episodeRepository.queueTranscription(episodeId);
  return { queued: true, alreadyQueued: false };
};

if (activeRun) return activeRun;
activeRun = (async () => { /* process one serialized run */ })().finally(() => {
  activeRun = null;
});
```

For ZIP preparation, make this idempotency durable rather than database-backed: manifest lookup by `{ episodeId, normalized requested selectors }` returns the existing `queued`/`preparing` job, a valid `ready` job is a cache hit, and only one in-process pump may archive at once. Persist each transition before exposing it: `queued`, `preparing`, `ready`, `failed`, `expired`.

**Canonical media-root pattern** — `src/services/episode-media-layout.service.ts:41-45,58-59`:

```ts
export const getEpisodeMediaDirectory = (episodeId: number): string =>
  path.resolve(config.media.storageRoot, "episodes", String(episodeId));

export const getEpisodeMediaFinalPath = (episodeId: number, kind: EpisodeMediaKind): string =>
  path.resolve(getEpisodeMediaDirectory(episodeId), kindFileName(episodeId, kind));
```

Create private preparation-root helpers from `config.media.storageRoot` (for example a fixed `artifact-preparations/` child). Do not use `findExistingEpisodeMediaPath` because it intentionally includes staging and legacy candidates (`episode-media-layout.service.ts:93-123`), which violates Phase 13's final-only contract.

**ZIP/output error pattern to adapt** — `src/routes/episodes.routes.ts:486-516`:

```ts
const archive = new ZipArchive();
archive.on("warning", () => logArchiveFailure("warning"));
archive.on("error", (error: Error) => {
  logArchiveFailure("error");
  if (!res.destroyed) res.destroy(error);
});
for (const artifact of preflight.available) {
  archive.file(artifact.path, { name: artifact.archiveEntryName });
}
void archive.finalize().catch(/* log and fail */);
```

Adapt it to a file output stream: install archive/output error listeners before `finalize`, archive only job-local snapshots, await output completion, rename `*.part` to the generated ready filename, then persist `ready` with `progress: 100`. On any error remove temporary output/snapshots, persist `failed`, and log selector names but not filesystem paths. Progress comes from Archiver source-byte events divided by snapshotted source bytes, clamped below 100 until rename/persist succeeds.

### `src/workers/episode-artifact-preparation.worker.ts` (new worker; event-driven, batch)

**Analog:** `src/workers/launch-notification.worker.ts`

**Startup + no-overlap pattern** — `src/workers/launch-notification.worker.ts:4-50`:

```ts
let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (): Promise<void> => {
  if (activeRun) return activeRun;
  activeRun = (async () => {
    const result = await processPendingLaunchNotifications();
    if (result.processed > 0) console.log(/* summary */);
  })().finally(() => { activeRun = null; });
  return activeRun;
};

export const startLaunchNotificationWorker = async (): Promise<() => void> => {
  await runOnce();
  pollTimer = setInterval(() => {
    void runOnce().catch((error: unknown) => console.error("Launch notification worker failed", error));
  }, config.telegram.pollIntervalMs);
  return () => { if (pollTimer) clearInterval(pollTimer); };
};
```

Expose `startEpisodeArtifactPreparationWorker(): Promise<() => void>`. Its first `runOnce` should rehydrate manifests, reset interrupted `preparing` jobs to `queued`, remove orphan parts/snapshots, expire stale ready jobs, then pump one queued job. Subsequent best-effort interval sweeps may run cleanup and pump; retain the `activeRun` guard so the 4 GB VPS never prepares two ZIPs concurrently.

### `src/routes/episodes.routes.ts` (modified route; request-response + ZIP streaming)

**Analog:** existing `GET /:episodeId/artifacts/download` handler at `src/routes/episodes.routes.ts:430-526`

**Imports/auth/error/ID-validation pattern** — `src/routes/episodes.routes.ts:21-25,430-450`:

```ts
import { requireAuth } from "../middleware/auth.middleware";
import {
  EpisodeArtifactSelectorValidationError,
  parseEpisodeArtifactSelectors,
  preflightEpisodeArtifactDownloads,
} from "../services/episode-artifact-download.service";

episodesRouter.get("/:episodeId/artifacts/download", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }
    // catch EpisodeArtifactSelectorValidationError -> 400 JSON; unexpected errors -> next(error)
  } catch (error) {
    next(error);
  }
});
```

Add the static preparation routes before generic `GET /:episodeId` (`line 528`) and preserve `requireAuth` on every lifecycle endpoint:

- `POST /:episodeId/artifacts/prepare` parses the existing `artifacts` query, confirms `episodeRepository.findByEpisodeId`, calls `prepareEpisodeArtifactArchive`, and returns JSON status (`202` queued/preparing; `200` ready cache hit).
- `GET /:episodeId/artifacts/preparations/:jobId` returns status JSON after service lookup/revalidation. Set `Cache-Control: no-store`, matching protected status routes at `lines 400-424`.
- `GET /:episodeId/artifacts/preparations/:jobId/download` obtains only a validated ready archive from the service; set the retained Phase 12 `Content-Type`, deterministic `Content-Disposition`, and `X-Missing-Artifacts` headers before streaming. Non-ready state returns JSON before bytes begin.

**Existence/preflight + safe logging pattern** — `src/routes/episodes.routes.ts:453-475`:

```ts
const episode = episodeRepository.findByEpisodeId(episodeId);
if (!episode) {
  res.status(404).json({ message: "Episode not found" });
  return;
}
const preflight = await preflightEpisodeArtifactDownloads(episodeId, selectedArtifacts);
logArtifactDownload({
  episodeId,
  requested: preflight.requested,
  available: preflight.available.map((artifact) => artifact.selector),
  missing: preflight.missing,
});
if (preflight.available.length === 0) {
  res.status(404).json({ message: "No requested artifacts found" });
  return;
}
```

Replace/retire the direct-only handler rather than changing its success body to JSON. Retain the exact 400/401/404 selector and availability behavior at the `POST` boundary; route-specific lifecycle errors should be JSON `404` unknown/mismatched job, `409` not ready, and `410` expired. Add a `logArtifactPreparation` helper shaped like the existing safe selector-only logger at `lines 45-52`, emitting `queued`, `started`, `completed`, `cache-hit`, `invalidated`, `expired`, and `failed` with episode ID and selector names only.

### `src/server.ts` (modified bootstrap; event-driven)

**Analog:** worker bootstrap at `src/server.ts:1-42`

```ts
if (backgroundWorkersDisabled) {
  console.info("Background workers disabled by DISABLE_BACKGROUND_WORKERS=true");
} else {
  await startEpisodeTranscriptionWorker();
  await startLaunchNotificationWorker();
  await startSpotifyMetricsWorker();
  await startYouTubeMetricsWorker();
  await startTelegramBotWorker();
}
```

Import and start the ZIP-preparation worker inside the same branch, after database/media-layout startup and before `app.listen`. This keeps restart recovery active in production while preserving `DISABLE_BACKGROUND_WORKERS=true` for compiled verifier execution. The preparation service must make status/prepare calls safe even when this flag is set; the verifier can explicitly invoke its processing seam or startup worker as needed.

### `src/docs/openapi.ts` (modified API contract)

**Analog:** artifact-download OpenAPI operation at `src/docs/openapi.ts:702-763`

```ts
"/v1/episodes/{episodeId}/artifacts/download": {
  get: {
    tags: ["Episodes"],
    summary: "Download final episode artifacts as a ZIP archive",
    security: [{ bearerAuth: [] }],
    parameters: [/* positive episodeId + one optional CSV artifacts query */],
    responses: { "200": { content: { "application/zip": { schema: { type: "string", format: "binary" } } } } },
  },
},
```

Replace this direct contract with three bearer-protected operations, retaining the existing selector parameter wording and ZIP header descriptions. Define/reuse a JSON status schema with opaque `jobId`, normalized requested/available/missing selectors, `state`, `progress`, `stateText`, nullable/conditional `queuePosition`, nullable/conditional `downloadUrl`, and `expiresAt`; it must not include paths, manifests, fingerprints, or internal failures. Document `200/202` preparation semantics and `409/410` download semantics.

### `src/scripts/verify-episode-artifact-downloads.ts` (modified verifier; request-response + file-I/O)

**Analog:** existing direct-router verifier in the same file

**In-memory response/direct route invocation pattern** — `src/scripts/verify-episode-artifact-downloads.ts:19-57,95-119`:

```ts
type RouteHandler = (req: FakeRequest, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;

class MemoryResponse extends Writable {
  statusCode = 200;
  jsonBody: unknown;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];
  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
}

const route = router.stack?.find((layer) => layer.route?.path === "/:episodeId/artifacts/download")?.route;
// invoke route middleware stack directly, resolving on response finish
```

Extend this instead of adding a test framework or localhost server. Update the fake request params/query support and route lookups for the POST/status/download handlers. Keep actual media fixtures via `getEpisodeMediaFinalPath` (`lines 73-80`) and cleanup in `finally` (`lines 184-205`).

**Current executable assertion style** — `src/scripts/verify-episode-artifact-downloads.ts:150-181`:

```ts
const unauthorized = await invokeDownload(String(fixtureEpisodeId));
assert.equal(unauthorized.statusCode, 401);
assert.deepEqual(unauthorized.jsonBody, { message: "Missing Bearer token" });

assert.equal(partial.getHeader("x-missing-artifacts"), "trailer,image,image-low");
assert.deepEqual(readZipEntryNames(Buffer.concat(partial.chunks)), [
  `episode-${fixtureEpisodeId}/audio.mp3`,
  `episode-${fixtureEpisodeId}/transcript.txt`,
]);
```

Add contract cases for unauthorized preparation/status/download, normalized-selector idempotency, queued position, preparing progress bounds/state text, one global active worker, ready-only download URL, ZIP entries/header after completion, 24-hour expiration (`410`), source-change invalidation (including a previously missing selected artifact appearing), restart recovery, and no internal-path leakage. Keep the compiled-script guard and npm command pattern in `package.json:14`:

```json
"verify:episode-artifact-downloads": "NODE_ENV=development node dist/scripts/verify-episode-artifact-downloads.js"
```

## Shared Patterns

### Authentication

**Source:** `src/middleware/auth.middleware.ts:1-25`  
**Apply to:** prepare, status, and ready-download routes.

All artifact lifecycle routes must take `requireAuth` as route middleware. This preserves the existing development-only `AUTH_BYPASS` behavior; do not make job IDs a substitute for authorization.

### Selector normalization and final-only access

**Source:** `src/services/episode-artifact-download.service.ts:4-106`  
**Apply to:** cache key construction, initial preflight, worker source refresh, ready-cache validation, and download revalidation.

Use `parseEpisodeArtifactSelectors` for one CSV query value and normalized catalog order. Use `preflightEpisodeArtifactDownloads`/`getEpisodeMediaFinalPath` for every source decision. Never store/use a request path, legacy lookup, draft, staging, backup, summary, state file, glob, or directory scan.

### Worker serialization, lifecycle, and logging

**Source:** `src/workers/launch-notification.worker.ts:4-50`; `src/services/episode-transcription.service.ts:851-893`  
**Apply to:** ZIP preparation worker.

Use a module-local active promise to coalesce pump calls, await a startup pass, schedule guarded background work, and log operational failures at the worker boundary. ZIP logs should use an object analogous to `logArtifactDownload` but must contain only event, episode ID, and normalized selectors—never resolved paths.

### Route errors and no-store status JSON

**Source:** `src/routes/episodes.routes.ts:400-426,430-526`  
**Apply to:** all lifecycle routes.

Validate positive numeric IDs first; map expected selector/existence/state errors to `{ message }` JSON and send unexpected failures through `next(error)`. Set `Cache-Control: no-store` before status JSON, so polling does not reuse a stale queue/progress/ready state.

### Offline executable verification

**Source:** `src/scripts/verify-episode-artifact-downloads.ts:1-205`  
**Apply to:** all Phase 13 behavior.

Use the compiled direct-router verifier, real temporary final-media fixtures, in-memory response capture, explicit ZIP entry inspection, and `finally` cleanup. This project has no separate test runner.

## No Analog Found

| File/Concern | Role | Data Flow | Planning Guidance |
|---|---|---|---|
| Durable artifact preparation manifest/cache schema | service persistence | file-I/O, event-driven | No existing persisted job-manifest module. Follow the research contract: on-disk manifest under the fixed media root, opaque job IDs, fingerprint every requested selector including `missing`, atomic `*.part` publication, and restart recovery. |

## Metadata

**Analog search scope:** `src/routes`, `src/services`, `src/workers`, `src/scripts`, `src/config`, `src/docs`, `src/server.ts`, `.planning/codebase`, and Phase 12 artifacts  
**Files scanned:** 24 primary files/artifacts  
**Pattern extraction date:** 2026-07-28
