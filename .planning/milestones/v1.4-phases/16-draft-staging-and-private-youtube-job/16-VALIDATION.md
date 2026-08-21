---
phase: 16
slug: draft-staging-and-private-youtube-job
status: validated
nyquist_compliant: true
wave_1_verification_foundation: complete
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
| Durable job persistence and source identity | TRAILER-02, TRAILER-03 | T-16-02 | One active job per fingerprint; lease/revision checks block duplicate or stale writes. | compiled repository/service integration | `npm run build && npm run verify:youtube-trailer-job-lifecycle -- --focus=repository` | ✅ Wave 1 scaffold | ⬜ pending |
| Resumable private transfer and processing | TRAILER-02 | T-16-03 | Persist session before bytes, resume through provider offsets, and distinguish private upload from processing/ready. | compiled fake-provider worker integration | `npm run build && npm run verify:youtube-trailer-job-lifecycle -- --focus=worker` | ✅ Wave 1 scaffold | ⬜ pending |
| Cancel, obsolete, retry, and restart recovery | TRAILER-03 | T-16-04 | Cancellation is honest, accepted provider resources are reconciled, and unchanged sources resume instead of duplicating uploads. | compiled fake-provider worker integration | `npm run build && npm run verify:youtube-trailer-job-lifecycle -- --focus=worker` | ✅ Wave 1 scaffold | ⬜ pending |
| Protected route and DTO boundary | TRAILER-02, TRAILER-03, TRAILER-09 | T-16-05 | Auth is required; browser-visible payloads omit server paths, session URIs, provider credentials, and raw provider errors. | compiled route contract | `npm run build && npm run verify:youtube-trailer-job-lifecycle` | ✅ Wave 1 scaffold | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 1 Verification Foundation

- [ ] Plan 16-05 creates `src/scripts/verify-youtube-trailer-job-lifecycle.ts` and the compiled `verify:youtube-trailer-job-lifecycle` npm command before repository or worker implementation.
- [ ] The Wave 1 verifier scaffold proves deterministic fake-provider isolation and supports `--focus=repository` and `--focus=worker` as later seams become available; it never reads OAuth credentials or makes network calls.
- [ ] Plan 16-01 expands `src/scripts/verify-trailer-video-upload-lifecycle.ts` for create/promotion/consume compensation in the same wave.
- [ ] Plans 16-02 and 16-03 depend on Plan 16-05 and run their focused verifier checks; every completed wave runs the full suite.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OAuth upload-scope readiness against the production channel | TRAILER-02 | A real refresh-token grant and channel policy cannot be proved with committed fixtures. | Before enabling live jobs, use an operator-controlled credential check to confirm the production grant supports `youtube.upload`; do not upload a real video as part of automated validation. |
| Real VPS transfer throughput and provider processing delay | TRAILER-02, TRAILER-03 | Bandwidth, reverse-proxy timeout, and provider processing time are deployment-dependent. | With a disposable private video, observe one complete private transfer, restart/recovery behavior, and cancellation messaging; record any required environment-limit adjustments. |
| Live-worker enablement | TRAILER-02, TRAILER-03 | Production OAuth grant/channel and VPS limits cannot be proved with committed fixtures. | Keep `YOUTUBE_TRAILER_JOB_ENABLED` false. In the Plan 16-06 blocking checkpoint, validate the intended channel and `youtube.upload` grant without test upload, record the accepted 60-second poll, 30-second timeout, 60-second-to-15-minute backoff, five-attempt defaults (or approved conservative overrides), then explicitly enable the worker. |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 1 verifier-foundation dependency.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification.
- [ ] Wave 1 verifier foundation exists before repository/worker tasks execute.
- [ ] Live worker enablement has an approved manual OAuth/token/channel and operational-limit checkpoint; automated tests use only the fake provider.
- [ ] No watch-mode flags.
- [ ] Feedback latency < 60s.
- [ ] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
