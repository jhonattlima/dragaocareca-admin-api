# Phase 12: Secure Episode Artifact Downloads - Pattern Map

**Mapped:** 2026-07-28  
**Files analyzed:** 6 new/modified files (including lockfile)  
**Analogs found:** 5 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/routes/episodes.routes.ts` | route | request-response, streaming, file-I/O | same file: protected episode GET routes at lines 383-425 | exact role; streaming extension |
| `src/services/episode-artifact-download.service.ts` | service | transform, file-I/O | `src/services/episode-media-layout.service.ts` | role/data-boundary match |
| `src/docs/openapi.ts` | config/documentation | request-response contract | same file: protected episode paths at lines 680-815 | exact |
| `src/scripts/verify-episode-artifact-downloads.ts` | test/verifier | request-response, file-I/O | `src/scripts/verify-public-episodes.ts` | exact compiled direct-router pattern |
| `package.json` | config | batch | same file: verifier scripts at lines 6-17 and dependency blocks at lines 23-48 | exact |
| `package-lock.json` | config/lockfile | batch | generated from `package.json` dependency installation | no hand-authored analog |

## Pattern Assignments

### `src/routes/episodes.routes.ts` (route, request-response/streaming/file-I/O)

**Analog:** `src/routes/episodes.routes.ts`

**Imports and router pattern** (lines 1-29):

```typescript
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { config } from "../config/env";
import { requireAuth } from "../middleware/auth.middleware";
import { episodeRepository } from "../database/repositories/episode.repository";
// Domain services use direct relative imports; no aliases or barrels.

export const episodesRouter = Router();
```

Add the Archiver external import after existing external imports and the final-artifact helper beside other service imports. Register `GET /:episodeId/artifacts/download` **before** the generic `GET /:episodeId` at line 413.

**Protected GET, validation, and pre-header error pattern** (lines 383-410):

```typescript
episodesRouter.get("/:episodeId/transcription", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(getEpisodeTranscriptionStatus(episodeId));
  } catch (error) {
    next(error);
  }
});
```

Use this structure for query parsing, episode lookup, and final-artifact preflight. Return the required `400`/`404` JSON before setting ZIP headers or piping. The new route differs only after that boundary: late archive errors must log safely and destroy the response, rather than call `next(error)` after bytes begin streaming.

**Episode existence response** (lines 413-424):

```typescript
const episode = episodeRepository.findByEpisodeId(episodeId);
if (!episode) {
  res.status(404).json({ message: "Episode not found" });
  return;
}
res.json(episode);
```

**Auth middleware to reuse, not duplicate** — `src/middleware/auth.middleware.ts` (lines 5-24):

```typescript
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (config.nodeEnv === "development" && config.auth.bypassInDev) {
    req.user = { email: "dev-bypass@local" };
    next();
    return;
  }

  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing Bearer token" });
    return;
  }

  const token = raw.slice("Bearer ".length).trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (_error) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};
```

### `src/services/episode-artifact-download.service.ts` (service, transform/file-I/O)

**Analog:** `src/services/episode-media-layout.service.ts`

**Imports and typed filename vocabulary** (lines 1-21):

```typescript
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";

export type EpisodeMediaKind = "audio" | "trailer" | "cover" | "coverLow" | "transcript";

const kindFileName = (episodeId: number, kind: EpisodeMediaKind): string => {
  switch (kind) {
    case "audio": return "audio.mp3";
    case "trailer": return "trailer.mp3";
    case "cover": return "cover.jpeg";
    case "coverLow": return "cover.webp";
    case "transcript": return "transcript.txt";
  }
};
```

Create a small function-based module with named exports and a typed fixed catalog. Map only the five public selectors to `EpisodeMediaKind` plus these canonical archive filenames; preserve catalog order for available/missing output.

**Canonical final-path boundary** (lines 43-47, 76-77):

```typescript
export const getEpisodeMediaDirectory = (episodeId: number): string =>
  path.resolve(config.media.storageRoot, "episodes", String(episodeId));

export const getEpisodeMediaFinalPath = (episodeId: number, kind: EpisodeMediaKind): string =>
  path.resolve(getEpisodeMediaDirectory(episodeId), kindFileName(episodeId, kind));
```

The preflight helper must call only `getEpisodeMediaFinalPath(episodeId, kind)` and `lstat`/`stat` each fixed result to admit regular files. It should return typed available entries (`path`, `entryName`, selector) and missing selectors; never accept or expose a path from request input.

**Explicitly do not copy this broader lookup** — `src/services/episode-media-layout.service.ts` (lines 106-141):

```typescript
if (currentFileName) {
  candidates.push(path.isAbsolute(currentFileName) ? currentFileName : path.resolve(config.media.storageRoot, currentFileName));
}
// It also probes final, staging, legacy, and draft candidates.
```

`findExistingEpisodeMediaPath()` is appropriate for migration/authoring but prohibited for this export because it can return request-adjacent stored paths, staging files, drafts, and legacy locations.

### `src/docs/openapi.ts` (config/documentation, request-response contract)

**Analog:** `src/docs/openapi.ts` protected episode definitions

**Protected endpoint object pattern** (lines 702-723):

```typescript
"/v1/episodes/{episodeId}": {
  get: {
    tags: ["Episodes"],
    summary: "Get one episode",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
    responses: { "200": { description: "Episode" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
  },
},
```

Add a sibling path object for `/v1/episodes/{episodeId}/artifacts/download`, retaining `tags`, bearer security, inline parameter objects, and status-keyed response declarations. Document the optional `artifacts` CSV query as the five English selector values; document `application/zip`, `Content-Disposition`, `X-Missing-Artifacts`, and exact `400`, `401`, and both `404` JSON cases.

### `src/scripts/verify-episode-artifact-downloads.ts` (test/verifier, request-response/file-I/O)

**Analog:** `src/scripts/verify-public-episodes.ts`

**Direct compiled router-handler discovery** (lines 52-85):

```typescript
const router = publicEpisodesRouter as unknown as {
  stack?: Array<{
    route?: { path?: string; stack?: Array<{ handle: (...args: unknown[]) => unknown }> };
  }>;
};
const layer = router.stack?.find((entry) => entry.route?.path === "/");
const handler = layer?.route?.stack?.[0]?.handle;

if (typeof handler !== "function") {
  throw new Error("public catalog route handler not found");
}
```

Adapt this against `episodesRouter`: find the exact download route and invoke its middleware/handler stack directly. Account for `requireAuth` as the first route layer; assert the normal bearer failure and development `AUTH_BYPASS` behavior without opening a listener.

**Promise-wrapped fake request/response invocation** (lines 87-106):

```typescript
const requestCatalog = (): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const handler = getCatalogRouteHandler();
    const req = { /* only the handler fields needed by the route */ };
    const res = {
      json(body: unknown): void {
        resolve(body);
      },
    };

    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
```

For the archive verifier, make `res` an in-memory writable response supporting `status`, `setHeader`, `json`, `destroy`, and streamed chunks. Create deterministic temporary final-media fixtures through the canonical final-path helper; assert archive bytes/entry names and clean them up. Keep ZIP inspection verifier-only and dependency-free unless a human checkpoint approves another package.

**Executable entry point and failure reporting** (lines 108-118):

```typescript
const main = async (): Promise<void> => {
  await connectDb();
  const data = await requestCatalog();
  assertCatalogContract(data);
  console.log(`verified ${Array.isArray(data) ? data.length : 0} catalog items`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```

### `package.json` (config, batch)

**Analog:** existing compiled verifier scripts in `package.json`

**Script convention** (lines 9-17):

```json
"build": "tsc -p tsconfig.json",
"typecheck": "tsc --noEmit",
"verify:public-episodes": "NODE_ENV=development node dist/scripts/verify-public-episodes.js",
"verify:summary-runtime-contract": "NODE_ENV=development node dist/scripts/verify-summary-runtime-contract.js"
```

Add `verify:episode-artifact-downloads` using the same `NODE_ENV=development node dist/scripts/...js` form; the planner should run `npm run build` before it.

**Dependency convention** (lines 23-48):

```json
"dependencies": {
  "express": "^5.2.1",
  "multer": "^2.1.1",
  "swagger-jsdoc": "^6.3.0"
},
"devDependencies": {
  "@types/express": "^5.0.6",
  "typescript": "^6.0.3"
}
```

Add `archiver` to runtime `dependencies`. Add `@types/archiver` only if TypeScript requires it after installation. Research marked both package choices as suspicious, so include the required human legitimacy checkpoint before install.

### `package-lock.json` (config/lockfile, batch)

**Analog:** `package-lock.json` is generated by the approved package-manager install that updates `package.json`.

Do not hand-edit it. It records the exact Archiver dependency graph after the human checkpoint and approved install.

## Shared Patterns

### Authentication

**Source:** `src/middleware/auth.middleware.ts` lines 5-24  
**Apply to:** Download route and verifier auth cases

Attach `requireAuth` directly on the route, as all protected episode handlers do. Preserve the middleware’s development-only bypass; do not add a download-specific auth mechanism.

### Route validation and errors before streaming

**Source:** `src/routes/episodes.routes.ts` lines 383-425; `src/app.ts` lines 74-88  
**Apply to:** Download route

Use numeric positive-ID guards and JSON `{ message }` early returns. Wrap the preflight phase in `try/catch` and `next(error)`. The global error middleware has no `headersSent` branch:

```typescript
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Validation failed", issues: error.issues });
    return;
  }
  if (error instanceof Error) {
    res.status(400).json({ message: error.message });
    return;
  }
  res.status(500).json({ message: "Unexpected error" });
});
```

Therefore do not call `next(error)` for Archiver failures after `archive.pipe(res)`; log the episode ID and selector names (not filesystem paths) and `res.destroy(error)` if still open.

### Final-only media resolution

**Source:** `src/services/episode-media-layout.service.ts` lines 6-21 and 76-77  
**Apply to:** Download helper and archive loop

The fixed selector catalog is the security boundary. Every selected entry must resolve through `getEpisodeMediaFinalPath`; archive with explicit entry names `episode-<episodeId>/<canonical filename>`. Never use `findExistingEpisodeMediaPath`, staging, backup, draft, stored filename, directory, or glob APIs.

### Documentation and executable validation

**Source:** `src/docs/openapi.ts` lines 680-815; `src/scripts/verify-public-episodes.ts` lines 52-118  
**Apply to:** OpenAPI addition, verifier, and npm script

Use the existing inline OpenAPI path-object style and compiled `dist/scripts` verifier execution. The verifier must invoke router layers directly and avoid a localhost listener or system `unzip` tool.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `package-lock.json` | config/lockfile | batch | Generated artifact; update through the approved package-manager install rather than copied code. |

## Metadata

**Analog search scope:** `src/routes`, `src/middleware`, `src/services`, `src/docs`, `src/scripts`, `src/app.ts`, `package.json`, `.planning/codebase`  
**Files scanned:** 15  
**Pattern extraction date:** 2026-07-28
