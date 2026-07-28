# Phase 12: Secure Episode Artifact Downloads - Research

**Researched:** 2026-07-28  
**Domain:** Protected final-media ZIP export for Express 5 / Node.js 24  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Archive Organization
- **D-01:** Every successful response is a ZIP archive, including a request that resolves to one file.
- **D-02:** ZIP entries must live under a deterministic `episode-<episodeId>/` directory, so extracting an archive cannot scatter files into the destination directory.
- **D-03:** The download filename must be `episode-<episodeId>-artifacts.zip`.
- **D-04:** ZIP entries use canonical final filenames (`audio.mp3`, `trailer.mp3`, `transcript.txt`, `cover.jpeg`, `cover.webp`) rather than selector names or stored database paths.

### Availability and Errors
- **D-05:** An omitted `artifacts` query selects all five supported selector values; a valid CSV query selects only the requested types.
- **D-06:** If no requested final artifacts exist for an existing episode, return `404` JSON with `{ "message": "No requested artifacts found" }`.
- **D-07:** If an episode does not exist, return `404` JSON with `{ "message": "Episode not found" }`.
- **D-08:** If at least one requested final artifact exists, stream the ZIP and set `X-Missing-Artifacts` to the canonical comma-separated selector list for unavailable requested items.
- **D-09:** Malformed, empty, repeated-query, and unknown selector input returns `400`; never silently omit an invalid requested selector.

### Security and Operations
- **D-10:** Reuse the existing `requireAuth` middleware and its development-only `AUTH_BYPASS` behavior.
- **D-11:** Resolve artifacts from a fixed allowlist using final media paths only. Do not use legacy, draft, staging, backup, state, summary, directory, glob, filename, or arbitrary-path inputs.
- **D-12:** Log each download attempt with episode ID and requested, available, and missing selector names. Do not log absolute filesystem paths.

### the agent's Discretion
- Choose the smallest typed helper/service boundary that keeps selector parsing, final-only resolution, and availability preflight testable.
- Choose safe archive stream-error handling consistent with existing route error conventions.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ART-01 | Authenticated default-all ZIP download. | Fixed catalog plus preflight of all five final paths. [VERIFIED: codebase grep] |
| ART-02 | Selected English `artifacts` query values. | Strict singular CSV parser with catalog-order output. [VERIFIED: codebase grep] |
| ART-03 | Zero available is JSON 404; partial is ZIP plus header. | Preflight before headers and canonical missing list. [CITED: https://nodejs.org/api/http.html] |
| ART-04 | Reject malformed, empty, repeated, and unknown selectors. | Inspect the raw Express query shape; do not coerce with `String()`. [VERIFIED: codebase grep] |
| ART-05 | Final-only fixed paths and canonical entries. | Use only `getEpisodeMediaFinalPath()` and explicit `archive.file()` entries. [CITED: https://www.archiverjs.com/docs/archiver/] |
| ART-06 | Preserve existing admin auth/bypass behavior. | Reuse route-level `requireAuth`; the middleware gates bypass by development environment. [VERIFIED: codebase grep] |
| ART-07 | OpenAPI plus executable offline validation. | Follow existing compiled verifier-script pattern; verify direct router handling and ZIP bytes without localhost/network. [VERIFIED: codebase grep] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Keep feed generation server-side.
- Do not move scheduling/feed rules to frontend.
- Respect auth toggles: backend `.env.dev`: `AUTH_BYPASS`; frontend env: `authBypass`.
- Prefer minimal-scope changes and verify with `npm run typecheck` / `npm run build`.
- Telegram launch notifications remain in their listed backend service/worker locations.
- Use the documented WSL paths for the API and admin-web workspaces.

## Summary

This phase should add one protected `GET /v1/episodes/:episodeId/artifacts/download` route before the generic `/:episodeId` route, plus a small final-artifact helper. The helper owns the only public selector vocabulary and maps it to the existing final-media resolver; it must never receive or return a client-supplied path. [VERIFIED: codebase grep]

The route must fully validate the episode ID and query, check the SQLite episode record, and preflight every selected final file as a regular file before setting ZIP headers. This ordering is what makes the required JSON `404` deterministic. [CITED: https://nodejs.org/api/http.html] Stream only the preflighted files using Archiver's explicit `file(filepath, { name })` API, with archive event listeners attached before `finalize()`. [CITED: https://www.archiverjs.com/docs/quickstart/]

**Primary recommendation:** Implement a typed, fixed selector catalog and availability preflight service, then let the route stream only its approved results through `archiver`; add a self-contained compiled verifier rather than a new test framework. [VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authentication and development bypass | API / Backend | — | `requireAuth` is existing backend middleware. [VERIFIED: codebase grep] |
| Selector parsing and final-only allowlist | API / Backend | Database / Storage | Request values become fixed catalog entries before filesystem access. [VERIFIED: codebase grep] |
| Episode existence | Database / Storage | API / Backend | `episodeRepository.findByEpisodeId()` is the canonical lookup. [VERIFIED: codebase grep] |
| Artifact availability and ZIP file reads | Database / Storage | API / Backend | Files live under the configured episode media root and are streamed by the route. [VERIFIED: codebase grep] |
| ZIP headers and archive response | API / Backend | — | Express/Node own the HTTP response lifecycle. [CITED: https://nodejs.org/api/http.html] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `archiver` [WARNING: flagged as suspicious — verify before using.] | 8.0.0, published 2026-05-08. [CITED: https://registry.npmjs.org/archiver] | Stream explicit ZIP entries into the HTTP response. | Its documented `file()` method accepts a single filepath with an explicitly supplied archive name, and `finalize()` completes the input. [CITED: https://www.archiverjs.com/docs/archiver/] |
| Express | 5.2.1 installed. [VERIFIED: codebase grep] | Route, auth middleware, status/header handling. | Reuses the project's established protected route boundary. [VERIFIED: codebase grep] |
| Node `fs.promises` + HTTP response | Node 24.17.0 available. [VERIFIED: local command] | Regular-file preflight and response streaming. | `headersSent` permits correct branching around late stream failures. [CITED: https://nodejs.org/api/http.html] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|-------------|-------------|
| `@types/archiver` [ASSUMED] [WARNING: flagged as suspicious — verify before using.] | 8.0.0, published 2026-06-05. [CITED: https://registry.npmjs.org/@types%2farchiver] | Type declarations if the selected Archiver version does not provide compatible declarations. | Install only after checking whether `archiver@8` already satisfies TypeScript 6. [ASSUMED] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Explicit `archive.file()` calls | `archive.directory()` | Directory addition is recursive, so it violates the final-only allowlist boundary. [CITED: https://www.archiverjs.com/docs/archiver/] |
| Stream to response | Temporary ZIP file | Adds mutable on-disk archives without meeting a current caching/resume requirement. [VERIFIED: project context] |
| Dedicated helper | Reuse `findExistingEpisodeMediaPath()` | That existing helper intentionally considers staging, legacy, and draft locations, which this endpoint must exclude. [VERIFIED: codebase grep] |

**Installation:**

```bash
npm install archiver
# Only if TypeScript reports missing/incompatible declarations:
npm install -D @types/archiver
```

**Version verification:** Registry metadata confirmed `archiver@8.0.0` and `@types/archiver@8.0.0`; both need a human legitimacy checkpoint because the mandated legitimacy seam returned `SUS` with unavailable registry signals. [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `archiver` | npm [CITED: https://registry.npmjs.org/archiver] | Created 2012; latest published 2026-05-08. [CITED: https://registry.npmjs.org/archiver] | Not returned by the legitimacy seam. [VERIFIED: package-legitimacy check] | `archiverjs/node-archiver`. [CITED: https://registry.npmjs.org/archiver] | SUS: `unknown-age`, `unknown-downloads`, `no-repository` from seam. [VERIFIED: package-legitimacy check] | Flagged — planner must add `checkpoint:human-verify` before install. |
| `@types/archiver` [ASSUMED] | npm [CITED: https://registry.npmjs.org/@types%2farchiver] | Created 2016; latest published 2026-06-05. [CITED: https://registry.npmjs.org/@types%2farchiver] | Not returned by the legitimacy seam. [VERIFIED: package-legitimacy check] | DefinitelyTyped `types/archiver`. [CITED: https://registry.npmjs.org/@types%2farchiver] | SUS: `unknown-age`, `unknown-downloads`, `no-repository` from seam. [VERIFIED: package-legitimacy check] | Do not install unless compiler needs it; then human-verify first. |

**Packages removed due to [SLOP] verdict:** none. [VERIFIED: package-legitimacy check]  
**Packages flagged as suspicious [SUS]:** `archiver`, `@types/archiver`; planner inserts a human checkpoint before each install. [VERIFIED: package-legitimacy check]

The npm metadata exposes no `postinstall` value for either package. [VERIFIED: npm registry] This is not a substitute for the required human legitimacy checkpoint.

## Architecture Patterns

### System Architecture Diagram

```text
Authenticated admin request
  GET /v1/episodes/:episodeId/artifacts/download?artifacts=...
             |
             v
episodesRouter (route registered before /:episodeId) -- requireAuth
             |
             +--> validate positive ID + singular nonempty CSV selector query --400 JSON-->
             |
             +--> episodeRepository.findByEpisodeId --absent--> 404 Episode not found JSON
             |
             v
fixed typed artifact catalog (canonical selector order)
             |
             v
getEpisodeMediaFinalPath + lstat/stat regular-file preflight
             |
      +------|------+
      |             |
zero available     some available
404 No requested    headers + X-Missing-Artifacts + `archiver` explicit files
artifacts JSON                  |
                                  v
                  ZIP entries: episode-<id>/<canonical filename>
```

The route must not invoke `findExistingEpisodeMediaPath()`, directory/glob archive APIs, or a request-derived filesystem path. [VERIFIED: codebase grep]

### Recommended Project Structure

```text
src/
├── routes/episodes.routes.ts                     # protected download route and stream lifecycle
├── services/episode-artifact-download.service.ts # selector catalog, parser, final-only preflight
├── docs/openapi.ts                               # protected ZIP contract
└── scripts/verify-episode-artifact-downloads.ts  # compiled offline contract verifier
```

### Pattern 1: Fixed catalog and preflight

**What:** Export a helper whose catalog is the only mapping from public selector to `EpisodeMediaKind`, canonical filename, and archive entry name. [VERIFIED: codebase grep]

**When to use:** Always, before any response header is emitted. [CITED: https://nodejs.org/api/http.html]

**Example:**

```typescript
// Source: existing final layout + https://www.archiverjs.com/docs/archiver/
const artifactCatalog = [
  { selector: "episode", kind: "audio", filename: "audio.mp3" },
  { selector: "trailer", kind: "trailer", filename: "trailer.mp3" },
  { selector: "transcript", kind: "transcript", filename: "transcript.txt" },
  { selector: "image", kind: "cover", filename: "cover.jpeg" },
  { selector: "image-low", kind: "coverLow", filename: "cover.webp" },
] as const;

archive.file(finalPath, { name: `episode-${episodeId}/${artifact.filename}` });
```

The planner should make the parser reject an array/repeated key, non-string input, blank CSV segment, empty query, and unknown selector; preserve catalog order while deduplicating *within one valid CSV*. [VERIFIED: phase context]

### Pattern 2: Two-phase response error handling

**What:** Before piping, errors follow existing `next(error)` / JSON behavior; after piping starts, archive warnings/errors are logged without paths and the response is destroyed. [CITED: https://expressjs.com/en/guide/error-handling/]

**When to use:** Every archive stream because Express closes a connection when an error is forwarded after streaming has begun. [CITED: https://expressjs.com/en/guide/error-handling/]

**Example:**

```typescript
// Source: https://www.archiverjs.com/docs/quickstart/
archive.on("warning", (error) => console.warn("[episodes] artifact archive warning", error.code));
archive.on("error", (error) => {
  console.error("[episodes] artifact archive failed", error.message);
  if (!res.destroyed) res.destroy(error);
});
archive.pipe(res);
for (const artifact of available) archive.file(artifact.path, { name: artifact.entryName });
void archive.finalize();
```

The exact logging detail is a planner implementation choice, but it must include episode ID and selector names—not absolute paths. [VERIFIED: phase context]

### Anti-Patterns to Avoid

- **`findExistingEpisodeMediaPath()` in this route:** It has legacy, staging, draft, and stored-path fallbacks. Use `getEpisodeMediaFinalPath()` only. [VERIFIED: codebase grep]
- **`archive.directory()` / `archive.glob()`:** Both expand beyond the allowlist; directory expansion is recursive. [CITED: https://www.archiverjs.com/docs/archiver/]
- **Set headers before availability preflight:** Prevents the agreed JSON `404` when no requested file exists. [CITED: https://nodejs.org/api/http.html]
- **Call `next(error)` after archive piping:** The project error middleware attempts JSON, while Express documents that late errors close the connection. [VERIFIED: codebase grep] [CITED: https://expressjs.com/en/guide/error-handling/]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP container creation, central directory, compression, file-stream timing | A custom ZIP encoder using `zlib` | `archiver` explicit `file()` entries. [CITED: https://www.archiverjs.com/docs/archiver/] | ZIP lifecycle and central-directory correctness are not application logic. [CITED: https://www.archiverjs.com/docs/quickstart/] |
| Generic file downloader | A request-to-path resolver | Fixed typed selector catalog plus existing final path helper. [VERIFIED: codebase grep] | Keeps user input out of filesystem resolution. [VERIFIED: phase context] |
| Archive cache/job system | Temporary archive persistence or background jobs | Direct response stream. [VERIFIED: project context] | Cached/resumable archives are explicitly deferred. [VERIFIED: requirements] |

**Key insight:** The safe boundary is not the episode directory; it is the five-entry catalog. [VERIFIED: phase context]

## Common Pitfalls

### Pitfall 1: Query coercion accepts an ambiguous request

**What goes wrong:** `String(req.query.artifacts)` can turn an array/repeated key into a tolerated string. [ASSUMED]  
**Why it happens:** Express query parsing can represent repeated keys as arrays. [ASSUMED]  
**How to avoid:** Treat only `undefined` as default-all; otherwise require a single string and validate every CSV segment. [VERIFIED: phase context]  
**Warning signs:** Tests do not include `?artifacts=episode&artifacts=trailer`, `?artifacts=`, or `episode,,trailer`. [VERIFIED: requirements]

### Pitfall 2: A non-final fallback leaks an artifact

**What goes wrong:** A draft transcript, staged audio, backup, legacy filename, state JSON, or `summary.txt` enters the archive. [VERIFIED: codebase grep]  
**Why it happens:** Existing media lookup intentionally supports migration and authoring workflows. [VERIFIED: codebase grep]  
**How to avoid:** Resolve and `stat` only fixed `getEpisodeMediaFinalPath()` results; append only catalog entries. [VERIFIED: codebase grep]  
**Warning signs:** Any route code references stored media filename fields, staging/backup helpers, `path.resolve()` on request data, `directory()`, or `glob()`. [VERIFIED: codebase grep]

### Pitfall 3: Streaming failure uses the JSON error middleware

**What goes wrong:** The stream fails after headers and the app attempts a second JSON response. [VERIFIED: codebase grep]  
**Why it happens:** Existing app error middleware has no `res.headersSent` branch. [VERIFIED: codebase grep]  
**How to avoid:** Register archive listeners before piping/finalization; log safely and `res.destroy(error)` after stream start. [CITED: https://www.archiverjs.com/docs/quickstart/] [CITED: https://nodejs.org/api/http.html]  
**Warning signs:** Late archive errors call `next(error)` or `res.json()`. [CITED: https://expressjs.com/en/guide/error-handling/]

### Pitfall 4: Offline verifier depends on a listener or system ZIP tool

**What goes wrong:** Validation is flaky in the sandbox or cannot inspect entries on a fresh workstation. [VERIFIED: project state]  
**Why it happens:** Existing project verification intentionally invokes compiled router handlers directly, and this environment has no `unzip`/`zipinfo` executable. [VERIFIED: codebase grep] [VERIFIED: local command]  
**How to avoid:** Build a compiled verifier that uses an in-memory writable response and deterministic temporary media fixture; keep ZIP-entry inspection in the verifier, not production. [VERIFIED: codebase grep]  
**Warning signs:** The npm script starts the server, fetches localhost, or shells out to `unzip`. [VERIFIED: project context]

## Code Examples

### Header and archive setup after preflight

```typescript
// Source: https://www.archiverjs.com/docs/quickstart/
res.status(200);
res.setHeader("Content-Type", "application/zip");
res.setHeader("Content-Disposition", `attachment; filename="episode-${episodeId}-artifacts.zip"`);
if (missing.length > 0) res.setHeader("X-Missing-Artifacts", missing.join(","));

const archive = archiver("zip");
archive.on("warning", onArchiveWarning);
archive.on("error", onArchiveError);
archive.pipe(res);
available.forEach(({ path, entryName }) => archive.file(path, { name: entryName }));
await archive.finalize();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Resolve a media file through stored, staging, final, and legacy candidates. | Fixed-catalog final-only resolver for export. | This phase. [VERIFIED: phase context] | The downloader cannot inherit authoring/migration fallback behavior. [VERIFIED: codebase grep] |
| Manual/local HTTP validation. | Compiled direct-handler verifier. | Existing public catalog phase. [VERIFIED: project state] | Contract tests work without a network listener. [VERIFIED: codebase grep] |

**Deprecated/outdated:** `findExistingEpisodeMediaPath()` is not deprecated globally, but it is prohibited for this export path because it intentionally supports non-final locations. [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Express represents a repeated query key as an array in this configuration. | Common Pitfalls | Parser may need to handle an alternative repeated-key representation while still returning `400`. |
| A2 | `@types/archiver` is needed for the chosen Archiver release. | Standard Stack | Unnecessary install or missing compiler types; check after installing Archiver. |

## Open Questions

1. **Which ZIP-entry inspection method should the verifier use?**
   - What we know: No system `unzip` or `zipinfo` command is available, while verifier scripts are intentionally network-free. [VERIFIED: local command] [VERIFIED: codebase grep]
   - What's unclear: Whether the team accepts a narrow test-only ZIP central-directory reader or prefers a separately vetted reader dependency. [ASSUMED]
   - Recommendation: Keep the first plan's verification implementation dependency-free if it can inspect only the archive entries it generates; otherwise stop at a human checkpoint before adding any reader package. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, stream, verifier | ✓ | v24.17.0 [VERIFIED: local command] | — |
| npm | Dependency install and scripts | ✓ | 12.0.1 [VERIFIED: local command] | — |
| `archiver` | ZIP generation | ✗ (not in manifest/lockfile). [VERIFIED: codebase grep] | — | Install after human legitimacy checkpoint. |
| `unzip` / `zipinfo` | External ZIP-entry inspection | ✗ [VERIFIED: local command] | — | In-process verifier inspection; do not require system package. [ASSUMED] |

**Missing dependencies with no fallback:** none after `archiver` receives its required human review. [VERIFIED: package-legitimacy check]  
**Missing dependencies with fallback:** `unzip` / `zipinfo`; use an in-process verifier rather than network or OS tooling. [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Repository-native compiled TypeScript verifier scripts; no test runner. [VERIFIED: codebase grep] |
| Config file | none — existing scripts compile from `src/scripts/` into `dist/scripts/`. [VERIFIED: codebase grep] |
| Quick run command | `npm run verify:episode-artifact-downloads` [ASSUMED] |
| Full suite command | `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads` [VERIFIED: AGENTS.md] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ART-01 | Omitted selector yields default-all ZIP of available finals. | route contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |
| ART-02 | Valid selected CSV yields only selected available canonical entries. | route contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |
| ART-03 | Zero gives exact 404 JSON; partial ZIP has canonical missing header. | route contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |
| ART-04 | Empty, repeated, malformed, and unknown selectors give 400. | route contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |
| ART-05 | ZIP has only prefixed canonical final entries; forbidden files never appear. | archive-byte/route contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |
| ART-06 | Missing bearer is 401; dev `AUTH_BYPASS` uses existing middleware. | middleware/route contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |
| ART-07 | OpenAPI path, security, parameters, responses, and headers match route contract. | static contract | `npm run verify:episode-artifact-downloads` [ASSUMED] | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run build` [VERIFIED: AGENTS.md]
- **Per wave merge:** `npm run verify:episode-artifact-downloads` [ASSUMED]
- **Phase gate:** `npm run typecheck && npm run build && npm run verify:episode-artifact-downloads` before `$gsd-verify-work`. [VERIFIED: AGENTS.md]

### Wave 0 Gaps

- [ ] `src/scripts/verify-episode-artifact-downloads.ts` — direct router, auth, fixture, response-header, and entry assertions for ART-01 through ART-07.
- [ ] `package.json` script `verify:episode-artifact-downloads` — executes the compiled verifier with `NODE_ENV=development`.
- [ ] No framework install — preserve the established verifier pattern. [VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `requireAuth`; bypass remains development-only. [VERIFIED: codebase grep] |
| V3 Session Management | yes | Reuse bearer-token verification unchanged; no token propagation in ZIP logic. [VERIFIED: codebase grep] |
| V4 Access Control | yes | Route-level `requireAuth` before episode/media access. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Strict positive ID and singular known-selector CSV parser. [VERIFIED: requirements] |
| V6 Cryptography | no new control | No new cryptographic primitive; retain existing JWT verification. [VERIFIED: codebase grep] |

### Known Threat Patterns for Express file export

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal / arbitrary file read | Information Disclosure | Fixed selector catalog; never derive a filesystem path from request input. [VERIFIED: phase context] |
| Scope creep through recursive directory archive | Information Disclosure | Explicit `archive.file()` calls for preflighted files only. [CITED: https://www.archiverjs.com/docs/archiver/] |
| Unauthenticated download | Spoofing / Information Disclosure | Existing `requireAuth` on this route; verify 401 and dev bypass. [VERIFIED: codebase grep] |
| Error response leaks internal paths | Information Disclosure | Log only ID/selector names and return defined JSON messages/header selectors. [VERIFIED: phase context] |
| Archive failure after output | Denial of Service / Integrity | Attach archive listeners before `finalize()` and destroy already-streaming response. [CITED: https://www.archiverjs.com/docs/quickstart/] [CITED: https://nodejs.org/api/http.html] |

## Sources

### Primary (MEDIUM confidence)

- [Archiver Quickstart](https://www.archiverjs.com/docs/quickstart/) — installation, `file()`, error/warning listeners, and finalize timing.
- [Archiver API](https://www.archiverjs.com/docs/archiver/) — explicit file, recursive directory, entry-name, and finalization behavior.
- [Node.js HTTP API](https://nodejs.org/api/http.html) — `headersSent`, response stream lifecycle, and `destroy(error)`.
- [Express error handling](https://expressjs.com/en/guide/error-handling/) — behavior of errors passed after streaming begins.

### Repository Evidence

- `src/services/episode-media-layout.service.ts` — canonical final paths and the broader legacy/staging resolver.
- `src/routes/episodes.routes.ts`, `src/middleware/auth.middleware.ts`, and `src/app.ts` — router ordering, authentication, and error handling.
- `src/docs/openapi.ts`, `src/scripts/verify-public-episodes.ts`, and `package.json` — documentation and compiled verifier patterns.

### Tertiary (LOW confidence)

- No external community sources used; all remaining uncertainty is listed in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — official Archiver/Node/Express docs were checked, but the mandatory package-legitimacy seam flagged the package metadata as SUS. [VERIFIED: package-legitimacy check]
- Architecture: HIGH — final layout, route ordering, auth behavior, and existing verifier pattern were inspected in the repository. [VERIFIED: codebase grep]
- Pitfalls: HIGH — fallback media lookup and app error middleware create directly observable risks. [VERIFIED: codebase grep]

**Research date:** 2026-07-28  
**Valid until:** 2026-08-27 for codebase patterns; re-check npm metadata immediately before install. [ASSUMED]
