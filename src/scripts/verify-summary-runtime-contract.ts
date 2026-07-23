import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  abortDraftEpisodeSummary,
  buildSummaryPrompt,
  createEpisodeSummaryService,
  getEpisodeDraftSummary,
  getEpisodeDraftSummaryStatus,
  normalizeSummaryDraft,
  queueDraftEpisodeSummary,
  syncDraftEpisodeSummary,
} from "../services/episode-summary.service";
import {
  getEpisodeMediaDraftStatePath,
  getEpisodeMediaDraftSummaryPath,
  getEpisodeMediaDraftTranscriptPath,
  getEpisodeMediaSummaryPath,
} from "../services/episode-media-layout.service";

const tempRoot = path.resolve(os.tmpdir(), "dragaocareca-summary-contract");

type RuntimeMode = "success" | "missingTranscript" | "runtimeConfigError";

type SummaryRuntimeConfig = {
  enabled: boolean;
  command: string;
  modelPath: string;
  contextSize: number;
  maxTokens: number;
  timeoutMs: number;
  promptVersion: string;
};

type ContractResult = {
  queued: boolean;
  version: number;
  status: string;
  progress: number | null;
  error?: string | null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ensureTempRoot = (): void => {
  fs.mkdirSync(tempRoot, { recursive: true });
};

const cleanupEpisodeWorkspace = async (episodeId: number): Promise<void> => {
  const directories = new Set([
    path.dirname(getEpisodeMediaDraftTranscriptPath(episodeId)),
    path.dirname(getEpisodeMediaDraftSummaryPath(episodeId)),
    path.dirname(getEpisodeMediaDraftStatePath(episodeId)),
    path.dirname(getEpisodeMediaSummaryPath(episodeId)),
  ]);

  for (const dir of directories) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const writeTranscriptFixture = async (episodeId: number, transcript: string): Promise<void> => {
  const transcriptPath = getEpisodeMediaDraftTranscriptPath(episodeId);
  await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
  await fs.promises.writeFile(transcriptPath, `${transcript.trim()}\n`, "utf8");
};

const createFakeRuntime = async (): Promise<{ command: string; modelPath: string }> => {
  ensureTempRoot();
  const runtimeDir = fs.mkdtempSync(path.join(tempRoot, "runtime-"));
  const modelPath = path.join(runtimeDir, "summary-model.gguf");
  const commandPath = path.join(runtimeDir, "fake-summary-runtime.js");

  await fs.promises.writeFile(modelPath, "fake-model", "utf8");

  const runtimeScript = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const requestIndex = args.indexOf("--request-file");
if (requestIndex < 0 || !args[requestIndex + 1]) {
  console.error("missing request file");
  process.exit(1);
}

const requestPath = args[requestIndex + 1];
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
if (typeof request.prompt !== "string" || !request.prompt.includes("pt-BR")) {
  console.error("missing pt-BR prompt");
  process.exit(1);
}

if (typeof request.transcript !== "string" || !request.transcript.trim()) {
  console.error("missing transcript");
  process.exit(1);
}

const summary = [
  "O episodio discute temas concretos presentes no transcript, com nomes, jogos e referencias que ajudam a descoberta.",
  "O texto permanece curto, fiel ao conteudo e escrito em pt-BR sem cair em keyword stuffing.",
  "A leitura final continua util para a equipe editorial e para quem procura o episodio por assunto."
].join(" ");

process.stdout.write(JSON.stringify({ summary }) + "\\n");
`;

  await fs.promises.writeFile(commandPath, runtimeScript, "utf8");
  await fs.promises.chmod(commandPath, 0o755);

  return { command: commandPath, modelPath };
};

const createRuntimeConfig = async (): Promise<SummaryRuntimeConfig> => {
  const fakeRuntime = await createFakeRuntime();
  return {
    enabled: true,
    command: fakeRuntime.command,
    modelPath: fakeRuntime.modelPath,
    contextSize: 4096,
    maxTokens: 256,
    timeoutMs: 15000,
    promptVersion: "1",
  };
};

const waitForStatus = async (
  service: ReturnType<typeof createEpisodeSummaryService>,
  episodeId: number,
  expected: Array<string>,
  timeoutMs = 5000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = service.getEpisodeDraftSummaryStatus(episodeId);
    if (expected.includes(snapshot.status)) {
      return;
    }
    await sleep(100);
  }

  throw new Error(`timed out waiting for summary status: ${expected.join(", ")}`);
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const makeTranscriptFixture = (
  episodeId: number
): string =>
  [
    `Episodio ${episodeId} com conversa sobre RPG, games e cultura pop.`,
    "Os convidados citam franquias, nomes proprios e temas descobriveis para busca.",
    "O resumo precisa ficar curto, fiel ao transcript e em pt-BR.",
  ].join(" ");

const runSuccessCase = async (): Promise<void> => {
  const episodeId = Number(`9${randomUUID().replace(/-/g, "").slice(0, 10)}`);
  const summaryConfig = await createRuntimeConfig();
  const runtimeCalls: Array<{ command: string; args: string[] }> = [];
  const service = createEpisodeSummaryService({
    summaryConfig,
    runtime: {
      async execute(request) {
        runtimeCalls.push({ command: request.command, args: request.args });
        const requestIndex = request.args.indexOf("--request-file");
        assert(requestIndex >= 0, "runtime missing request-file argument");
        const requestPath = request.args[requestIndex + 1];
        assert(requestPath, "runtime missing request file path");
        const requestBody = JSON.parse(fs.readFileSync(requestPath, "utf8")) as { prompt?: string; transcript?: string };
        assert(typeof requestBody.prompt === "string" && requestBody.prompt.includes("pt-BR"), "prompt contract missing pt-BR");
        assert(typeof requestBody.transcript === "string" && requestBody.transcript.includes("RPG"), "transcript contract missing");
        return JSON.stringify({
          summary:
            "O episodio discute RPG, games e cultura pop com nomes e referencias claras. O texto fica curto, fiel ao transcript e escrito em pt-BR. O resultado mantem termos pesquisaveis sem virar keyword stuffing.",
        });
      },
    },
  });

  await cleanupEpisodeWorkspace(episodeId);
  await writeTranscriptFixture(episodeId, makeTranscriptFixture(episodeId));

  const queueResult = (await service.queueDraftEpisodeSummary(episodeId)) as ContractResult;
  assert(queueResult.queued, "expected summary queue to start");
  await waitForStatus(service, episodeId, ["done", "error"]);

  const statusAfterQueue = service.getEpisodeDraftSummaryStatus(episodeId);
  assert(statusAfterQueue.status === "done", `expected done status, got ${statusAfterQueue.status}`);
  assert(statusAfterQueue.summaryFileName?.endsWith("summary.txt") ?? false, "summary file name missing");
  assert(statusAfterQueue.promptVersion === summaryConfig.promptVersion, "prompt version not recorded");
  const summarySnapshot = getEpisodeDraftSummary(episodeId);
  assert((summarySnapshot.summaryText?.length ?? 0) > 0, "summary text missing from snapshot");
  assert(fs.existsSync(getEpisodeMediaDraftSummaryPath(episodeId)), "draft summary file missing");
  assert(fs.existsSync(getEpisodeMediaDraftTranscriptPath(episodeId)), "draft transcript missing");

  const draftSummary = fs.readFileSync(getEpisodeMediaDraftSummaryPath(episodeId), "utf8").trim();
  const transcriptText = fs.readFileSync(getEpisodeMediaDraftTranscriptPath(episodeId), "utf8").trim();
  assert(draftSummary.length > 0, "draft summary empty");
  assert(transcriptText.includes("RPG"), "transcript content changed unexpectedly");
  assert(draftSummary !== transcriptText, "summary must remain distinct from transcript");

  const syncResult = await service.syncDraftEpisodeSummary(episodeId);
  assert(syncResult.status === "done", "sync did not preserve done status");
  assert(fs.existsSync(getEpisodeMediaSummaryPath(episodeId)), "final summary file missing after sync");
  assert(!fs.existsSync(getEpisodeMediaDraftSummaryPath(episodeId)), "draft summary should be promoted away after sync");
  assert(
    fs.readFileSync(getEpisodeMediaSummaryPath(episodeId), "utf8").trim() === draftSummary,
    "promoted summary differs from draft summary"
  );

  const normalized = normalizeSummaryDraft(draftSummary);
  assert(normalized.length > 0, "normalized summary should not be empty");
  const promptPreview = buildSummaryPrompt({
    episodeId,
    transcript: transcriptText,
    promptVersion: summaryConfig.promptVersion,
    contextSize: summaryConfig.contextSize,
    maxTokens: summaryConfig.maxTokens,
  });
  assert(promptPreview.includes("pt-BR"), "summary prompt missing pt-BR instruction");
  assert(runtimeCalls.length > 0, "runtime was not invoked");

  await cleanupEpisodeWorkspace(episodeId);
};

const runMissingTranscriptCase = async (): Promise<void> => {
  const episodeId = Number(`8${randomUUID().replace(/-/g, "").slice(0, 10)}`);
  const summaryConfig = await createRuntimeConfig();
  const service = createEpisodeSummaryService({ summaryConfig });

  await cleanupEpisodeWorkspace(episodeId);

  const result = (await service.queueDraftEpisodeSummary(episodeId)) as ContractResult;
  assert(!result.queued, "queue should fail without transcript");
  const status = service.getEpisodeDraftSummaryStatus(episodeId);
  assert(status.status === "error", "missing transcript should mark error");
  assert(status.error?.toLowerCase().includes("transcript"), "missing transcript error not recorded");
  assert(!fs.existsSync(getEpisodeMediaDraftSummaryPath(episodeId)), "summary draft should not exist");

  await cleanupEpisodeWorkspace(episodeId);
};

const runRuntimeConfigErrorCase = async (): Promise<void> => {
  const episodeId = Number(`7${randomUUID().replace(/-/g, "").slice(0, 10)}`);
  const service = createEpisodeSummaryService({
    summaryConfig: {
      enabled: true,
      command: "",
      modelPath: "",
      contextSize: 4096,
      maxTokens: 256,
      timeoutMs: 15000,
      promptVersion: "1",
    },
  });

  const error = service.getSummaryConfigurationError();
  assert(error?.includes("EPISODE_SUMMARY_COMMAND") ?? false, "expected missing command error");

  await cleanupEpisodeWorkspace(episodeId);
};

const parseArgs = (): RuntimeMode => {
  const argv = process.argv.slice(2);
  if (argv.includes("--missing-transcript")) {
    return "missingTranscript";
  }

  if (argv.includes("--expect-runtime-config-error")) {
    return "runtimeConfigError";
  }

  return "success";
};

const main = async (): Promise<void> => {
  const mode = parseArgs();

  if (mode === "missingTranscript") {
    await runMissingTranscriptCase();
    console.log("verified summary contract without transcript");
    return;
  }

  if (mode === "runtimeConfigError") {
    await runRuntimeConfigErrorCase();
    console.log("verified summary runtime config failure path");
    return;
  }

  await runSuccessCase();
  console.log("verified summary runtime contract");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
