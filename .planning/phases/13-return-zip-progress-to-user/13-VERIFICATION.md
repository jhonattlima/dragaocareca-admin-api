---
phase: 13-return-zip-progress-to-user
verified: 2026-07-29T04:15:00Z
status: gaps_found
score: 3/7 must-haves verified
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "An authenticated preparation request is idempotent: the same normalized episode/selector set reuses its existing queued, preparing, or ready job."
    status: failed
    reason: "Expired manifests remain first in cache-key lookup. Subsequent identical requests ignore a newer queued job and each create another queued manifest."
    artifacts:
      - path: "src/services/episode-artifact-preparation.service.ts"
        issue: "prepareEpisodeArtifactArchive uses find() by cacheKey, evaluates only the earliest manifest, then creates a new job when that manifest is expired."
    missing:
      - "Select and reuse the current queued/preparing/valid-ready manifest for a cache key, or replace/remove stale manifests before lookup."
      - "Add a compiled regression test that invalidates a ready job and proves repeated identical prepare calls return one job ID."
  - truth: "OpenAPI and compiled contract coverage accurately document and prove the full Phase 13 preparation lifecycle."
    status: failed
    reason: "The documented artifacts parameter is a string enum of individual selectors, which rejects valid CSV values such as episode,transcript accepted by the route; the compiled verifier only checks the schema type and does not detect this mismatch."
    artifacts:
      - path: "src/docs/openapi.ts"
        issue: "The prepare artifacts parameter has enum [episode, trailer, transcript, image, image-low] despite the API accepting one CSV value."
      - path: "src/scripts/verify-episode-artifact-downloads.ts"
        issue: "OpenAPI assertions do not prove a multi-selector CSV is schema-valid or that documentation matches the route parser."
    missing:
      - "Describe the CSV grammar without a single-selector enum (or use a schema pattern that permits the valid fixed-selector CSV combinations)."
      - "Assert the OpenAPI selector schema accepts the same representative normalized CSV accepted by the route."
behavior_unverified_items:
  - truth: "While preparing, status reports a 0-100 percentage derived from source bytes processed into the ZIP."
    test: "Prepare a sufficiently large selected final artifact, poll the status endpoint while Archiver is running, and compare progress to source-byte work rather than transfer bytes."
    expected: "The observed preparing state has an integer 0-99 progress that advances from Archiver source-byte processing; ready becomes 100 only after atomic publication."
    why_human: "The compiled verifier writes a synthetic preparing manifest with progress 42; it does not observe a live Archiver progress event."
  - truth: "Production startup recovers interrupted work and keeps the archive processor serialized."
    test: "Leave a persisted preparing manifest and partial output, restart the service with background workers enabled, then inspect the protected status endpoint and processing behavior."
    expected: "The job is requeued once, partial/snapshot output is removed, and only one archive is processed at a time."
    why_human: "The verifier invokes the service recovery seam directly; it does not start the server/worker lifecycle."
---

# Phase 13: return zip progress to user Verification Report

**Phase Goal:** Let authenticated administrators prepare a final-artifact ZIP on the server, poll its queue and assembly progress, then download a validated cached archive.
**Verified:** 2026-07-29T04:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | ZIP-01: authenticated preparation preserves selector validation/404 behavior and idempotently starts or reuses a normalized job. | ✗ FAILED | Route authentication, parser, episode check, and zero-availability 404 are wired at `episodes.routes.ts:436-474`; however, the independent compiled-service probe invalidated a ready job then received two different queued IDs for two identical requests. `prepareEpisodeArtifactArchive` only examines the first matching manifest at `episode-artifact-preparation.service.ts:263-270`. |
| 2 | ZIP-02: jobs persist global FIFO state, one processor is active, and queued status exposes position. | ✓ VERIFIED | JSON manifests are persisted under the fixed media root (`:14-18`, `:81-105`); queue position is computed from globally sorted queued manifests (`:127-145`); `activeProcess` coalesces concurrent processing (`:304-345`). The compiled verifier exercises second queued position `2` and concurrent processor calls. |
| 3 | ZIP-03: preparing status reports source-byte assembly progress from 0-100. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Archiver `progress.fs.processedBytes / snapshot bytes` writes clamped 0-99 progress (`:190-216`) and ready persists 100 (`:329-334`), but the verifier fabricates a manifest with `progress: 42` (`verify-episode-artifact-downloads.ts:408-422`) rather than observing live Archiver progress. |
| 4 | ZIP-04: a ready archive is reusable for 24 hours only while SHA-256 and missing-marker evidence remains unchanged. | ✓ VERIFIED | Streaming hashes and explicit missing evidence are persisted (`:107-122`, `:317-327`); ready status/download recompute the complete map (`:156-168`, `:282-301`). The compiled verifier passes byte changes with restored timestamps, a newly appearing missing trailer, and 24-hour expiry. |
| 5 | ZIP-05: only a revalidated ready archive downloads behind auth; legacy direct download is authenticated 410 migration. | ✓ VERIFIED | All lifecycle routes use `noStoreArtifactPreparation, requireAuth`; download rejects non-ready/expired before streaming and calls the validated service seam (`episodes.routes.ts:507-565`); direct route is protected 410 (`:571-582`). The compiled route-stack verifier checks unauthenticated access, 409 non-ready, ZIP success, 410 expiration, and migration payload. |
| 6 | ZIP-06: startup recovery/cleanup retains final-only security and avoids path leakage. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Recovery/cleanup code is wired into the background worker and server (`episode-artifact-preparation.worker.ts:12-48`, `server.ts:25-34`); final-only selection remains through Phase 12 preflight and tests capture API/log output without storage-root text. The recovery test calls the service directly, not an actual restarted server/worker. |
| 7 | ZIP-07: OpenAPI and compiled contract verification document and prove the full lifecycle. | ✗ FAILED | Paths, bearer security, status fields, no-store headers, and migration are documented and mounted via `app.ts:60-62`, but `openapi.ts:728` defines `artifacts` as a single-value enum that rejects valid CSV selections. The verifier only asserts `schema.type === "string"` (`verify-episode-artifact-downloads.ts:339-352`), so its green result does not prove contract parity. |

**Score:** 3/7 truths verified (2 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/services/episode-artifact-preparation.service.ts` | Persisted manifests, FIFO, cache validation, snapshots, cleanup | ⚠️ PARTIAL | Exists (345 lines), substantive, and used by routes/worker. SHA/missing revalidation and atomic `*.part`→rename are real, but stale-manifest lookup breaks active-job idempotency. |
| `src/workers/episode-artifact-preparation.worker.ts` | Startup recovery, guarded pump, periodic cleanup | ✓ VERIFIED | Exists (48 lines), imported by `server.ts`, startup pass invokes recovery then one processor, interval is guarded and unref’d. Runtime restart behavior remains listed above for human confirmation. |
| `src/server.ts` | Starts worker when background workers are enabled | ✓ VERIFIED | Imports and awaits `startEpisodeArtifactPreparationWorker` within the non-disabled bootstrap branch. |
| `src/routes/episodes.routes.ts` | Protected prepare, status, ready-download, migration routes | ✓ VERIFIED | Static routes precede generic `/:episodeId`; all lifecycle route stacks apply no-store before `requireAuth`, delegate to preparation service, and never expose manifest/path fields. |
| `src/docs/openapi.ts` | Public lifecycle OpenAPI contract | ⚠️ HOLLOW | Exists, substantive, and served by the app, but the `artifacts` schema conflicts with valid multi-selector CSV input. |
| `src/scripts/verify-episode-artifact-downloads.ts` | Compiled lifecycle/security contract | ⚠️ PARTIAL | Invokes real compiled router/service/OpenAPI without a listener and catches many security cases, but misses invalidation-then-retry idempotency and OpenAPI CSV validity. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Preparation service | Phase 12 selector/preflight service | Imported parser/preflight | ✓ WIRED | Only fixed selector parsing and canonical-final preflight determine sources. No legacy resolver is imported by the preparation service. |
| Preparation service | `config.media.storageRoot` | Fixed `.artifact-preparations` child | ✓ WIRED | Root is server-owned at `path.join(config.media.storageRoot, ".artifact-preparations")`. |
| Server | preparation worker | Startup call | ✓ WIRED | Worker starts after DB/media initialization unless `DISABLE_BACKGROUND_WORKERS=true`. |
| Lifecycle routes | preparation service | prepare/status/validated-download calls | ✓ WIRED | Direct imports and calls at route lines 25-29 and 467/493/537. |
| OpenAPI | mounted route contract | `swaggerSpec` served by app | ⚠️ PARTIAL | Paths/methods/statuses/security match the handlers, but selector-schema semantics do not. |
| Compiled verifier | actual router and OpenAPI | direct route-stack invocation and `swaggerSpec` inspection | ✓ WIRED | Imports both actual exports and runs from `dist`; coverage gaps are documented above. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| Preparation service | requested/available/missing/evidence | request selector → fixed catalog → Phase 12 canonical final-file `lstat`/streamed bytes | Yes | ✓ FLOWING |
| Archive output | snapshots → `ZipArchive` → `*.part` → renamed ready ZIP | job-local snapshots of preflighted final files | Yes | ✓ FLOWING |
| Status/download routes | serialized status / validated read stream | persisted manifest → revalidation → archive read stream | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Typecheck, build, and repository contract suite | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads && npm run verify:public-episodes && npm run verify:summary-runtime-contract && npm run verify:summary-quality-contract` | Exit 0; artifact verifier, public catalog verifier, and summary verifiers all passed. | ✓ PASS |
| Idempotency after cache invalidation | Compiled-service probe: ready → mutate source → revalidate → prepare twice | Returned distinct queued job IDs (`fc714094-...` then `7909ea80-...`); `reusedAfterInvalidation:false`. Test fixture and preparation root were removed in `finally`. | ✗ FAIL |
| Live byte-progress observation | No safe existing named test | Existing verifier uses a synthetic `progress: 42`, not a live Archiver event. | ? SKIP |
| Actual startup recovery | No safe existing named test | Existing verifier uses direct service initialization, not server/worker startup. | ? SKIP |

### Probe Execution

Step 7c: SKIPPED — no declared or conventional `scripts/**/tests/probe-*.sh` probes exist.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| ZIP-01 | 13-01, 13-02 | Authenticated idempotent preparation and preserved selector/404 handling | ✗ BLOCKED | The invalidation/retry probe proves duplicate active queued jobs for one normalized cache key. |
| ZIP-02 | 13-01, 13-02 | Persisted global FIFO, states, queue position | ✓ SATISFIED | Manifests, global ordering, state serialization, and compiled queue/concurrency checks. |
| ZIP-03 | 13-01, 13-03 | Byte-derived progress | ? NEEDS HUMAN | Code is correctly wired but no test observes the state transition on a real archive. |
| ZIP-04 | 13-01, 13-03 | SHA-256/missing-marker cache invalidation and 24-hour reuse | ✓ SATISFIED | Executed compiled tests cover same-size timestamp-preserved mutation, missing-marker appearance, and expiry. |
| ZIP-05 | 13-02, 13-03 | Ready-only authenticated download and direct-route 410 | ✓ SATISFIED | Executed route-stack contract covers auth/no-store/non-ready/ready/expired/migration paths. |
| ZIP-06 | 13-01, 13-02 | Recovery, cleanup, final-only/no-path safety | ? NEEDS HUMAN | Service recovery and static worker/server wiring are present; real startup recovery is not exercised. |
| ZIP-07 | 13-03 | Accurate OpenAPI plus compiled lifecycle coverage | ✗ BLOCKED | OpenAPI enum rejects valid CSV input and verifier does not assert this contract parity. |

No orphaned Phase 13 requirements: ZIP-01 through ZIP-07 are claimed by the phase plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| `src/services/episode-artifact-preparation.service.ts` | 263-270 | Stale-first cache-key lookup | 🛑 Blocker | Defeats idempotent reuse after invalidation/expiry and can grow the FIFO with duplicate work. |
| `src/docs/openapi.ts` | 728 | Single-selector enum for CSV parameter | 🛑 Blocker | Generated/validated API clients reject a valid selected-artifact request. |
| Phase-modified source files | — | No unreferenced `TBD`, `FIXME`, or `XXX` markers; no placeholder or empty user-visible implementation found. | ℹ️ Info | No debt-marker blocker. |
| Lifecycle source path handling | — | No request-derived path or legacy final-media lookup in the preparation service; public status/openapi schemas omit paths, cache keys, fingerprints, and manifest names. | ℹ️ Info | Final-only and path-redaction boundaries remain intact in static and compiled checks. |

### Behavior Evidence Still Needed After Gap Closure

1. **Live assembly progress**

**Test:** Prepare a large archive and poll while it is assembling.
**Expected:** `progress` is source-byte assembly work, remains below 100 until publication, and `downloadUrl` stays null until ready.
**Why human:** The existing compiled verifier does not observe a live Archiver progress transition.

2. **Startup recovery**

**Test:** Restart with an interrupted preparing manifest and partial output while background workers are enabled.
**Expected:** One requeued job, partial artifacts removed, one active processor.
**Why human:** The current test invokes the service recovery function directly rather than the startup worker.

### Gaps Summary

The phase goal is not achieved yet. The green compiled verifier is insufficient because it misses a reproducible idempotency failure: an old expired manifest prevents lookup of the current queued job, so identical retries create duplicate FIFO work. In addition, the public OpenAPI parameter schema contradicts the Phase 12 CSV selector contract. Both are blocking ZIP-01/ZIP-07 gaps. No later phase exists in the roadmap to defer either item.

---

_Verified: 2026-07-29T04:15:00Z_
_Verifier: the agent (gsd-verifier)_
