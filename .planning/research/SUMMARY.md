# Project Research Summary

**Project:** dragaocareca-admin-api
**Domain:** Authenticated episode artifact ZIP downloads
**Researched:** 2026-07-28
**Confidence:** HIGH

## Executive Summary

The milestone is a small protected export surface over media that the API already owns. The correct approach is a single streamed ZIP endpoint, backed by an explicit selector catalog rather than an episode-directory download. This preserves the existing final-media layout and prevents exposure of state, staging, backup, or arbitrary files.

Use `archiver` to add each preflighted final artifact directly to the HTTP response. The principal implementation risk is response timing: validate selector shape and file availability before writing ZIP headers so the endpoint can return the agreed `404` when no requested artifact exists. For partial results, stream the available files and expose only selector names through `X-Missing-Artifacts`.

## Key Findings

### Recommended Stack

Add `archiver` with its TypeScript declarations. Its documented file-level API and native stream output fit Express without temporary archives. Node's HTTP response is writable, so the ZIP is sent as it is assembled. See [STACK.md](STACK.md).

**Core technologies:**
- `archiver` - explicit ZIP file entries streamed to the response.
- Existing Express `requireAuth` - maintains current admin auth and dev-only bypass behavior.
- Existing final-media layout helper - supplies canonical paths without legacy or staging fallback.

### Expected Features

**Must have:**
- Default download of all available final artifacts.
- Strict selected download through `artifacts=episode,trailer,transcript,image,image-low`.
- ZIP attachment for every successful request.
- `404` if none requested artifacts exist; `X-Missing-Artifacts` on a partial ZIP.
- OpenAPI and an executable contract verifier.

**Defer:**
- Admin-web controls, download audit records, archive caching, resumable export, and any non-final asset types.

### Architecture Approach

Put the HTTP contract in `episodes.routes.ts`, but isolate the typed selector catalog and strict final-file availability calculation in a small service/helper. The route must be registered before the generic `/:episodeId` handler, use `requireAuth`, and append only individual canonical files. See [ARCHITECTURE.md](ARCHITECTURE.md).

### Critical Pitfalls

1. **Path and scope leakage** - never derive a filesystem path from request input or archive a directory.
2. **Wrong zero/partial behavior** - preflight before ZIP headers; `404` only when zero requested artifacts exist.
3. **Late stream failures** - register Archiver error handling before finalization and do not attempt JSON output after stream bytes start.
4. **Ambiguous query parsing** - reject unknown, empty, and repeated selector values; use canonical ordering after deduplication.

## Implications for Roadmap

### Phase 12: Secure Artifact Download Contract
**Rationale:** The requirements form one cohesive route-level capability with a single security boundary and no new data model.
**Delivers:** Final-only allowlist, authenticated ZIP endpoint, partial-missing header, OpenAPI, and contract verification.
**Avoids:** Directory recursion, legacy/staging resolution, and post-header error responses.

### Phase Ordering Rationale

- Parsing and strict final-file resolution must exist before streaming so the `404` and missing-header contracts are deterministic.
- Documentation and verification belong in the same phase because they protect a public admin API contract from selector drift.

### Research Flags

Phases with standard patterns:
- **Phase 12:** Express streaming ZIP with a fixed catalog is well documented; implementation should validate the installed `archiver` type package against the project Node runtime.

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | Archiver and Node streaming APIs were verified against official documentation. |
| Features | HIGH | Scope and error behavior were explicitly confirmed by the user. |
| Architecture | HIGH | Existing final/staging/legacy media layout was inspected. |
| Pitfalls | HIGH | Risks follow directly from the existing fallback resolver and HTTP stream semantics. |

## Sources

### Primary
- [Archiver Quickstart](https://www.archiverjs.com/docs/quickstart/) - installation and streaming file ZIPs.
- [Archiver API](https://www.archiverjs.com/docs/archiver/) - file entry and finalization APIs.
- [Node.js Streams](https://nodejs.org/api/stream.html) - HTTP responses as writable streams and stream failure behavior.

### Repository Evidence
- `src/services/episode-media-layout.service.ts` - final, staging, legacy, and draft media paths.
- `src/routes/episodes.routes.ts` - authenticated route conventions.

---
*Research completed: 2026-07-28*
*Ready for roadmap: yes*
