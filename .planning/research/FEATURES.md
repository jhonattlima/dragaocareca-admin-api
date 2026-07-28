# Feature Research

**Domain:** Authenticated episode artifact ZIP downloads
**Researched:** 2026-07-28
**Confidence:** HIGH

## Feature Landscape

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Download all available final artifacts | Operator can retrieve one episode without assembling files manually | LOW | Omitted selector uses the five-item allowlist. |
| Download selected artifact types | Operator can request a targeted export | LOW | `artifacts` is a comma-separated list of English selectors. |
| ZIP attachment response | One transfer works for one or many files | MEDIUM | Always return a ZIP, including for one selected file. |
| Partial availability reporting | Operator learns what was unavailable without losing existing files | LOW | Return ZIP plus `X-Missing-Artifacts` when at least one requested item exists. |
| Protected route | Media must remain an admin operation | LOW | Reuse `requireAuth`, including dev-only `AUTH_BYPASS`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Canonical folder inside archive | ZIP can be extracted without polluting a destination folder | LOW | Use `episode-<id>/` as the archive entry prefix. |
| Stable selector and archive names | Admin-web can integrate without knowing local disk naming | LOW | Selector names are `episode`, `trailer`, `transcript`, `image`, `image-low`; entries use canonical filenames. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| Arbitrary directory download | Looks flexible for operators | Exposes drafts, backups, state files, and later unrelated files. | Fixed five-item final-artifact allowlist. |
| Manual archive refresh queue | Seems useful if files change | Adds job state where a fresh request naturally reads current files. | Build the ZIP for each request. |
| Silent omission of invalid selectors | Avoids error handling | A typo can produce an incomplete archive without notice. | Return `400` with supported selector names. |

## Feature Dependencies

```text
Validated selector parsing
    -> canonical final-file resolution
        -> availability preflight
            -> streamed ZIP response
                -> partial-missing response header
```

## MVP Definition

### Launch With (v1.3)

- [ ] Authenticated endpoint with default all-artifact behavior.
- [ ] Strict selected-artifact CSV parsing for `episode`, `trailer`, `transcript`, `image`, and `image-low`.
- [ ] ZIP streaming of only existing final artifacts, `404` when none exist, and `X-Missing-Artifacts` for partial results.
- [ ] OpenAPI documentation and a repo-native contract verifier.

### Add After Validation

- [ ] Admin-web download controls when that project receives its related milestone.
- [ ] Optional audit logging if downloads become an operational compliance concern.

### Future Consideration

- [ ] Large archive cache or resumable exports only if real download volume makes per-request streaming costly.

## Sources

- User-confirmed milestone scope and missing-artifact behavior, 2026-07-28.
- Existing final media layout in `src/services/episode-media-layout.service.ts`.

---
*Feature research for: episode artifact ZIP downloads*
