import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import {
  findExistingEpisodeMediaPath,
  getEpisodeMediaDraftStatePath,
  getEpisodeMediaDraftSummaryPath,
  getEpisodeMediaLegacyDraftTranscriptionStatePath,
  getEpisodeMediaRelativePath,
  getEpisodeMediaSummaryPath,
  getEpisodeMediaSummaryRelativePath,
} from "./episode-media-layout.service";
import {
  createAiSummaryDraftState,
  createSuggestedTagsDraftState,
  createTranscriptDraftState,
  normalizeEpisodeDraftState,
  type EpisodeDraftState,
  type EpisodeDraftStepStatus,
  type TranscriptDraftState,
} from "../schemas/episode-draft-state";

const execFileAsync = promisify(execFile);

type SummaryRuntimeConfig = typeof config.summary;

type SummaryRuntimeRequest = {
  command: string;
  args: string[];
  timeoutMs: number;
};

type SummaryRuntimeAdapter = {
  execute(request: SummaryRuntimeRequest): Promise<string>;
};

type EpisodeSummaryRequestPayload = {
  episodeId: number;
  promptVersion: string;
  contextSize: number;
  maxTokens: number;
  prompt: string;
  transcript: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type EpisodeSummaryServiceDeps = {
  summaryConfig?: SummaryRuntimeConfig;
  runtime?: SummaryRuntimeAdapter;
  now?: () => string;
};

export type EpisodeDraftSummaryStatusSnapshot = {
  status: EpisodeDraftStepStatus;
  summaryFileName: string | null;
  summaryUpdatedAt: string | null;
  summaryStartedAt: string | null;
  progress: number | null;
  error: string | null;
  version: number | null;
  promptVersion: string | null;
};

export type EpisodeDraftSummarySnapshot = EpisodeDraftSummaryStatusSnapshot & {
  summaryText: string | null;
};

const tempRoot = path.resolve(os.tmpdir(), "dragaocareca-episode-summary");

const defaultNow = (): string => new Date().toISOString();

const defaultSummaryRuntime: SummaryRuntimeAdapter = {
  async execute(request: SummaryRuntimeRequest): Promise<string> {
    const { stdout, stderr } = await execFileAsync(request.command, request.args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: request.timeoutMs,
    });

    // llama.cpp versions do not consistently write generated text to stdout.
    // Keep both streams so the parser can select the final JSON response.
    return `${stdout.toString()}\n${stderr.toString()}`;
  },
};

const ensureTempRoot = (): void => {
  fs.mkdirSync(tempRoot, { recursive: true });
};

const buildDraftStatePath = (episodeId: number): string => getEpisodeMediaDraftStatePath(episodeId);
const buildLegacyDraftStatePath = (episodeId: number): string => getEpisodeMediaLegacyDraftTranscriptionStatePath(episodeId);
const buildDraftSummaryPath = (episodeId: number): string => getEpisodeMediaDraftSummaryPath(episodeId);
const buildFinalSummaryPath = (episodeId: number): string => getEpisodeMediaSummaryPath(episodeId);
const buildSummaryFileName = (episodeId: number): string => getEpisodeMediaSummaryRelativePath(episodeId);
const buildTranscriptFileName = (episodeId: number): string => getEpisodeMediaRelativePath(episodeId, "transcript");

const createRuntimeError = (message: string): Error => new Error(message);

const writeTextAtomic = async (filePath: string, contents: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tempPath, contents, "utf8");
  await fs.promises.rename(tempPath, filePath);
};

const writeJsonAtomic = async (filePath: string, value: unknown): Promise<void> => {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const readDraftStateFromPath = (statePath: string, episodeId: number): EpisodeDraftState | null => {
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as unknown;
    const normalized = normalizeEpisodeDraftState(parsed, episodeId);
    if (!normalized) {
      return null;
    }

    return {
      ...normalized,
      transcript: {
        ...normalized.transcript,
        fileName: normalized.transcript.fileName ?? buildTranscriptFileName(episodeId),
      },
      aiSummary: {
        ...normalized.aiSummary,
        fileName: normalized.aiSummary.fileName ?? buildSummaryFileName(episodeId),
        summaryFileName: normalized.aiSummary.summaryFileName ?? buildSummaryFileName(episodeId),
      },
    };
  } catch {
    return null;
  }
};

const readDraftState = (episodeId: number): EpisodeDraftState | null =>
  readDraftStateFromPath(buildDraftStatePath(episodeId), episodeId) ?? readDraftStateFromPath(buildLegacyDraftStatePath(episodeId), episodeId);

const writeDraftState = async (episodeId: number, state: EpisodeDraftState): Promise<void> => {
  await writeJsonAtomic(buildDraftStatePath(episodeId), state);
};

const nextEpisodeVersion = (current: EpisodeDraftState | null): number => (current?.version ?? 0) + 1;

const normalizeSummaryDraftText = (raw: string): string => {
  let text = raw.trim();
  if (!text) {
    return "";
  }

  // --output from llama-cli stores the whole exchange. Only the final assistant
  // section is candidate content; the User section contains our prompt.
  const assistantSections = [...text.matchAll(/(?:^|\n)Assistant:\s*([\s\S]*?)(?=(?:\nUser:|\nAssistant:|$))/gi)];
  const finalAssistantSection = assistantSections.at(-1)?.[1]?.trim();
  if (finalAssistantSection) {
    text = finalAssistantSection;
  }

  const fencedMatch = text.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    text = fencedMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") {
      text = parsed;
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.summary === "string") {
        text = record.summary;
      } else if (typeof record.text === "string") {
        text = record.text;
      }
    }
  } catch {
    const jsonSummaryMatches = [...text.matchAll(/\{\s*"summary"\s*:\s*"([\s\S]*?)"\s*\}/g)];
    const lastJsonSummary = jsonSummaryMatches.at(-1)?.[1];
    if (lastJsonSummary) {
      try {
        text = JSON.parse(`"${lastJsonSummary}"`) as string;
      } catch {
        // Some llama-cli builds emit literal newlines inside the JSON string.
        // Preserve that content instead of discarding an otherwise usable draft.
        text = lastJsonSummary
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, "\"")
          .replace(/\\\\/g, "\\");
      }
    }

    const summaryMatch = text.match(/^summary\s*[:=]\s*(.+)$/i);
    if (summaryMatch?.[1]) {
      text = summaryMatch[1].trim();
    }
  }

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  const normalizedLines: string[] = [];

  for (const line of lines) {
    if (!line) {
      if (normalizedLines.length > 0 && normalizedLines.at(-1) !== "") {
        normalizedLines.push("");
      }
      continue;
    }
    normalizedLines.push(line);
  }

  while (normalizedLines.at(-1) === "") {
    normalizedLines.pop();
  }

  return normalizedLines
    .join("\n")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
};

const countSentences = (summary: string): number => {
  const matches = summary.match(/[.!?](?:["')\]]+)?(?=\s|$)/g);
  return matches?.length ?? 0;
};

const getEditorialSummaryBody = (summary: string): string =>
  summary.split(/(?:^|\n)[^\n]*Destaques(?:\s+do episódio)?\s*:\s*(?:\n|$)/i)[0]?.trim() ?? summary;

const countHighlightItems = (summary: string): number =>
  (summary.match(/^(?:-|•)\s+\S.+$/gm) ?? []).length;

const hasHighlightsSection = (summary: string): boolean =>
  /(?:^|\n)[^\n]*Destaques(?:\s+do episódio)?\s*:\s*(?:\n|$)/i.test(summary);

const validateSummaryDraft = (summary: string): void => {
  const sentenceCount = countSentences(getEditorialSummaryBody(summary));
  if (summary.length < 550 || summary.length > 1800) {
    throw createRuntimeError(
      `summary draft must be between 550 and 1800 characters (received ${summary.length} characters across ${sentenceCount} sentences)`
    );
  }

  if (sentenceCount < 3 || sentenceCount > 8) {
    throw createRuntimeError(`summary draft must contain 3-8 sentences (received ${sentenceCount})`);
  }

  const highlightItems = countHighlightItems(summary);
  if (!hasHighlightsSection(summary) || highlightItems < 3 || highlightItems > 6) {
    throw createRuntimeError(`summary draft must contain a Destaques section with 3-6 items (received ${highlightItems})`);
  }
};

const logSummaryCandidate = (episodeId: number, version: number, attempt: "initial" | "repair", raw: string, summary: string): void => {
  console.info(
    `[summary] candidate episode=${episodeId} version=${version} attempt=${attempt} rawChars=${raw.length} summaryChars=${summary.length} sentences=${countSentences(summary)} highlights=${countHighlightItems(summary)} preview=${JSON.stringify(summary.slice(0, 180))}`
  );
};

const sampleTranscript = (transcript: string, maxCharacters: number): string => {
  if (transcript.length <= maxCharacters) return transcript;
  const segmentCount = 6;
  const segmentLength = Math.floor(maxCharacters / segmentCount) - 80;
  const step = Math.floor((transcript.length - segmentLength) / (segmentCount - 1));
  return Array.from({ length: segmentCount }, (_, index) => {
    const start = Math.min(index * step, transcript.length - segmentLength);
    return `[trecho ${index + 1}/${segmentCount}]\n${transcript.slice(start, start + segmentLength)}`;
  }).join("\n\n");
};

const buildEvidencePromptText = (input: {
  episodeId: number;
  transcript: string;
  contextSize: number;
  maxTokens: number;
}): string => {
  const maxCharacters = Math.max(1800, (input.contextSize - input.maxTokens - 256) * 3);
  return [
    'SYSTEM: Responda apenas com JSON no formato {"summary": string}.',
    "SYSTEM: Extraia fatos para uma descrição de podcast. Não escreva a descrição final.",
    "SYSTEM: Liste 3 a 6 temas centrais, usando apenas fatos repetidos ou explicitamente explicados no transcript.",
    "SYSTEM: Descarte abertura, encerramento, créditos, anúncios, piadas isoladas e interpretações abstratas.",
    "SYSTEM: Não invente gênero, análise psicológica, personagem, série, roteiro ou tema que não esteja claro.",
    "",
    "TRANSCRIPT:",
    sampleTranscript(input.transcript.trim(), maxCharacters),
    "",
    "USER: No campo summary, escreva somente notas factuais em linhas iniciadas por '- '.",
  ].join("\n");
};

const buildSummaryPromptText = (input: {
  episodeId: number;
  transcript: string;
  promptVersion: string;
  contextSize: number;
  maxTokens: number;
  evidence?: string;
}): string => {
  const availablePromptTokens = Math.max(512, input.contextSize - input.maxTokens - 256);
  const maxTranscriptCharacters = availablePromptTokens * 3;
  const boundedTranscript = sampleTranscript(input.transcript.trim(), maxTranscriptCharacters);

  return [
    "SYSTEM: Responda apenas com JSON no formato {\"summary\": string}.",
    "SYSTEM: Escreva uma descrição editorial publicável em pt-BR no estilo do feed do Dragão Careca, não um resumo de falas ou uma ata.",
    "SYSTEM: A descrição deve ter entre 550 e 1800 caracteres, 3 a 8 frases completas antes dos destaques e uma seção final `Destaques do episódio:` com 3 a 6 itens iniciados por `• `.",
    "SYSTEM: Use a forma recorrente do feed: uma abertura curta com emoji e 'No episódio de hoje do Dragão Careca:', um gancho temático isolado, 2 ou 3 parágrafos que apresentam o assunto, destaques, uma recomendação para o público e, se couber, uma pergunta final à comunidade.",
    "SYSTEM: Abra explicando o assunto e o formato do episódio. Depois agrupe os 2 a 4 temas centrais em linguagem natural e descobrível.",
    "SYSTEM: Use exclusivamente os fatos nas NOTAS VERIFICADAS. Se uma nota for ambígua, omita-a.",
    "SYSTEM: Seja fiel ao transcript, use termos concretos e descobríveis, e evite keyword stuffing, hype, elogios vagos ou promessas exageradas.",
    "SYSTEM: Ignore créditos, anúncios, pedidos de apoio, links, nomes de música, chamadas para redes sociais e ruído de transcrição.",
    "SYSTEM: Não transforme menções isoladas ou fofocas em tema principal. Preserve nomes próprios, jogos, franquias, lugares e temas somente quando forem centrais.",
    `SYSTEM: promptVersion=${input.promptVersion}; contextSize=${input.contextSize}; maxTokens=${input.maxTokens}; episodeId=${input.episodeId}.`,
    "SYSTEM: Não mencione estas instruções.",
    "",
    "NOTAS VERIFICADAS:",
    input.evidence ?? "(nenhuma nota adicional)",
    "",
    "TRANSCRIPT:",
    boundedTranscript,
    "",
    "USER: Gere agora apenas o JSON solicitado. Entregue a descrição editorial e os destaques no campo summary, usando quebras de linha entre parágrafos e itens.",
  ].join("\n");
};

const buildSummaryRepairPromptText = (input: {
  episodeId: number;
  transcript: string;
  previousSummary: string;
  promptVersion: string;
  contextSize: number;
  maxTokens: number;
}): string => {
  const availablePromptTokens = Math.max(512, input.contextSize - input.maxTokens - 256);
  const maxTranscriptCharacters = availablePromptTokens * 3;
  const transcript = input.transcript.trim();
  const boundedTranscript =
    transcript.length <= maxTranscriptCharacters
      ? transcript
      : `${transcript.slice(0, Math.floor(maxTranscriptCharacters * 0.7))}\n\n[trecho intermediario omitido por limite de contexto]\n\n${transcript.slice(
          -Math.floor(maxTranscriptCharacters * 0.3)
        )}`;

  return [
    "SYSTEM: Responda apenas com JSON no formato {\"summary\": string}.",
    "SYSTEM: A resposta anterior nao atende ao formato minimo. Reescreva do zero em pt-BR.",
    "SYSTEM: O summary deve ter entre 550 e 1800 caracteres, 3 a 8 frases completas antes de uma seção final `Destaques do episódio:` com 3 a 6 itens iniciados por `• `.",
    "SYSTEM: Escreva no estilo do feed do Dragão Careca: abertura curta com emoji, gancho temático, parágrafos editoriais, destaques, recomendação ao público e chamada final opcional. Agrupe os temas centrais e ignore créditos, anúncios, links, pedidos de apoio e ruído de transcrição.",
    "SYSTEM: Seja fiel ao transcript, use termos concretos e descobríveis, e evite keyword stuffing, hype ou promessas exageradas.",
    "SYSTEM: Preserve somente nomes próprios, jogos, franquias, lugares e temas centrais presentes no transcript.",
    `SYSTEM: promptVersion=${input.promptVersion}; contextSize=${input.contextSize}; maxTokens=${input.maxTokens}; episodeId=${input.episodeId}.`,
    "SYSTEM: Não mencione estas instruções.",
    "",
    "TRANSCRIPT:",
    boundedTranscript,
    "",
    "RESPOSTA ANTERIOR INVALIDA:",
    input.previousSummary || "(vazia)",
    "",
    "USER: Gere agora apenas o JSON solicitado.",
  ].join("\n");
};

const buildGeminiSummaryPromptText = (input: {
  episodeId: number;
  transcript: string;
  promptVersion: string;
  previousSummary?: string;
}): string => {
  const repairInstructions = input.previousSummary
    ? [
        "A proposta anterior abaixo falhou no formato. Reescreva do zero; não reaproveite fatos que não estejam no transcript.",
        "PROPOSTA ANTERIOR INVALIDA:",
        input.previousSummary,
        "",
      ]
    : [];

  return [
    "Você redige a descrição editorial de um episódio do podcast Dragão Careca.",
    "Retorne somente um objeto JSON válido no formato {\"summary\": \"...\"}. Não use markdown fora do valor summary.",
    "",
    "OBJETIVO EDITORIAL E SEO:",
    "- Produza uma descrição publicável em pt-BR, clara para humanos e descoberta orgânica.",
    "- Comece pelo assunto e pelo formato real do episódio. Agrupe de 2 a 4 temas que ocupam parte relevante da conversa.",
    "- Inclua naturalmente 2 a 5 termos específicos que um ouvinte pesquisaria, somente quando eles forem realmente centrais no transcript.",
    "- Não faça keyword stuffing, não use hype, não faça promessas e não escreva uma ata ou resumo cronológico de falas.",
    "",
    "REGRAS DE FIDELIDADE:",
    "- Use apenas informações claramente sustentadas pelo transcript. Em caso de dúvida, omita.",
    "- Dê prioridade a temas repetidos, explicados ou introduzidos como assunto do episódio.",
    "- Ignore abertura e encerramento, créditos, anúncios, links, chamadas para redes sociais, pedidos de apoio, ruído de transcrição e piadas isoladas.",
    "- Não invente gênero, entrevista, roteiro, ficção científica, análise psicológica, personagem, evento ou conclusão implícita.",
    "- Preserve nomes próprios, jogos, franquias e lugares apenas se forem relevantes para o tema central, exatamente como aparecem no transcript.",
    "",
    "REFERENCIA DE ESTILO DO FEED DE PRODUCAO:",
    "- O feed abre com um emoji e uma linha curta como `🎧 No episódio de hoje do Dragão Careca:`.",
    "- Em seguida há um gancho editorial curto e isolado, em forma de pergunta ou afirmação, que resume a tensão ou a curiosidade real do tema.",
    "- O corpo apresenta o formato do episódio e 2 a 4 assuntos centrais em 2 ou 3 parágrafos naturais, com humor leve quando ele estiver sustentado pelo transcript.",
    "- Depois vem uma seção com emoji e o título `Destaques do episódio:`, seguida de 3 a 6 linhas iniciadas por `• `.",
    "- O fechamento costuma indicar para qual público o episódio é relevante (`Se você gosta de...`) e pode terminar com uma pergunta à comunidade iniciada por `📢`.",
    "- Reproduza essa estrutura, ritmo e tom, mas nunca copie frases, temas, nomes, perguntas ou chamadas de episódios anteriores.",
    "- O transcript atual é a única fonte de fatos. A chamada final é opcional e não pode afirmar que algo aconteceu ou existirá se isso não estiver no transcript.",
    "",
    "FORMATO OBRIGATÓRIO DO VALOR summary:",
    "- Entre 550 e 1800 caracteres.",
    "- De 3 a 8 frases completas antes da seção de destaques.",
    "- Inclua uma seção `Destaques do episódio:` com 3 a 6 linhas, cada uma iniciada por `• `.",
    "- Use quebras de linha entre a abertura, os parágrafos, a seção e os itens.",
    `- promptVersion=${input.promptVersion}; episodeId=${input.episodeId}.`,
    "",
    ...repairInstructions,
    "TRANSCRIPT COMPLETO:",
    input.transcript.trim(),
  ].join("\n");
};

const getSummaryConfigurationErrorForConfig = (summaryConfig: SummaryRuntimeConfig): string | null => {
  if (!summaryConfig.enabled) {
    return "Summary generation is disabled";
  }

  const provider = summaryConfig.provider.trim().toLowerCase();
  if (provider === "gemini") {
    if (!summaryConfig.geminiApiKey.trim()) {
      return "GEMINI_API_KEY is not configured";
    }
    if (!summaryConfig.geminiModel.trim()) {
      return "EPISODE_SUMMARY_GEMINI_MODEL is not configured";
    }
    return null;
  }

  if (provider !== "llama") {
    return `Unsupported EPISODE_SUMMARY_PROVIDER: ${summaryConfig.provider}`;
  }

  const command = summaryConfig.command.trim();
  if (!command) {
    return "EPISODE_SUMMARY_COMMAND is not configured";
  }

  const modelPath = summaryConfig.modelPath.trim();
  if (!modelPath) {
    return "EPISODE_SUMMARY_MODEL_PATH is not configured";
  }

  const commandProbe = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (commandProbe.error && (commandProbe.error as NodeJS.ErrnoException).code === "ENOENT") {
    return `Summary command not found: ${command}`;
  }

  if (!fs.existsSync(modelPath)) {
    return `Summary model not found: ${modelPath}`;
  }

  return null;
};

const readTranscriptText = async (episodeId: number): Promise<{ transcriptPath: string | null; transcriptText: string | null }> => {
  const transcriptPath = await findExistingEpisodeMediaPath(episodeId, "transcript");
  if (!transcriptPath) {
    return { transcriptPath: null, transcriptText: null };
  }

  const transcriptText = fs.readFileSync(transcriptPath, "utf8").trim();
  if (!transcriptText) {
    return { transcriptPath, transcriptText: null };
  }

  return { transcriptPath, transcriptText };
};

const readSummaryText = (episodeId: number): string | null => {
  const state = readDraftState(episodeId);
  if (!state || state.aiSummary.status !== "done") {
    return null;
  }

  for (const candidate of [buildDraftSummaryPath(episodeId), buildFinalSummaryPath(episodeId)]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const summaryText = fs.readFileSync(candidate, "utf8").trim();
    if (summaryText) {
      return summaryText;
    }
  }

  return null;
};

const ensureTranscriptReady = async (
  episodeId: number,
  currentState: EpisodeDraftState | null
): Promise<{ transcriptPath: string; transcriptText: string }> => {
  if (currentState && currentState.transcript.status !== "done") {
    throw createRuntimeError("Transcript draft is not ready yet");
  }

  const transcript = await readTranscriptText(episodeId);
  if (!transcript.transcriptPath || !transcript.transcriptText) {
    throw createRuntimeError("Cannot generate summary without transcript.txt");
  }

  return { transcriptPath: transcript.transcriptPath, transcriptText: transcript.transcriptText };
};

const buildDraftStateForSummary = (
  episodeId: number,
  currentState: EpisodeDraftState | null,
  version: number,
  now: string,
  summaryConfig: SummaryRuntimeConfig,
  status: EpisodeDraftStepStatus,
  error?: string | null
): EpisodeDraftState => {
  const transcriptState: TranscriptDraftState = currentState?.transcript
    ? {
        ...currentState.transcript,
        version,
        updatedAt: currentState.transcript.updatedAt ?? now,
        fileName: currentState.transcript.fileName ?? buildTranscriptFileName(episodeId),
      }
    : createTranscriptDraftState({
        status: "done",
        version,
        updatedAt: now,
        startedAt: null,
        finishedAt: now,
        progress: 100,
        fileName: buildTranscriptFileName(episodeId),
        error: null,
      });

  return {
    episodeId,
    version,
    updatedAt: now,
    transcript: transcriptState,
    aiSummary: {
      ...(currentState?.aiSummary ?? createAiSummaryDraftState()),
      status,
      version,
      updatedAt: now,
      startedAt: status === "pending" || status === "processing" ? now : currentState?.aiSummary?.startedAt ?? null,
      finishedAt: status === "done" || status === "error" ? now : status === "processing" ? null : currentState?.aiSummary?.finishedAt ?? null,
      progress: status === "done" ? 100 : status === "processing" ? 0 : null,
      promptVersion: summaryConfig.promptVersion,
      fileName: buildSummaryFileName(episodeId),
      summaryFileName: buildSummaryFileName(episodeId),
      error: error ?? null,
    },
    suggestedTags: currentState?.suggestedTags
      ? { ...currentState.suggestedTags, version, updatedAt: now }
      : createSuggestedTagsDraftState({ version, updatedAt: now }),
  };
};

const buildErrorDraftState = (
  episodeId: number,
  currentState: EpisodeDraftState | null,
  summaryConfig: SummaryRuntimeConfig,
  message: string
): EpisodeDraftState => {
  const nextVersion = nextEpisodeVersion(currentState);
  const now = defaultNow();
  const nextState = buildDraftStateForSummary(episodeId, currentState, nextVersion, now, summaryConfig, "error", message);

  if (!currentState) {
    nextState.transcript = createTranscriptDraftState({
      status: "idle",
      version: nextVersion,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      progress: null,
      fileName: buildTranscriptFileName(episodeId),
      error: null,
    });
  }

  return nextState;
};

const runSummaryRuntime = async (
  summaryConfig: SummaryRuntimeConfig,
  runtime: SummaryRuntimeAdapter,
  request: EpisodeSummaryRequestPayload
): Promise<string> => {
  ensureTempRoot();
  const requestDir = fs.mkdtempSync(path.join(tempRoot, "request-"));
  const requestPath = path.join(requestDir, "summary-request.json");
  const promptPath = path.join(requestDir, "summary-prompt.txt");
  const outputPath = path.join(requestDir, "summary-output.txt");

  try {
    await writeJsonAtomic(requestPath, request);
    await fs.promises.writeFile(promptPath, request.prompt, "utf8");
    const stdout = await runtime.execute({
      command: summaryConfig.command.trim(),
      args: [
        "-m",
        summaryConfig.modelPath.trim(),
        "-c",
        String(summaryConfig.contextSize),
        "-n",
        String(summaryConfig.maxTokens),
        "-f",
        promptPath,
        "--no-display-prompt",
        "--no-show-timings",
        "--log-disable",
        "--single-turn",
        "--simple-io",
        "--output",
        outputPath,
      ],
      timeoutMs: summaryConfig.timeoutMs,
    });

    const output = await fs.promises.readFile(outputPath, "utf8").catch(() => "");
    return output.trim() || stdout;
  } finally {
    await fs.promises.rm(requestDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const runGeminiSummary = async (summaryConfig: SummaryRuntimeConfig, prompt: string): Promise<string> => {
  const baseUrl = summaryConfig.geminiApiBaseUrl.replace(/\/+$/, "");
  const model = summaryConfig.geminiModel.trim();
  const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": summaryConfig.geminiApiKey.trim(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        // Gemini 3.x uses thinking by default. Low keeps enough output budget
        // for the required editorial text while retaining transcript analysis.
        thinkingConfig: {
          thinkingLevel: summaryConfig.geminiThinkingLevel.trim().toLowerCase(),
        },
        maxOutputTokens: 2048,
        responseFormat: {
          text: {
            // Raw REST uses the enum spelling, unlike the SDK's MIME string.
            mimeType: "APPLICATION_JSON",
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
              },
              required: ["summary"],
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(summaryConfig.timeoutMs),
  });

  const body = (await response.json().catch(() => ({}))) as GeminiGenerateContentResponse;
  if (!response.ok) {
    throw createRuntimeError(`Gemini request failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
  }

  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  console.info(
    `[summary] gemini response model=${model} finishReason=${candidate?.finishReason ?? "unknown"} textChars=${text?.length ?? 0}`
  );
  if (!text) {
    throw createRuntimeError("Gemini returned no generated summary text");
  }

  return text;
};

const createEpisodeSummaryService = (deps: EpisodeSummaryServiceDeps = {}) => {
  const summaryConfig = deps.summaryConfig ?? config.summary;
  const runtime = deps.runtime ?? defaultSummaryRuntime;
  const now = deps.now ?? defaultNow;
  let summaryExecutionTail: Promise<void> = Promise.resolve();

  const runSummaryExclusively = async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = summaryExecutionTail;
    let release!: () => void;
    summaryExecutionTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  };

  const getSummaryConfigurationErrorForRuntime = (): string | null => getSummaryConfigurationErrorForConfig(summaryConfig);

  const getEpisodeDraftSummaryStatus = (episodeId: number): EpisodeDraftSummaryStatusSnapshot => {
    const state = readDraftState(episodeId);
    if (!state) {
      return {
        status: "idle",
        summaryFileName: null,
        summaryUpdatedAt: null,
        summaryStartedAt: null,
        progress: null,
        error: null,
        version: null,
        promptVersion: null,
      };
    }

    return {
      status: state.aiSummary.status,
      summaryFileName: state.aiSummary.summaryFileName ?? buildSummaryFileName(episodeId),
      summaryUpdatedAt: state.aiSummary.updatedAt,
      summaryStartedAt: state.aiSummary.startedAt ?? null,
      progress: state.aiSummary.progress ?? (state.aiSummary.status === "done" ? 100 : null),
      error: state.aiSummary.error ?? null,
      version: state.version,
      promptVersion: state.aiSummary.promptVersion ?? summaryConfig.promptVersion,
    };
  };

  const getEpisodeDraftSummary = (episodeId: number): EpisodeDraftSummarySnapshot => {
    const status = getEpisodeDraftSummaryStatus(episodeId);
    return {
      ...status,
      summaryText: status.status === "done" ? readSummaryText(episodeId) : null,
    };
  };

  const syncDraftEpisodeSummary = async (episodeId: number): Promise<EpisodeDraftSummaryStatusSnapshot> => {
    const state = readDraftState(episodeId);
    if (!state) {
      return getEpisodeDraftSummaryStatus(episodeId);
    }

    const draftSummaryPath = buildDraftSummaryPath(episodeId);
    const finalSummaryPath = buildFinalSummaryPath(episodeId);
    if (state.aiSummary.status === "done" && fs.existsSync(draftSummaryPath)) {
      await fs.promises.mkdir(path.dirname(finalSummaryPath), { recursive: true });
      await fs.promises.copyFile(draftSummaryPath, finalSummaryPath);
      await fs.promises.rm(draftSummaryPath, { force: true }).catch(() => undefined);
      return {
        status: "done",
        summaryFileName: buildSummaryFileName(episodeId),
        summaryUpdatedAt: state.aiSummary.updatedAt,
        summaryStartedAt: state.aiSummary.startedAt ?? null,
        progress: 100,
        error: state.aiSummary.error ?? null,
        version: state.version,
        promptVersion: state.aiSummary.promptVersion ?? summaryConfig.promptVersion,
      };
    }

    return getEpisodeDraftSummaryStatus(episodeId);
  };

  const abortDraftEpisodeSummary = async (episodeId: number): Promise<void> => {
    const currentState = readDraftState(episodeId);
    const nextVersion = nextEpisodeVersion(currentState);
  const nextState = buildDraftStateForSummary(episodeId, currentState, nextVersion, now(), summaryConfig, "idle", null);
  nextState.aiSummary.startedAt = null;
  nextState.aiSummary.finishedAt = null;
  nextState.aiSummary.progress = null;
  nextState.aiSummary.error = null;
  await writeDraftState(episodeId, nextState);
  await fs.promises.rm(buildDraftSummaryPath(episodeId), { force: true }).catch(() => undefined);
  await fs.promises.rm(buildFinalSummaryPath(episodeId), { force: true }).catch(() => undefined);
};

  const queueDraftEpisodeSummary = async (
    episodeId: number
  ): Promise<{ queued: boolean; version: number; status: EpisodeDraftStepStatus; progress: number | null; error?: string | null }> => {
    const configurationError = getSummaryConfigurationErrorForRuntime();
    const currentState = readDraftState(episodeId);
    const version = nextEpisodeVersion(currentState);

    if (configurationError) {
      const nextState = buildErrorDraftState(episodeId, currentState, summaryConfig, configurationError);
      await writeDraftState(episodeId, nextState);
      return {
        queued: false,
        version: nextState.version,
        status: nextState.aiSummary.status,
        progress: nextState.aiSummary.progress ?? null,
        error: nextState.aiSummary.error ?? null,
      };
    }

    const transcript = await ensureTranscriptReady(episodeId, currentState);
    const nextState = buildDraftStateForSummary(episodeId, currentState, version, now(), summaryConfig, "pending", null);
    await writeDraftState(episodeId, nextState);
    console.info(`[summary] queued episode=${episodeId} version=${version} at=${now()}`);

    void runSummaryExclusively(async (): Promise<void> => {
      const currentBeforeRun = readDraftState(episodeId);
      if (!currentBeforeRun || currentBeforeRun.version !== version) {
        return;
      }

      const runningState = buildDraftStateForSummary(episodeId, currentBeforeRun, version, now(), summaryConfig, "processing", null);
      runningState.aiSummary.startedAt = now();
      runningState.aiSummary.progress = 0;
      await writeDraftState(episodeId, runningState);
      const startedAt = Date.now();
      console.info(`[summary] started episode=${episodeId} version=${version} at=${new Date().toISOString()}`);

      try {
        const provider = summaryConfig.provider.trim().toLowerCase();
        let rawOutput: string;
        if (provider === "gemini") {
          console.info(`[summary] provider=gemini episode=${episodeId} version=${version} transcriptChars=${transcript.transcriptText.length}`);
          rawOutput = await runGeminiSummary(
            summaryConfig,
            buildGeminiSummaryPromptText({
              episodeId,
              transcript: transcript.transcriptText,
              promptVersion: summaryConfig.promptVersion,
            })
          );
        } else {
          const evidencePrompt = buildEvidencePromptText({
            episodeId,
            transcript: transcript.transcriptText,
            contextSize: summaryConfig.contextSize,
            maxTokens: summaryConfig.maxTokens,
          });
          const rawEvidence = await runSummaryRuntime(summaryConfig, runtime, {
            episodeId,
            promptVersion: summaryConfig.promptVersion,
            contextSize: summaryConfig.contextSize,
            maxTokens: summaryConfig.maxTokens,
            prompt: evidencePrompt,
            transcript: transcript.transcriptText,
          });
          const evidence = normalizeSummaryDraftText(rawEvidence);
          console.info(
            `[summary] evidence episode=${episodeId} version=${version} chars=${evidence.length} preview=${JSON.stringify(evidence.slice(0, 180))}`
          );

          const prompt = buildSummaryPromptText({
            episodeId,
            transcript: transcript.transcriptText,
            promptVersion: summaryConfig.promptVersion,
            contextSize: summaryConfig.contextSize,
            maxTokens: summaryConfig.maxTokens,
            evidence,
          });
          rawOutput = await runSummaryRuntime(summaryConfig, runtime, {
            episodeId,
            promptVersion: summaryConfig.promptVersion,
            contextSize: summaryConfig.contextSize,
            maxTokens: summaryConfig.maxTokens,
            prompt,
            transcript: transcript.transcriptText,
          });
        }

        const currentAfterRuntime = readDraftState(episodeId);
        if (!currentAfterRuntime || currentAfterRuntime.version !== version) {
          return;
        }

        let normalizedSummary = normalizeSummaryDraftText(rawOutput);
        logSummaryCandidate(episodeId, version, "initial", rawOutput, normalizedSummary);
        try {
          validateSummaryDraft(normalizedSummary);
        } catch (error) {
          console.warn(
            `[summary] repair requested episode=${episodeId} version=${version} reason=${error instanceof Error ? error.message : String(error)}`
          );
          const repairPrompt = buildSummaryRepairPromptText({
            episodeId,
            transcript: transcript.transcriptText,
            previousSummary: normalizedSummary,
            promptVersion: summaryConfig.promptVersion,
            contextSize: summaryConfig.contextSize,
            maxTokens: summaryConfig.maxTokens,
          });
          const repairedOutput = provider === "gemini"
            ? await runGeminiSummary(
                summaryConfig,
                buildGeminiSummaryPromptText({
                  episodeId,
                  transcript: transcript.transcriptText,
                  promptVersion: summaryConfig.promptVersion,
                  previousSummary: normalizedSummary,
                })
              )
            : await runSummaryRuntime(summaryConfig, runtime, {
                episodeId,
                promptVersion: summaryConfig.promptVersion,
                contextSize: summaryConfig.contextSize,
                maxTokens: summaryConfig.maxTokens,
                prompt: repairPrompt,
                transcript: transcript.transcriptText,
              });
          normalizedSummary = normalizeSummaryDraftText(repairedOutput);
          logSummaryCandidate(episodeId, version, "repair", repairedOutput, normalizedSummary);
          validateSummaryDraft(normalizedSummary);
        }

        const currentBeforeWrite = readDraftState(episodeId);
        if (!currentBeforeWrite || currentBeforeWrite.version !== version) {
          return;
        }

        await writeTextAtomic(buildDraftSummaryPath(episodeId), `${normalizedSummary}\n`);

        const finalState = buildDraftStateForSummary(episodeId, currentBeforeWrite, version, now(), summaryConfig, "done", null);
        finalState.aiSummary.startedAt = currentBeforeWrite.aiSummary.startedAt ?? now();
        finalState.aiSummary.finishedAt = now();
        finalState.aiSummary.progress = 100;
        await writeDraftState(episodeId, finalState);
        console.info(
          `[summary] finished episode=${episodeId} version=${version} durationMs=${Date.now() - startedAt} at=${new Date().toISOString()}`
        );
      } catch (error) {
        const currentAfterRuntime = readDraftState(episodeId);
        if (!currentAfterRuntime || currentAfterRuntime.version !== version) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        const erroredState = buildDraftStateForSummary(episodeId, currentAfterRuntime, version, now(), summaryConfig, "error", message);
        erroredState.aiSummary.startedAt = currentAfterRuntime.aiSummary.startedAt ?? now();
        erroredState.aiSummary.finishedAt = now();
        erroredState.aiSummary.progress = null;
        await writeDraftState(episodeId, erroredState);
        console.warn(
          `[summary] failed episode=${episodeId} version=${version} durationMs=${Date.now() - startedAt} at=${new Date().toISOString()} error=${message}`
        );
      }
    }).catch((error: unknown) => {
      console.error(
        `[summary] draft episode=${episodeId} version=${version} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    return {
      queued: true,
      version,
      status: nextState.aiSummary.status,
      progress: nextState.aiSummary.progress ?? null,
      error: nextState.aiSummary.error ?? null,
    };
  };

  const buildSummaryPromptForRuntime = (input: {
    episodeId: number;
    transcript: string;
    promptVersion: string;
    contextSize: number;
    maxTokens: number;
  }): string => buildSummaryPromptText(input);

  return {
    getSummaryConfigurationError: getSummaryConfigurationErrorForRuntime,
    buildSummaryPrompt: buildSummaryPromptForRuntime,
    normalizeSummaryDraft: normalizeSummaryDraftText,
    getEpisodeDraftSummary,
    queueDraftEpisodeSummary,
    abortDraftEpisodeSummary,
    getEpisodeDraftSummaryStatus,
    syncDraftEpisodeSummary,
  };
};

const defaultSummaryService = createEpisodeSummaryService();

export const getSummaryConfigurationError = defaultSummaryService.getSummaryConfigurationError;
export const buildSummaryPrompt = defaultSummaryService.buildSummaryPrompt;
export const normalizeSummaryDraft = defaultSummaryService.normalizeSummaryDraft;
export const getEpisodeDraftSummary = defaultSummaryService.getEpisodeDraftSummary;
export const queueDraftEpisodeSummary = defaultSummaryService.queueDraftEpisodeSummary;
export const abortDraftEpisodeSummary = defaultSummaryService.abortDraftEpisodeSummary;
export const getEpisodeDraftSummaryStatus = defaultSummaryService.getEpisodeDraftSummaryStatus;
export const syncDraftEpisodeSummary = defaultSummaryService.syncDraftEpisodeSummary;

export { createEpisodeSummaryService };
