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
| State/config foundation | TRAILER-06 | T-18-01..03 | One state child, bounded quota/retry configuration, isolated temporary fixtures | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=state` | planned |
| Cache/admission and provider boundary | TRAILER-06 | T-18-04..07 | Exact normalized identity, serial cache-first lookup, daily reserve, safe errors | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=lookup` | planned |
| Summary sequencing and stale writes | TRAILER-06 | T-18-08 | Summary stays done; stale tag results cannot overwrite a newer summary | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=lookup` | planned |
| Protected manual lookup/API docs | TRAILER-06 | T-18-09..12 | Auth/no-store, strict input, redacted DTO, OpenAPI parity | `npm run build && npm run verify:episode-hashtag-authoring -- --focus=route` | planned |
| Full lifecycle | TRAILER-06 | T-18-01..14 | No network/OAuth, temporary cleanup, full route/service contract | `npm run typecheck && npm run build && npm run verify:episode-hashtag-authoring` | planned |

## Sampling Rate

- After every task: `npm run typecheck`.
- After each wave: `npm run build && npm run verify:episode-hashtag-authoring`.
- Before phase verification: run the full command above plus the existing summary runtime and quality verifiers.

## Manual-Only Verification

Production credentials and quota are intentionally outside automated coverage. Before enabling live authoring, an operator confirms configured Gemini/YouTube credentials, expected daily search limits, and observed approximate-count semantics without changing any private/public trailer-video lifecycle state.
