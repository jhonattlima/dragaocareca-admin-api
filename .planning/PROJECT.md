# dragaocareca-admin-api

## What This Is

An admin and public API service for Dragao Careca. It manages podcast episodes, media, feed generation, notifications, supporting backend workflows, and backend-owned public JSON contracts for the live/public frontend.

## Current State

- Latest shipped milestone: **v1.2 Episode AI authoring API** on 2026-07-23, with Gemini provider hardening completed on 2026-07-28
- Transcript and summary generation can use Gemini or local fallback providers, run sequentially for the 4 GB VPS target, and expose a protected read contract for future frontend reuse
- Next planning step: define the next milestone with `$gsd-new-milestone`

## Core Value

Serve the public frontend with stable backend-owned data contracts so page rendering no longer depends on legacy PHP responses or client-side reconstruction rules.

## Current Milestone: v1.3 Episode Artifact Downloads

**Goal:** Allow administrators to download the final media artifacts for one episode as a controlled ZIP archive.

**Target features:**
- Protected artifact-download endpoint with all-artifact and selected-artifact modes.
- English artifact selectors: `episode`, `trailer`, `transcript`, `image`, and `image-low`.
- ZIP response that reports partially missing requested artifacts without exposing internal paths.

## Requirements

### Validated

- Feed generation is backend-owned and already uses SQLite as the source of truth.
- Episode management, media storage, Telegram launch notifications, and transcription workflows are already implemented in this backend.
- The current public site behavior and the `dragaocareca_frontend` repo provide a concrete reference for the required public data shapes.
- Public episodes catalog and episode-detail endpoints are implemented under `/v1/public/episodes` and `/v1/public/episodes/:episodeId`.
- Public site endpoints are implemented under `/v1/public/about`, `/v1/public/contact`, `/v1/public/social`, `/v1/public/contacts`, and `/v1/public/site-config`.
- Public supporters data is implemented under `/v1/public/supporters` with `supporters` terminology and documented in the backend OpenAPI/feature docs.
- The backend can generate a suggested episode summary from transcript-only input.
- Summary generation stays sequential and lightweight enough for the 4 GB VPS target.
- Suggested summary drafts are persisted beside the episode files and kept separate from the final saved episode summary.
- Protected backend APIs expose the summary suggestion and generation state.
- Gemini summary output follows the production feed's editorial structure while using the current transcript as its only factual source.
- Phase 14 reconciles v1.3 around the authoritative protected artifact-job routes, including evidence-validated archive reuse and compiled verification.

### Active

- Deliver the v1.3 protected final episode artifact-download endpoint and verification contract.

### Out of Scope

- Moving feed generation or publication rules to the frontend — feed logic stays server-side.
- A single mega-endpoint for all public pages — the scope is distinct endpoints by concern.
- Public frontend redesign work — this milestone provides data contracts, not UI changes.
- Replacing the admin authentication model — auth bypass and admin auth behavior remain as-is.
- `admin-web` integration for pre-filling the summary field — defer to a later milestone in the frontend project.
- Finalizing Gemini as the permanent transcription provider — tracked in `.planning/STATE.md` as deferred technical debt.
- Staging, backup, and arbitrary-path downloads — v1.3 is limited to final episode artifacts.

## Context

The backend already owns episode media layout, transcript generation, summary drafting, and final media storage. v1.3 adds an administrator-only ZIP download surface over the final episode folder, with a fixed artifact allowlist and explicit partial-availability behavior.

## Constraints

- **Architecture**: Keep feed generation server-side — the frontend must not own scheduling or feed assembly rules.
- **Source of truth**: SQLite episode data remains canonical for public episode responses.
- **Compatibility**: Use the existing production site and local `dragaocareca_frontend` repo as the behavioral contract to replace.
- **Scope**: Prefer minimal backend-focused changes that can be verified with `npm run typecheck` and `npm run build`.
- **Terminology**: Use `supporters` naming in public contracts instead of `patreon`.
- **Runtime**: The Hostinger VPS target has 4 GB RAM — AI work must run sequentially and stay lightweight.
- **Integration**: Reuse the existing transcript workflow rather than redesigning transcription in this milestone.
- **Security**: Artifact download must use a fixed allowlist and final media layout only — never accept filesystem paths from a request.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace legacy public PHP responses with backend-owned JSON endpoints | The backend already owns canonical content and media rules | ✓ Good |
| Keep public data split across distinct endpoints | Matches the requested scope and avoids one oversized contract | ✓ Good |
| Treat the live site and `dragaocareca_frontend` repo as the migration reference | They define the real public data needs better than a greenfield spec | ✓ Good |
| Add a repo-native public-catalog verification script | Sandbox networking made localhost validation unreliable | ✓ Good |
| Defer transcription-engine re-evaluation out of v1.2 | Summary generation can proceed on top of the existing transcript pipeline | — Pending |
| Keep summary generation transcript-only and sequential | The 4 GB VPS target requires lightweight, backend-owned processing | ✓ Good |
| Store suggested summaries as draft artifacts beside the episode files | This preserves operator review/editability before save | ✓ Good |
| Expose summary drafts through a protected backend read endpoint | Future frontend integration can bind without rederiving workflow logic | ✓ Good |
| Use Gemini for the current transcript and summary configuration, retaining local providers as fallbacks | Remote generation avoids local model pressure on the 4 GB VPS while keeping an operational fallback | Under evaluation |
| Use the production RSS feed only as a static editorial-style reference | Preserve the established description shape without using other episodes as factual context | ✓ Good |
| Preserve `/v1/episodes/:episodeId/artifacts/jobs` as the artifact lifecycle contract | The v1.3 audit found the checked-out implementation, OpenAPI, and verifier already converge on jobs routes | ✓ Good |

## Archived Milestones

<details>
<summary>v1.1 Public frontend API responses</summary>

Goal:
Replace the legacy public PHP data sources with distinct backend JSON endpoints that serve the home page and the other public frontend pages.

Target features:
- Public episodes catalog endpoint for the home page
- Public episode detail endpoint for `/episode/:id`
- Public people/contacts endpoint for author and credit rendering
- Public site metadata endpoint for shared social/email/support links
- Public supporters endpoint for the guilda/supporters page

</details>

<details>
<summary>v1.2 Episode AI authoring API</summary>

Goal:
Add backend-only summary suggestion support on top of the existing transcript workflow.

Target features:
- Summary suggestion generation from transcript-only input
- Sequential transcript-to-summary processing inside `admin-api`
- Suggested summary persisted in the episode folder for reuse/review before episode save
- Backend API surface only for this milestone; `admin-web` integration deferred

</details>

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-28 after starting milestone v1.3*
