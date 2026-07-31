---
phase: 14-reconcile-artifact-job-contract-and-harden-zip-lifecycle
verified: 2026-07-31T14:48:35Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/6
  gaps_closed:
    - "Persisted SHA-256 evidence is derived from the exact streamed snapshot bytes, and a post-snapshot live-source comparison rejects mutations before archive publication."
  gaps_remaining: []
  regressions: []
---

# Phase 14: Reconcile Artifact Job Contract and Harden ZIP Lifecycle Verification Report

**Phase Goal:** Preserve the authoritative artifact-job routes while making cache reuse, source evidence, progress, errors, documentation, and verification internally consistent.
**Verified:** 2026-07-31T14:48:35Z
**Status:** passed
**Re-verification:** Yes — snapshot-evidence race-fix verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `POST /v1/episodes/:episodeId/artifacts/jobs` with an omitted body or omitted `artifacts` selects all five fixed artifacts. | ✓ VERIFIED | Existing route/parser/verifier coverage remains intact; compiled verifier passed. |
| 2 | Completed archives have a 24-hour TTL. | ✓ VERIFIED | Existing retention/repository behavior remains intact; compiled verifier passed. |
| 3 | A ready ZIP is reusable only while persisted streamed SHA-256-or-missing evidence represents the exact selected bytes archived and still matches every selected live source before reuse, status, and download. | ✓ VERIFIED | `digestSnapshot` hashes every buffer as it writes the snapshot (`src/services/episode-artifact-preparation.service.ts:127-143`); the service persists those snapshot hashes only after `collectEpisodeArtifactSourceEvidence` matches them (`:329-349`); Archiver then reads those snapshot files (`:146-150`). Reuse, status, and download continue to call `hasCurrentSourceEvidence` before serving a ready archive. The compiled verifier pauses at `processing-evidence`, mutates the final audio, releases the comparison, and requires failed state plus no partial output (`src/scripts/verify-episode-artifact-downloads.ts:293-306`). |
| 4 | Actual Archiver source-byte progress remains below 100 until archive publication. | ✓ VERIFIED | Existing Archiver/repository progress behavior remains intact; compiled verifier passed. |
| 5 | Failed jobs expose only a safe public error. | ✓ VERIFIED | Existing generic-failure behavior remains intact; compiled verifier passed. |
| 6 | OpenAPI and the compiled verifier describe and exercise the current jobs-route contract. | ✓ VERIFIED | Existing route/OpenAPI parity checks remain intact; compiled verifier passed. |

**Score:** 6/6 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/services/episode-artifact-preparation.service.ts` | Snapshot-derived evidence and post-snapshot mutation rejection | ✓ VERIFIED | L1 exists; L2 substantive streaming hash and comparison logic; L3 wired into the preparation lifecycle; L4 snapshot hash is persisted and Archiver reads the same snapshot path. |
| `src/scripts/verify-episode-artifact-downloads.ts` | Deterministic race regression check | ✓ VERIFIED | L1 exists; L2 uses the stage controller to place mutation exactly after snapshots/evidence construction and before live-source comparison; L3 invoked by `npm run verify:episode-artifact-downloads`; compiled execution passed. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- |
| Snapshot stream | persisted source evidence | `digestSnapshot` result → `sourceEvidence` → `updateSourceEvidence` | ✓ WIRED | SHA-256 is calculated from the buffers written to the snapshot, not by a later source reread. |
| Snapshot evidence | live final sources | `evidenceMatches(sourceEvidence, await collectEpisodeArtifactSourceEvidence(...))` | ✓ WIRED | A mismatch throws before persistence/archive assembly; the deterministic mutation case proves the failure path. |
| Snapshot files | archive bytes | `archive.file(snapshot.filePath, ...)` | ✓ WIRED | Archiver consumes the same snapshots whose bytes were hashed. |
| Verifier stage controller | mutation window | `processing-evidence` completion/wait/release | ✓ WIRED | The verifier cannot release archive work until after it writes the mutated source and releases the evidence comparison. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| Preparation service | `sourceEvidence` | SHA-256 computed while each final source is streamed into its snapshot, then compared to a fresh stream of every selected final source | Yes | ✓ FLOWING |
| Preparation service | archive entries | `snapshots` built from the same snapshot paths that supplied `sourceEvidence` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Type safety | `npm run typecheck` | Exit 0 | ✓ PASS |
| Build | `npm run build` | Exit 0 | ✓ PASS |
| Snapshot-evidence race and artifact-job lifecycle | `npm run verify:episode-artifact-downloads` | Exit 0; deterministic post-snapshot mutation case produced the expected failed job and no partial output | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| — | — | No `TBD`, `FIXME`, `XXX`, or placeholder markers in the race-fix service or compiled verifier. | ℹ️ Info | No unresolved implementation-debt marker found. |

### Gaps Summary

None. The previous ZIP-04 blocker is closed: evidence now describes the exact bytes copied into and consumed from the snapshots, and the live source is re-read after snapshotting to reject an intervening mutation before an archive can be published.

_Verified: 2026-07-31T14:48:35Z_
_Verifier: the agent (independent goal-backward re-verification)_
