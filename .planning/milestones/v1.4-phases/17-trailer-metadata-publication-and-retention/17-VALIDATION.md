---
phase: 17
slug: trailer-metadata-publication-and-retention
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-11
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node `assert/strict` in compiled repository-native verifier scripts |
| **Config file** | None — use `src/scripts/verify-*.ts` |
| **Quick run command** | `npm run build && npm run verify:youtube-trailer-publication` |
| **Full suite command** | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads && npm run verify:trailer-video-upload-lifecycle && npm run verify:youtube-trailer-job-lifecycle && npm run verify:youtube-trailer-publication` |
| **Estimated runtime** | ~30 seconds offline |

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`.
- **After every plan wave:** Run the quick run command.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 60 seconds.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 17-00-01 | 00 | 0 | TRAILER-08 | compiled verifier command registration | `node -e "const p=require('./package.json'); if(!p.scripts['verify:youtube-trailer-publication']) process.exit(1)"` | passed |
| 17-00-02 | 00 | 0 | TRAILER-08 | temporary SQLite/media fixtures plus artifact-download and draft staging/promotion/rollback regression | `npm run build && npm run verify:youtube-trailer-publication && npm run verify:episode-artifact-downloads && npm run verify:trailer-video-upload-lifecycle` | passed |
| 17-01-01 | 01 | 1 | TRAILER-04 | guarded repository/provider contract with fake-provider readiness and category preservation | `npm run typecheck && npm run verify:youtube-trailer-publication` | passed |
| 17-02-01 | 02 | 2 | TRAILER-04, TRAILER-07 | publication ordering, idempotency, stale-source guards, legacy discovery, retention fault injection | `npm run build && npm run verify:youtube-trailer-publication` | passed |
| 17-03-01 | 03 | 3 | TRAILER-04, TRAILER-08 | protected route/OpenAPI/configuration contract | `npm run typecheck && npm run build && npm run verify:youtube-trailer-publication` | passed |
| 17-04-01 | 04 | 4 | TRAILER-04, TRAILER-07, TRAILER-08 | full suite including existing artifact-download and Phase 16 draft lifecycle assertions | full suite command above | passed |

## Wave 0 Requirements

- Add `src/scripts/verify-youtube-trailer-publication.ts` with temporary SQLite/media fixtures, fake-provider/network tripwire, and explicit existing artifact-download plus Phase 16 draft reservation/staging/promotion/rollback assertions.
- Add the compiled verifier package script before Plans 01/02 start; those plans depend on 17-00.
- Extend the same fixture file during Plans 01-03 with publication revision guards, existing URL/manual-sync state, retention error fields, categoryId preservation, route/OpenAPI assertions, and retention version ordering.
- Keep live OAuth/channel verification outside automation behind the blocking checkpoint in Plan 03.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|-----------|-------------------|
| Live OAuth scope and target ownership | TRAILER-04, TRAILER-08 | Production YouTube writes are unsafe for automated tests | Confirm the refresh token grants both `youtube.upload` and `youtube.force-ssl`, the authenticated channel is `UCq-TjauoYJrr3po121gA6iw`, and that channel owns playlist `PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t` before enabling live publication. |

## Final Execution Evidence

Executed 2026-08-11 in development mode with temporary SQLite/media fixtures. The complete offline gate passed:

```text
npm run typecheck                                      PASS
npm run build                                          PASS
npm run verify:episode-artifact-downloads              PASS
npm run verify:trailer-video-upload-lifecycle         PASS
npm run verify:youtube-trailer-job-lifecycle          PASS
npm run verify:youtube-trailer-publication             PASS
```

The passing output explicitly covered artifact ZIP downloads, draft reservation/staging/promotion/rollback and no premature final deletion, private job recovery and stale-source protection, exact saved-summary metadata, provider `snippet.categoryId` preservation, private playlist insertion before public visibility, canonical URL persistence, idempotent reuse, source/revision guards, current-plus-12 retention, malformed/symlink/directory exclusion, protected route/OpenAPI parity, and the network/OAuth tripwire. The gap-closure verifier additionally executed playlist-insertion failure and public-update failure with the fake provider, proving the same provider video remained private, no URL was persisted, and retry reached public confirmation without a duplicate playlist item. It exercised retention deletion failure by injecting one `fs.promises.unlink` error only in a disposable fixture, proving all eligible files remained present, publication stayed `public_confirmed` with its canonical URL, cleanup was `retryable-error`, and a later retry completed with the current plus twelve prior versions. It also exercised an exact 100-code-point Unicode title, an astral-character title over the limit, empty/whitespace/angle-bracket titles, malformed and invalid-character hashtags, and more than three hashtags; invalid inputs were rejected before provider delegation.

No live YouTube, OAuth write, VPS, or local listener operation was performed.

## Validation Sign-Off

- [x] All implementation tasks have automated verification; the single manual task is the blocking OAuth/channel checkpoint.
- [x] Sampling continuity has no three consecutive implementation tasks without automated verification.
- [x] Wave 0 creates the verifier and fixtures before Plans 01/02 depend on them.
- [x] No watch-mode flags are used.
- [x] Final execution evidence recorded after the complete offline phase gate passed.
- [ ] Blocking manual OAuth/channel/playlist readiness checkpoint remains outstanding and must not be inferred from offline success.
- **Approval:** offline automated gate passed; live readiness remains manual and pending.
