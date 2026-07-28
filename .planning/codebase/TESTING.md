# Testing Patterns

**Analysis Date:** 2026-07-28

## Test Framework

**Runner:**
- No real automated test runner is configured yet
- `package.json` still contains `npm test` as `echo "Error: no test specified" && exit 1`

**Assertion Library:**
- None detected

**Run Commands:**
```bash
npm run typecheck     # Static TypeScript validation
npm run build         # Compile-time validation of the backend
npm run verify:public-episodes            # Public catalog route contract
npm run verify:summary-runtime-contract   # Summary provider and draft lifecycle contract
npm run verify:summary-quality-contract   # Summary editorial-shape contract
npm run dev           # Manual runtime verification during development
```

## Test File Organization

**Location:**
- No `tests/`, `test/`, or colocated `*.test.ts` files detected

**Naming:**
- No unit, integration, or E2E naming convention exists yet in the repository

**Structure:**
```text
src/
  ...source files only...

No adjacent test files were found.
```

## Test Structure

**Current Pattern:**
- Verification is currently manual plus compile/type checks
- Operational confidence appears to come from local runs, feed snapshot comparison files in `data/feed/`, and direct endpoint usage

**Patterns:**
- Build-first validation: `npm run build`
- Type-first validation: `npm run typecheck`
- Manual scenario validation through routes such as `/health`, `/v1/feed`, `/v1/episodes`, and metrics endpoints

## Mocking

**Framework:**
- No mocking framework configured

**Practical Implication:**
- There is no established pattern for mocking SQLite, Telegram, Google auth, Spotify, or YouTube integrations
- Any future automated tests will need to introduce a runner and define a seam around env/config, DB, and external services

## Fixtures and Factories

**Test Data:**
- `data/all_episodes.json` functions as a real-world seed/import fixture
- `data/feed/reference-feed.xml`, `data/feed/feed-local.xml`, and `data/feed/feed-remote.xml` look like comparison artifacts for manual feed validation

**Location:**
- Operational/sample fixtures live under `data/`, not in a dedicated test fixture tree

## Coverage

**Requirements:**
- No coverage target or enforcement detected

**Configuration:**
- No coverage tooling or config files detected

## Test Types

**Unit Tests:**
- Not implemented

**Integration Tests:**
- Not implemented as code; current equivalent is manual endpoint exercise against a local SQLite DB

**E2E Tests:**
- Not implemented

## Common Patterns

**Current Validation Strategy:**
- Change code
- run `npm run typecheck`
- run `npm run build`
- manually exercise the affected route, worker, or asset generation path

**Highest-Risk Untested Areas:**
- media upload/promotion flow in `src/routes/episodes.routes.ts`
- worker-driven external integrations in `src/workers/*.worker.ts`
- RSS output parity and legacy `xmlSnapshot` fallback in `src/services/feed.service.ts`
- SQLite schema migrations and backward-compat copying in `src/database/connect.ts`

---

*Testing analysis: 2026-07-28*
*Update when test patterns change*
