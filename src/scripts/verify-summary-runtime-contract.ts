import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomInt } from "node:crypto";
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
import { config } from "../config/env";
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
  provider: string;
  command: string;
  modelPath: string;
  contextSize: number;
  maxTokens: number;
  timeoutMs: number;
  promptVersion: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiApiBaseUrl: string;
  geminiThinkingLevel: string;
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
const promptIndex = args.indexOf("-f");
if (promptIndex < 0 || !args[promptIndex + 1]) {
  console.error("missing prompt file");
  process.exit(1);
}

const prompt = fs.readFileSync(args[promptIndex + 1], "utf8");
if (!prompt.includes("pt-BR")) {
  console.error("missing pt-BR prompt");
  process.exit(1);
}

if (!prompt.includes("TRANSCRIPT:") || !prompt.split("TRANSCRIPT:")[1].trim()) {
  console.error("missing transcript");
  process.exit(1);
}

const summary = [
  "O episodio discute temas concretos presentes no transcript, com nomes, jogos e referencias que ajudam a descoberta.",
  "O texto permanece fiel ao conteudo e escrito em pt-BR sem cair em keyword stuffing.",
  "A leitura final organiza os assuntos para quem procura o episodio por temas especificos.",
  "",
  "Destaques:",
  "- RPG, games e cultura pop",
  "- Referencias e nomes citados no episodio",
  "- Termos concretos para descoberta"
].join("\\n");

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
    provider: "llama",
    command: fakeRuntime.command,
    modelPath: fakeRuntime.modelPath,
    contextSize: 4096,
    maxTokens: 256,
    timeoutMs: 15000,
    promptVersion: "1",
    geminiApiKey: "",
    geminiModel: "gemini-3.6-flash",
    geminiApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    geminiThinkingLevel: "low",
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
  const episodeId = randomInt(1_000_000_000, 2_000_000_000);
  const summaryConfig = await createRuntimeConfig();
  const runtimeCalls: Array<{ command: string; args: string[] }> = [];
  const service = createEpisodeSummaryService({
    summaryConfig,
    runtime: {
      async execute(request) {
        runtimeCalls.push({ command: request.command, args: request.args });
        const promptIndex = request.args.indexOf("-f");
        assert(promptIndex >= 0, "runtime missing prompt file argument");
        const promptPath = request.args[promptIndex + 1];
        assert(promptPath, "runtime missing prompt file path");
        const prompt = fs.readFileSync(promptPath, "utf8");
        assert(prompt.includes("pt-BR"), "prompt contract missing pt-BR");
        assert(prompt.includes("TRANSCRIPT:") && prompt.includes("RPG"), "transcript contract missing");
        return JSON.stringify({
          summary:
            "🎧 No episódio de hoje do Dragão Careca:\n\nComo RPG, games e cultura pop podem se encontrar na mesma conversa?\n\nNeste episódio, a guilda discute RPG, games e cultura pop com nomes e referências claras. A conversa mantém o foco em assuntos concretos, sem transformar termos pesquisáveis em keyword stuffing. É uma descrição para quem procura o episódio por temas nerds e referências citadas no papo.\n\n📜 Destaques do episódio:\n• RPG, games e cultura pop\n• nomes e referências citadas\n• termos concretos para busca\n\n🎮 Se você gosta de RPG, games e cultura pop, este episódio é pra você.",
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

const runGeminiSuccessCase = async (): Promise<void> => {
  const episodeId = randomInt(1_000_000_000, 2_000_000_000);
  const transcript = makeTranscriptFixture(episodeId);
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let summaryRequestCount = 0;
  const summary = [
    "🎧 No episódio de hoje do Dragão Careca:",
    "",
    "Como RPG, games e cultura pop se misturam nas conversas da guilda?",
    "",
    "Neste episódio, a conversa passa por RPG, games e cultura pop, reunindo referências que fazem parte do assunto principal.",
    "Os convidados retomam nomes e franquias citados durante o papo, mantendo o foco em temas concretos para quem procura o episódio.",
    "A descrição organiza os pontos centrais sem transformar a conversa em uma lista de falas ou promessas exageradas.",
    "",
    "📜 Destaques do episódio:",
    "• RPG, games e cultura pop",
    "• franquias e referências citadas",
    "• temas concretos para descoberta",
    "",
    "🎮 Se você gosta de RPG, games e cultura pop, este episódio é pra você.",
  ].join("\n");

  globalThis.fetch = async (input, init) => {
    requestCount += 1;
    assert(String(input).endsWith("/models/gemini-3.6-flash:generateContent"), "Gemini endpoint was not used");
    const requestHeaders = new Headers(init?.headers);
    assert(requestHeaders.get("x-goog-api-key") === "test-gemini-key", "Gemini API key header missing");
    summaryRequestCount += 1;
    const body = JSON.parse(String(init?.body)) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
      generationConfig?: {
        thinkingConfig?: { thinkingLevel?: string };
        responseFormat?: { text?: { mimeType?: string; schema?: { properties?: Record<string, unknown> } } };
      };
    };
    const prompt = body.contents?.[0]?.parts?.[0]?.text ?? "";
    assert(prompt.includes("OBJETIVO EDITORIAL E SEO"), "Gemini prompt missing SEO instructions");
    assert(prompt.includes("REGRAS DE FIDELIDADE"), "Gemini prompt missing fidelity instructions");
    assert(prompt.includes("REFERENCIA DE ESTILO DO FEED DE PRODUCAO"), "Gemini prompt missing feed style reference");
    assert(prompt.includes("Destaques do episódio"), "Gemini prompt missing production highlights format");
    assert(prompt.includes(transcript), "Gemini prompt must contain the complete transcript");
    assert(body.generationConfig?.thinkingConfig?.thinkingLevel === "low", "Gemini thinking level missing");
    assert(body.generationConfig?.responseFormat?.text?.mimeType === "APPLICATION_JSON", "Gemini JSON response format missing");
    assert("summary" in (body.generationConfig?.responseFormat?.text?.schema?.properties ?? {}), "Gemini summary schema missing");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary }) }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const service = createEpisodeSummaryService({
      summaryConfig: {
        enabled: true,
        provider: "gemini",
        command: "",
        modelPath: "",
        contextSize: 4096,
        maxTokens: 256,
        timeoutMs: 15000,
        promptVersion: "3",
        geminiApiKey: "test-gemini-key",
        geminiModel: "gemini-3.6-flash",
        geminiApiBaseUrl: "https://gemini.test/v1beta",
        geminiThinkingLevel: "low",
      },
    });

    await cleanupEpisodeWorkspace(episodeId);
    await writeTranscriptFixture(episodeId, transcript);
    const queueResult = await service.queueDraftEpisodeSummary(episodeId);
    assert(queueResult.queued, "expected Gemini summary queue to start");
    await waitForStatus(service, episodeId, ["done", "error"]);
    const snapshot = service.getEpisodeDraftSummaryStatus(episodeId);
    assert(snapshot.status === "done", `expected Gemini done status, got ${snapshot.status}`);
    assert(summaryRequestCount === 1, `expected one Gemini summary request, got ${summaryRequestCount} (total Gemini requests: ${requestCount})`);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupEpisodeWorkspace(episodeId);
  }
};

const runMissingTranscriptCase = async (): Promise<void> => {
  const episodeId = randomInt(1_000_000_000, 2_000_000_000);
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
  const episodeId = randomInt(1_000_000_000, 2_000_000_000);
  const service = createEpisodeSummaryService({
    summaryConfig: {
      enabled: true,
      provider: "llama",
      command: "",
      modelPath: "",
      contextSize: 4096,
      maxTokens: 256,
      timeoutMs: 15000,
      promptVersion: "1",
      geminiApiKey: "",
      geminiModel: "gemini-3.6-flash",
      geminiApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      geminiThinkingLevel: "low",
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
  const originalHashtagAuthoringEnabled = config.youtube.hashtagAuthoring.enabled;
  config.youtube.hashtagAuthoring.enabled = false;
  try {
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
  await runGeminiSuccessCase();
  console.log("verified summary runtime contract");
  } finally {
    config.youtube.hashtagAuthoring.enabled = originalHashtagAuthoringEnabled;
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
