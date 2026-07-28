# Phase 9: Summary Runtime and Draft Contract - Research

**Researched:** 2026-07-23 [VERIFIED: local command `date -Iseconds`]
**Domain:** Backend-local transcript-to-summary runtime design for `admin-api` [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
**Confidence:** MEDIUM [VERIFIED: synthesis from codebase + official docs]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Summary generation must stay configuration-driven inside `admin-api`; the implementation should use env-based runtime settings instead of hardwiring one model or CLI shape into service code.
- **D-02:** The summary runtime should read only the saved transcript as input and must preserve the current transcription engine unchanged for v1.2.
- **D-03:** Summary generation is a single sequential job per episode, designed to finish and stop once the suggestion text is produced.
- **D-04:** The generated draft summary should be persisted as its own text artifact, such as `summary.txt`, beside the episode files so later phases can return it directly to `admin-web`.
- **D-05:** The current draft state file should be renamed from a transcript-specific artifact into an episode-level file such as `episode.state.json`, so multiple workflow steps can share one state document.
- **D-06:** The shared episode state file should store child objects per workflow step, such as `transcript` and `aiSummary`, instead of creating separate state files for each step.
- **D-07:** Regenerating a summary should replace the previous draft suggestion artifact, but it must never overwrite the final `episodes.summary` database field automatically.
- **D-08:** `transcript.txt` must remain a pure transcript source file; summary text must not be prepended or appended into the transcript artifact.
- **D-09:** After generation, the backend job is done; review, editing, replacement, or deletion of the text happens in `admin-web` before form submit.
- **D-10:** The final summary saved to the database is only the value submitted from the admin form, not the generated draft artifact itself.
- **D-11:** Generated summaries must follow short, discovery-friendly `pt-BR` writing rules intended to improve natural internet search relevance without keyword stuffing.
- **D-12:** The prompt and validation contract should enforce: `2-4` short sentences, main topic in the opening sentence, `1-3` concrete searchable terms when supported by the transcript, explicit naming of relevant guests/franchises/games/themes when present, and a concise explanation of what the listener will hear or learn.
- **D-13:** The summary contract should explicitly avoid vague hype language, disconnected keyword lists, and any behavior that mixes SEO goals with unnatural writing.
[VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

### the agent's Discretion
Exact env var names and internal service boundaries are left to the agent, as long as the runtime stays env-driven, sequential, and consistent with the existing transcript workflow.
[VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

### Deferred Ideas (OUT OF SCOPE)
- `admin-web` behavior for prefilling, editing UX, and acceptance/rejection controls belongs to a later frontend milestone.
- Any change to the transcription runtime or broader AI drafting beyond summary text remains deferred outside Phase 9.
[VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SUMM-01 | The backend can generate a suggested summary using only the episode transcript as source input. [VERIFIED: .planning/REQUIREMENTS.md] | Use a one-shot local LLM CLI invoked from a backend service that reads `transcript.txt`, writes `summary.txt`, and never reads audio or DB summary content. [VERIFIED: codebase grep] [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md] |
| FLOW-02 | Summary generation only starts when a transcript file already exists for the episode draft. [VERIFIED: .planning/REQUIREMENTS.md] | Gate queue/start logic on transcript artifact existence plus shared state readiness, mirroring current draft transcription state checks. [VERIFIED: codebase grep] |
| OPS-01 | Summary generation model/runtime selection is configuration-driven inside the backend. [VERIFIED: .planning/REQUIREMENTS.md] | Add a dedicated summary config block in `src/config/env.ts` and keep runtime command/model/context/prompt constraints in env vars. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 9 should define a backend-owned summary runtime that mirrors the existing transcription service shape instead of introducing a new subsystem. The repo already has the right seams: env-backed runtime config in `src/config/env.ts`, episode-scoped file ownership in `src/services/episode-media-layout.service.ts`, and versioned file-backed draft state in `src/services/episode-transcription.service.ts`. [VERIFIED: codebase grep]

The standard implementation path is a one-shot local `llama.cpp` CLI invocation using a small instruction model, with transcript input read from `transcript.txt`, draft output written to `summary.txt`, and operational metadata consolidated into `episode.state.json`. `llama.cpp` is documented as a local inference runtime with GGUF model support, quantization options for reduced memory use, and a simple CLI/server split; for this repo, the CLI path fits the existing `execFile` pattern better than adding a persistent inference server. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md]

The main planning risk is not model quality but contract drift: if Phase 9 mixes draft summary text into `transcript.txt`, overwrites `episodes.summary`, or keeps transcript-only state files, later API and frontend phases will inherit the wrong storage boundaries. The plan should therefore prioritize shared artifact/state primitives and a strict transcript-ready gate before any route work. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: codebase grep]

**Primary recommendation:** Reuse the transcription service architecture, but implement summary generation as a separate env-driven one-shot `llama.cpp` CLI service using transcript-only input, `summary.txt` output, and shared `episode.state.json` step objects. [VERIFIED: codebase grep] [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md]

## Project Constraints (from AGENTS.md)

- Read `.planning/PROJECT.md` before implementation and treat it as the architecture source of truth. [VERIFIED: AGENTS.md]
- Keep feed generation server-side. [VERIFIED: AGENTS.md]
- Do not move scheduling or feed rules to the frontend. [VERIFIED: AGENTS.md]
- Respect auth toggles: backend `.env.dev` uses `AUTH_BYPASS`; frontend env uses `authBypass`. [VERIFIED: AGENTS.md]
- Prefer minimal-scope changes and verify with `npm run typecheck` and `npm run build`. [VERIFIED: AGENTS.md]
- Keep Telegram launch-notification logic in the existing backend service files listed in `AGENTS.md`. [VERIFIED: AGENTS.md]
- Use the WSL workspace layout paths listed in `AGENTS.md`. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read transcript artifact and decide readiness | API / Backend | Database / Storage | Transcript existence and draft-state checks already live in backend services and episode media paths. [VERIFIED: codebase grep] |
| Invoke local summary model | API / Backend | — | The transcription workflow already executes local CLIs from backend code through `execFile`; summary generation should follow the same ownership boundary. [VERIFIED: codebase grep] |
| Store `summary.txt` and `episode.state.json` | Database / Storage | API / Backend | Files belong in the episode media layout, while the backend owns write timing and shape. [VERIFIED: codebase grep] |
| Preserve final `episodes.summary` editorial ownership | API / Backend | Database / Storage | The SQLite row is only mutated through normal create/update repository flows, which Phase 9 should leave unchanged for draft generation. [VERIFIED: codebase grep] |
| Review/edit/delete draft summary | Browser / Client | API / Backend | Context explicitly defers human review and final form submission to `admin-web` and later phases. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js runtime | `18+` on VPS, `v24.17.0` locally | Execute backend services and local CLI orchestration. | The repo already targets Node scripts and VPS docs require Node 18+. [VERIFIED: .planning/codebase/OPERATIONS.md] [VERIFIED: local command `node --version`] |
| `llama.cpp` CLI | Current upstream CLI docs, version not pinned in repo yet [ASSUMED] | Run one-shot local text generation from a GGUF model. | Official docs describe local inference, GGUF requirement, and minimal setup, which matches this backend’s existing CLI-worker pattern. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md] |
| `Qwen2.5-3B-Instruct` | Current official model card; exact local GGUF quant remains operator-selected [ASSUMED] | Small instruct model for Portuguese transcript summarization. | Official Qwen sources say the model family supports long text and over 29 languages including Portuguese, which fits transcript-only `pt-BR` summarization. [CITED: https://qwenlm.github.io/blog/qwen2.5/] [CITED: https://huggingface.co/Qwen/Qwen2.5-3B-Instruct] |
| Node built-ins: `node:child_process`, `node:fs`, `node:path` | Built-in | Execute the CLI, manage temp files, and write episode artifacts. | The transcription service already uses this exact stack successfully. [VERIFIED: codebase grep] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `^4.4.3` | Validate any shared state payloads or future summary status responses. | Use when Phase 9 introduces an explicit `episode.state.json` schema or Phase 10 exposes summary status through routes. [VERIFIED: package.json] |
| `dotenv` | `^17.4.2` | Load env-driven summary runtime settings through the existing config bootstrap. | Use only through `src/config/env.ts`; do not add ad hoc env reads in services. [VERIFIED: package.json] [VERIFIED: codebase grep] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One-shot `llama.cpp` CLI process | `llama-server` | `llama-server` adds a persistent local service and concurrency surface that the phase does not need under a sequential 4 GB VPS constraint. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md] |
| Qwen 3B-class local model | Larger local instruct model | Larger models may improve generation headroom but increase memory pressure and startup time on the target VPS. [CITED: https://qwenlm.github.io/blog/qwen2.5/] [ASSUMED] |

**Installation:** No new npm packages are required for Phase 9; reuse repo dependencies plus an OS-level local inference runtime. [VERIFIED: package.json] [VERIFIED: .planning/codebase/OPERATIONS.md]

```bash
# Existing verification baseline
npm run typecheck
npm run build

# Runtime prerequisites to verify before executable summary tests
node --version
ffmpeg -version | head -1
llama-cli --version
```

**Version verification:** No new npm library is required by this phase, so package-registry version verification is not applicable. Runtime verification should instead confirm the installed CLI binary and model file configured by env. [VERIFIED: package.json] [VERIFIED: .planning/codebase/OPERATIONS.md]

## Package Legitimacy Audit

No new external npm package is recommended for Phase 9. [VERIFIED: package.json]  
Package-legitimacy gate: not applicable unless implementation scope changes to add a new registry dependency. [VERIFIED: synthesis from planned stack]

## Architecture Patterns

### System Architecture Diagram

```text
Protected trigger / worker
        |
        v
Summary service gate
  - summary enabled?
  - transcript exists?
  - no active summary job?
        |
        v
Read transcript.txt  --->  Read episode.state.json (fallback transcript.state.json during migration)
        |                                  |
        +---------------> Build prompt/context <----------------+
                               |
                               v
                    execFile(summary CLI, env-driven args)
                               |
                +--------------+--------------+
                |                             |
                v                             v
         success path                    failure path
   write summary.txt                 update aiSummary.error
   update aiSummary.status           keep DB summary unchanged
   keep transcript.txt unchanged
                |
                v
     Phase 10 protected read endpoint / later admin-web review
```

This diagram reflects the locked boundary that transcript input, draft artifact output, and final DB summary ownership stay separate. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

### Recommended Project Structure
```text
src/
├── config/
│   └── env.ts                       # add summary runtime config block
├── services/
│   ├── episode-media-layout.service.ts   # shared artifact/state path helpers
│   ├── episode-transcription.service.ts  # unchanged transcription engine
│   └── episode-summary.service.ts        # new one-shot summary runtime
└── schemas/
    └── episode-draft-state.ts       # optional zod-backed shared state schema
```

### Pattern 1: Env-Driven Summary Runtime Block
**What:** Add a `summary` config block beside the existing `transcription` block with flags such as `enabled`, `command`, `modelPath`, `contextSize`, `maxTokens`, and `timeoutMs`. [VERIFIED: codebase grep]
**When to use:** Use for every runtime choice that operators may need to tune without code edits. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
**Example:**
```typescript
// Source: codebase env pattern + official llama.cpp CLI docs
export const config = {
  // ...
  summary: {
    enabled: (process.env.EPISODE_SUMMARY_ENABLED ?? "false").toLowerCase() === "true",
    command: process.env.EPISODE_SUMMARY_COMMAND ?? "llama-cli",
    modelPath: process.env.EPISODE_SUMMARY_MODEL_PATH ?? "",
    contextSize: Number(process.env.EPISODE_SUMMARY_CONTEXT_SIZE ?? 4096),
    maxTokens: Number(process.env.EPISODE_SUMMARY_MAX_TOKENS ?? 160),
    timeoutMs: Number(process.env.EPISODE_SUMMARY_TIMEOUT_MS ?? 900000),
  },
};
```

### Pattern 2: Shared Episode-Level Draft State
**What:** Replace `transcript.state.json` as the primary contract with `episode.state.json` containing step-specific objects such as `transcript` and `aiSummary`. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
**When to use:** Use whenever draft media files exist before the episode row is finalized or when multiple background steps need the same episode-scoped operational state. [VERIFIED: codebase grep]
**Example:**
```typescript
// Source: phase context + existing draft transcription state pattern
type EpisodeDraftState = {
  episodeId: number;
  version: number;
  transcript?: {
    status: "idle" | "pending" | "processing" | "done" | "error";
    updatedAt: string;
    startedAt?: string | null;
    progress?: number | null;
    error?: string | null;
  };
  aiSummary?: {
    status: "idle" | "pending" | "processing" | "done" | "error";
    updatedAt: string;
    startedAt?: string | null;
    promptVersion?: string | null;
    summaryFileName?: string | null;
    error?: string | null;
  };
};
```

### Pattern 3: One-Shot Sequential Summary Job
**What:** Run summary generation as a single fire-and-stop process per episode, with state versioning to prevent stale writes. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: codebase grep]
**When to use:** Use for manual trigger/refresh flows and any future protected admin endpoint that needs deterministic low-memory behavior. [VERIFIED: .planning/REQUIREMENTS.md]
**Example:**
```typescript
// Source: transcription service orchestration pattern + official llama.cpp local CLI docs
const current = readEpisodeDraftState(episodeId);
const nextVersion = (current?.version ?? 0) + 1;
writeEpisodeDraftState(episodeId, {
  ...current,
  version: nextVersion,
  aiSummary: { status: "pending", updatedAt: new Date().toISOString() },
});

void generateDraftSummary(episodeId, nextVersion);
```

### Anti-Patterns to Avoid
- **Transcript/summary mixing:** Do not append generated summary text into `transcript.txt`; keep transcript as a pure source artifact. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
- **Direct DB overwrite:** Do not mutate `episodes.summary` from the generator; that field remains user-submitted final content only. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
- **Persistent inference daemon for this phase:** Do not add a background `llama-server` just to support single-episode generation. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md]
- **Ad hoc shell interpolation:** Do not build CLI commands by concatenating transcript text into shell strings; use `execFile`/argument arrays only. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Local LLM serving for one draft job | Custom HTTP model microservice | One-shot CLI execution from a backend service | The repo already uses local CLI orchestration for AI-adjacent work, and Phase 9 does not need a long-lived model server. [VERIFIED: codebase grep] [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md] |
| Per-step state file sprawl | Separate `summary.state.json`, `prompt.state.json`, etc. | One shared `episode.state.json` with child step objects | The phase explicitly locks shared episode-level state to avoid cross-step drift. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] |
| Final-summary auto-publish | Generator writes directly into SQLite `summary` | Separate `summary.txt` draft artifact | Editorial review belongs later and final DB ownership must stay manual. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] |
| Free-form prompt output parsing | Regex-heavy parser against arbitrary model output | Tight prompt contract plus simple post-validation of sentence count and non-empty text | The phase only needs short draft text, not a complex generative protocol. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [ASSUMED] |

**Key insight:** The difficult part here is not generating text; it is preserving clean backend ownership boundaries between transcript source, draft artifact, operational state, and final database content. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing draft transcription state files are currently written as staging-side `transcript.state.json`, and final transcript artifacts are written as `transcript.txt`. [VERIFIED: codebase grep] | Add backward-compatible reads for the legacy transcript state path and migrate forward to `episode.state.json` on next write/sync. This is a file-state migration, not a database migration. [VERIFIED: codebase grep] |
| Live service config | None found in external UI-managed services for transcript or summary runtime. [VERIFIED: repo/doc scan] | None. [VERIFIED: repo/doc scan] |
| OS-registered state | None found; current transcription worker is started by backend runtime code rather than OS scheduler registration. [VERIFIED: codebase grep] | None. [VERIFIED: codebase grep] |
| Secrets/env vars | Existing transcription env vars are read from `src/config/env.ts`; summary runtime will need new env names, but no existing secret key rename is required by this phase. [VERIFIED: codebase grep] | Add new summary env vars only; keep transcription env vars unchanged. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] |
| Build artifacts | None found for summary runtime yet; `dist/` output will refresh from source changes normally. [VERIFIED: repo scan] | None. [VERIFIED: repo scan] |

## Common Pitfalls

### Pitfall 1: Overwriting the final summary field
**What goes wrong:** The generator updates `episodes.summary` automatically and destroys the review boundary. [VERIFIED: .planning/REQUIREMENTS.md]
**Why it happens:** The repo already stores a `summary` column on the episode row, so it is tempting to reuse it as the draft store. [VERIFIED: src/database/sqlite.ts]
**How to avoid:** Write drafts to `summary.txt` and expose them separately; only `PUT /episodes/:id` should update the final DB summary. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: codebase grep]
**Warning signs:** A summary-generation primitive imports the repository update path or returns an updated `EpisodeRow.summary`. [VERIFIED: codebase grep]

### Pitfall 2: Leaving transcript-only state as the contract
**What goes wrong:** Phase 10 must special-case two different state-file shapes and later phases inherit fragmented operational state. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]
**Why it happens:** The current draft workflow only knows `transcript.state.json`. [VERIFIED: codebase grep]
**How to avoid:** Introduce `episode.state.json` now and make transcription read/write through shared helpers. [VERIFIED: codebase grep]
**Warning signs:** New summary code adds `summary.state.json` or duplicates version/progress fields in a second file. [VERIFIED: synthesis from codebase pattern]

### Pitfall 3: Unbounded context causing VPS memory spikes
**What goes wrong:** Large transcript prompts or oversized context settings make the local inference process too heavy for the 4 GB VPS target. [VERIFIED: .planning/PROJECT.md]
**Why it happens:** `llama.cpp` docs explicitly warn to start with a reasonable context size because memory can spike with larger settings. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md]
**How to avoid:** Keep summary execution sequential, make context size env-configurable, and default conservatively. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [CITED: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md]
**Warning signs:** Planning assumes parallel episode generation or hardcodes a large context without an operator override. [VERIFIED: .planning/REQUIREMENTS.md]

### Pitfall 4: Treating transcript text as trusted shell input
**What goes wrong:** Transcript contents can break the command invocation or create injection risk if embedded into shell strings. [VERIFIED: untrusted-input boundary + codebase pattern]
**Why it happens:** Summaries are generated from raw transcript text, which is effectively untrusted derived content. [VERIFIED: untrusted-input boundary]
**How to avoid:** Use temp files or stdin with `execFile`, never `bash -lc` plus interpolated transcript content. [VERIFIED: codebase grep] [ASSUMED]
**Warning signs:** The implementation builds one large shell command string that includes transcript text directly. [VERIFIED: synthesis from safe process pattern]

## Code Examples

Verified patterns from official sources and this codebase:

### Summary Config Validation Gate
```typescript
// Source: src/config/env.ts + src/services/episode-transcription.service.ts
const getSummaryConfigurationError = (): string | null => {
  if (!config.summary.enabled) return "Summary generation is disabled";
  if (!config.summary.command.trim()) return "EPISODE_SUMMARY_COMMAND is not configured";
  if (!config.summary.modelPath.trim()) return "EPISODE_SUMMARY_MODEL_PATH is not configured";
  return null;
};
```

### Shared Artifact Helpers
```typescript
// Source: episode-media-layout pattern from the existing media service
export const getEpisodeMediaDraftSummaryPath = (episodeId: number): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), "summary.txt");

export const getEpisodeMediaEpisodeStatePath = (episodeId: number): string =>
  path.join(getEpisodeMediaStagingDirectory(episodeId), "episode.state.json");
```

### Recommended CLI Invocation Shape
```typescript
// Source: official llama.cpp CLI docs + existing execFile usage
await execFileAsync(config.summary.command, [
  "-m",
  config.summary.modelPath,
  "-c",
  String(config.summary.contextSize),
  "-n",
  String(config.summary.maxTokens),
  "--log-disable",
  // prompt delivery mechanism stays runtime-specific; keep it argument-array based
], {
  timeout: config.summary.timeoutMs,
  maxBuffer: 8 * 1024 * 1024,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Transcript-only draft state file | Shared episode-level state document for multi-step AI workflow | Required by Phase 9 decisions on 2026-07-23. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] | Avoids per-step state drift and simplifies later API exposure. [VERIFIED: synthesis from context + codebase] |
| Persistent local model service assumption | One-shot local CLI invocation for a single sequential job | Current recommendation as of 2026-07-23. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md] | Lowers idle resource usage and matches repo worker patterns. [VERIFIED: codebase grep] |
| Draft summary stored in DB summary field | Draft summary stored as `summary.txt` beside media | Required by Phase 9 decisions on 2026-07-23. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] | Preserves editorial review and keeps DB state authoritative only after form submit. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] |

**Deprecated/outdated:**
- `transcript.state.json` as the primary forward contract is outdated for this milestone because Phase 9 locks a shared episode-level state file. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Qwen2.5-3B-Instruct` is the right default size/model family for this VPS rather than a smaller or larger local instruct model. [ASSUMED] | Standard Stack | Medium; planner may overfit the runtime contract to a model size that operators later replace. |
| A2 | The exact GGUF quant to deploy for Qwen should remain operator-selected instead of being locked in Phase 9. [ASSUMED] | Standard Stack | Medium; a later phase may need to pin one artifact for reproducible ops docs. |
| A3 | The chosen `llama.cpp` CLI invocation can stay runtime-specific without locking exact prompt-file flags in Phase 9. [ASSUMED] | Code Examples | Low; implementation still needs one concrete invocation shape before verification. |

## Open Questions (RESOLVED)

1. **Should Phase 9 pin one exact default GGUF artifact name or only the runtime contract?**
   - Resolution: Phase 9 locks only the env-driven runtime contract and example model family, not one mandatory GGUF artifact name. The backend must accept the model location through `EPISODE_SUMMARY_MODEL_PATH`, and Phase 11 operations docs can pin the deployed artifact after local validation. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: .planning/milestones/v1.2-ROADMAP.md]
   - Why this is locked: D-01 requires configuration-driven runtime selection, and the context leaves exact env naming and service boundaries to the agent, so locking the contract instead of a single artifact preserves operator control without reopening the architecture. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

2. **Should summary state live in staging only or be copied to the final episode folder after save?**
   - Resolution: Phase 9 locks `summary.txt` and `episode.state.json` to the episode staging directory as the canonical generation-time write target, matching the current draft transcript workflow. The media-layout contract must also support promoted final-path reads after save/sync so later phases can resolve the same artifacts before or after promotion without changing ownership rules. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: src/services/episode-media-layout.service.ts] [VERIFIED: src/services/episode-transcription.service.ts]
   - Why this is locked: Unsaved draft work already needs a staging-first home, while saved episodes already use promotion and final-path resolution in the existing media layout. Locking staging-first writes plus promotion-aware reads removes the ambiguity without changing the transcription engine per D-02, D-04, D-05, and D-08. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: src/services/episode-media-layout.service.ts]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node` | Backend runtime and scripts | ✓ | `v24.17.0` | — |
| `npm` | Build/typecheck commands | ✓ | `12.0.1` | — |
| `ffmpeg` | Existing transcription workflow continuity | ✓ | `4.2.7` | — |
| `ffprobe` | Existing transcription duration checks | ✓ | `4.2.7` | — |
| `python3` | Existing VPS worker bootstrap | ✓ | `3.8.10` | — |
| `whisper-cli` | Existing executable transcription path | ✗ on this machine | — | None for end-to-end transcription verification here. [VERIFIED: local command probe] |
| `llama-cli` | Proposed local summary runtime | ✗ on this machine | — | Another compatible local CLI could be used if wired through env, but that is not verified in this session. [ASSUMED] |

**Missing dependencies with no fallback:**
- `llama-cli` for executable summary-generation verification on this machine. [VERIFIED: local command probe]

**Missing dependencies with fallback:**
- None verified. [VERIFIED: local command probe]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected; `package.json` only contains a placeholder `test` script. [VERIFIED: package.json] |
| Config file | none — see Wave 0. [VERIFIED: repo scan] |
| Quick run command | `npm run typecheck` [VERIFIED: package.json] |
| Full suite command | `npm run build` [VERIFIED: package.json] |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUMM-01 | Transcript-only summary generation path is defined and executable behind a service boundary. [VERIFIED: .planning/REQUIREMENTS.md] | integration | `npm run build && NODE_ENV=development node dist/scripts/verify-summary-runtime-contract.js` | ❌ Wave 0 |
| FLOW-02 | Summary start is blocked until transcript artifact exists. [VERIFIED: .planning/REQUIREMENTS.md] | unit/integration | `npm run build && NODE_ENV=development node dist/scripts/verify-summary-runtime-contract.js --missing-transcript` | ❌ Wave 0 |
| OPS-01 | Runtime/model selection comes only from backend config. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm run typecheck` plus targeted config/service assertions | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run typecheck` [VERIFIED: package.json]
- **Per wave merge:** `npm run build` [VERIFIED: package.json]
- **Phase gate:** `npm run build` plus one executable summary workflow check before `$gsd-verify-work`. [VERIFIED: .planning/REQUIREMENTS.md]

### Wave 0 Gaps
- [ ] Add a dedicated backend verification script for summary workflow contract checks. [VERIFIED: package.json] [VERIFIED: .planning/REQUIREMENTS.md]
- [ ] Add a minimal test/verification harness or script target for summary runtime edge cases. [VERIFIED: repo scan]
- [ ] Install/verify the local summary CLI on the target environment before executable tests. [VERIFIED: local command probe]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 9 does not add a new auth flow; later endpoints should reuse existing admin auth. [VERIFIED: SDD + context] |
| V3 Session Management | no | Phase 9 adds runtime primitives, not new session behavior. [VERIFIED: SDD + context] |
| V4 Access Control | yes | Future trigger/read endpoints must stay behind `requireAuth`, matching current episode admin routes. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Validate episode IDs, transcript readiness, env config, and shared state payloads with existing TypeScript/Zod patterns. [VERIFIED: codebase grep] [VERIFIED: package.json] |
| V6 Cryptography | no | No new crypto primitive is introduced by this phase. [VERIFIED: phase scope] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via transcript-derived prompt handling | Elevation of Privilege | Use `execFile` with argument arrays and temp files/stdin; never interpolate transcript text into `bash -lc`. [VERIFIED: codebase grep] [ASSUMED] |
| Prompt injection or malformed content inside transcript text | Tampering | Treat transcript content as untrusted input, keep instructions in backend-owned prompt template, and post-validate output length/emptiness. [VERIFIED: untrusted-input boundary] [ASSUMED] |
| Path confusion between staging/final episode files | Tampering | Centralize all summary/transcript/state paths in `episode-media-layout.service.ts`. [VERIFIED: codebase grep] |
| Unauthorized draft generation or retrieval | Information Disclosure | Reuse existing protected route pattern for later API exposure. [VERIFIED: codebase grep] |

## Sources

### Primary (HIGH confidence)
- Codebase grep across `src/config/env.ts`, `src/services/episode-media-layout.service.ts`, `src/services/episode-transcription.service.ts`, `src/routes/episodes.routes.ts`, and `src/database/sqlite.ts` - existing config, file-layout, draft-state, and route patterns. [VERIFIED: codebase grep]
- `.planning/PROJECT.md` - architecture source of truth, backend ownership, and env conventions. [VERIFIED: .planning/PROJECT.md]
- `.planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md` - locked decisions for transcript-only input, env-driven runtime, shared state, and draft artifact boundaries. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md]

### Secondary (MEDIUM confidence)
- https://github.com/ggml-org/llama.cpp/blob/master/README.md - local CLI/server model, GGUF requirement, quantization, and supported Qwen family. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/README.md]
- https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md - current CLI options including `--hf-repo` defaults and `--log-disable`. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md]
- https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md - conservative context-size guidance because memory can spike. [CITED: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md]
- https://qwenlm.github.io/blog/qwen2.5/ - Qwen2.5 family multilingual and long-context capabilities. [CITED: https://qwenlm.github.io/blog/qwen2.5/]
- https://huggingface.co/Qwen/Qwen2.5-3B-Instruct - Qwen2.5-3B-Instruct model-card details for language support and context/generation limits. [CITED: https://huggingface.co/Qwen/Qwen2.5-3B-Instruct]

### Tertiary (LOW confidence)
- Exact recommended GGUF quant artifact for production deployment. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - the internal Node/service pattern is clear, but the exact deployed summary CLI binary and GGUF artifact are not yet installed or pinned in-repo. [VERIFIED: codebase grep] [ASSUMED]
- Architecture: HIGH - the repo already contains the config, file-layout, and draft-state patterns that Phase 9 should extend. [VERIFIED: codebase grep]
- Pitfalls: HIGH - the failure modes follow directly from locked phase decisions and the current transcription/state implementation. [VERIFIED: .planning/milestones/v1.2-phases/09-summary-runtime-and-draft-contract/09-CONTEXT.md] [VERIFIED: codebase grep]

**Research date:** 2026-07-23 [VERIFIED: local command `date -Iseconds`]
**Valid until:** 2026-08-22 for repo-internal architecture, 2026-07-30 for external runtime/model guidance. [VERIFIED: synthesis from source stability]
