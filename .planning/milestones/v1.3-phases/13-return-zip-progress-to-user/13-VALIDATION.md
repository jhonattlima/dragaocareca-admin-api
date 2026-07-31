---
phase: 13
slug: return-zip-progress-to-user
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Repository-native compiled TypeScript verification scripts |
| **Config file** | none |
| **Quick run command** | `npm run build && npm run verify:episode-artifact-downloads` |
| **Full suite command** | `npm run typecheck && npm run build && npm run verify:public-episodes && npm run verify:episode-artifact-downloads && npm run verify:summary-runtime-contract && npm run verify:summary-quality-contract` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck && npm run build`
- **After every plan wave:** Run `npm run build && npm run verify:episode-artifact-downloads`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | D-01, D-03, D-05, D-06, D-08, D-09 | T-13-01, T-13-02 | One persisted FIFO job prepares snapshots into an atomically published ZIP; stale source fingerprints cannot be reused. | service/filesystem integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend verifier | ⬜ pending |
| 13-01-02 | 01 | 1 | D-04, D-07, D-12 | T-13-03 | Status safely distinguishes queued, preparing, ready, failed, and expired without exposing local paths. | service integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend verifier | ⬜ pending |
| 13-02-01 | 02 | 2 | D-01, D-02, D-07, D-10, D-11 | T-13-04, T-13-05 | Protected prepare/status/download routes preserve selector validation and final-only restrictions. | route integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend verifier | ⬜ pending |
| 13-02-02 | 02 | 2 | D-08, D-09, D-10, D-11 | T-13-01, T-13-02, T-13-06 | Ready ZIP revalidates source fingerprints, retains canonical entries and headers, and refuses expired/non-ready output. | route/filesystem integration | `npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend verifier | ⬜ pending |
| 13-03-01 | 03 | 3 | D-04, D-07, D-10, D-11, D-12 | T-13-04, T-13-05, T-13-06 | OpenAPI describes the lifecycle and the verifier covers auth, status, progress, cache, invalidation, download, and migration behavior. | documentation/contract integration | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads` | ❌ Extend verifier | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/scripts/verify-episode-artifact-downloads.ts` — add deterministic temporary cache roots, preparation lifecycle helpers, and route-stack assertions before relying on the new behavior.
- [ ] `src/services/episode-artifact-preparation.service.ts` — expose a testable initialization/recovery seam without an HTTP listener.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin-web presentation of progress | D-06, D-07 | This backend phase exposes a polling contract only; UI integration is outside this repository. | Use a client to poll the status endpoint during a large archive preparation and confirm state, percentage, queue position, ready URL, and expiration display correctly. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30 seconds
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
