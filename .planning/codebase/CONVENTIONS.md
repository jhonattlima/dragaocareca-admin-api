# Coding Conventions

**Analysis Date:** 2026-07-21

## Naming Patterns

**Files:**
- kebab-case module names such as `launch-notification.service.ts` and `episodes.routes.ts`
- role suffixes are meaningful: `.service.ts`, `.routes.ts`, `.worker.ts`
- root bootstrap files stay short and generic: `app.ts`, `server.ts`

**Functions:**
- camelCase for functions and helpers such as `connectDb`, `buildFeedXml`, `queueLaunchNotification`
- async functions use normal camelCase naming without `async` prefixes
- boolean predicates often read as `is*` or `assert*`

**Variables:**
- camelCase for locals and exported constants
- constant arrays sometimes use lower camelCase when they are internal module constants, for example `metricFields`
- no underscore prefix convention for privacy

**Types:**
- PascalCase for interfaces and type aliases such as `AuthUser`, `EpisodeRow`, `YouTubeMetricsSnapshot`
- no `I` prefix pattern detected

## Code Style

**Formatting:**
- double quotes are used consistently in source files
- semicolons are required
- trailing commas are minimal; formatting appears TypeScript/Prettier-compatible even without an explicit config file
- multiline objects and conditionals are preferred once lines become long

**Linting:**
- no ESLint config detected in the project root
- `npm run typecheck` and `npm run build` appear to be the main quality gates

## Import Organization

**Order:**
1. Node built-ins such as `fs`, `path`, `child_process`
2. External packages such as `express`, `multer`, `jsonwebtoken`
3. Internal relative imports

**Grouping:**
- blank line separation is used between external imports and internal imports
- type-only imports are sometimes mixed into normal imports rather than separated aggressively

**Path Aliases:**
- no TS path aliases detected; imports are relative (`../...`, `./...`)

## Error Handling

**Patterns:**
- throw `Error` with descriptive messages inside services/config helpers
- catch at route boundaries and pass to Express `next(error)`
- startup logic in `src/server.ts` catches fatal bootstrap failure and exits with code `1`

**Error Types:**
- `ZodError` receives special handling in `src/app.ts`
- auth/config problems are surfaced as plain `Error` instances with message matching
- services frequently convert external failures into structured response objects instead of crashing endpoints

## Logging

**Framework:**
- `morgan("dev")` for request logging
- `console.log`, `console.warn`, `console.error` for service and startup logging

**Patterns:**
- logs are written close to side effects and worker boundaries
- warning logs are common for non-fatal startup tasks such as cover mosaic refresh or media layout migration
- no structured logger abstraction detected

## Comments

**When to Comment:**
- comments are sparse and generally reserved for fallback/edge-case explanations
- the codebase prefers readable helper names over explanatory comments

**TODO Comments:**
- no obvious repo-wide TODO convention detected from the sampled files

## Function Design

**Size:**
- route modules can contain large helper blocks plus endpoint definitions, especially `src/routes/episodes.routes.ts`
- services are usually function-oriented rather than class-based

**Parameters:**
- object parameters are used when payloads are naturally grouped, especially in repository/service APIs
- primitive parameters are still common for simple operations like `episodeId` and `days`

**Return Values:**
- explicit object returns are favored for workflow outcomes, e.g. `{ queued, alreadyQueued }`
- guard clauses and early returns are common

## Module Design

**Exports:**
- named exports only; no default exports seen in the sampled backend modules
- modules usually expose a few focused functions or one configured object such as `config` or `app`

**Barrel Files:**
- no barrel-file pattern detected
- callers import concrete modules directly

---

*Convention analysis: 2026-07-21*
*Update when patterns change*
