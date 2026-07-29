# Phase 13: return-zip-progress-to-user - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 13-return-zip-progress-to-user
**Areas discussed:** ZIP preparation lifecycle, status and queue contract

---

## ZIP Preparation Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Temporary archive then separate download | Build on the server, expose progress/status, then download the ready archive. | ✓ |
| Reusable cached archive | Retain an archive indefinitely for later reuse. | |
| Same request | Return the completed ZIP in the request that starts construction. | Initially selected, then replaced after the HTTP response constraint was explained. |

**User's choice:** Accepted the preparation/status/download lifecycle after clarification that an `application/zip` response cannot also provide server-side progress events.
**Notes:** The user wants progress for server ZIP construction, not network transfer.

| Option | Description | Selected |
|--------|-------------|----------|
| Delete after download | Remove temporary output as soon as it is downloaded. | |
| Keep temporarily | Permit retries during a defined cache lifetime. | ✓ |

**User's choice:** Keep the archive for 24 hours; discard it if any selected source artifact changes.
**Notes:** Cache validity is tied to the exact selected artifacts.

## Status and Queue Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Global sequential queue | Allow only one ZIP assembly on the VPS at a time. | ✓ |
| Concurrent preparations | Build several archives in parallel. | |

**User's choice:** One global preparation at a time.
**Notes:** This protects the constrained VPS.

| Option | Description | Selected |
|--------|-------------|----------|
| Byte-based percentage | Report 0-100 from source artifact bytes processed. | ✓ |
| Indeterminate state | Show activity without a percentage. | |

**User's choice:** Byte-based percentage with separate textual states.
**Notes:** Queued, preparing, ready, failed, and expired remain explicit.

| Option | Description | Selected |
|--------|-------------|----------|
| Ready cache hit | Return an existing valid archive immediately. | ✓ |
| Always rebuild | Queue a new archive for every request. | |

**User's choice:** Reuse a valid cache for the same episode and selection.
**Notes:** The response must not enter the queue for a cache hit.

| Option | Description | Selected |
|--------|-------------|----------|
| Include queue position | Expose the request's position while queued. | ✓ |
| State only | Report queued without a position. | |

**User's choice:** Include `queuePosition`.
**Notes:** A ready response exposes a download URL only once the file exists.

## the agent's Discretion

- Exact route names, methods, persistence shape, cleanup mechanism, polling guidance, and JSON error envelopes.
- Idempotent handling of duplicate requests while an identical archive is queued or preparing.
- Backward-compatible treatment of the existing direct download endpoint.

## Deferred Ideas

None.
