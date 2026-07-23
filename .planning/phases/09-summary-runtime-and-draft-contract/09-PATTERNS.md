# Phase 09: Summary Runtime and Draft Contract - Pattern Map

**Mapped:** 2026-07-23
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/config/env.ts` | config | request-response | `src/config/env.ts` | exact |
| `src/services/episode-media-layout.service.ts` | service | file-I/O | `src/services/episode-media-layout.service.ts` | exact |
| `src/services/episode-transcription.service.ts` | service | streaming | `src/services/episode-transcription.service.ts` | exact |
| `src/services/episode-summary.service.ts` | service | request-response | `src/services/episode-transcription.service.ts` | role-match |
| `src/schemas/episode-draft-state.ts` | model | transform | `src/schemas/episode.ts` | role-match |
| `.env.example` | config sample | request-response | `src/config/env.ts` | exact-style mirror |
| `src/scripts/verify-summary-runtime-contract.ts` | script | request-response | `src/scripts/verify-public-episodes.ts` | role-match |
| `package.json` | script registry | request-response | `package.json` | exact |

## Pattern Assignments

### `src/config/env.ts` (config, request-response)

**Analog:** `src/config/env.ts`

**Imports and env bootstrap pattern** (lines 1-16):
```typescript
import path from "node:path";
import dotenv from "dotenv";

const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : process.env.NODE_ENV === "development"
      ? ".env.dev"
      : ".env";

dotenv.config({ path: envFile });

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};
```

**Feature block pattern** (`transcription`, lines 61-67):
```typescript
transcription: {
  enabled: (process.env.EPISODE_TRANSCRIPTION_ENABLED ?? "false").toLowerCase() === "true",
  command: process.env.EPISODE_TRANSCRIPTION_COMMAND ?? "whisper-cli",
  modelPath: process.env.EPISODE_TRANSCRIPTION_MODEL_PATH ?? "",
  language: process.env.EPISODE_TRANSCRIPTION_LANGUAGE ?? "pt",
  timeoutMs: Number(process.env.EPISODE_TRANSCRIPTION_TIMEOUT_MS ?? 7200000),
  pollIntervalMs: Number(process.env.EPISODE_TRANSCRIPTION_POLL_INTERVAL_MS ?? 300000),
},
```

**What to copy for Phase 9**
- Add a sibling `summary` block beside `transcription`, not ad hoc `process.env` reads inside the service.
- Follow the same boolean normalization, string fallback, and numeric coercion style.

---

### `src/services/episode-media-layout.service.ts` (service, file-I/O)

**Analog:** `src/services/episode-media-layout.service.ts`

**Imports and ownership pattern** (lines 1-4):
```typescript
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
```

**Episode-scoped artifact path helpers** (lines 49-62):
```typescript
export const getEpisodeMediaDraftTranscriptPath = (episodeId: number): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), "transcript.txt");

export const getEpisodeMediaDraftTranscriptionStatePath = (episodeId: number): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), "transcript.state.json");

export const getEpisodeMediaFinalPath = (episodeId: number, kind: EpisodeMediaKind): string =>
  path.resolve(getEpisodeMediaDirectory(episodeId), kindFileName(episodeId, kind));
```

**Existing-file fallback pattern** (`findExistingEpisodeMediaPath`, lines 91-121):
```typescript
export const findExistingEpisodeMediaPath = async (
  episodeId: number,
  kind: EpisodeMediaKind,
  currentFileName?: string | null
): Promise<string | null> => {
  const candidates: string[] = [];

  if (currentFileName) {
    candidates.push(path.isAbsolute(currentFileName) ? currentFileName : path.resolve(config.media.storageRoot, currentFileName));
  }

  if (kind !== "transcript") {
    candidates.push(getEpisodeMediaFinalPath(episodeId, kind));
    if (kind === "audio") {
      candidates.push(getEpisodeMediaStagingPath(episodeId, kind));
    }
    candidates.push(path.join(legacyMediaDirectories[kind], legacyFileName(episodeId, kind)));
  } else {
    candidates.push(getEpisodeMediaFinalPath(episodeId, kind));
    candidates.push(path.join(config.media.episodesDir, `episode_${episodeId}.txt`));
    candidates.push(path.join(config.media.episodesDir, `${episodeId}.txt`));
  }
```

**Migration/update pattern** (`migrateEpisodeMediaLayout`, lines 140-204):
```typescript
const transcriptCurrent = await findExistingEpisodeMediaPath(episode.episodeId, "transcript", episode.transcriptFileName ?? null);
if (transcriptCurrent) {
  const transcriptFinal = getEpisodeMediaFinalPath(episode.episodeId, "transcript");
  if (transcriptCurrent !== transcriptFinal) {
    await moveFile(transcriptCurrent, transcriptFinal);
    filesMoved += 1;
  }

  const nextTranscriptName = getEpisodeMediaRelativePath(episode.episodeId, "transcript");
  if (episode.transcriptFileName !== nextTranscriptName) {
    updates.transcriptFileName = nextTranscriptName;
  }
}
```

**What to copy for Phase 9**
- Extend this service with `summary.txt` and `episode.state.json` helpers instead of hardcoding file names in the new summary service.
- Keep backward-compatible fallback helpers for legacy `transcript.state.json` reads here.

---

### `src/services/episode-transcription.service.ts` (service, streaming)

**Analog:** `src/services/episode-transcription.service.ts`

**Imports and CLI-runner pattern** (lines 1-16):
```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
import {
  getEpisodeMediaDraftTranscriptPath,
  getEpisodeMediaDraftTranscriptionStatePath,
  findExistingEpisodeMediaPath,
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
} from "./episode-media-layout.service";

const execFileAsync = promisify(execFile);
```

**Draft state contract pattern** (`DraftTranscriptionState`, lines 22-29; state helpers at 58-104):
```typescript
type DraftTranscriptionState = {
  episodeId: number;
  version: number;
  status: DraftTranscriptionStatus;
  updatedAt: string;
  startedAt?: string | null;
  progress?: number | null;
  error?: string | null;
};

const readDraftState = (episodeId: number): DraftTranscriptionState | null => {
  const statePath = buildDraftStatePath(episodeId);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as DraftTranscriptionState;
    // shape guards omitted here for brevity
    return {
      episodeId,
      version: parsed.version,
      status: parsed.status,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      progress: typeof parsed.progress === "number" && Number.isFinite(parsed.progress) ? parsed.progress : null,
      error: typeof parsed.error === "string" ? parsed.error : null,
    };
  } catch {
    return null;
  }
};
```

**Configuration gate pattern** (`getTranscriptionConfigurationError`, lines 111-133):
```typescript
const getTranscriptionConfigurationError = (): string | null => {
  if (!config.transcription.enabled) {
    return "Transcription is disabled";
  }

  if (!config.transcription.command.trim()) {
    return "EPISODE_TRANSCRIPTION_COMMAND is not configured";
  }

  if (!config.transcription.modelPath.trim()) {
    return "EPISODE_TRANSCRIPTION_MODEL_PATH is not configured";
  }
```

**CLI execution pattern** (`runTranscriptionCommand`, lines 225-248):
```typescript
const runTranscriptionCommand = async (wavPath: string, outputBase: string): Promise<string> => {
  const transcriptPath = `${outputBase}.txt`;
  const { stdout } = await execFileAsync(
    config.transcription.command,
    [
      "-m",
      config.transcription.modelPath,
      "-f",
      wavPath,
      "-l",
      config.transcription.language,
      "-otxt",
      "-of",
      outputBase,
      "-nt",
      "-np",
    ],
    {
      maxBuffer: 20 * 1024 * 1024,
      timeout: config.transcription.timeoutMs,
    }
  );
```

**Sequential draft-job pattern** (`transcribeDraftEpisode`, lines 339-392):
```typescript
const transcribeDraftEpisode = async (episodeId: number, version: number): Promise<void> => {
  const audioPath = await findExistingEpisodeMediaPath(episodeId, "audio");
  if (!audioPath) {
    console.info(`[transcription] draft episode=${episodeId} version=${version} audio not found`);
    return;
  }

  if (!isDraftStateCurrent(episodeId, version)) {
    console.info(`[transcription] draft episode=${episodeId} version=${version} aborted before start`);
    return;
  }

  writeDraftState(episodeId, nextDraftState(episodeId, "processing", version));

  try {
    const transcript = await transcribeAudioInChunks(audioPath, (progress) => {
      if (!isDraftStateCurrent(episodeId, version)) {
        return;
      }

      writeDraftState(episodeId, {
        ...nextDraftState(episodeId, "processing", version),
        progress,
      });
    });
```

**Queue-and-fire pattern** (`queueDraftEpisodeTranscription`, lines 420-452):
```typescript
export const queueDraftEpisodeTranscription = async (
  episodeId: number
): Promise<{ queued: boolean; version: number; status: DraftTranscriptionStatus; progress: number | null; error?: string | null }> => {
  const configurationError = getTranscriptionConfigurationError();
  if (configurationError) {
    const current = getCurrentDraftState(episodeId);
    const next = nextDraftState(episodeId, "error", (current?.version ?? 0) + 1, configurationError);
    writeDraftState(episodeId, next);
    return {
      queued: false,
      version: next.version,
      status: next.status,
      progress: next.progress ?? null,
      error: next.error,
    };
  }

  const current = getCurrentDraftState(episodeId);
  const next = nextDraftState(episodeId, "pending", (current?.version ?? 0) + 1);
  writeDraftState(episodeId, next);
  void transcribeDraftEpisode(episodeId, next.version);
```

**Worker serialization pattern** (`startEpisodeTranscriptionWorker`, lines 594-635):
```typescript
let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;

const runOnce = async (): Promise<void> => {
  if (activeRun) {
    return activeRun;
  }

  activeRun = (async () => {
    const result = await processPendingEpisodeTranscriptions();
    if (result.processed > 0) {
      console.log(
        `Episode transcription worker processed ${result.processed} pending episode(s); delivered=${result.delivered}; failed=${result.failed}`
      );
    }
  })().finally(() => {
    activeRun = null;
  });

  return activeRun;
};
```

**What to copy for Phase 9**
- Use this service as the main analog for `src/services/episode-summary.service.ts`.
- Keep `execFile` plus argument arrays only.
- Keep versioned draft-state writes and stale-write guards.
- Preserve the separation between file artifacts and repository persistence.

---

### `src/services/episode-summary.service.ts` (service, request-response)

**Analog:** `src/services/episode-transcription.service.ts`

**Imports pattern to mirror** (`episode-transcription.service.ts`, lines 1-16):
```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import { episodeRepository, type EpisodeRow } from "../database/repositories/episode.repository";
import {
  findExistingEpisodeMediaPath,
  getEpisodeMediaFinalPath,
  getEpisodeMediaRelativePath,
} from "./episode-media-layout.service";
```

**Alternative CLI wrapper analog** (`src/services/spotify-metrics.service.ts`, lines 1-44):
```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { config } from "../config/env";

const execFileAsync = promisify(execFile);

export async function getSpotifyMetricsSnapshot(days = 30): Promise<SpotifyMetricsSnapshot> {
  if (!config.spotify.enabled) {
    throw new Error("Spotify metrics are disabled.");
  }

  const { stdout } = await execFileAsync("python3", [scriptPath], {
    timeout: config.spotify.timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      SPOTIFY_METRICS_BASE_URL: config.spotify.baseUrl,
      SQLITE_PATH: config.sqlitePath,
    },
  });
```

**State-update and fire-and-stop pattern to mirror** (`episode-transcription.service.ts`, lines 339-452):
```typescript
writeDraftState(episodeId, nextDraftState(episodeId, "processing", version));

try {
  // read input artifact
  // run CLI once
  // write output artifact
  writeDraftState(episodeId, {
    ...nextDraftState(episodeId, "done", version),
    progress: 100,
  });
} catch (error) {
  if (isDraftStateCurrent(episodeId, version)) {
    writeDraftState(episodeId, {
      ...nextDraftState(episodeId, "error", version, error instanceof Error ? error.message : "Unknown transcription error"),
      progress: null,
    });
  }
}
```

**Repository isolation pattern** (`src/database/repositories/episode.repository.ts`, lines 619-709 and 763-817):
```typescript
create(input: EpisodeInput): EpisodeRow {
  // summary comes from input.summary only
}

update(episodeId: number, input: EpisodeInput): EpisodeRow | null {
  // summary stays part of normal episode save/update flow
}

queueTranscription(...)
markTranscriptionDone(...)
markTranscriptionError(...)
```

**What to copy for Phase 9**
- Read only `transcript.txt` from the media layout service.
- Write only `summary.txt` plus shared `episode.state.json`.
- Do not auto-write `episodes.summary`; repository usage should stay read-only or existence-check-only in this phase.

---

### `src/schemas/episode-draft-state.ts` (model, transform)

**Analog:** `src/schemas/episode.ts`

**Schema declaration pattern** (lines 1-28):
```typescript
import { z } from "zod";

export const episodeSchema = z.object({
  episodeId: z.coerce.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().default(""),
  pubDate: z.coerce.date(),
  // ...
});

export type EpisodeInput = z.infer<typeof episodeSchema>;
```

**Error-surface pattern for schema failures** (`src/app.ts`, lines 74-84):
```typescript
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Validation failed", issues: error.issues });
    return;
  }
```

**What to copy for Phase 9**
- If the planner chooses a dedicated shared-state schema, keep it as a plain `z.object(...)` + exported inferred type.
- Use it at file-adapter boundaries only; do not add route coupling in this phase.

## Shared Patterns

### Protected Route Shape
**Source:** `src/routes/episodes.routes.ts` lines 365-375, 393-442
**Apply to:** Any later summary routes in Phase 10
```typescript
episodesRouter.get("/:episodeId/transcription", requireAuth, async (req, res, next) => {
  try {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      res.status(400).json({ message: "Invalid episodeId" });
      return;
    }

    res.json(getEpisodeTranscriptionStatus(episodeId));
  } catch (error) {
    next(error);
  }
});
```

### Request Validation
**Source:** `src/routes/auth.routes.ts` lines 6-18 and `src/routes/episodes.routes.ts` lines 393-423
**Apply to:** Any future trigger/status payloads
```typescript
const loginSchema = z.object({
  idToken: z.string().min(1),
});

const { idToken } = loginSchema.parse(req.body);
const payload = episodeSchema.parse({ ...req.body, episodeId: routeId });
```

### Error Handling
**Source:** `src/app.ts` lines 74-86
**Apply to:** All new service/route errors
```typescript
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Validation failed", issues: error.issues });
    return;
  }

  if (error instanceof Error) {
    const authConfigError =
      error.message.includes("GOOGLE_CLIENT_ID") || error.message.includes("JWT_SECRET");
    res.status(authConfigError ? 500 : 400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected error" });
});
```

### File-Backed Draft State
**Source:** `src/services/episode-transcription.service.ts` lines 58-104, 420-452
**Apply to:** Shared `episode.state.json` readers/writers and summary queueing
```typescript
const current = getCurrentDraftState(episodeId);
const next = nextDraftState(episodeId, "pending", (current?.version ?? 0) + 1);
writeDraftState(episodeId, next);
void transcribeDraftEpisode(episodeId, next.version);
```

### CLI Execution
**Source:** `src/services/episode-transcription.service.ts` lines 225-248 and `src/services/spotify-metrics.service.ts` lines 19-38
**Apply to:** Summary model invocation
```typescript
const { stdout } = await execFileAsync(command, args, {
  timeout: configValue,
  maxBuffer: 10 * 1024 * 1024,
  env: {
    ...process.env,
    SOME_CONFIG: someValue,
  },
});
```

### Env Example Mirror
**Source:** `src/config/env.ts`
**Apply to:** `.env.example`
```text
EPISODE_SUMMARY_ENABLED=false
EPISODE_SUMMARY_COMMAND=llama-cli
EPISODE_SUMMARY_MODEL_PATH=
EPISODE_SUMMARY_CONTEXT_SIZE=4096
EPISODE_SUMMARY_MAX_TOKENS=256
EPISODE_SUMMARY_TIMEOUT_MS=900000
EPISODE_SUMMARY_PROMPT_VERSION=1
```

### Summary Contract Verifier
**Source:** `src/scripts/verify-public-episodes.ts`
**Apply to:** `src/scripts/verify-summary-runtime-contract.ts`
```typescript
const result = await service.queueDraftEpisodeSummary(episodeId);
if (!result.queued) {
  throw new Error("expected summary queue to start");
}
```

### NPM Script Registry
**Source:** `package.json`
**Apply to:** `package.json`
```json
{
  "scripts": {
    "verify:summary-runtime-contract": "NODE_ENV=development node dist/scripts/verify-summary-runtime-contract.js"
  }
}
```

### Repository Ownership Boundary
**Source:** `src/database/repositories/episode.repository.ts` lines 619-709, 763-817
**Apply to:** Summary generation contract
```typescript
create(input: EpisodeInput): EpisodeRow {
  // input.summary populates the DB field
}

update(episodeId: number, input: EpisodeInput): EpisodeRow | null {
  // final summary persists through normal save/update only
}
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| None | — | — | The repo already has strong analogs for config, file-backed state, CLI orchestration, and schema validation. |

## Metadata

**Analog search scope:** `src/config`, `src/services`, `src/routes`, `src/database/repositories`, `src/schemas`, `docs`, `.planning/phases/09-summary-runtime-and-draft-contract`
**Files scanned:** 9 primary files plus phase context artifacts
**Pattern extraction date:** 2026-07-23
