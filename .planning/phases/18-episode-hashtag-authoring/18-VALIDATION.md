---
phase: 18
slug: episode-hashtag-authoring
status: planned
nyquist_compliant: true
wave_1_verification_foundation: planned
created: 2026-08-06
---

# Phase 18 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Repository-native compiled Node assertion scripts |
| Config | None; TypeScript compiles `src/scripts/verify-episode-hashtag-authoring.ts` |
| Quick command | `npm run typecheck` |
| Full command | `npm run typecheck && npm run build && npm run verify:episode-hashtag-authoring` |
| Live providers | Forbidden; fake Gemini, OAuth, and YouTube search adapters only |

## Per-Task Verification Map

| Task area | Requirement | Threat | Secure behavior | Automated command | Status |
|-----------|-------------|--------|-----------------|-------------------|--------|
| Foundation | TRAILER-06 | T-18-01..03 | One state child, deterministic display case, bounded quota/retry configuration, isolated temporary fixtures | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=foundation` | planned |
| Cache/admission and provider boundary | TRAILER-06 | T-18-04..07 | Exact normalized identity, canonical lower-case display, serial cache-first lookup, strict non-borrowable Pacific 90/10 reservation, safe errors | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=lookup` | planned |
| Durable authoring lifecycle | TRAILER-06 | T-18-08, T-18-13..14 | Summary stays done; persisted pending/retry state, fake-clock restart recovery, and state-version/digest guards block stale writes | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=lifecycle` | planned |
| Protected manual lookup/API docs | TRAILER-06 | T-18-09..12 | Auth/no-store, strict input, redacted DTO, OpenAPI parity | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=route` | planned |
| Full lifecycle | TRAILER-06 | T-18-01..14 | No network/OAuth, temporary cleanup, full route/service contract | `npm run typecheck && npm run build && npm run verify:episode-hashtag-authoring` | planned |

## Sampling Rate

- After every task: `npm run typecheck`.
- After each wave: `npm run build && npm run verify:episode-hashtag-authoring`.
- Before phase verification: run the full command above plus the existing summary runtime and quality verifiers.

## Focus Command Contract

| Command | Exclusive proof scope |
|---------|-----------------------|
| `--focus=foundation` | Environment parsing, one-file `suggestedTags` normalization, bounded retry state, and fixture/no-network guards. |
| `--focus=lookup` | Normalization, canonical lower-case display output, cache identity, serial provider lane, and strict 90 automatic / 10 manual Pacific-day admission. |
| `--focus=lifecycle` | Persisted pending/processing/unavailable transitions, serialized due retry, startup recovery, fake-clock timer cleanup, and root-version/summary-digest stale guards. |
| `--focus=route` | Protected no-store route stack, DTO redaction, canonical response case, and OpenAPI parity. |
| no `--focus` | Runs all four scopes; unknown or repeated focus arguments fail before fixture setup. |

## Offline Durable-Recovery Proof

- The lifecycle focus injects a fake clock and timer scheduler; no real timers, OAuth calls, fetch calls, configured persistence, or network access are permitted.
- It proves a restart turns persisted `pending`, interrupted `processing`, and due `unavailable` work into exactly one serialized execution, preserves `aiSummary: done`, and calls the returned worker stop callback in cleanup.
- It proves both an in-flight completion and a scheduled retry cannot mutate `suggestedTags` after the root state version or SHA-256 saved-summary digest changes.

## Manual-Only Verification

Production credentials and quota are intentionally outside automated coverage. Before enabling live authoring, an operator confirms configured Gemini/YouTube credentials, expected daily search limits, and observed approximate-count semantics without changing any private/public trailer-video lifecycle state.
