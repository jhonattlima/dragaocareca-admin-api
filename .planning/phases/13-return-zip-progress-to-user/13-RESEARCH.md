# Phase 13: return-zip-progress-to-user - Research

**Researched:** 2026-07-28  
**Domain:** Authenticated, filesystem-backed ZIP-preparation jobs for Express / Node.js 24  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Preparation and Download Lifecycle
- **D-01:** ZIP construction is asynchronous: a preparation request creates or returns a job, a protected status endpoint reports progress, and a separate protected download endpoint delivers the completed ZIP.
- **D-02:** A normal `application/zip` response must not attempt to carry preparation-progress events. Progress is returned by the status contract before download begins.
- **D-03:** Only one ZIP preparation may run globally on the VPS. Later requests are accepted as `queued` and report their position.
- **D-04:** Preparation state must distinguish `queued`, `preparing`, `ready`, `failed`, and `expired`.
- **D-05:** A valid cache hit for the same episode and normalized artifact selection returns `ready` immediately and never enters the queue.

### Progress and Cache Validity
- **D-06:** While `preparing`, `progress` is an integer from 0 to 100 based on source artifact bytes processed into the ZIP; state text remains separate from the percentage.
- **D-07:** Status responses for queued work include `queuePosition`; ready work exposes the download URL only after the archive exists.
- **D-08:** A prepared ZIP remains available for 24 hours to support repeat downloads.
- **D-09:** A cached ZIP is discarded before reuse if any selected source artifact changes. Cache identity and validation must preserve the Phase 12 normalized selector semantics.

### Security and Compatibility
- **D-10:** All preparation, status, and download routes reuse `requireAuth` and its development-only `AUTH_BYPASS` behavior.
- **D-11:** Jobs retain the Phase 12 fixed final-artifact allowlist and partial-availability behavior. They must not accept paths or include draft, staging, backup, state, summary, or legacy files.
- **D-12:** The implementation must log preparation queued, started, completed, cache-hit, invalidated, expired, and failed events with episode ID and selector names, never filesystem paths.

### the agent's Discretion
- Choose the narrowest route names, HTTP methods, persisted job metadata, cleanup mechanism, polling guidance, and error payload shapes that preserve the decisions above.
- Decide whether a second identical request while work is already queued or preparing returns the existing job or an equivalent idempotent response; it must not create duplicate work.
- Preserve compatibility for existing direct download callers where possible, or document a deliberate replacement with a migration-safe contract.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

## Project Constraints (from AGENTS.md)

- Keep feed generation server-side.
- Do not move scheduling/feed rules to frontend.
- Respect auth toggles: backend `.env.dev`: `AUTH_BYPASS`; frontend env: `authBypass`.
- Prefer minimal-scope changes and verify with `npm run typecheck` / `npm run build`.
- Telegram launch notifications live in the backend service: queue + dedupe in `src/services/launch-notification.service.ts`; delivery in `src/services/telegram.service.ts`; startup worker in `src/workers/launch-notification.worker.ts`.
- Use the WSL workspace layout: `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-api` and `/home/jhonatt/repos/jhonatt_projects/dragaocareca-admin-web`.

`docs/SDD.md` is absent; it was checked before this research. [VERIFIED: codebase grep]

## Summary

Replace the direct stream-only route with a protected preparation lifecycle: `POST /v1/episodes/:episodeId/artifacts/prepare`, `GET /v1/episodes/:episodeId/artifacts/preparations/:jobId`, and `GET /v1/episodes/:episodeId/artifacts/preparations/:jobId/download`. Keep the existing `artifacts` query parser on the `POST`; it already enforces one valid CSV, preserves catalog order, and deduplicates only inside that CSV. [VERIFIED: codebase grep] Treat the old `GET /artifacts/download` route as deliberately replaced rather than silently changing it into a JSON response; document the migration in OpenAPI and return `410 Gone` with the prepare URL from that legacy route for one release if compatibility is desired. [ASSUMED]

Use a small artifact-preparation service with an on-disk job manifest and an archive/snapshot directory under the server-owned media root. A process-local FIFO executes exactly one job at a time, but startup rehydrates persisted `queued` work and resets interrupted `preparing` work to `queued` after removing its incomplete temporary output. [VERIFIED: codebase grep] The worker snapshots every selected regular final source before Archiver reads it, uses `progress.fs.processedBytes` against the snapshotted source-byte total, writes `*.part`, and renames only a fully finished ZIP into the ready cache. Archiver documents both its `progress.fs.processedBytes` field and the need to install destination listeners before `finalize()`. [CITED: https://www.archiverjs.com/docs/archiver/] [CITED: https://www.archiverjs.com/docs/quickstart/]

The ready-cache key is `{episodeId, normalizedSelectors}`. Its manifest must also retain a fingerprint for every requested selector—available fingerprints and an explicit `missing` marker—so an artifact appearing, disappearing, or changing invalidates a partial archive before either a status response says `ready` or a download stream begins. [VERIFIED: CONTEXT.md] Node explicitly warns that check-then-open patterns introduce a race; source capture must open/copy the fixed canonical file and handle errors, not use `fs.access()` as a gate. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html]

**Primary recommendation:** Add a persisted, idempotent, single-concurrency archive-preparation service that snapshots selected final files, atomically publishes a validated 24-hour ZIP cache, and reuses only a cache whose complete requested-selector fingerprint still matches.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authentication, validation, status and download contracts | API / Backend | — | Existing protected episode routes use `requireAuth`; its bypass is development-only. [VERIFIED: codebase grep] |
| Global FIFO scheduling and restart recovery | API / Backend | Database / Storage | This is one Express process with process-local worker state and local persistent storage. [VERIFIED: codebase grep] |
| Canonical source selection and source snapshots | Database / Storage | API / Backend | Final artifact paths are server-derived by `getEpisodeMediaFinalPath`; request input only chooses fixed selectors. [VERIFIED: codebase grep] |
| ZIP creation and ready-cache persistence | Database / Storage | API / Backend | The archive, manifest, snapshots, and cleanup lifecycle are local filesystem responsibilities driven by the backend. [VERIFIED: codebase grep] |
| Progress polling and download response | API / Backend | Database / Storage | Express returns JSON until ready, then streams an already-published ZIP. [CITED: https://expressjs.com/en/5x/guide/error-handling/] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `node:fs`, `node:stream`, `node:crypto` | Node `v24.17.0` locally installed. [VERIFIED: local command] | Snapshot, manifest, temporary output, atomic publication, cleanup, and opaque job IDs. | Node documents Promise filesystem APIs, stream completion/error handling, and cryptographically generated UUIDs. [CITED: https://nodejs.org/api/fs.html] [CITED: https://nodejs.org/api/stream.html] [CITED: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html] |
| `archiver` | `8.0.0` locally installed; local package metadata identifies `archiverjs/node-archiver`. [VERIFIED: codebase grep] | Append explicit snapshot files to a ZIP and report filesystem-byte progress. | `file()` appends individual paths, `progress` reports processed filesystem bytes, and `finalize()` drains the work. [CITED: https://www.archiverjs.com/docs/archiver/] |
| Express | `5.2.1` installed. [VERIFIED: codebase grep] | Protected POST/GET routes and JSON errors before download streaming. | Existing app route/error conventions already use it; rejected async route promises reach error handling in Express 5. [VERIFIED: codebase grep] [CITED: https://expressjs.com/en/5x/guide/error-handling/] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|-------------|-------------|
| Existing `episode-artifact-download.service.ts` | Repository source. [VERIFIED: codebase grep] | Fixed selector catalog, canonical filename mapping, final-only regular-file preflight. | Reuse at POST validation and source-fingerprint boundaries; do not replace its allowlist with client paths. [VERIFIED: codebase grep] |
| Existing compiled verifier pattern | Repository source. [VERIFIED: codebase grep] | Offline route/service/OpenAPI validation through `dist/scripts`. | Extend `verify-episode-artifact-downloads.ts`; no new test framework is needed. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Persisted manifests plus process-local FIFO | Process-memory jobs only | Process-memory state cannot describe, retry, clean, or invalidate an interrupted job after process restart. [VERIFIED: codebase grep] |
| Job-local source snapshots | Calling `archive.file(finalPath)` on live final paths | Archiver opens file paths lazily, while Node warns against check-then-open races; a live path can change after preflight. [CITED: https://www.archiverjs.com/docs/archiver/] [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html] |
| Same-directory `*.part` then `rename` | Serving the output path while Archiver writes | `rename()` publishes only after the worker has finished its output path; a partial archive must never become ready. [CITED: https://nodejs.org/api/fs.html] |
| Polling status JSON | SSE/chunked progress on ZIP download | The locked contract explicitly keeps preparation progress separate from a normal ZIP response. [VERIFIED: CONTEXT.md] |

**Installation:** No new external package is needed; `archiver@8.0.0` and `@types/archiver@8.0.0` are already present in the project manifest. [VERIFIED: codebase grep]

## Package Legitimacy Audit

No Phase 13 package installation is recommended. `archiver` is an existing Phase 12 dependency, so this phase must not add or reinstall it. [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `archiver` | npm registry lookup was unavailable from this environment (`EAI_AGAIN`). [VERIFIED: local command] | Not re-verified. [VERIFIED: local command] | Not re-verified. [VERIFIED: local command] | `archiverjs/node-archiver` in installed metadata. [VERIFIED: codebase grep] | Existing dependency; legitimacy seam returned `SUS` because registry signals were unavailable. [VERIFIED: package-legitimacy check] | Do not install in this phase. |

**Packages removed due to [SLOP] verdict:** none. [VERIFIED: package-legitimacy check]  
**Packages flagged as suspicious [SUS]:** `archiver` is inherited only; no installation task belongs in this phase. [VERIFIED: package-legitimacy check]

## Architecture Patterns

### System Architecture Diagram

```text
Authenticated POST /episodes/:episodeId/artifacts/prepare?artifacts=CSV
        |
        v
requireAuth -> strict Phase 12 selector parser -> episode existence + final-only preflight
        |                                           |
        |                                           +-- zero available --> 404 JSON
        v
cache-key: episodeId + normalized selector catalog order
        |
        +-- matching ready manifest + all requested fingerprints match --> 200 ready job
        |
        +-- matching queued/preparing manifest -------------------------> 202 same job
        |
        +-- stale/expired/failed cache --> delete archive + manifest event -> persisted FIFO
                                                                          |
                                                         one active worker globally
                                                                          |
                    lstat regular canonical sources -> job-local snapshots -> Archiver *.part
                                                                          |
             source changed during snapshot? --- yes --> discard and re-preflight/requeue
                                                                          |
                                no --> close output -> rename *.part to ready ZIP -> ready manifest
                                                                          |
GET status (requireAuth) <------------------------------------------------+
  queued: queuePosition; preparing: byte progress; ready: downloadUrl; failed/expired: state
                                                                          |
GET download (requireAuth) -> revalidate manifest fingerprints -> ZIP or invalidate/410 JSON
```

### Recommended Project Structure

```text
src/
├── services/episode-artifact-download.service.ts    # keep catalog/parser/preflight final-only boundary
├── services/episode-artifact-preparation.service.ts # persisted jobs, snapshot, FIFO, cache, cleanup
├── workers/episode-artifact-preparation.worker.ts   # startup rehydrate + housekeeping interval
├── routes/episodes.routes.ts                         # protected prepare/status/download routes; retire direct stream route
├── docs/openapi.ts                                  # three-route lifecycle and legacy migration response
└── scripts/verify-episode-artifact-downloads.ts      # compiled offline job/route/cache verifier
```

### Pattern 1: Idempotent cache identity and persisted state

**What:** Build a cache key from `episodeId` and `parseEpisodeArtifactSelectors(...).map(selector).join(",")`; never use raw CSV text. Persist only server-generated job IDs and fixed selector names in a manifest. [VERIFIED: codebase grep]

**When to use:** On every preparation request and after startup recovery. A matching `queued` or `preparing` job returns the same job; a matching valid `ready` job returns immediately. [VERIFIED: CONTEXT.md]

**Recommended manifest fields:**

```typescript
type ArtifactPreparationJob = {
  id: string; // crypto.randomUUID(), opaque external identifier
  episodeId: number;
  requested: EpisodeArtifactSelector[]; // catalog order
  available: EpisodeArtifactSelector[];
  missing: EpisodeArtifactSelector[];
  sourceFingerprint: Record<EpisodeArtifactSelector, { state: "missing" } | {
    state: "file"; size: number; mtimeMs: number; ctimeMs: number; ino?: number;
  }>;
  state: "queued" | "preparing" | "ready" | "failed" | "expired";
  progress: number;
  stateText: string;
  createdAt: string;
  expiresAt: string | null;
  archiveFile: string | null; // generated basename only, never a request value
  errorCode: "preparation_failed" | null;
};
```

Use `randomUUID()` for opaque IDs; Node documents it as cryptographically generated UUID v4. [CITED: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html] Include the missing marker in the fingerprint so a formerly missing selected final artifact appearing invalidates the cached partial ZIP. [VERIFIED: CONTEXT.md]

### Pattern 2: Snapshot before archive, publish after completion

**What:** At worker start, obtain a fresh fixed-catalog preflight, `lstat` each canonical source to require a regular non-symlink file, capture its fingerprint, copy it into a job-owned snapshot directory, and compare fresh canonical fingerprints after copying. If any selected source changed, remove the snapshot and restart preflight once through the FIFO rather than publishing a mixed archive. [VERIFIED: codebase grep] [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html]

**When to use:** Before calling `archive.file()`. Pass only snapshot paths and the existing canonical archive entry names to Archiver. [VERIFIED: codebase grep]

**Example:**

```typescript
// Source: Node fs + Archiver official docs
const outputPath = path.join(jobDirectory, `${job.id}.zip.part`);
const readyPath = path.join(cacheDirectory, `${job.id}.zip`);
const output = fs.createWriteStream(outputPath, { flags: "wx" });
const archive = new ZipArchive();

archive.on("progress", ({ fs: progress }) => {
  job.progress = Math.min(99, Math.floor((progress.processedBytes / snapshotBytes) * 100));
  persistJob(job);
});
archive.pipe(output);
for (const file of snapshots) archive.file(file.path, { name: file.archiveEntryName });
await archive.finalize();
await finished(output);
await fs.promises.rename(outputPath, readyPath);
job.progress = 100;
```

Archiver's `progress.fs.processedBytes` is source-byte work; `pointer()` is emitted compressed archive bytes and must not define the user-visible preparation percentage. [CITED: https://www.archiverjs.com/docs/archiver/] The implementation must attach `error`, `warning`, and output completion listeners before `finalize()`, delete `*.part`/snapshots on any failure, and keep paths out of operator logs and API errors. [CITED: https://www.archiverjs.com/docs/quickstart/] [VERIFIED: CONTEXT.md]

### Pattern 3: Cache validation, expiration, and restart recovery

**What:** Validate the ready archive exists as a regular file and compare a fresh fingerprint for every requested selector before returning `ready` or opening a download stream. On mismatch, atomically change the manifest to `expired`, delete the ZIP/snapshots best-effort, log `invalidated`, and create/reuse a new job only from the prepare endpoint. [VERIFIED: CONTEXT.md]

**When to use:** On prepare cache lookup, status, download, startup recovery, and housekeeping. An expired download returns `410 { "message": "Artifact preparation expired" }`; a non-ready download returns `409 { "message": "Artifact archive is not ready" }`. [ASSUMED]

At startup, load manifests from the generated cache root: retain only unexpired ready manifests with matching ZIP files; reset persisted `queued` and interrupted `preparing` work to `queued` with `progress: 0`; remove stale `*.part` and snapshot directories; then pump one job. This preserves visibility and retryability through a process restart without trying to resume an interrupted Archiver stream. [ASSUMED] Run a best-effort sweep at startup and after each terminal job; add an hourly unref'd timer only if the server bootstrap owns the service lifecycle. [ASSUMED]

### API Contract Recommendation

| Route | Success | Errors / guarantees |
|-------|---------|---------------------|
| `POST /v1/episodes/:episodeId/artifacts/prepare?artifacts=...` | `202` for a new/reused queued or preparing job; `200` for valid ready cache. Body is the status representation. [ASSUMED] | Preserve Phase 12 `400`, `401`, `404 Episode not found`, and `404 No requested artifacts found` behavior before enqueueing. [VERIFIED: codebase grep] |
| `GET /v1/episodes/:episodeId/artifacts/preparations/:jobId` | `200` JSON status; `queuePosition` exists only when queued; `downloadUrl` exists only when ready. [VERIFIED: CONTEXT.md] | `401` before lookup; `404` for unknown/mismatched episode-job; cache revalidation may transition ready to expired. [ASSUMED] |
| `GET /v1/episodes/:episodeId/artifacts/preparations/:jobId/download` | `200 application/zip`, `Content-Disposition: attachment; filename="episode-<id>-artifacts.zip"`, and the Phase 12 `X-Missing-Artifacts` header. [VERIFIED: codebase grep] | Revalidate before opening. Return JSON `409` while non-ready, `410` expired, or `404` unknown; once bytes start, destroy the response on file-stream failure. [ASSUMED] [CITED: https://expressjs.com/en/5x/guide/error-handling/] |

Recommended status body:

```json
{
  "jobId": "opaque-uuid",
  "episodeId": 123,
  "artifacts": ["episode", "transcript"],
  "availableArtifacts": ["episode", "transcript"],
  "missingArtifacts": ["trailer"],
  "state": "preparing",
  "progress": 42,
  "stateText": "Creating ZIP archive",
  "queuePosition": null,
  "downloadUrl": null,
  "expiresAt": null
}
```

Return `Cache-Control: no-store` on job/status JSON and ZIP download responses because the archive lifetime is managed by server-side manifests, not browser/proxy reuse. [ASSUMED]

### Anti-Patterns to Avoid

- **Changing the existing direct route into a long-running JSON/ZIP hybrid:** It breaks direct callers and cannot satisfy pre-download progress. Replace it with the explicit lifecycle and document the migration. [VERIFIED: CONTEXT.md]
- **Using raw query text as cache identity:** Equivalent valid selector CSVs must share cache identity through Phase 12 catalog-order normalization. [VERIFIED: codebase grep]
- **Using `findExistingEpisodeMediaPath`, `archive.directory`, or `archive.glob`:** They can reach draft, staging, backup, legacy, or recursive content outside the fixed final-only boundary. [VERIFIED: codebase grep] [CITED: https://www.archiverjs.com/docs/archiver/]
- **Publishing a ZIP before output close/finalization:** It risks serving a corrupt archive; listener order around `finalize()` matters. [CITED: https://www.archiverjs.com/docs/quickstart/]
- **Relying only on `lstat` preflight:** It does not freeze what lazy `archive.file()` will later open. Snapshot and revalidate instead. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html] [CITED: https://www.archiverjs.com/docs/archiver/]
- **Keeping only in-memory job state:** Restart loses queue position, failure visibility, cleanup records, and cache identity. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP encoding and central-directory writing | Custom ZIP writer | Existing `archiver` `ZipArchive` | Archiver already supports explicit file entries, progress events, output finalization, and stream errors. [CITED: https://www.archiverjs.com/docs/archiver/] |
| Random external job IDs | Counter/timestamp identifiers | `crypto.randomUUID()` | Opaque, cryptographically generated UUIDs prevent predictable status/download identifiers. [CITED: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html] |
| Stream completion/error coordination | Ad-hoc event races | Node `stream/promises` `finished()` or `pipeline()` | The promise APIs model full stream completion and rejection on errors. [CITED: https://nodejs.org/api/stream.html] |
| Source selection | Request-derived paths or directory scans | Existing fixed selector catalog + canonical final resolver | The existing helper restricts the public vocabulary and preflights regular final files. [VERIFIED: codebase grep] |

**Key insight:** The custom code should own only lifecycle state, validation, and cache policy; ZIP mechanics, IDs, stream completion, and final-path mapping already have safer primitives. [CITED: https://www.archiverjs.com/docs/archiver/] [CITED: https://nodejs.org/api/stream.html] [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Incorrect percentage denominator

**What goes wrong:** Progress jumps unpredictably or reflects compressed output/network transfer instead of source processing. [CITED: https://www.archiverjs.com/docs/archiver/]

**Why it happens:** `archive.pointer()` measures emitted archive bytes, while Archiver's progress event separately exposes filesystem total and processed bytes. [CITED: https://www.archiverjs.com/docs/archiver/]

**How to avoid:** Sum the stable snapshot sizes once, calculate `floor(processedBytes / snapshotBytes * 100)`, clamp at 99 until output is closed/renamed, then set 100 and `ready`. [ASSUMED]

**Warning signs:** A small highly-compressible transcript appears complete before a large audio source has been processed, or `ready` appears before the ZIP exists. [ASSUMED]

### Pitfall 2: Cache does not reflect partial availability changes

**What goes wrong:** A cache created when `trailer` was missing remains reusable after the final trailer appears, or an archive references a now-removed source. [VERIFIED: CONTEXT.md]

**Why it happens:** The cache records only available files rather than every normalized requested selector. [ASSUMED]

**How to avoid:** Persist a fingerprint or `missing` marker per requested selector and compare all of them before ready status/download reuse. [VERIFIED: CONTEXT.md]

**Warning signs:** A second default-all request returns a stale `X-Missing-Artifacts` value after final media is promoted. [ASSUMED]

### Pitfall 3: TOCTOU during archive construction

**What goes wrong:** Preflight accepts a final file but Archiver later reads changed/replaced content or fails after headers/job state claim success. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html] [CITED: https://www.archiverjs.com/docs/archiver/]

**Why it happens:** Node identifies the race between checking and using a filesystem path, and `archive.file()` uses a lazy stream wrapper. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html] [CITED: https://www.archiverjs.com/docs/archiver/]

**How to avoid:** Snapshot fixed canonical sources into a job-owned server path, recompare fingerprints after copy, archive the snapshots, and discard/requeue on mismatch. [ASSUMED]

**Warning signs:** A ready archive's source fingerprint no longer matches at download time, or an Archiver ENOENT error follows successful preflight. [ASSUMED]

### Pitfall 4: Restart leaves a permanent preparing job

**What goes wrong:** Status remains `preparing` forever after the process exits mid-archive. [ASSUMED]

**Why it happens:** The old direct route has no durable lifecycle, and a writable stream cannot be resumed after process loss. [VERIFIED: codebase grep]

**How to avoid:** Persist every state transition, delete orphan `*.part` output during startup recovery, reset interrupted jobs to `queued`, and start only one pump. [ASSUMED]

**Warning signs:** Manifest has `preparing` but no process-owned active job or a stale temporary file. [ASSUMED]

## Code Examples

### Safe cache validation boundary

```typescript
// Source: existing fixed selector/preflight service + Node fs documentation
const preflight = await preflightEpisodeArtifactDownloads(episodeId, selectedArtifacts);
const currentFingerprint = await fingerprintRequestedFinalArtifacts(preflight);

if (job.state === "ready" && fingerprintsEqual(job.sourceFingerprint, currentFingerprint)) {
  return toStatus(job, { downloadUrl: downloadUrlFor(job) });
}

if (job.state === "ready") {
  await expireAndDelete(job, "invalidated");
}
```

The helper must fingerprint every selected catalog entry, return `missing` for `ENOENT`/`ENOTDIR` or a non-regular path, and never serialize absolute paths. [VERIFIED: codebase grep]

### Completion before ready response

```typescript
// Source: Archiver quickstart + Express error-handling documentation
await archive.finalize();
await finished(output);
await fs.promises.rename(partPath, readyPath);
job.state = "ready";
job.progress = 100;
job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
await persistJob(job);
```

Do not make the archive downloadable until `finished(output)`, rename, and manifest persistence all succeed. [CITED: https://www.archiverjs.com/docs/quickstart/] [ASSUMED]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct HTTP streaming through `/:episodeId/artifacts/download` | Asynchronous preparation/status/download lifecycle with a server-side ready cache | Phase 13 locked decision. [VERIFIED: CONTEXT.md] | Enables true server-side preparation progress and repeat downloads without claiming transfer progress. [VERIFIED: CONTEXT.md] |
| One-time final-file preflight then live `archive.file(path)` | Job-local snapshot plus source-fingerprint validation before cache reuse | Phase 13 recommendation. [ASSUMED] | Prevents a preflight/cache record from silently representing changed final artifacts. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html] |

**Deprecated/outdated:**

- Direct streaming as the sole artifact endpoint: it cannot report ZIP construction progress before the response and has no reusable ready cache. [VERIFIED: CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Preserve direct-route compatibility by returning `410` with a migration link for one release. | Summary / API Contract | Existing callers may require an alternate compatibility window. |
| A2 | `POST` returns `202` for queued/preparing and `200` for ready cache; `GET download` uses `409`/`410` for not-ready/expired. | API Contract | Client/OpenAPI contract would need adjustment. |
| A3 | Restart recovery should requeue interrupted work instead of marking it permanently failed. | Architecture Patterns | Operations may prefer failed-with-retry semantics. |
| A4 | A one-time post-job cleanup plus hourly unref'd sweep is the right cleanup cadence. | Architecture Patterns | Storage use may need a different operational cadence. |
| A5 | `size`, `mtimeMs`, `ctimeMs`, and optional inode are sufficient cache fingerprints after snapshot revalidation. | Architecture Patterns | If producers preserve these fields while replacing bytes, a stronger content digest is required. |
| A6 | Snapshot-copy then post-copy fingerprint comparison is adequate for the repository's final-media promotion model. | Architecture Patterns / Pitfalls | If writers modify final files in place concurrently, use descriptor-bound reads or content hashing. |

## Open Questions

1. **Legacy direct-download migration window**
   - What we know: Phase 13 allows a deliberate replacement if migration-safe. [VERIFIED: CONTEXT.md]
   - What's unclear: Whether any deployed admin-web or operator tooling calls the direct route today. [ASSUMED]
   - Recommendation: Search the companion admin-web before implementation; retain `410` guidance for one release only if callers exist. [ASSUMED]

2. **Fingerprint strength versus disk I/O**
   - What we know: The VPS has a 4 GB constraint and the selected artifacts can include large audio files. [VERIFIED: PROJECT.md]
   - What's unclear: Whether final-media writers can preserve timestamps/size while altering bytes. [ASSUMED]
   - Recommendation: Start with regular-file type + size + mtime/ctime (+ inode where exposed) and snapshot revalidation; add a streaming SHA-256 only if the writer behavior makes metadata fingerprints insufficient. [ASSUMED]

3. **Cache-root configuration**
   - What we know: Existing media roots are centralized in `config.media`. [VERIFIED: codebase grep]
   - What's unclear: Whether operations want an environment override separate from the media root. [ASSUMED]
   - Recommendation: Default to a hidden generated subdirectory under `config.media.storageRoot`; expose a narrowly named optional env override only if deployment needs it. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Worker, filesystem, streams, UUIDs | ✓ | `v24.17.0`. [VERIFIED: local command] | — |
| npm | Existing project validation scripts | ✓ | `12.0.1`. [VERIFIED: local command] | — |
| `archiver` package | Existing ZIP implementation and Phase 13 worker | ✓ | `8.0.0` installed. [VERIFIED: codebase grep] | No new package action. |
| Local writable media storage | Snapshots, manifests, ZIP cache | ✓ by existing media layout initialization. [VERIFIED: codebase grep] | — |

**Missing dependencies with no fallback:** None identified. [VERIFIED: codebase grep]

**Missing dependencies with fallback:** npm registry lookup failed in this sandbox due DNS (`EAI_AGAIN`), but Phase 13 does not require a package install. [VERIFIED: local command]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Repository-native compiled verification scripts; no general test runner. [VERIFIED: codebase grep] |
| Config file | none — existing scripts run after `npm run build`. [VERIFIED: codebase grep] |
| Quick run command | `npm run build && npm run verify:episode-artifact-downloads`. [VERIFIED: codebase grep] |
| Full suite command | `npm run typecheck && npm run build && npm run verify:public-episodes && npm run verify:episode-artifact-downloads && npm run verify:summary-runtime-contract && npm run verify:summary-quality-contract`. [VERIFIED: codebase grep] |

### Phase Behaviors → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P13-01 | Authenticated POST validates Phase 12 selector semantics, returns 404 for zero available, and deduplicates equivalent requests. [VERIFIED: CONTEXT.md] | Route/service integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend existing verifier |
| P13-02 | FIFO exposes correct queued state/position and byte-based preparing progress. [VERIFIED: CONTEXT.md] | Service integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend existing verifier |
| P13-03 | A valid same-normalized-selector cache returns ready; selected source changes or missing/available transitions invalidate it. [VERIFIED: CONTEXT.md] | Filesystem integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend existing verifier |
| P13-04 | Ready download preserves canonical entries, deterministic filename, and `X-Missing-Artifacts`; non-ready/expired do not stream. [VERIFIED: CONTEXT.md] | Route/OpenAPI integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend existing verifier |
| P13-05 | Restart recovery requeues interrupted work, removes `*.part`, and retains only valid ready cache. [VERIFIED: CONTEXT.md] | Service integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend existing verifier |
| P13-06 | All lifecycle routes reuse authentication and dev bypass. [VERIFIED: CONTEXT.md] | Route integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend existing verifier |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run build`. [VERIFIED: AGENTS.md]
- **Per wave merge:** `npm run build && npm run verify:episode-artifact-downloads`. [VERIFIED: codebase grep]
- **Phase gate:** Run the full suite above before `$gsd-verify-work`. [ASSUMED]

### Wave 0 Gaps

- [ ] Extend `src/scripts/verify-episode-artifact-downloads.ts` with deterministic temporary cache roots, job-worker hooks, and cleanup assertions. [VERIFIED: codebase grep]
- [ ] Expose a service initialization/recovery seam so the verifier can simulate interrupted `preparing` state without starting an HTTP listener. [ASSUMED]
- [ ] Update route-stack verifier helpers for prepare, status, and download handlers plus the preserved/replaced direct route. [VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Route-level `requireAuth`, preserving its development-only bypass. [VERIFIED: codebase grep] |
| V3 Session Management | yes | Reuse existing bearer-token verification; do not invent job credentials. [VERIFIED: codebase grep] |
| V4 Access Control | yes | Authenticate prepare, status, and download before resolving job/cache state. [VERIFIED: CONTEXT.md] |
| V5 Input Validation | yes | Positive episode ID, strict singular CSV selector parser, opaque UUID format lookup, and no request path input. [VERIFIED: codebase grep] |
| V6 Cryptography | yes | Use Node `crypto.randomUUID()` for unguessable job identifiers; do not hand-roll randomness. [CITED: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html] |
| V7 Error Handling and Logging | yes | Persist generic failure state and log only episode ID/selectors/event, never absolute paths. [VERIFIED: CONTEXT.md] |
| V12 Files and Resources | yes | Fixed canonical final paths, regular-file checks, snapshots, generated cache paths, no arbitrary filenames. [VERIFIED: codebase grep] [CITED: https://cornucopia.owasp.org/taxonomy/asvs-5.0/05-file-storage/03-file-storage] |
| V13 API and Web Service | yes | Document protected lifecycle, no-store status responses, and JSON error/status representation. [ASSUMED] |

OWASP lists validation, access control, files/resources, and API/web service among ASVS categories; the file-download guidance requires ignoring or validating user-submitted filenames and specifying the response filename. [CITED: https://devguide.owasp.org/en/03-requirements/05-asvs/] [CITED: https://cornucopia.owasp.org/taxonomy/asvs-5.0/05-file-handling/04-file-download]

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal / local-file inclusion | Elevation of Privilege | Never accept a path or filename; map only fixed selectors to `getEpisodeMediaFinalPath`. [VERIFIED: codebase grep] |
| Symlink substitution | Tampering | Use `lstat`, reject non-regular sources, snapshot server-owned files, and revalidate before cache reuse. [VERIFIED: codebase grep] [ASSUMED] |
| Job-ID enumeration | Information Disclosure | Authenticate before job lookup and issue opaque `randomUUID` job IDs. [VERIFIED: CONTEXT.md] [CITED: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html] |
| ZIP cache poisoning / stale content | Tampering | Write `*.part`, await output completion, rename, persist ready state, and fingerprint all requested selectors before reuse. [ASSUMED] |
| Queue exhaustion by duplicate polling/prepare | Denial of Service | Idempotently return matching queued/preparing job; only the single worker performs archive work. [VERIFIED: CONTEXT.md] |
| Filesystem-layout leakage | Information Disclosure | API errors/status/logs contain selector names and generic error codes only, never local paths. [VERIFIED: CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- Existing Phase 13 context and Phase 12 implementation - locked lifecycle/security requirements, selector behavior, route order, auth, OpenAPI, and verifier conventions. [VERIFIED: codebase grep]
- [Node.js v24 filesystem documentation](https://nodejs.org/download/release/v24.15.0/docs/api/fs.html) - TOCTOU warning and filesystem API behavior. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html]
- [Archiver API](https://www.archiverjs.com/docs/archiver/) and [Quickstart](https://www.archiverjs.com/docs/quickstart/) - explicit file append, progress semantics, output finalization/listener order. [CITED: https://www.archiverjs.com/docs/archiver/] [CITED: https://www.archiverjs.com/docs/quickstart/]
- [Express 5 error handling](https://expressjs.com/en/5x/guide/error-handling/) - rejected async handlers and behavior after response streaming begins. [CITED: https://expressjs.com/en/5x/guide/error-handling/]

### Secondary (MEDIUM confidence)

- [Node filesystem API](https://nodejs.org/api/fs.html), [stream API](https://nodejs.org/api/stream.html), and [Node crypto API](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html) - current stable primitives used by the recommendation. [CITED: https://nodejs.org/api/fs.html] [CITED: https://nodejs.org/api/stream.html] [CITED: https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html]
- [OWASP ASVS overview](https://devguide.owasp.org/en/03-requirements/05-asvs/) and [file storage/download controls](https://cornucopia.owasp.org/taxonomy/asvs-5.0/05-file-storage/03-file-storage) - applicable verification categories and file-path controls. [CITED: https://devguide.owasp.org/en/03-requirements/05-asvs/] [CITED: https://cornucopia.owasp.org/taxonomy/asvs-5.0/05-file-storage/03-file-storage]

### Tertiary (LOW confidence)

- The manifest schema, HTTP response choices, snapshot retry policy, fingerprint composition, and cleanup cadence are intentionally marked `[ASSUMED]` for discuss/planning confirmation.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - all required runtime/library pieces are already present and official Archiver/Node/Express behavior was checked. [VERIFIED: codebase grep] [CITED: https://www.archiverjs.com/docs/archiver/]
- Architecture: MEDIUM - lifecycle constraints are locked, but restart-recovery and snapshot/fingerprint implementation choices need confirmation. [VERIFIED: CONTEXT.md] [ASSUMED]
- Pitfalls: HIGH - TOCTOU, stream completion, byte-progress, and source-selection risks were verified against official docs and the current implementation. [CITED: https://nodejs.org/download/release/v24.15.0/docs/api/fs.html] [CITED: https://www.archiverjs.com/docs/archiver/] [VERIFIED: codebase grep]

**Research date:** 2026-07-28  
**Valid until:** 2026-08-27 for Node/Express/Archiver API guidance; revisit archive lifecycle decisions before implementation if the final-media writer semantics change. [ASSUMED]
