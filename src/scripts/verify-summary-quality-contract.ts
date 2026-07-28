import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomInt } from "node:crypto";
import {
  buildSummaryPrompt,
  createEpisodeSummaryService,
  getEpisodeDraftSummary,
} from "../services/episode-summary.service";
import {
  getEpisodeMediaDraftStatePath,
  getEpisodeMediaDraftSummaryPath,
  getEpisodeMediaDraftTranscriptPath,
  getEpisodeMediaSummaryPath,
} from "../services/episode-media-layout.service";

const tempRoot = path.resolve(os.tmpdir(), "dragaocareca-summary-quality");

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

type SummaryRuntimeRequest = {
  command: string;
  args: string[];
  timeoutMs: number;
};

type SummaryRuntimeAdapter = {
  execute(request: SummaryRuntimeRequest): Promise<string>;
};

type RuntimeCapture = {
  requestBody: {
    episodeId: number;
    promptVersion: string;
    contextSize: number;
    maxTokens: number;
    prompt: string;
    transcript: string;
  } | null;
};

type QualityCase = {
  name: string;
  summaryText: string;
  expectViolation: string;
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

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

const createRuntimeConfig = async (): Promise<SummaryRuntimeConfig> => {
  ensureTempRoot();
  const runtimeDir = fs.mkdtempSync(path.join(tempRoot, "runtime-"));
  const modelPath = path.join(runtimeDir, "summary-model.gguf");
  await fs.promises.writeFile(modelPath, "fake-model", "utf8");

  return {
    enabled: true,
    provider: "llama",
    command: process.execPath,
    modelPath,
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

const createRuntime = (summaryText: string, capture: RuntimeCapture): SummaryRuntimeAdapter => ({
  async execute(request) {
    assert(request.command === process.execPath, "summary runtime command was not propagated");
    const promptIndex = request.args.indexOf("-f");
    assert(promptIndex >= 0, "summary runtime prompt file missing");
    const promptPath = request.args[promptIndex + 1];
    assert(promptPath, "summary runtime prompt path missing");
    const prompt = fs.readFileSync(promptPath, "utf8");
    const transcript = prompt.split("TRANSCRIPT:")[1]?.split("\n\nUSER:")[0]?.trim();
    if (!transcript) {
      throw new Error("request transcript missing");
    }

    assert(prompt.includes("pt-BR"), "prompt does not constrain output to pt-BR");
    assert(prompt.includes("TRANSCRIPT:"), "prompt missing transcript section");
    assert(prompt.includes(transcript.trim()), "prompt is not transcript-only");

    capture.requestBody = {
      episodeId: 0,
      promptVersion: "",
      contextSize: 0,
      maxTokens: 0,
      prompt,
      transcript,
    };

    return JSON.stringify({ summary: summaryText });
  },
});

const normalizeText = (value: string): string =>
  value
    .trim()
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const stripDiacritics = (value: string): string => value.normalize("NFD").replace(/\p{M}+/gu, "");

const countSentences = (summary: string): number => {
  const matches = summary.match(/[.!?](?:["')\]]+)?(?=\s|$)/g);
  return matches?.length ?? 0;
};

const countHighlightItems = (summary: string): number =>
  (summary.match(/^(?:-|•)\s+\S.+$/gm) ?? []).length;

const hasHighlightsSection = (summary: string): boolean =>
  /(?:^|\n)[^\n]*Destaques(?:\s+do episódio)?\s*:\s*(?:\n|$)/i.test(summary);

const extractKeywords = (text: string): string[] => {
  const stopwords = new Set([
    "a",
    "aos",
    "as",
    "ao",
    "com",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "em",
    "episodio",
    "episódio",
    "esta",
    "este",
    "isso",
    "mais",
    "na",
    "nas",
    "não",
    "no",
    "nos",
    "o",
    "os",
    "para",
    "por",
    "que",
    "resumo",
    "summary",
    "transcript",
    "um",
    "uma",
    "with",
    "the",
    "and",
    "this",
    "that",
    "episode",
    "about",
    "from",
    "for",
    "is",
    "are",
  ]);

  const tokens = stripDiacritics(text)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

  return [...new Set(tokens.filter((token) => token.length >= 4 && !stopwords.has(token)))];
};

const collectSummaryViolations = (summaryText: string, transcriptText: string): string[] => {
  const normalized = normalizeText(summaryText);
  const transcript = normalizeText(transcriptText);
  const violations: string[] = [];
  const summaryKeywords = new Set(extractKeywords(normalized));
  const transcriptKeywords = extractKeywords(transcript);
  const sharedKeywords = transcriptKeywords.filter((keyword) => summaryKeywords.has(keyword));
  const normalizedAscii = stripDiacritics(normalized).toLowerCase();
  const englishSignals = [" the ", " and ", " with ", " this ", " that ", " episode ", " summary ", " is ", " are ", " for "];

  if (normalized.length < 550 || normalized.length > 1800) {
    violations.push("summary length must stay between 550 and 1800 characters");
  }

  const sentenceCount = countSentences(normalized);
  if (sentenceCount < 3 || sentenceCount > 8) {
    violations.push("summary must contain 3-8 sentences");
  }

  const highlightItems = countHighlightItems(normalized);
  if (!hasHighlightsSection(normalized) || highlightItems < 3 || highlightItems > 6) {
    violations.push("summary must contain a Destaques section with 3-6 items");
  }

  if (englishSignals.some((signal) => normalizedAscii.includes(signal))) {
    violations.push("summary must be written in pt-BR");
  }

  if (sharedKeywords.length < 2) {
    violations.push("summary must reuse at least two transcript-specific terms");
  }

  if (normalized === transcript) {
    violations.push("summary must remain distinct from the transcript");
  }

  return violations;
};

const assertSummaryQuality = (summaryText: string, transcriptText: string): void => {
  const violations = collectSummaryViolations(summaryText, transcriptText);
  assert(violations.length === 0, `summary quality violations: ${violations.join("; ")}`);
};

const waitForStatus = async (
  service: ReturnType<typeof createEpisodeSummaryService>,
  episodeId: number,
  timeoutMs = 5000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = service.getEpisodeDraftSummaryStatus(episodeId);
    if (status.status === "done" || status.status === "error") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`timed out waiting for summary status on episode ${episodeId}`);
};

const makeEpisodeId = (): number => randomInt(100000, 999999);

const transcriptFixture = (episodeId: number): string =>
  [
    `O episodio ${episodeId} fala sobre RPG, jogos independentes e cultura pop.`,
    "Os convidados citam nomes proprios, franquias e referencias que ajudam a descoberta.",
    "O resumo precisa ser curto, fiel ao transcript e escrito em pt-BR.",
  ].join(" ");

const runPassCase = async (): Promise<void> => {
  const episodeId = makeEpisodeId();
  const transcript = transcriptFixture(episodeId);
  const rawSummary =
    "🎧 No episódio de hoje do Dragão Careca:\n\nQue assuntos fazem uma conversa sobre RPG e cultura pop render boas histórias?\n\nNeste episódio, a guilda conversa sobre RPG, jogos independentes e cultura pop, reunindo referências concretas que aparecem durante o papo. Entre franquias, nomes próprios e temas recorrentes da comunidade, os participantes conectam jogos e narrativas sem transformar cada menção em assunto principal. É uma conversa para quem procura referências nerds e histórias compartilhadas pela guilda.\n\n📜 Destaques do episódio:\n• jogos independentes e cultura pop\n• referências de RPG citadas pelos convidados\n• temas que voltam nas conversas da comunidade\n\n🎮 Se você gosta de RPG, jogos e cultura pop, este episódio é pra você.";
  const summaryConfig = await createRuntimeConfig();
  const capture: RuntimeCapture = { requestBody: null };
  const service = createEpisodeSummaryService({
    summaryConfig,
    runtime: createRuntime(rawSummary, capture),
  });

  await cleanupEpisodeWorkspace(episodeId);
  await writeTranscriptFixture(episodeId, transcript);

  const queueResult = await service.queueDraftEpisodeSummary(episodeId);
  assert(queueResult.queued, "expected summary queue to start");
  await waitForStatus(service, episodeId);

  const status = service.getEpisodeDraftSummaryStatus(episodeId);
  assert(status.status === "done", `expected done status, got ${status.status}`);
  const requestBody = capture.requestBody;
  if (!requestBody) {
    throw new Error("summary runtime request was not captured");
  }
  assert(requestBody.prompt.includes("pt-BR"), "prompt discipline check failed");
  assert(requestBody.transcript.trim() === transcript.trim(), "prompt transcript changed unexpectedly");

  const snapshot = getEpisodeDraftSummary(episodeId);
  const summaryText = snapshot.summaryText;
  if (!summaryText) {
    throw new Error("summary snapshot missing text");
  }
  assertSummaryQuality(summaryText, transcript);

  const promptPreview = buildSummaryPrompt({
    episodeId,
    transcript,
    promptVersion: summaryConfig.promptVersion,
    contextSize: summaryConfig.contextSize,
    maxTokens: summaryConfig.maxTokens,
  });
  assert(promptPreview.includes("pt-BR"), "summary prompt missing pt-BR instruction");
  assert(promptPreview.includes("No episódio de hoje do Dragão Careca"), "summary prompt missing feed style instruction");

  await cleanupEpisodeWorkspace(episodeId);
};

const runFailCase = async (testCase: QualityCase): Promise<void> => {
  const episodeId = makeEpisodeId();
  const transcript = transcriptFixture(episodeId);
  const summaryConfig = await createRuntimeConfig();
  const capture: RuntimeCapture = { requestBody: null };
  const service = createEpisodeSummaryService({
    summaryConfig,
    runtime: createRuntime(testCase.summaryText, capture),
  });

  await cleanupEpisodeWorkspace(episodeId);
  await writeTranscriptFixture(episodeId, transcript);

  const queueResult = await service.queueDraftEpisodeSummary(episodeId);
  assert(queueResult.queued, `expected summary queue to start for ${testCase.name}`);
  await waitForStatus(service, episodeId);

  const requestBody = capture.requestBody;
  if (!requestBody) {
    throw new Error(`summary runtime request was not captured for ${testCase.name}`);
  }
  const violations = collectSummaryViolations(testCase.summaryText, transcript);
  assert(violations.length > 0, `${testCase.name} should violate the summary quality contract`);
  assert(
    violations.some((violation) => violation.includes(testCase.expectViolation)),
    `${testCase.name} did not fail for the expected reason; got: ${violations.join("; ")}`
  );

  await cleanupEpisodeWorkspace(episodeId);
};

const main = async (): Promise<void> => {
  await runPassCase();

  const failingCases: QualityCase[] = [
    {
      name: "too-short-summary",
      summaryText: "Resumo curto demais para passar no contrato.",
      expectViolation: "between 550 and 1800 characters",
    },
    {
      name: "too-long-summary",
      summaryText:
        "Este resumo foi inflado de proposito para ultrapassar o limite e provar que o contrato encerra drafts excessivamente longos. Ele continua a repetir a mesma ideia sem necessidade, adicionando mais contexto, mais redundancia e mais palavras do que uma descrição editorial deveria conter. Isso nao deveria ser aceito porque o texto perde foco, fica cansativo e deixa de ser útil para descoberta. A mesma mensagem aparece outra vez apenas para empurrar o tamanho total acima do limite permitido. A repeticao continua de forma calculada para exceder o teto de caracteres. Cada frase extra reforca que o contrato precisa bloquear esse tipo de saida. O objetivo aqui e provar o erro de tamanho com folga suficiente. ".repeat(3),
      expectViolation: "between 550 and 1800 characters",
    },
    {
      name: "wrong-sentence-count",
      summaryText:
        "Este resumo tem apenas uma frase longa, ainda que mencione RPG, jogos independentes, cultura pop e nomes proprios suficientes para ficar acima do limite minimo de tamanho e continuar explicando como os convidados conectam assuntos recorrentes, jogos, narrativas e referencias da comunidade em uma conversa voltada para ouvintes que procuram cultura nerd, humor e histórias compartilhadas sem precisar de uma lista de tópicos. ".repeat(2),
      expectViolation: "3-8 sentences",
    },
    {
      name: "non-pt-br-summary",
      summaryText:
        "The episode talks about RPG, indie games, and pop culture with concrete references that matter to the community. The discussion connects recurring stories, games, and nerd culture without turning isolated comments into the main topic. This editorial description is intentionally long enough to satisfy the length requirement while it remains written in English and should therefore be rejected by the language quality rule.\n\nHighlights:\n- indie games and RPG references\n- recurring stories from the community\n- conversations about pop culture",
      expectViolation: "pt-BR",
    },
  ];

  for (const testCase of failingCases) {
    await runFailCase(testCase);
  }

  console.log("verified summary quality contract");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
