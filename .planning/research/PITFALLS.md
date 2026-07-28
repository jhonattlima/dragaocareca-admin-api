# Pitfalls Research

**Domain:** Authenticated episode artifact ZIP downloads
**Researched:** 2026-07-28
**Confidence:** HIGH

## Critical Pitfalls

### Path or Scope Leakage

**What goes wrong:** A request exposes staging uploads, transcript/summary state, backups, or arbitrary filesystem content.

**How to avoid:** Accept only five selector strings, map them to fixed final paths, and add files individually. Never accept filenames, directories, globs, or a path query parameter.

**Warning signs:** The route calls `findExistingEpisodeMediaPath()`, `archive.directory()`, or `path.resolve()` on request input.

**Phase to address:** Phase 12.

### Incorrect Partial-Availability Contract

**What goes wrong:** The response silently omits files, or sends a binary ZIP when zero requested files are available.

**How to avoid:** Preflight all selected final paths before streaming. Return `404` when availability is empty; otherwise set `X-Missing-Artifacts` to the canonical missing selector list.

**Warning signs:** Availability is checked inside an archive callback after headers are sent.

**Phase to address:** Phase 12.

### Invalid ZIP Stream Error Handling

**What goes wrong:** A late filesystem/archive error calls Express `next()` after the response is already a ZIP stream, causing double-response errors or a hanging request.

**How to avoid:** Attach archive warning/error listeners before finalization; log errors, destroy the response only when headers are sent, and use `next(error)` only before streaming begins.

**Warning signs:** Archive events have no listeners or call `res.json()` after streaming starts.

**Phase to address:** Phase 12.

### Selector Ambiguity

**What goes wrong:** Empty, repeated, unknown, or array query values behave inconsistently across clients.

**How to avoid:** Treat omitted `artifacts` as all; reject empty values, repeated query keys, and unknown selectors with `400`; deduplicate valid CSV values using catalog order.

**Warning signs:** `String(req.query.artifacts)` is used without shape validation.

**Phase to address:** Phase 12.

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Accepting file paths | Path traversal and data exposure | Fixed selector catalog only. |
| Using unauthenticated static media as the export mechanism | Bypasses admin authorization | Route remains behind `requireAuth`. |
| Returning absolute paths in body/header | Internal filesystem disclosure | Return selector names only. |

## Looks Done But Isn't Checklist

- [ ] Default request uses all five selectors but includes only existing final files.
- [ ] Selected request with no existing files returns JSON `404`, not an empty ZIP.
- [ ] Selected request with one or more existing files sends a valid ZIP and `X-Missing-Artifacts` only for missing selections.
- [ ] Invalid selectors and malformed query shapes return `400`.
- [ ] ZIP entries contain canonical names under `episode-<id>/`, never absolute or staging paths.
- [ ] `AUTH_BYPASS` remains effective only under development through the existing middleware.

## Sources

- [Archiver Quickstart](https://www.archiverjs.com/docs/quickstart/) - archive warnings/errors and listener registration before finalization.
- [Node.js Streams](https://nodejs.org/api/stream.html) - failures can destroy response streams, so preflight precedes stream output.
- Existing `findExistingEpisodeMediaPath()` behavior in this repository.

---
*Pitfalls research for: episode artifact ZIP downloads*
