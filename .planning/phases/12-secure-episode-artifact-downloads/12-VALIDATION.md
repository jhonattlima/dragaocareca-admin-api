---
phase: 12
slug: secure-episode-artifact-downloads
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-28
---

# Phase 12 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | Repository-native compiled TypeScript verifier scripts |
| **Config file** | none - verifier compiles from `src/scripts/` to `dist/scripts/` |
| **Quick run command** | `npm run verify:episode-artifact-downloads` |
| **Full suite command** | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads` |
| **Estimated runtime** | ~10 seconds, excluding package installation |

## Sampling Rate

- **After every task commit:** Run `npm run typecheck && npm run build`
- **After every plan wave:** Run `npm run verify:episode-artifact-downloads`
- **Before `$gsd-verify-work`:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads` must be green
- **Max feedback latency:** 30 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---|---:|---:|---|---|---|---|---|---|---|
| 12-02-02 | 02 | 2 | ART-07 | T-12-SC | Compiled verifier scaffold and npm script exist and run before the selector/preflight boundary is implemented. | verifier bootstrap | `npm run verify:episode-artifact-downloads` | ❌ bootstrap | ⬜ pending |
| 12-03-01 | 03 | 3 | ART-01, ART-02, ART-04, ART-05 | T-12-01 | Fixed selector catalog resolves only final regular files and rejects invalid query shapes. | helper contract | `npm run verify:episode-artifact-downloads` | ❌ extended in plan | ⬜ pending |
| 12-04-01 | 04 | 4 | ART-01, ART-02, ART-03, ART-06 | T-12-02 | Authenticated route streams only preflighted files; zero availability is JSON `404`; partial result exposes selector-only missing header. | route contract | `npm run verify:episode-artifact-downloads` | ❌ extended in plan | ⬜ pending |
| 12-04-02 | 04 | 4 | ART-07 | T-12-01, T-12-02 | OpenAPI and the compiled verifier cover the stable endpoint, headers, auth, and ZIP entries. | static and archive-byte contract | `npm run verify:episode-artifact-downloads` | ❌ extended in plan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

## Verification Bootstrap Requirements

- [ ] Plan 12-02 creates `src/scripts/verify-episode-artifact-downloads.ts` and the `package.json` `verify:episode-artifact-downloads` script, then builds and runs that compiled scaffold before Plan 12-03 implements selector parsing or final-file preflight.
- [ ] Plan 12-03 extends the already-runnable verifier with selector and preflight assertions, then runs it after its implementation wave.
- [ ] Plan 12-04 extends that verifier with direct-router, auth, response-header, OpenAPI, and ZIP-entry assertions, then runs it after its implementation wave.
- [ ] No general test framework - preserve the established verifier pattern.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Package legitimacy before installation | implementation prerequisite | The package-legitimacy seam flagged `archiver` metadata as suspicious despite its official docs and long-lived project history. | Review the npm package name, repository, release, and lockfile diff before approving the dependency installation checkpoint. |

## Validation Sign-Off

- [ ] All tasks have automated verification or a completed verification-bootstrap dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification
- [ ] The verifier scaffold exists and runs before the selector/preflight security boundary; its progressively extended checks cover ART-01 through ART-07
- [ ] No watch-mode flags
- [ ] Feedback latency < 30 seconds
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
