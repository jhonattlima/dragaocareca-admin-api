# Phase 5: Public Episodes Catalog Endpoint - Research

**Researched:** 2026-07-21
**Domain:** Express/TypeScript public JSON endpoint for published episode catalog responses
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The Phase 5 endpoint should return a plain JSON array, not an `{ items, meta }` envelope.
- **D-02:** The backend should return only published episodes; the frontend should not filter unpublished items by `pubDate` anymore.
- **D-03:** The backend should return the catalog already ordered in reverse chronological order for home-page consumption.

### Link and media ownership
- **D-04:** Catalog items should include fully-qualified public URLs for page and media-related fields instead of relying on frontend path reconstruction.
- **D-05:** Public URL assembly is backend-owned contract logic and should be derived from the current media/storage conventions already managed in this repo.

### Scope and compatibility
- **D-06:** The endpoint should return the full published catalog in one response for now; pagination is deferred.
- **D-07:** The production site and the local `dragaocareca_frontend` repo are the canonical behavior references for the required catalog fields.

### the agent's Discretion
Route naming, exact field normalization, and internal mapper/service boundaries are left to the agent as long as the response remains a plain array, contains published episodes only, returns full public URLs, and fits the current home-page usage.

### Deferred Ideas (OUT OF SCOPE)
- Add pagination or cursor metadata in a later phase if catalog size or client needs justify it.
- Introduce envelope-style response metadata or public API versioning in a future public API milestone.
- Broader public-page contracts for contacts/site metadata/supporters belong to Phases 7 and 8, not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CATALOG-01 | A public endpoint returns only published episodes. | Use `episodeRepository.listPublished(now)` as the only read path for the catalog route. [VERIFIED: codebase grep] |
| CATALOG-02 | Published episodes are returned in reverse chronological order for the home page. | Preserve repository ordering from `ORDER BY datetime(pub_date) DESC, episode_id DESC`; do not reverse in the route or frontend. [VERIFIED: codebase grep] |
| CATALOG-03 | Each catalog item includes the fields the home page needs for cards, search, and navigation. | Map the array to frontend-ready card/search fields: episode id, title, pubDate, normalized guests, and fully-qualified page/media URLs. [VERIFIED: codebase grep] |
| CATALOG-04 | Catalog responses include backend-owned media and page URLs so the frontend does not reconstruct legacy paths. | Reuse backend feed/media URL conventions and emit absolute URLs from the backend contract instead of exposing storage-relative filenames. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 5 should add an unauthenticated `GET /v1/public/episodes` route that returns the output of `episodeRepository.listPublished(now)` as a plain JSON array after a backend mapper normalizes the contract for the public home page. `src/routes/feed.routes.ts` already establishes the right public pattern: thin route, repository-backed published read, and no frontend-owned publication logic. [VERIFIED: codebase grep]

The frontend compatibility target is precise: `EpisodeGrid.js` currently fetches the full legacy array from `config.api`, filters unpublished episodes with `new Date(episode.pubDate) < new Date()`, reverses the list, and passes the results into `SearchBar` and `EpisodeCard`. `SearchBar` filters by `title` and `guests[].name`, while `EpisodeCard` builds cover, trailer, and page links client-side from hardcoded config values. Phase 5 should move all of those publication, ordering, and URL-ownership responsibilities to the backend contract. [VERIFIED: codebase grep]

The safest implementation is to keep repository querying unchanged, add a dedicated public catalog mapper/service, and build absolute URLs from backend-owned configuration that already exists for feed/page/media concerns. `config.feed.baseLink`, `config.feed.audioBase`, and `config.feed.imageBase` already define public page/audio/image origins, while `app.use("/media", express.static(config.media.storageRoot))` exposes storage-root-backed media under a mount prefix when request-origin URLs are needed. [VERIFIED: codebase grep] [CITED: https://expressjs.com/en/starter/static-files/]

**Primary recommendation:** Implement `GET /v1/public/episodes` as a thin public router backed by `episodeRepository.listPublished(now)` plus a dedicated mapper that returns absolute `pageUrl`, `audioUrl`, `coverUrl`, and `trailerUrl` fields and normalizes `guests` into `{ name }[]`. [VERIFIED: codebase grep] [ASSUMED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Publication filtering | API / Backend | Database / Storage | Published-vs-scheduled logic already lives in repository/feed reads and must not remain in the frontend. [VERIFIED: codebase grep] |
| Reverse chronological ordering | Database / Storage | API / Backend | The repository already sorts by `pub_date DESC, episode_id DESC`, so the backend should pass through canonical order. [VERIFIED: codebase grep] |
| Public contract mapping | API / Backend | — | Field normalization and URL assembly are contract concerns, not frontend reconstruction logic. [VERIFIED: codebase grep] |
| Media URL ownership | API / Backend | CDN / Static | The backend owns the public URL fields, while static media delivery remains under `/media` or feed-configured public bases. [VERIFIED: codebase grep] [ASSUMED] |
| Cover/audio/trailer file serving | CDN / Static | API / Backend | Express static serving exposes media files, but the API chooses which absolute URLs to publish. [VERIFIED: codebase grep] [CITED: https://expressjs.com/en/starter/static-files/] |
| Home-page search inputs | API / Backend | Browser / Client | The browser still performs the interactive search, but the backend must supply normalized searchable fields. [VERIFIED: codebase grep] |

## Project Constraints (from AGENTS.md)

- Read `docs/SDD.md` before implementation; it is the source of truth for architecture and constraints. [VERIFIED: codebase grep]
- Keep feed generation server-side. [VERIFIED: codebase grep]
- Do not move scheduling/feed rules to the frontend. [VERIFIED: codebase grep]
- Respect auth toggles: backend `.env.dev` uses `AUTH_BYPASS`, frontend env uses `authBypass`. [VERIFIED: codebase grep]
- Prefer minimal-scope changes and verify with `npm run typecheck` and `npm run build`. [VERIFIED: codebase grep]
- Telegram launch notifications stay in the backend service files already called out in AGENTS.md; this phase should not disturb them. [VERIFIED: codebase grep]
- Use the WSL workspace layout paths documented in AGENTS.md. [VERIFIED: codebase grep]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | `5.2.1` [VERIFIED: codebase grep] | Mount the new unauthenticated public router and return JSON responses. [VERIFIED: codebase grep] | The app already mounts all HTTP surface through Express routers. [VERIFIED: codebase grep] |
| `zod` | `4.4.3` [VERIFIED: codebase grep] | Keep request/response-adjacent validation patterns consistent if a response schema helper is added later. [VERIFIED: codebase grep] | Zod is already the repo’s validation standard. [VERIFIED: codebase grep] |
| `swagger-jsdoc` | `6.3.0` [VERIFIED: codebase grep] | Extend `/docs` and `/docs.json` with the public catalog contract. [VERIFIED: codebase grep] | OpenAPI is already generated centrally from `src/docs/openapi.ts`. [VERIFIED: codebase grep] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `helmet` | `8.2.0` [VERIFIED: codebase grep] | Preserve default public-route response hardening already applied app-wide. [VERIFIED: codebase grep] | No special action; new public routes inherit it automatically. [VERIFIED: codebase grep] |
| `cors` | `2.8.6` [VERIFIED: codebase grep] | Continue allowing frontend fetches through existing app-wide CORS. [VERIFIED: codebase grep] | No per-route customization is needed in this phase unless frontend deployment shows a stricter origin policy requirement. [ASSUMED] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dedicated public mapper/service | Reuse admin `EpisodeRow` payload directly | Faster, but leaks storage-relative fields (`fileName`, `coverLowFileName`, `trailerFileName`) and preserves frontend reconstruction responsibility. [VERIFIED: codebase grep] |
| `/v1/public/episodes` | `/v1/catalog/episodes` | `/v1/public/episodes` leaves a cleaner Phase 6 path for `/v1/public/episodes/:episodeId`. [ASSUMED] |
| Feed-configured/public-API URL assembly | Direct filesystem-relative `/media/...` strings everywhere | `/media/...` alone is not fully-qualified and shifts origin ownership back to consumers. [VERIFIED: codebase grep] |

**Installation:**
```bash
# No new packages recommended for Phase 5.
```

**Version verification:** The recommended implementation reuses dependencies already declared in `package.json`; no additional package install is required in this phase. [VERIFIED: codebase grep]

## Package Legitimacy Audit

No new external packages are recommended for Phase 5; this phase should be implemented on the existing dependency set. [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| none | — | — | — | — | — | Reuse current stack only. [VERIFIED: codebase grep] |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
Browser home page
  -> GET /v1/public/episodes
  -> public episodes router
  -> catalog mapper/service
  -> episodeRepository.listPublished(now)
  -> SQLite episodes table
  -> mapped public catalog array
  -> JSON response

Mapped item URLs
  -> config.feed.baseLink / audioBase / imageBase
  -> or request-origin + /media/<relative-path> for media without feed env coverage
  -> frontend renders cards/search/navigation without extra filtering or URL reconstruction
```

The data flow above keeps publication filtering and URL ownership inside the backend, while the frontend remains only a consumer of the plain array contract. [VERIFIED: codebase grep]

### Recommended Project Structure
```text
src/
├── routes/public-episodes.routes.ts      # new public catalog HTTP surface
├── services/public-episode-catalog.service.ts  # catalog mapping + absolute URL assembly
├── docs/openapi.ts                       # catalog endpoint + array schema docs
├── app.ts                                # router registration
└── database/repositories/episode.repository.ts # existing published read reused as-is, unless a tiny projection helper is added
```

### Recommended Route Shape

Use `GET /v1/public/episodes` for the Phase 5 catalog endpoint. This matches the repo’s `/v1/...` route convention, keeps the response concern-specific, and leaves a natural Phase 6 expansion path for `GET /v1/public/episodes/:episodeId`. [VERIFIED: codebase grep] [ASSUMED]

### Pattern 1: Thin Public Route + Dedicated Catalog Mapper
**What:** Keep the router limited to calling `episodeRepository.listPublished(now)` and serializing mapper output. [VERIFIED: codebase grep]
**When to use:** Use this pattern whenever a public route needs a different contract than the admin repository shape. [VERIFIED: codebase grep]
**Example:**
```typescript
// Source: repo pattern from src/routes/feed.routes.ts + official Express router docs
publicEpisodesRouter.get("/", async (_req, res, next) => {
  try {
    const episodes = episodeRepository.listPublished(new Date());
    res.json(episodes.map((episode) => mapEpisodeToPublicCatalogItem(episode)));
  } catch (error) {
    next(error);
  }
});
```
[VERIFIED: codebase grep] [CITED: https://expressjs.com/en/5x/api/router/]

### Pattern 2: Explicit Field Mapping Instead of Pass-Through Rows
**What:** Map `EpisodeRow` to a catalog-specific DTO instead of exposing repository fields directly. [VERIFIED: codebase grep]
**When to use:** Use this for any route where `EpisodeRow` contains internal filenames or unused admin-only properties. [VERIFIED: codebase grep]
**Example:**
```typescript
type PublicEpisodeCatalogItem = {
  episodeId: number;
  title: string;
  summary: string;
  pubDate: string;
  guests: Array<{ name: string }>;
  pageUrl: string;
  audioUrl: string | null;
  coverUrl: string | null;
  trailerUrl: string | null;
};
```
[ASSUMED]

### Concrete Field Mapping Recommendation

| Public field | Source | Mapping rule |
|--------------|--------|--------------|
| `episodeId` | `EpisodeRow.episodeId` | Copy directly. [VERIFIED: codebase grep] |
| `title` | `EpisodeRow.title` | Copy directly. [VERIFIED: codebase grep] |
| `summary` | `EpisodeRow.summary` | Copy directly; harmless for card/search consumers and useful for later reuse. [VERIFIED: codebase grep] [ASSUMED] |
| `pubDate` | `EpisodeRow.pubDate` | Copy repository ISO string directly. [VERIFIED: codebase grep] |
| `guests` | `EpisodeRow.guests` | Normalize to `{ name }[]`; if a string contains structured JSON, parse the name before emitting. [VERIFIED: codebase grep] [ASSUMED] |
| `pageUrl` | `config.feed.baseLink` + `episodeId` | Build an absolute public episode page URL from the same base link used by feed items. [VERIFIED: codebase grep] |
| `audioUrl` | `config.feed.audioBase` + `fileName` fallback | Reuse feed audio URL rules; return `null` when no audio file is published. [VERIFIED: codebase grep] [ASSUMED] |
| `coverUrl` | `config.feed.imageBase` + `coverLowFileName` preferred | Prefer low cover asset for catalog cards; fall back to `coverFileName` only if low cover is absent. [VERIFIED: codebase grep] [ASSUMED] |
| `trailerUrl` | request origin + `/media/${trailerFileName}` | Build an absolute public trailer URL when a trailer exists; this is the Phase 5 resolved fallback because no trailer-specific public base exists yet. [VERIFIED: codebase grep] |

### Likely Touched Files

| File | Why it should change |
|------|----------------------|
| `src/app.ts` | Register the new public router under `/v1/public/episodes`. [VERIFIED: codebase grep] [ASSUMED] |
| `src/routes/public-episodes.routes.ts` | New route file following the same thin-router pattern as `feed.routes.ts`. [VERIFIED: codebase grep] [ASSUMED] |
| `src/services/public-episode-catalog.service.ts` | Central place for field normalization and absolute URL assembly. [ASSUMED] |
| `src/docs/openapi.ts` | Document the new array response in `/docs` and `/docs.json`. [VERIFIED: codebase grep] |
| `src/database/repositories/episode.repository.ts` | Optional only if the guest-name parsing helper is extracted for reuse instead of duplicated. [VERIFIED: codebase grep] [ASSUMED] |

### Anti-Patterns to Avoid

- **Passing `EpisodeRow` through unchanged:** This leaks filename-oriented fields and preserves frontend reconstruction logic. [VERIFIED: codebase grep]
- **Filtering again in the frontend:** Publication filtering already exists in `listPublished(now)` and must remain backend-owned. [VERIFIED: codebase grep]
- **Calling `listAll()` for the public route:** That would expose scheduled/unpublished episodes. [VERIFIED: codebase grep]
- **Building page/media URLs inside React components:** That repeats the legacy `config.js` coupling this milestone is replacing. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Publication filtering | Custom date filtering in React | `episodeRepository.listPublished(now)` | The repository already encodes the correct SQL filter and sort order. [VERIFIED: codebase grep] |
| Audio/page public URLs | A second URL scheme separate from feed config | `config.feed.audioBase` and `config.feed.baseLink` | Those values already represent public-facing backend-owned origins. [VERIFIED: codebase grep] |
| Media path discovery | Manual filename guessing in the mapper | Existing media-layout conventions from `episode-media-layout.service.ts` and stored filenames | The codebase already centralizes canonical relative paths and legacy fallbacks. [VERIFIED: codebase grep] |
| Static asset serving | Per-route file streaming code | Existing `app.use("/media", express.static(...))` mount | Express already serves mounted static assets correctly by prefix. [VERIFIED: codebase grep] [CITED: https://expressjs.com/en/starter/static-files/] |

**Key insight:** Phase 5 is primarily contract mapping work; the backend already owns the published-read logic, feed page/audio/image URL conventions, and static media exposure needed to replace the legacy frontend reconstruction path. [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Unpublished Data Leakage
**What goes wrong:** Scheduled episodes appear in the public catalog if the route reads from `listAll()` or an admin endpoint shape. [VERIFIED: codebase grep]
**Why it happens:** The current frontend compensates for the legacy source by filtering `pubDate` client-side, so it is easy to forget that the public API must own this rule. [VERIFIED: codebase grep]
**How to avoid:** Read only through `episodeRepository.listPublished(new Date())` and do not re-query with a broader dataset later in the route. [VERIFIED: codebase grep]
**Warning signs:** A future-dated episode appears in the first response page or in a manual `curl` against the endpoint. [ASSUMED]

### Pitfall 2: Media URL Ownership Drift
**What goes wrong:** The API returns `fileName`-style relative paths and the frontend starts rebuilding URLs again. [VERIFIED: codebase grep]
**Why it happens:** Repository rows store storage-relative filenames, while the legacy frontend expects fully-qualified cover/trailer/audio paths from hardcoded config. [VERIFIED: codebase grep]
**How to avoid:** Emit only absolute public URLs in the response contract and keep filename fields internal. [VERIFIED: codebase grep]
**Warning signs:** The frontend needs `config.episodeImg`, `config.episodeFiles`, or `config.episodeTrailer` after switching to the new endpoint. [VERIFIED: codebase grep]

### Pitfall 3: Guest Search Regressions
**What goes wrong:** Search stops matching guest names because the API returns raw string arrays while the frontend still expects `guest.name`. [VERIFIED: codebase grep]
**Why it happens:** `SearchBar.js` explicitly checks `episode.guests?.some(guest => guest.name?.toLowerCase()...)`. [VERIFIED: codebase grep]
**How to avoid:** Normalize guest output to objects with at least a `name` property. [VERIFIED: codebase grep] [ASSUMED]
**Warning signs:** Title search works but guest-name search returns no hits. [ASSUMED]

## Code Examples

Verified patterns from official sources and this codebase:

### Documenting the Plain Array Response in OpenAPI
```typescript
// Source: https://spec.openapis.org/oas/v3.0.4.html
"/v1/public/episodes": {
  get: {
    tags: ["Public"],
    summary: "Published public episode catalog",
    responses: {
      "200": {
        description: "Published episodes in reverse chronological order",
        content: {
          "application/json": {
            schema: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeCatalogItem" },
            },
          },
        },
      },
    },
  },
}
```
[CITED: https://spec.openapis.org/oas/v3.0.4.html]

### Mounting Static Media on a Public Prefix
```typescript
// Source: https://expressjs.com/en/starter/static-files/
app.use("/media", express.static(config.media.storageRoot));
```
[VERIFIED: codebase grep] [CITED: https://expressjs.com/en/starter/static-files/]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Frontend fetches legacy `index.php`, filters unpublished items locally, reverses locally, and rebuilds URLs from hardcoded config. [VERIFIED: codebase grep] | Backend returns a public plain-array contract that is already published-only, ordered, and URL-complete. [ASSUMED] | Milestone v1.1 planning on 2026-07-21 defines this migration direction. [VERIFIED: codebase grep] | Removes duplication, reduces leakage risk, and turns the frontend into a simple consumer. [ASSUMED] |

**Deprecated/outdated:**
- Client-side publication filtering for the home catalog is outdated once Phase 5 ships. [VERIFIED: codebase grep] [ASSUMED]
- Client-side path reconstruction from `config.episodeImg`, `config.episodeFiles`, and `config.episodeTrailer` is outdated once the API returns absolute URLs. [VERIFIED: codebase grep] [ASSUMED]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `/v1/public/episodes` is the best final route shape versus another public prefix. | Architecture Patterns | Low; route name can still change before implementation. |
| A2 | Catalog `guests` should be normalized to `{ name }[]` instead of keeping raw strings. | Architecture Patterns / Common Pitfalls | Medium; frontend search compatibility depends on this. |
| A3 | `coverUrl` should prefer the low-resolution cover asset for home-page cards. | Architecture Patterns | Low; fallback to high-res cover is still viable. |
| A4 | `trailerUrl` should be built from request origin + `/media/...` because feed config has no trailer base. | Architecture Patterns | Medium; production media origin may need an env-backed override later. |
| A5 | `summary` is worth including in the catalog contract even though current card/search code does not need it immediately. | Architecture Patterns | Low; removing it later is easy. |

## Resolved Questions

1. **Trailer URL origin for Phase 5**
   - Status: RESOLVED for this phase.
   - Resolution: Build absolute trailer URLs from the request origin plus `/media/${trailerFileName}` because no trailer-specific public base exists yet.
   - Scope note: A dedicated trailer public base can be evaluated in a later phase only if deployment proves the `/media` origin is insufficient; it is not part of Phase 5.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build/typecheck and runtime parity | ✓ | `v24.17.0` [VERIFIED: local command] | — |
| npm | Verification commands | ✓ | `12.0.1` [VERIFIED: local command] | — |

**Missing dependencies with no fallback:**
- none

**Missing dependencies with fallback:**
- none

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected; only TypeScript compile verification is configured. [VERIFIED: codebase grep] |
| Config file | none — see Wave 0. [VERIFIED: codebase grep] |
| Quick run command | `npm run typecheck` [VERIFIED: codebase grep] |
| Full suite command | `npm run build` [VERIFIED: codebase grep] |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CATALOG-01 | Only published episodes are returned. | automated route smoke + manual API review | `npm run typecheck`, `npm run build`, and the route smoke command recorded in `05-VALIDATION.md`. [VERIFIED: codebase grep] | ✅ `05-VALIDATION.md` |
| CATALOG-02 | Episodes are reverse chronological. | automated route smoke + manual API review | `npm run typecheck`, `npm run build`, and the route smoke command recorded in `05-VALIDATION.md`. [VERIFIED: codebase grep] | ✅ `05-VALIDATION.md` |
| CATALOG-03 | Item fields satisfy card/search/navigation needs. | automated contract check + manual frontend contract review | `npm run typecheck`, `npm run build`, and the route smoke command recorded in `05-VALIDATION.md`; field review must cover `episodeId`, `title`, `pubDate`, `guests[].name`, `pageUrl`, `coverUrl`, `trailerUrl`, and `audioUrl`. [VERIFIED: codebase grep] | ✅ `05-VALIDATION.md` |
| CATALOG-04 | Response includes backend-owned page/media URLs. | automated route smoke + manual API review | `npm run typecheck`, `npm run build`, and the route smoke command recorded in `05-VALIDATION.md`. [VERIFIED: codebase grep] | ✅ `05-VALIDATION.md` |

### Sampling Rate
- **Per task commit:** `npm run typecheck` [VERIFIED: codebase grep]
- **Per wave merge:** `npm run build` [VERIFIED: codebase grep]
- **Phase gate:** `npm run typecheck` and `npm run build` green, plus manual JSON-shape verification against current frontend usage. [VERIFIED: codebase grep] [ASSUMED]

### Phase 5 Validation Artifact
- `05-VALIDATION.md` is required before execution and is the phase-level source of truth for automated commands plus manual contract review steps.
- Phase 5 stays within the existing repo toolchain: `npm run typecheck`, `npm run build`, and a local route smoke command. Adding a new test runner is out of scope for this phase.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Endpoint is intentionally public; do not add auth middleware. [VERIFIED: codebase grep] [ASSUMED] |
| V3 Session Management | no | No session state is introduced by this route. [VERIFIED: codebase grep] [ASSUMED] |
| V4 Access Control | yes | Publication filtering in `listPublished(now)` is the access-control boundary for scheduled/unpublished episodes. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | The route has no body/query/path inputs in Phase 5, so the main validation control is contract mapping with no user-supplied fields. [VERIFIED: codebase grep] [ASSUMED] |
| V6 Cryptography | no | This phase adds no crypto behavior. [VERIFIED: codebase grep] [ASSUMED] |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Scheduled episode disclosure | Information Disclosure | Read only through `listPublished(now)` and never reuse `listAll()` for public output. [VERIFIED: codebase grep] |
| Internal filename leakage | Information Disclosure | Emit absolute public URLs only; keep relative filenames internal. [VERIFIED: codebase grep] |
| Broken media origin assumptions | Tampering / Availability | Centralize URL assembly in one mapper/service instead of spreading it across React components. [VERIFIED: codebase grep] [ASSUMED] |

## Sources

### Primary (HIGH confidence)
- Project codebase files listed in Phase 5 context, especially `src/app.ts`, `src/routes/feed.routes.ts`, `src/database/repositories/episode.repository.ts`, `src/services/feed.service.ts`, `src/services/episode-media-layout.service.ts`, and the referenced frontend catalog files. [VERIFIED: codebase grep]
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, and `.planning/phases/05-public-episodes-catalog-endpoint/05-CONTEXT.md`. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)
- Express static files guide: https://expressjs.com/en/starter/static-files/ [CITED: https://expressjs.com/en/starter/static-files/]
- Express Router API: https://expressjs.com/en/5x/api/router/ [CITED: https://expressjs.com/en/5x/api/router/]
- OpenAPI Specification v3.0.4: https://spec.openapis.org/oas/v3.0.4.html [CITED: https://spec.openapis.org/oas/v3.0.4.html]

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all recommended implementation pieces reuse declared project dependencies and existing route/config patterns. [VERIFIED: codebase grep]
- Architecture: HIGH - the route/repository/frontend interaction points are directly visible in the codebase. [VERIFIED: codebase grep]
- Pitfalls: HIGH - the main regression risks are directly observable from the current frontend filter/search/reconstruction logic and the repository’s broader read methods. [VERIFIED: codebase grep]

**Research date:** 2026-07-21
**Valid until:** 2026-08-20

## RESEARCH COMPLETE

Planner-ready research artifact written for Phase 5. [VERIFIED: local file]
