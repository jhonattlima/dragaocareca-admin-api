---
phase: 11
slug: summary-quality-verification-and-documentation
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-23
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for summary quality verification and documentation updates.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none detected in repo; use repo-native verification scripts |
| **Config file** | none - Wave 0 can add script/harness support if needed |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run build` |
| **Summary quality command** | `npm run verify:summary-quality-contract` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run build`
- **Before `$gsd-verify-work`:** `npm run build` plus the summary quality command must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | SUMM-02 | T-11-01 | Summary quality verifier accepts short Portuguese-BR drafts and rejects malformed or non-`pt-BR` output | source + integration | `npm run typecheck` | ✅ | planned |
| 11-01-02 | 01 | 1 | OPS-02 | T-11-02 | Verifier runs from compiled backend output and stays backend-only | integration | `npm run build && npm run verify:summary-quality-contract` | ✅ | planned |
| 11-02-01 | 02 | 2 | DOC-01 | T-11-04 | SDD, feature README, and VPS docs describe the current summary contract and sequential VPS constraints | docs | `npm run build` | ✅ | planned |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/scripts/verify-summary-quality-contract.ts` - executable summary quality contract check
- [ ] `package.json` script entry for the summary quality verification command
- [ ] summary docs updated to describe transcript-only input, draft summary storage, and VPS sequencing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Portuguese-BR summary quality stays discovery-friendly without keyword stuffing | SUMM-02 | Human judgment is required for tone, search phrasing, and naturalness | Generate a draft summary from a real transcript and confirm it is `pt-BR`, 2-4 short sentences, uses natural searchable terms, and avoids hype or keyword-list output |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned
