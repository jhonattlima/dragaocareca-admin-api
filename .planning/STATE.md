---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Trailer Video Publishing
current_phase: 16
current_phase_name: draft-staging-and-private-youtube-job
status: executing
stopped_at: Completed 16-04-PLAN.md
last_updated: "2026-08-05T21:55:09.364Z"
last_activity: 2026-08-04
last_activity_desc: Phase 16 execution started
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 10
  completed_plans: 9
current_plan: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-04)

**Core value:** Serve the public frontend with stable backend-owned data contracts so page rendering no longer depends on legacy PHP responses or client-side reconstruction rules.
**Current focus:** Phase 16 — draft-staging-and-private-youtube-job

## Current Position

Phase: 16 (draft-staging-and-private-youtube-job) — EXECUTING
Plan: 6 of 6
Status: Ready to execute
Last activity: 2026-08-04 — Phase 16 execution started

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Milestone v1.1]: Replace legacy PHP public responses with backend-owned JSON endpoints.
- [Milestone v1.1]: Keep public data split across distinct endpoints.
- [Milestone v1.1]: Rename public support terminology from `patreon` to `supporters`.
- [Milestone v1.2]: Keep summary generation transcript-only and sequential.
- [Milestone v1.2]: Store suggested summaries as draft artifacts beside the episode files.
- [Milestone v1.2]: Expose summary drafts through a protected backend read endpoint.
- [Post-v1.2]: Use Gemini as the current configured provider for transcript and summary generation; preserve internal/llama fallbacks.
- [Post-v1.2]: Use production-feed structure as a static summary style reference, never as factual generation context.
- [Phase ?]: Plan 12-02 may install archiver; @types/archiver remains conditional on TypeScript compiler evidence.
- [Phase ?]: Install only approved archiver; defer @types/archiver until a future import produces a compiler declaration error.
- [Phase ?]: Run artifact-download verification as a compiled development script before selector or preflight implementation.
- [Phase ?]: Use lstat so only regular canonical final files can enter artifact preflight; symlinks and directories are treated as missing.
- [Phase ?]: Accept duplicate selector values only within one valid CSV and normalize them into the fixed catalog order; reject repeated query keys.
- [Phase ?]: Use Archiver v8 ZipArchive at runtime and install @types/archiver only after compiler evidence.
- [Phase ?]: Persist selector names, generated basenames, and SHA-256-or-missing evidence only; never persist source paths.
- [Phase ?]: Revalidate the complete evidence map before ready reuse, status exposure, and archive streaming.
- [Phase ?]: Publish ZIP output only after same-directory temporary output closes and renames successfully.
- [Phase ?]: Run interrupted-job recovery only during worker startup so normal prepare/status traffic cannot requeue live work.
- [Phase ?]: Retire the legacy direct ZIP stream behind authenticated 410 JSON that names the prepare endpoint.
- [Phase ?]: Document only public preparation status fields; cache and filesystem internals remain server-only.
- [Phase ?]: Apply Cache-Control: no-store before lifecycle authentication so error JSON cannot be cached.
- [Phase ?]: Coalesce normalized artifact preparation lookup, ready revalidation, and persistence per cache key to prevent duplicate FIFO jobs.
- [Phase ?]: Prefer queued or preparing cache-key manifests before valid revalidated ready candidates so stale history never shadows active work.
- [Phase ?]: Use an anchored OpenAPI pattern for fixed nonempty selector CSV grammar and prove it against parser and route behavior.
- [Phase ?]: Require a non-zero source-byte progress sample or a strictly increasing preparing pair before accepting live assembly evidence.
- [Phase ?]: Invoke the exported worker startup path offline and always call its returned stop callback in finally.
- [Phase ?]: Preserve the current artifact jobs routes; default-all is an omitted JSON body or artifacts property, not a CSV route.
- [Phase ?]: Keep final trailer-video metadata distinct from the existing audio trailer and reserve manual-sync-required for replacements.
- [Phase ?]: Keep initial final trailer-video uploads unpublished; mark later or previously published replacements manual-sync-required.
- [Phase ?]: Promote trailer video through a final-directory temporary file and rollback copy so metadata persistence failures preserve the previous canonical artifact.
- [Phase ?]: Keep trailer-video separate from the existing audio trailer selector and fixed ZIP filename.
- [Phase ?]: Use existing canonical-final lstat and source-evidence revalidation for trailer-video artifacts.
- [Phase ?]: Use in-memory multipart streams against the direct protected route stack for offline trailer-video verification.
- [Phase ?]: Keep final-video OpenAPI and closed selector documentation under compiled verifier assertions.
- [Milestone v1.4]: New Episode uploads require an owner-bound, expiring draft reservation and stage before the matching Save promotes them to final media.
- [Milestone v1.4]: YouTube upload is a durable, API-owned private-first job; explicit public publication, title/hashtag metadata, and retention are separate concerns.
- [Phase ?]: Consume a draft only after all durable create, media, metadata, and post-create steps succeed.
- [Phase ?]: Use a conditional repository transition to bind consumption to the exact owner, episode, active state, and expiry.
- [Phase ?]: Keep the lifecycle foundation entirely local: it reads only NODE_ENV and uses no OAuth configuration or network client.
- [Phase ?]: Expose deterministic repository and worker focus branches now so later plans extend real contracts instead of deferring coverage.
- [Phase ?]: Coalesce only active jobs for the exact canonical filename, SHA-256, and byte count; source replacement obsoletes earlier active rows.
- [Phase ?]: Every worker-owned mutation includes the job source, expected revision, and lease ID in its SQL predicate.
- [Phase ?]: Repository verification initializes a temporary SQLite fixture before importing persistence, avoiding the configured application database.
- [Phase ?]: Keep private resumable sessions, provider IDs, OAuth tokens, and raw responses inside internal provider/service types.
- [Phase ?]: A local cancellation after any accepted bytes or provider video reports provider-video-retained, never a claimed remote rollback.
- [Phase ?]: Only enable the live worker with YOUTUBE_TRAILER_JOB_ENABLED=true after the Plan 16-06 human OAuth/channel checkpoint.
- [Phase ?]: Expose private trailer jobs through a safe DTO allowlist; provider/session/source internals remain service-only.

### Pending Todos

- Discuss and plan Phase 12 with `$gsd-discuss-phase 12` or `$gsd-plan-phase 12`.

### Blockers/Concerns

- Milestone v1.1 was archived as an override closeout because Phases 6-8 did not retain their original GSD phase directories and summaries.
- Phase 5 runtime validation is now captured through `npm run verify:public-episodes`, which verifies the shipped route handler without relying on sandboxed localhost networking.

### Roadmap Evolution

- Phase 13 edited: formalized ZIP preparation goal, success criteria, and ZIP-01 through ZIP-07 requirements
- Phase 14 added: reconcile the artifact-job API contract and harden its ZIP lifecycle after the v1.3 audit found documentation and verification drift.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| artifact | Missing original GSD phase directories/summaries for Phases 6-8 | acknowledged at milestone closeout | 2026-07-23 |
| verification | Milestone closeout used reconciled code/docs evidence for Phases 6-8 rather than preserved phase-level verification artifacts | acknowledged at milestone closeout | 2026-07-23 |
| feature | admin-web summary-field prefill | deferred to later frontend milestone | 2026-07-23 |
| technology | production transcription-provider evaluation (Gemini vs `whisper.cpp` / `faster-whisper`) | deferred tech debt | 2026-07-28 |

### TD-001: Validate the permanent transcription provider

The current development configuration uses `EPISODE_TRANSCRIPTION_PROVIDER=gemini`; `internal` keeps the local `whisper.cpp` path available as a fallback. Before making Gemini the permanent production default, compare quality, cost, quota, privacy, long-episode latency, and memory behavior on the 4 GB Hostinger VPS. Revisit when transcription becomes slow, unreliable, or cost-sensitive.

## Session Continuity

Last session: 2026-08-05T21:55:09.356Z
Stopped at: Completed 16-04-PLAN.md
Resume file: None

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 12 P01 | 0 | 1 tasks | 1 files |
| Phase 12 P02 | 3min | 2 tasks | 3 files |
| Phase 12 P03 | 1min | 2 tasks | 2 files |
| Phase 12 P04 | 8min | 2 tasks | 5 files |
| Phase 13-return-zip-progress-to-user P01 | 24min | 2 tasks | 2 files |
| Phase 13-return-zip-progress-to-user P02 | 4min | 2 tasks | 5 files |
| Phase 13-return-zip-progress-to-user P03 | 5min | 2 tasks | 3 files |
| Phase 13-return-zip-progress-to-user P04 | 2min | 2 tasks | 2 files |
| Phase 13-return-zip-progress-to-user P05 | 4min | 2 tasks | 2 files |
| Phase 13-return-zip-progress-to-user P06 | 5min | 2 tasks | 1 files |
| Phase 14 P01 | 25min | 2 tasks | 9 files |
| Phase 15-final-trailer-video-artifact P01 | 10min | 2 tasks | 6 files |
| Phase 15-final-trailer-video-artifact P02 | 18min | 2 tasks | 5 files |
| Phase 15-final-trailer-video-artifact P03 | 12min | 2 tasks | 4 files |
| Phase 15 P04 | 34min | 2 tasks | 5 files |
| Phase 16-draft-staging-and-private-youtube-job P01 | 4min | 2 tasks | 5 files |
| Phase 16 P05 | 3min | 2 tasks | 2 files |
| Phase 16 P02 | 8min | 2 tasks | 3 files |
| Phase 16 P03 | 11min | 2 tasks | 9 files |
| Phase 16 P04 | 5min | 2 tasks | 6 files |

## Operator Next Steps

- Discuss and plan Phase 16 with `$gsd-discuss-phase 16` or `$gsd-plan-phase 16`.
