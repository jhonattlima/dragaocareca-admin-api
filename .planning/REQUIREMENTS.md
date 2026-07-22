# Requirements: dragaocareca-admin-api

**Defined:** 2026-07-21
**Core Value:** Serve the public frontend with stable backend-owned data contracts so page rendering no longer depends on legacy PHP responses or client-side reconstruction rules.

## v1 Requirements

### Episodes Catalog

- [ ] **CATALOG-01**: A public endpoint returns only published episodes.
- [ ] **CATALOG-02**: Published episodes are returned in reverse chronological order for the home page.
- [ ] **CATALOG-03**: Each catalog item includes the fields the home page needs for cards, search, and navigation.
- [ ] **CATALOG-04**: Catalog responses include backend-owned media and page URLs so the frontend does not reconstruct legacy paths.

### Episode Detail

- [ ] **DETAIL-01**: A public endpoint returns a single published episode by ID.
- [ ] **DETAIL-02**: Episode detail responses include summary, playback/embed fields, download/media URLs, and credit/citation data required by the episode page.
- [ ] **DETAIL-03**: Missing or unpublished episodes return a clear not-found response instead of leaking unpublished data.

### People and Site Metadata

- [ ] **PEOPLE-01**: A dedicated public endpoint returns people/contact metadata used to render authors and credits.
- [ ] **PEOPLE-02**: People data supports frontend credit resolution by member/name without the old `contacts.php` structure.
- [ ] **SITE-01**: A dedicated public endpoint returns shared public-site metadata such as email, social links, support links, and character-sheet links.
- [ ] **SITE-02**: Site metadata uses `supporters` terminology instead of `patreon`.

### Supporters

- [ ] **SUPPORT-01**: A dedicated public endpoint returns the supporters data needed by the guilda/supporters page.
- [ ] **SUPPORT-02**: Supporters responses can represent the current page content without requiring the legacy `patreon.php` endpoint.

### Verification and Documentation

- [ ] **PUBLIC-01**: The backend documents the new public endpoints and their response shapes.
- [ ] **PUBLIC-02**: Public endpoint work is verified against current frontend data needs with backend build and type checks.

## v2 Requirements

### Future Public API Work

- **PUBLIC-03**: Provide versioned public API contracts for safer frontend migrations.
- **SITE-03**: Let operators manage public people/site/supporters content through admin-managed storage instead of code or static files.
- **PUBLIC-04**: Add integration or contract tests that validate the public API against frontend fixtures automatically.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Frontend redesign | This milestone is backend contract work only |
| Single aggregated public endpoint | The requested design is distinct endpoints |
| Moving feed generation to the frontend | Feed scheduling and generation must remain server-side |
| Admin auth changes | Not required to serve public page data |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CATALOG-01 | Phase 5 | Pending |
| CATALOG-02 | Phase 5 | Pending |
| CATALOG-03 | Phase 5 | Pending |
| CATALOG-04 | Phase 5 | Pending |
| DETAIL-01 | Phase 6 | Pending |
| DETAIL-02 | Phase 6 | Pending |
| DETAIL-03 | Phase 6 | Pending |
| PEOPLE-01 | Phase 7 | Pending |
| PEOPLE-02 | Phase 7 | Pending |
| SITE-01 | Phase 7 | Pending |
| SITE-02 | Phase 7 | Pending |
| SUPPORT-01 | Phase 8 | Pending |
| SUPPORT-02 | Phase 8 | Pending |
| PUBLIC-01 | Phase 8 | Pending |
| PUBLIC-02 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-21*
*Last updated: 2026-07-21 after milestone v1.1 definition*
