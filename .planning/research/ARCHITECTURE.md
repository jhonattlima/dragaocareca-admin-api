# Architecture Research

**Domain:** Authenticated episode artifact ZIP downloads
**Researched:** 2026-07-28
**Confidence:** HIGH

## Standard Architecture

```text
Admin client
    |
GET /v1/episodes/:episodeId/artifacts/download?artifacts=...
    |
episodesRouter + requireAuth
    |
selector parser and final-artifact allowlist
    |
strict final media resolver + fs preflight
    |
Archiver ZIP stream -> HTTP response
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|---|---|---|
| `episodes.routes.ts` | Parse request, enforce auth, define HTTP status/headers, stream the ZIP | New route before the generic `/:episodeId` route. |
| Artifact catalog helper | Own selector-to-final-media mapping and availability discovery | New small service/module using `getEpisodeMediaFinalPath()` only. |
| `episode-media-layout.service.ts` | Continue owning canonical final filename conventions | Reuse existing `audio.mp3`, `trailer.mp3`, `cover.jpeg`, `cover.webp`, and `transcript.txt` paths. |
| `src/docs/openapi.ts` | Publish protected endpoint contract | Document query values, ZIP response, `404`, and missing header. |
| Verification script | Exercise route outcomes without a localhost dependency | Add a focused built-script verifier to existing verification pattern. |

## Data Flow

1. The route validates a positive integer episode ID and confirms the episode exists.
2. It parses `artifacts`; omission selects all five types, while a nonempty CSV must contain only known selectors. Duplicates are removed in canonical order.
3. For each selector, the helper calculates only its final path and checks that it is a regular file.
4. If no requested files exist, the route returns JSON `404` before writing archive headers.
5. Otherwise it sets `Content-Type: application/zip`, an attachment filename, and `X-Missing-Artifacts` if needed; Archiver appends only the preflighted files and finalizes into the response.

## Architectural Patterns

### Fixed-Catalog Export

**What:** A typed, explicit catalog maps public selector strings to internal file kinds and archive filenames.

**Why:** The current `findExistingEpisodeMediaPath()` intentionally finds staging and legacy paths, so it is unsuitable for this administrative final-artifact contract.

**Trade-off:** New artifact types require explicit catalog changes, which is a security advantage.

### Preflight Before Streaming

**What:** Determine all available/missing files before `Content-Disposition` and ZIP bytes are emitted.

**Why:** Preserves the required `404` when no requested artifacts exist and makes the missing header accurate.

**Trade-off:** A file could disappear between preflight and archive read; handle the archive error by logging and terminating the response because a second JSON response is no longer valid.

## Build Order

1. Add the typed allowlist/resolver and unit-like verifier coverage for parser and availability outcomes.
2. Add `archiver`, protected route, headers, and streaming error logging.
3. Document the endpoint in OpenAPI; run typecheck, build, and the verifier.

## Anti-Patterns

### Reusing Legacy/Stage Lookup

`findExistingEpisodeMediaPath()` may resolve drafts, staging audio, or legacy files. Use final paths directly instead.

### Archiving a Directory

Do not call a recursive directory API because `summary.txt`, state files, backups, or future files could unintentionally become downloadable.

## Sources

- [Archiver API](https://www.archiverjs.com/docs/archiver/) - explicit file entries and archive finalization.
- Existing route and media-layout modules in this repository.

---
*Architecture research for: episode artifact ZIP downloads*
