# Phase 17: Trailer Metadata, Publication and Retention - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-09
**Phase:** 17-trailer-metadata-publication-and-retention
**Areas discussed:** publication transaction, repeated publication, local replacement behavior

---

## Publication Transaction

| Option | Description | Selected |
|--------|-------------|----------|
| Publish first | Make the video public, then insert it into the playlist and compensate on failure | |
| Playlist first while private | Insert the private video into the playlist, then make it public only after insertion succeeds | ✓ |

**User's choice:** Use the recommended playlist-first sequence.
**Notes:** A failed playlist operation must not leave a public video. Failures remain recoverable.

## Repeated Publication

| Option | Description | Selected |
|--------|-------------|----------|
| Create a new provider video | Treat every request as a new upload/publication | |
| Reconcile the existing provider video | Reuse the same provider video and avoid duplicates on repeated requests | ✓ |

**User's choice:** Reconcile the same provider video.
**Notes:** Publication is explicit and idempotent from the API perspective.

## Local Replacement Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Replace the published provider video automatically | Immediately synchronize a local replacement to YouTube | |
| Preserve the published video and require manual sync | Mark the replacement `manual-sync-required` and require the private-ready workflow before publication | ✓ |

**User's choice:** Preserve the existing published video and use `manual-sync-required` for replacements.
**Notes:** The replacement must not become public implicitly.

## the agent's Discretion

- Define the exact protected route and DTO shape for publication responses.
- Define provider reconciliation, failure categories, persistence, and cleanup mechanics while preserving the locked invariants.

## Deferred Ideas

- Automatic and manual hashtag authoring belongs to Phase 18 and remains independent from trailer publication.
- Admin-web controls for publication, title editing, and hashtags belong to the sibling frontend project.
