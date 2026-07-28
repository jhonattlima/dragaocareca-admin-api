---
phase: 9
slug: summary-runtime-and-draft-contract
status: executed
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-23
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none detected in repo; use repo-native verification scripts |
| **Config file** | none - Wave 0 can add script/harness support if needed |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run build`
- **Before `$gsd-verify-work`:** `npm run build` plus one executable summary workflow check must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | SUMM-01 | T-09-01 | Summary runtime reads only transcript-derived input and writes draft output without mutating DB summary | source + integration | `npm run typecheck` | ✅ | done |
| 09-01-02 | 01 | 1 | OPS-01 | T-09-02 | Runtime/model selection is env-driven only | source | `npm run typecheck` | ✅ | done |
| 09-02-01 | 02 | 2 | FLOW-02 | T-09-03 | Summary generation is blocked when transcript artifact is missing or not ready | integration | `npm run build && NODE_ENV=development node dist/scripts/verify-summary-runtime-contract.js --missing-transcript` | ✅ | done |
| 09-02-02 | 02 | 2 | SUMM-01 | T-09-04 | Shared episode state and summary artifact contract remain separated from `transcript.txt` and final DB summary, and runtime-config failures surface when `EPISODE_SUMMARY_COMMAND` or `EPISODE_SUMMARY_MODEL_PATH` are missing | integration | `npm run build && NODE_ENV=development node dist/scripts/verify-summary-runtime-contract.js && NODE_ENV=development EPISODE_SUMMARY_COMMAND= EPISODE_SUMMARY_MODEL_PATH= node dist/scripts/verify-summary-runtime-contract.js --expect-runtime-config-error` | ✅ | done |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/scripts/verify-summary-runtime-contract.ts` - executable summary workflow contract check
- [x] `package.json` script entry for the summary verification command
- [x] local summary CLI availability check wired to env-driven runtime config, including explicit missing-command and missing-model failure coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Portuguese-BR summary quality stays discovery-friendly without keyword stuffing | SUMM-01 | Human judgment is required for tone and search phrasing quality | Generate a draft summary from a real transcript and confirm it is `pt-BR`, `2-4` short sentences, uses natural searchable terms, and avoids hype/keyword-list output |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
