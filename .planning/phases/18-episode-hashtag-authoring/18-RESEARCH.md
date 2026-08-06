# Phase 18: Episode Hashtag Authoring - Research

**Researched:** 2026-08-05
**Domain:** Server-owned Gemini hashtag candidate generation with quota-aware YouTube Data API relevance-count lookup
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Automatic authoring flow
- **D-01:** After transcript completion, preserve the existing sequential flow: generate the summary with Gemini, then ask Gemini for 50 candidate YouTube hashtags grounded only in the transcript and saved summary.
- **D-02:** The backend looks up all 50 normalized candidates on YouTube and returns three suggested tags for the future admin-web YouTube-tags field.
- **D-03:** Choose the three highest-count candidates only from tags Gemini assessed as relevant to the episode, so generic high-volume tags do not win merely by reach.

#### Failure and persistence
- **D-04:** A Gemini or YouTube hashtag failure never fails transcript or summary generation. Persist an `unavailable` state with a recoverable error and retry automatically under the established job semantics.
- **D-05:** Persist suggestion state together with the existing summary state as a `suggestedTags` child object, so the protected API can recover it after reload without creating a second state file.

#### Manual relevance lookup
- **D-06:** Provide a protected single-hashtag endpoint that normalizes a manually entered tag and returns its approximate YouTube count and retrieval metadata.
- **D-07:** Admin-web calls the manual lookup after two seconds without typing. The API owns cache and rate limiting; the UI only displays the returned approximate number.

### the agent's Discretion
- Select the precise relevance threshold/ranking formula, retry backoff, cache TTL, and safe error DTO fields.
- Reuse existing sequential worker/state patterns where feasible without coupling this flow to trailer-video lifecycle code.

### Deferred Ideas (OUT OF SCOPE)

- Admin-web controls and automatic field population are owned by the sibling frontend project.
- Trailer title composition, private/public video lifecycle, playlist insertion, URL persistence, and local retention remain Phase 17.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAILER-06 | After transcript completion, generate a saved summary, then 50 grounded Gemini candidates; retrieve normalized cached/rate-limited approximate YouTube counts; return the three relevant highest-count candidates and a protected manual lookup. | Existing summary completion has an atomic state-write seam and an in-process sequential tail; Gemini supports schema-constrained JSON; YouTube `search.list` supplies an explicitly approximate `pageInfo.totalResults` value. [VERIFIED: codebase grep] [CITED: https://ai.google.dev/gemini-api/docs/structured-output] [CITED: https://developers.google.com/youtube/v3/docs/search/list] |
</phase_requirements>

## Summary

Phase 18 should extend—not replace—the episode AI workflow. The transcript worker writes the transcript state, queues one summary, and the summary service serializes executions with an in-process promise tail before atomically persisting `aiSummary: done`. Queue tag authoring only after that successful state write, inside the same serial execution, but isolate tag errors so summary completion remains `done` even when candidate generation or YouTube lookup is unavailable. [VERIFIED: codebase grep]

Use one Gemini structured-output request to produce exactly 50 candidate records. Each record must include the display tag, a deterministic relevance decision, and a bounded relevance score; locally validate JSON, normalize/dedupe tags, then request YouTube `search.list` sequentially for every surviving candidate. `pageInfo.totalResults` is expressly approximate and capped at 1,000,000, so label it as an approximate public search count rather than a precise hashtag-use count. [CITED: https://ai.google.dev/gemini-api/docs/structured-output] [CITED: https://developers.google.com/youtube/v3/docs/search/list]

The critical operational constraint is quota: official YouTube documentation currently assigns `search.list` a separate 100-call daily bucket, with each call costing one and invalid requests still costing quota. Fifty cold candidates consume half that bucket before manual lookups. Persist a normalized count cache in SQLite, permit only one sequential lookup at a time, and fail safely into `unavailable` with a retry time when cache misses cannot be admitted. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost]

**Primary recommendation:** Attach a single tag-authoring stage after the durable summary write; use Gemini JSON candidate records, a SQLite normalized-count cache and one server-side lookup lane, then persist only a sanitized `suggestedTags` snapshot and return its three relevant highest-count selections. [VERIFIED: codebase grep] [CITED: https://ai.google.dev/gemini-api/docs/structured-output]

## Project Constraints (from AGENTS.md)

- Read `.planning/PROJECT.md` and `.planning/STATE.md` before implementation. [VERIFIED: AGENTS.md]
- Read relevant `.planning/codebase/*.md` files before changing an established subsystem, and use `.planning/` as architecture source of truth. [VERIFIED: AGENTS.md]
- Keep feed generation server-side and do not move scheduling/feed rules to the frontend. [VERIFIED: AGENTS.md]
- Respect backend `AUTH_BYPASS` and frontend `authBypass` toggles. [VERIFIED: AGENTS.md]
- Prefer minimal-scope changes and verify with `npm run typecheck` and `npm run build`. [VERIFIED: AGENTS.md]
- Keep Telegram launch notification responsibilities in the services/workers named by `AGENTS.md`. [VERIFIED: AGENTS.md]
- Use the listed WSL API/web workspace paths. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Transcript-to-summary-to-tags sequencing | API / Backend | Database / Storage | Existing backend workers own transcript completion, summary queueing, and state-file writes. [VERIFIED: codebase grep] |
| Candidate JSON generation and validation | API / Backend | External Gemini boundary | The server supplies transcript and saved summary, validates structured output, and never delegates provider access to the browser. [VERIFIED: codebase grep] [CITED: https://ai.google.dev/gemini-api/docs/structured-output] |
| Normalized count cache and lookup admission | Database / Storage | API / Backend | SQLite gives restart-safe cache entries while the backend owns quota/rate policy. [VERIFIED: codebase grep] [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] |
| YouTube public search | API / Backend | External YouTube boundary | `search.list` is a backend-to-provider request; clients receive only sanitized approximate results. [CITED: https://developers.google.com/youtube/v3/docs/search/list] |
| Suggestions and manual lookup API | API / Backend | Browser / Client | Protected backend endpoints expose state/counts; the future UI only debounces and displays them. [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Existing Node built-ins (`fetch`, `URLSearchParams`, `node:sqlite`) | Node v24.17.0 available | Call documented REST endpoints, encode query parameters, and persist cache data. | The repository already uses native `fetch` and SQLite without an HTTP SDK. [VERIFIED: local command `node --version`] [VERIFIED: codebase grep] |
| Existing Gemini REST boundary | Existing `GEMINI_API_KEY` and `generateContent` implementation | Generate a structured candidate set. | The summary service already calls Gemini directly and parses non-thought candidate text. [VERIFIED: codebase grep] |
| Existing `google-auth-library` OAuth client | `^10.6.2` in manifest | Obtain the server-owned YouTube access token. | The existing YouTube metrics service caches refreshed access tokens and makes server-side Data API calls. [VERIFIED: package.json] [VERIFIED: codebase grep] |
| Existing Zod | `^4.4.3` in manifest | Validate protected manual-lookup request data and provider DTOs at boundaries. | The project already uses Zod request validation. [VERIFIED: package.json] [VERIFIED: codebase grep] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing compiled verifier scripts | Repository-native pattern | Prove state, routes, cache, retry, and no-network behavior with fakes. | Extend the summary contract verifier or add a focused verifier; do not add a runner. [VERIFIED: package.json] [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing OAuth refresh client | A separate public API-key configuration | `search.list` supports API-key samples, but reusing the established server OAuth boundary avoids a second credential type and configuration surface. [CITED: https://developers.google.com/youtube/v3/docs/search/list] [VERIFIED: codebase grep] |
| SQLite count cache | Process-memory-only cache | Memory-only results disappear on restart and cannot protect the small daily search bucket across authoring/manual calls. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] |

**Installation:** No packages should be installed. [VERIFIED: package.json] [VERIFIED: codebase grep]

## Package Legitimacy Audit

No external package installation is recommended for this phase, so the package-install gate does not apply. `google-auth-library` is an existing dependency, not a Phase 18 installation. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
Transcript worker
  │ writes transcript.txt + transcript done state
  ▼
Summary service (existing one-at-a-time tail)
  │ Gemini summary → validate → write summary.txt → persist aiSummary: done
  ▼
Tag authoring stage (same sequential lane; failure isolated)
  │ Gemini structured JSON: exactly 50 candidate records
  ▼
Local validation + normalization + dedupe
  │ relevant candidates only for final ranking
  ▼
SQLite normalized-count cache ── fresh hit ──► persisted suggestedTags snapshot
  │ miss
  ▼
one lookup lane + quota/rate admission
  │ GET YouTube search.list (server OAuth; no browser credential)
  ▼
persist cache result ──► rank relevant candidates by count ──► top three DTO
                                                      │
Protected summary/episode contract ◄──────────────────┘
Protected manual endpoint ──► same normalize/cache/admission/DTO path
```

### Recommended Project Structure

```text
src/
├── schemas/episode-draft-state.ts                 # add suggestedTags state and normalizer
├── database/repositories/youtube-hashtag-cache.repository.ts # durable normalized cache
├── services/episode-hashtag-authoring.service.ts  # Gemini, validation, ranking, safe DTO
├── services/youtube-hashtag-search.service.ts     # cache, admission, provider adapter
├── services/episode-summary.service.ts            # enqueue stage after persisted summary done
├── routes/episodes.routes.ts                      # protected snapshot and single lookup routes
├── config/env.ts                                  # bounded cache/rate/retry configuration
└── scripts/verify-episode-hashtag-authoring.ts    # fake Gemini/YouTube offline contract
```

### Pattern 1: Durable summary boundary, then isolated tag stage

**What:** Keep the existing serialized summary tail. Write `summary.txt`, then persist `aiSummary.status = "done"`; only then queue/execute tags. A tags failure must write `suggestedTags.status = "unavailable"` without changing transcript or summary status/files. [VERIFIED: codebase grep] [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md]

**When to use:** Transcript completion and explicit summary regeneration. Regeneration must increment the shared episode-state version and make earlier tag work stale. [VERIFIED: codebase grep]

**Required stale-write guard:** Capture the shared state version and a digest of the saved summary before Gemini; before each cache write and final state write, re-read the state and require the same version/digest. A later summary regeneration must suppress an older async tag result. [ASSUMED]

### Pattern 2: Schema-constrained Gemini candidate output plus local validation

**What:** Ask Gemini for a JSON object with exactly 50 `candidates`, each `{ tag, relevant, relevanceScore }`. The prompt receives only the completed transcript and saved generated summary; it must reject generic/disconnected tags, inventing entities, and terms unsupported by those sources. Gemini structured output supports JSON schema-constrained generation, but the API documentation also says schemas are a subset/large schemas can be rejected, so validate every field locally. [CITED: https://ai.google.dev/gemini-api/docs/structured-output]

**Recommended schema/validation contract:**

```ts
type GeminiTagCandidate = {
  tag: string;                 // user-facing hashtag, no count claimed by Gemini
  relevant: boolean;           // model's editorial eligibility gate
  relevanceScore: number;      // integer 0..100; deterministic tie-break only
};

type GeminiTagResponse = { candidates: GeminiTagCandidate[] };

// Reject the entire provider response unless exactly 50 candidates survive
// schema parsing; then normalize, dedupe by normalizedTag, and retain the
// highest relevanceScore record per normalized tag for lookup.
```

The requirement says all 50 normalized candidates are looked up. Therefore reject/retry malformed output that cannot provide 50 unique valid normalized candidates; do not silently send fewer queries. [VERIFIED: .planning/REQUIREMENTS.md] [ASSUMED]

### Pattern 3: Canonical normalized lookup and cache identity

**What:** Normalize once in a pure helper used by automatic and manual paths: Unicode NFKC, trim/collapse whitespace, accept one optional leading `#`, reject empty/control characters/whitespace inside the resulting tag, case-fold to a cache key, and return display form as `#${normalized}`. Build provider requests only with `URLSearchParams`; never concatenate operator input into a URL. [ASSUMED]

**Provider request:** `GET /youtube/v3/search` with `part=snippet`, `q=#${normalizedTag}`, `type=video`, `maxResults=0`, `order=relevance`, `regionCode=BR`, and `relevanceLanguage=pt`. The documented method uses `q`, allows `maxResults` from 0 through 50, supports `type`, region and relevance-language filters, and returns `pageInfo.totalResults`; `maxResults=0` keeps the response payload minimal while requesting only the page metadata. [CITED: https://developers.google.com/youtube/v3/docs/search/list]

**Count semantics:** Store and return `approximateCount = pageInfo.totalResults`, `retrievedAt`, `source: "youtube-search-list"`, `regionCode`, `relevanceLanguage`, and `cacheStatus`. Do not call it an exact number of videos tagged with the phrase: it is the API's approximate total for the configured search query. [CITED: https://developers.google.com/youtube/v3/docs/search/list]

### Pattern 4: Cache-first quota admission and retries

**What:** Store cache rows keyed by `(normalized_tag, region_code, relevance_language, search_shape_version)`, including count, retrieval timestamp, expiry timestamp, and only a safe normalized provider-error category. Cache hits never call YouTube. Use one process-wide, non-overlapping lookup lane shared by automatic and manual paths; automatic work enqueues all fifty in order, manual work can consume only a configured bounded share. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] [ASSUMED]

**Recommended operational defaults (agent discretion; confirm before locking):** Fresh success TTL: 24 hours; bounded zero-count TTL: 6 hours; one lookup at a time; maximum 90 provider calls in one Pacific-time quota day; reserve 10 calls for manual operator checks; retry transient 408/429/5xx/network failures with 1, 5, 15, and 60 minute delays, then mark `unavailable` and retry at the next safe admission window. These limits leave headroom below YouTube's documented 100-call search bucket and prevent a tag batch from exhausting manual lookup capacity. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] [ASSUMED]

**Failure boundaries:** Configuration/auth failure, non-OK provider response, malformed response, rate admission refusal, or stale state must never re-run transcription or overwrite a successful summary. Persist a short error category (`disabled`, `missing_credentials`, `unauthorized`, `quota_exhausted`, `rate_limited`, `provider_unavailable`, `invalid_provider_response`) plus `retryAt`; keep status `unavailable` and do not expose raw upstream bodies. [VERIFIED: codebase grep] [ASSUMED]

### Pattern 5: Relevance-gated ranking and safe DTO

**What:** From the fully retrieved candidate set, select only `relevant === true`; sort by descending approximate count, then descending Gemini relevance score, then canonical tag for deterministic ties; persist/return the first three. If fewer than three candidates are relevant, return fewer rather than promoting irrelevant high-count tags. [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md] [ASSUMED]

**Persisted child object (state file):**

```ts
suggestedTags: {
  status: "idle" | "pending" | "processing" | "done" | "unavailable";
  version: number;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryAt: string | null;
  errorCategory: SafeTagErrorCategory | null;
  promptVersion: string | null;
  summaryDigest: string | null;
  suggestions: Array<{
    tag: string;
    normalizedTag: string;
    approximateCount: number;
    retrievedAt: string;
    cacheStatus: "hit" | "miss";
  }>;
}
```

Persist the complete sanitized candidate/retrieval set internally only if future automatic retry needs it; expose a DTO with state, safe error/retry fields, and the top three—not raw Gemini text, prompt/transcript, access token, response bodies, cache internals, or provider URL. [VERIFIED: codebase grep] [ASSUMED]

### Anti-Patterns to Avoid

- **Parallel fifty-request fan-out:** It risks immediate quota/rate pressure and makes recovery/order nondeterministic. Use one lane. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] [ASSUMED]
- **Treating `totalResults` as an exact hashtag metric:** Google documents it as approximate and caps it at 1,000,000. [CITED: https://developers.google.com/youtube/v3/docs/search/list]
- **Letting tag failure set `aiSummary.error`:** The locked requirement explicitly makes tags advisory and recoverable. [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md]
- **Browser-side YouTube credentials or policy:** It violates the backend-owned provider boundary. [VERIFIED: .planning/PROJECT.md]
- **A second tag state file:** The locked state contract requires `suggestedTags` inside `episode.state.json`. [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md]
- **Cache key without search shape:** Region/language/query semantics change the approximate count; include them in cache identity. [CITED: https://developers.google.com/youtube/v3/docs/search/list] [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gemini JSON generation | Regex-only extraction of freeform model text | Gemini structured output plus local Zod validation | Structured output yields schema-shaped responses, while local validation handles malformed/subset limitations. [CITED: https://ai.google.dev/gemini-api/docs/structured-output] [VERIFIED: package.json] |
| YouTube relevance count | Scraping YouTube HTML/search pages | Official YouTube Data API `search.list` | The documented API returns `pageInfo.totalResults` and defines its approximation semantics. [CITED: https://developers.google.com/youtube/v3/docs/search/list] |
| OAuth refresh | A second hand-written refresh implementation | Existing `google-auth-library` boundary | The project already refreshes/caches access tokens server-side. [VERIFIED: codebase grep] |
| Throttling/cache coordination | A distributed queue/broker | SQLite cache plus one in-process lookup lane | The API is a single Node/SQLite process; no package or external infrastructure is needed for this bounded workflow. [VERIFIED: .planning/codebase/ARCHITECTURE.md] [ASSUMED] |

**Key insight:** The difficult part is not generating strings; it is preserving summary success while admitting, caching, retrying, and accurately labeling a highly quota-constrained external count lookup. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost]

## Common Pitfalls

### Pitfall 1: Spending the daily search bucket on one automatic run

**What goes wrong:** Fifty uncached candidates consume half of YouTube's documented 100 daily `search.list` calls, leaving insufficient room for regeneration/retry/manual checks. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost]

**How to avoid:** Check durable cache before admission, process in one lane, reserve a manual budget, and persist a retry time rather than immediately retrying all misses. [ASSUMED]

### Pitfall 2: Ranking generic tags by reach alone

**What goes wrong:** Generic search phrases can outrank episode-specific tags even when Gemini identifies them as editorially irrelevant. [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md]

**How to avoid:** Make model relevance an eligibility gate before count ordering; score is only a tie-breaker among eligible candidates. [ASSUMED]

### Pitfall 3: A stale async job overwrites regenerated suggestions

**What goes wrong:** The shared state version changes during a provider wait, then an old result overwrites data grounded in a newer summary. [VERIFIED: codebase grep] [ASSUMED]

**How to avoid:** Bind execution and final persistence to state version plus summary digest, and discard stale provider results. [ASSUMED]

### Pitfall 4: Claiming a precise hashtag count

**What goes wrong:** `pageInfo.totalResults` is presented as an exact count or metadata-tag inventory even though the API calls it approximate. [CITED: https://developers.google.com/youtube/v3/docs/search/list]

**How to avoid:** Use `approximateCount` in the JSON/OpenAPI schema and include query-region/language/retrieval metadata. [CITED: https://developers.google.com/youtube/v3/docs/search/list] [ASSUMED]

### Pitfall 5: Making the manual endpoint a quota bypass

**What goes wrong:** Two-second client debounce does not defend against repeated callers, reloads, or direct API use. [VERIFIED: .planning/phases/18-episode-hashtag-authoring/18-CONTEXT.md]

**How to avoid:** Require auth, normalize on the server, return cache hits, and enforce server-side rate/quota admission before external calls. [ASSUMED]

## Code Examples

### Candidate output and deterministic ranking

```ts
// Source: Gemini structured-output contract + Phase 18 decisions.
const schema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      minItems: 50,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          tag: { type: "string" },
          relevant: { type: "boolean" },
          relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["tag", "relevant", "relevanceScore"],
      },
    },
  },
  required: ["candidates"],
};

const suggestions = candidates
  .filter((candidate) => candidate.relevant)
  .sort((a, b) => b.approximateCount - a.approximateCount || b.relevanceScore - a.relevanceScore || a.normalizedTag.localeCompare(b.normalizedTag))
  .slice(0, 3);
```

Gemini supports JSON object/array schemas, but the response still requires local parsing/validation before it drives a provider request. [CITED: https://ai.google.dev/gemini-api/docs/structured-output]

### Minimal public-search count request

```ts
// Source: https://developers.google.com/youtube/v3/docs/search/list
const params = new URLSearchParams({
  part: "snippet",
  q: `#${normalizedTag}`,
  type: "video",
  maxResults: "0",
  order: "relevance",
  regionCode: "BR",
  relevanceLanguage: "pt",
});

const response = await fetch(`${config.youtube.dataBaseUrl}/search?${params}`, {
  headers: { Authorization: `Bearer ${await getServerAccessToken()}`, Accept: "application/json" },
  signal: AbortSignal.timeout(config.youtube.timeoutMs),
});
// Parse only pageInfo.totalResults and label it approximate in the DTO.
```

The example uses the existing server OAuth pattern; search documentation also includes API-key samples, but this phase should not introduce a second credential flow. [CITED: https://developers.google.com/youtube/v3/docs/search/list] [VERIFIED: codebase grep]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Freeform LLM text parsed heuristically | Schema-constrained Gemini structured output plus local validation | Current official Gemini docs | Candidate output can be a stable typed contract, but schema restrictions still require validation. [CITED: https://ai.google.dev/gemini-api/docs/structured-output] |
| Older quota assumptions such as shared 10,000-unit-only planning | Separate documented 100/day `search.list` bucket, one call each | Current official YouTube quota documentation | A fifty-candidate workflow must cache and reserve calls explicitly. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] |

**Deprecated/outdated:** Do not plan around the older `search.list = 100 units` model; the current official quota calculator documents one search quota per call in a 100/day search bucket. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | State-version plus summary-digest compare-and-set is the best local stale-write guard. | Architecture Pattern 1 | Old work could overwrite regenerated suggestions if omitted. |
| A2 | NFKC/case-fold canonicalization and the displayed `#tag` shape meet product expectations. | Architecture Pattern 3 | Manual and automatic cache keys/UX could diverge. |
| A3 | The recommended TTLs, 90/10 allocation, one lane, and exponential backoff fit operations. | Architecture Pattern 4 | Could be too restrictive or still exhaust the quota. |
| A4 | `maxResults=0` is the right minimal payload shape while preserving `pageInfo`. | Architecture Pattern 3 | Need to increase to 1 if provider behavior contradicts the documented response shape. |
| A5 | Persisting all sanitized candidates internally is necessary for retry; exposing only top three is sufficient to future UI. | Architecture Pattern 5 | State size/API contract might need adjustment. |

## Open Questions

1. **Should the first deployed run use the proposed 90 automatic / 10 manual daily-search reservation?**
   - What we know: YouTube documents a 100/day `search.list` bucket and the phase mandates 50 candidate lookups. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost]
   - What's unclear: Expected number of episode authoring runs and manual checks per day.
   - Recommendation: Start at 90/10 as a configurable default and have the operator confirm it before enabling live calls. [ASSUMED]

2. **Does the operator want display case preserved after normalization?**
   - What we know: Cache/ranking needs a canonical identity, while hashtag display could retain Gemini/manual casing.
   - What's unclear: Preferred user-facing capitalization policy.
   - Recommendation: Persist canonical lower-case lookup key and display `#` plus the validated submitted/candidate case; state this explicitly in API docs. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | API, verifier, native fetch/SQLite | ✓ | v24.17.0 | — [VERIFIED: local command `node --version`] |
| npm | build and verifier commands | ✓ | 12.0.1 | — [VERIFIED: local command `npm --version`] |
| Gemini API key/network | candidate generation | Not probed; live API calls prohibited | — | Persist `unavailable`; summary remains successful. [VERIFIED: user request] |
| YouTube Data API OAuth/network/quota | public count lookup | Not probed; live API calls prohibited | — | Cache hit or `unavailable` with automatic retry. [VERIFIED: user request] |

**Missing dependencies with no fallback:** None for offline implementation verification; production candidate/count generation needs configured provider credentials and operator-approved quota policy. [VERIFIED: user request] [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Repository-native compiled TypeScript verifier scripts; no test runner. [VERIFIED: package.json] |
| Config file | none — scripts compile through `tsc`. [VERIFIED: package.json] |
| Quick run command | `npm run typecheck` |
| Full suite command | `npm run build && npm run verify:summary-runtime-contract && npm run verify:summary-quality-contract && npm run verify:episode-hashtag-authoring` [ASSUMED] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAILER-06 | Summary success triggers one sequential tag stage only after durable summary state; tags failure preserves summary. | integration | `npm run verify:episode-hashtag-authoring -- --focus=sequence` | ❌ Wave 0 |
| TRAILER-06 | Fake Gemini returns 50 records; local validator rejects malformed/duplicate/unsupported candidate sets. | integration | `npm run verify:episode-hashtag-authoring -- --focus=gemini` | ❌ Wave 0 |
| TRAILER-06 | Fake YouTube proves cache hit/miss, approximate metadata, 50 sequential calls, relevance-gated top three, rate/quota unavailable state and retry. | integration | `npm run verify:episode-hashtag-authoring -- --focus=lookup` | ❌ Wave 0 |
| TRAILER-06 | Protected manual route has no-store, normalization, safe DTO/error, and never exposes tokens/raw provider response. | integration | `npm run verify:episode-hashtag-authoring -- --focus=route` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run build && npm run verify:episode-hashtag-authoring`
- **Phase gate:** `npm run build`, both existing summary verifiers, and the new offline verifier green before `$gsd-verify-work`. [VERIFIED: package.json] [ASSUMED]

### Wave 0 Gaps

- [ ] `src/scripts/verify-episode-hashtag-authoring.ts` — temporary media/SQLite fixtures and injected fake Gemini/YouTube adapter; it must prevent live `fetch`/OAuth calls.
- [ ] `package.json` command `verify:episode-hashtag-authoring` — build first, run only compiled development verifier, clean temporary fixtures in `finally`.
- [ ] Injectable Gemini/search/OAuth seams for direct service and router-stack verification.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth` for snapshot/manual routes; retain development `AUTH_BYPASS` semantics. [VERIFIED: AGENTS.md] [VERIFIED: codebase grep] |
| V3 Session Management | yes | Apply `Cache-Control: no-store` before auth, following protected YouTube-job routes. [VERIFIED: codebase grep] |
| V4 Access Control | yes | Server owns OAuth refresh/token and external calls; browser receives no provider credential or raw response. [VERIFIED: .planning/PROJECT.md] [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Zod length/character validation plus canonical tag normalization; URL encoding through `URLSearchParams`. [VERIFIED: package.json] [ASSUMED] |
| V6 Cryptography | no new primitive | Reuse TLS provider calls and existing OAuth token handling; do not hand-roll token/crypto code. [VERIFIED: codebase grep] |

### Known Threat Patterns for TypeScript/Express provider lookups

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Manual-query quota exhaustion | Denial of Service | Auth, cache-first lookup, one lane, bounded daily admission, retry-after state. [ASSUMED] |
| Query-string injection or malformed Unicode | Tampering | Canonicalize/validate once and build URL with `URLSearchParams`. [ASSUMED] |
| OAuth/raw upstream response disclosure | Information Disclosure | Dedicated safe DTO and normalized error category; never return header/token/body/cache internals. [VERIFIED: codebase grep] [ASSUMED] |
| Stale generated result after re-summary | Tampering | State-version and summary-digest write guard. [ASSUMED] |
| Gemini prompt injection in transcript | Tampering | Treat transcript/summary as untrusted episode content, delimit as data in prompt, require schema, and locally validate/tag-ground candidates before lookup. [ASSUMED] |

## Sources

### Primary (official documentation)

- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) — JSON schema structured output, subset limitations, and validation implications.
- [Gemini GenerateContent API reference](https://ai.google.dev/api/generate-content) — `responseMimeType`, `responseSchema`, and deprecated `responseJsonSchema` details.
- [YouTube `search.list`](https://developers.google.com/youtube/v3/docs/search/list) — request parameters, `pageInfo.totalResults`, approximation/cap, and result filters.
- [YouTube quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) — current separate 100/day `search.list` bucket, one-call cost, invalid-call cost, and Pacific-time reset.
- [YouTube OAuth guide](https://developers.google.com/youtube/v3/guides/authentication) — server OAuth/refresh-token model and no service-account support.

### Codebase (verified)

- `src/services/episode-transcription.service.ts` and `src/services/episode-summary.service.ts` — current sequential transcript/summary trigger and atomic shared-state pattern.
- `src/schemas/episode-draft-state.ts` — existing shared state-file schema/normalizer.
- `src/services/youtube-metrics.service.ts` — existing server OAuth refresh/token cache and native REST call pattern.
- `src/routes/episodes.routes.ts`, `src/scripts/verify-summary-runtime-contract.ts`, and `src/scripts/verify-youtube-trailer-job-lifecycle.ts` — protected route and offline verifier conventions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — reuse is directly established in manifest and codebase. [VERIFIED: package.json] [VERIFIED: codebase grep]
- Architecture: MEDIUM — sequential/state integration is verified; cache/admission values are flagged assumptions. [VERIFIED: codebase grep] [ASSUMED]
- Pitfalls: MEDIUM — quota/count semantics are official; sizing/ranking policy remains discretionary. [CITED: https://developers.google.com/youtube/v3/determine_quota_cost] [ASSUMED]

**Research date:** 2026-08-05
**Valid until:** 2026-08-12 for Gemini/YouTube API quota behavior; re-check before enabling live provider traffic. [ASSUMED]
