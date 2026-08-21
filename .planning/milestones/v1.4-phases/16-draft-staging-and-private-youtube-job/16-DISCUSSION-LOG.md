# Phase 16: Draft Staging and Private YouTube Job - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-04
**Phase:** 16-draft-staging-and-private-youtube-job
**Areas discussed:** Draft reservation, replacement during jobs, cancellation boundary, recovery and retry

---

## Draft Reservation

| Option | Description | Selected |
|--------|-------------|----------|
| Reserve before first upload | Server issues an owner-bound reservation before selection/upload; it expires and staging is cleaned. | ✓ |
| Create on Save | Delay all reservation state until episode Save. | |

**User's choice:** Agreed with the recommended assumption.
**Notes:** Reservation uses the form episode ID, expires after 24 hours, and Save promotes the matching staged media.

---

## Replacement During Job

| Option | Description | Selected |
|--------|-------------|----------|
| Mark obsolete and attempt safe cancellation | Old-source jobs cannot update the episode; retain accepted provider resources for reconciliation. | ✓ |
| Let old jobs finish normally | Old jobs may overwrite current trailer state. | |

**User's choice:** Agreed with the recommended assumption.
**Notes:** A replacement preserves the final local artifact and prevents stale external completion.

---

## Cancellation Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Report accepted-work boundary honestly | Cancellation distinguishes local stop from a provider video already accepted by YouTube. | ✓ |
| Promise rollback | Claim that cancellation always deletes external work. | |

**User's choice:** Agreed with the recommended assumption.
**Notes:** Private provider videos may require later reconciliation.

---

## Recovery and Retry

| Option | Description | Selected |
|--------|-------------|----------|
| Resume persisted work when safe | Reuse resumable session/provider video for unchanged source; create another job only when unrecoverable or replaced. | ✓ |
| Always create a new upload | Risks duplicate private videos and quota waste. | |

**User's choice:** Agreed with the recommended assumption.
**Notes:** Durable source identity and provider references are required for restart/reload safety.

---

## the agent's Discretion

- Token format, state names, cleanup mechanism, retry policy, and provider adapter structure remain implementation decisions.

## Deferred Ideas

- Explicit publication, title/hashtag APIs, URL persistence, and retention are Phase 17 concerns.
- Angular presentation and controls remain in the sibling admin-web milestone.
