---
phase: 16
slug: draft-staging-and-private-youtube-job
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-04
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for draft-media promotion and private YouTube job lifecycle.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Repository-native compiled Node assertion scripts |
| **Config file** | none — `src/scripts/verify-*.ts` compiled by TypeScript |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run build && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle` |
| **Estimated runtime** | ~30 seconds without live provider calls |

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`.
- **After every plan wave:** Run `npm run build && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle`.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 60 seconds.

## Per-Task Verification Map

| Task Area | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Draft reservation and promotion compensation | TRAILER-09 | T-16-01 | Owner/episode/expiry checks, atomic promotion, and failure cleanup never finalize staging or lose a prior final file. | compiled route/service integration | `npm run verify:trailer-video-upload-lifecycle` | ✅ expand | ⬜ pending |
| Durable job persistence and source identity | TRAILER-02, TRAILER-03 | T-16-02 | One active job per fingerprint; lease/revision checks block duplicate or stale writes. | compiled repository/service integration | `npm run verify:youtube-trailer-job-lifecycle` | ❌ Wave 0 | ⬜ pending |
| Resumable private transfer and processing | TRAILER-02 | T-16-03 | Persist session before bytes, resume through provider offsets, and distinguish private upload from processing/ready. | compiled fake-provider worker integration | `npm run verify:youtube-trailer-job-lifecycle` | ❌ Wave 0 | ⬜ pending |
| Cancel, obsolete, retry, and restart recovery | TRAILER-03 | T-16-04 | Cancellation is honest, accepted provider resources are reconciled, and unchanged sources resume instead of duplicating uploads. | compiled fake-provider worker integration | `npm run verify:youtube-trailer-job-lifecycle` | ❌ Wave 0 | ⬜ pending |
| Protected route and DTO boundary | TRAILER-02, TRAILER-03, TRAILER-09 | T-16-05 | Auth is required; browser-visible payloads omit server paths, session URIs, provider credentials, and raw provider errors. | compiled route contract | `npm run verify:youtube-trailer-job-lifecycle` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] `src/scripts/verify-youtube-trailer-job-lifecycle.ts` — fake provider for private session, 308 resume, processing polling, cancellation, retry, duplicate start, obsolete source, restart recovery, and safe DTO assertions.
- [ ] Expand `src/scripts/verify-trailer-video-upload-lifecycle.ts` — force every create/promotion/consume failure and assert row, final-file, staging, and reservation compensation.
- [ ] `package.json` — add `verify:youtube-trailer-job-lifecycle` as a compiled development command.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OAuth upload-scope readiness against the production channel | TRAILER-02 | A real refresh-token grant and channel policy cannot be proved with committed fixtures. | Before enabling live jobs, use an operator-controlled credential check to confirm the production grant supports `youtube.upload`; do not upload a real video as part of automated validation. |
| Real VPS transfer throughput and provider processing delay | TRAILER-02, TRAILER-03 | Bandwidth, reverse-proxy timeout, and provider processing time are deployment-dependent. | With a disposable private video, observe one complete private transfer, restart/recovery behavior, and cancellation messaging; record any required environment-limit adjustments. |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing test references.
- [ ] No watch-mode flags.
- [ ] Feedback latency < 60s.
- [ ] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
