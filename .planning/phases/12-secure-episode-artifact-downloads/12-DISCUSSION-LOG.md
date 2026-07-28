# Phase 12: Secure Episode Artifact Downloads - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 12-Secure Episode Artifact Downloads
**Areas discussed:** Archive organization, Download filename, Empty availability responses, Operational logging

---

## Archive Organization

| Option | Description | Selected |
|---|---|---|
| Archive root | Put artifact files directly in the ZIP root. | |
| Episode folder | Put all files under `episode-<episodeId>/` to keep extraction organized. | ✓ |

**User's choice:** Recommended episode-folder structure.
**Notes:** Applies to every successful archive, including archives containing only one artifact.

---

## Download Filename

| Option | Description | Selected |
|---|---|---|
| Generic filename | Use a non-specific `artifacts.zip` attachment. | |
| Deterministic filename | Use `episode-<episodeId>-artifacts.zip`. | ✓ |

**User's choice:** Recommended deterministic filename.
**Notes:** Makes repeated downloads identifiable without local-path exposure.

---

## Empty Availability Responses

| Option | Description | Selected |
|---|---|---|
| Generic `404` | Use the same message for missing episode and no matching files. | |
| Distinct `404` messages | Differentiate episode absence from missing requested artifacts. | ✓ |

**User's choice:** Recommended distinct messages.
**Notes:** Existing episode with zero requested final artifacts returns `No requested artifacts found`; absent episode returns `Episode not found`.

---

## Operational Logging

| Option | Description | Selected |
|---|---|---|
| No route log | Depend on existing request logging only. | |
| Selector-only operational log | Log episode ID and requested, available, and missing selectors, never local paths. | ✓ |

**User's choice:** Recommended selector-only operational log.
**Notes:** Supports troubleshooting while retaining the filesystem security boundary.

## the agent's Discretion

- Use the smallest typed helper boundary for selector parsing, final-only resolution, and preflight availability.
- Select safe ZIP stream error handling consistent with route conventions.

## Deferred Ideas

None.
