import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env";

const execFileAsync = promisify(execFile);

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; is_bot?: boolean };
    text?: string;
  };
};

type TelegramMessage = {
  message_id: number;
};

type TelegramApiError = Error & {
  status?: number;
  code?: string;
  cause?: unknown;
};

type TelegramPollingProbeResult = "ready" | "conflict" | "transient";

let polling = false;
let lastUpdateId = 0;
let botUserId: number | null = null;
let retryDelayMs = 2000;
let lastTransientLogSignature = "";
let lastTransientLogAt = 0;

const baseUrl = () => config.telegram.apiBaseUrl.replace(/\/$/, "");

const transientNetworkErrorCodes = new Set(["ETIMEDOUT", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND"]);

const isTransientNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const asError = error as {
    code?: string;
    message?: string;
    cause?: unknown;
    errors?: unknown[];
  };

  if (typeof asError.code === "string" && transientNetworkErrorCodes.has(asError.code)) {
    return true;
  }

  if (typeof asError.message === "string" && asError.message.toLowerCase().includes("fetch failed")) {
    return true;
  }

  const cause = asError.cause;
  if (cause && typeof cause === "object") {
    const nested = cause as { code?: string; message?: string; errors?: unknown[] };
    if (typeof nested.code === "string" && transientNetworkErrorCodes.has(nested.code)) {
      return true;
    }
    if (typeof nested.message === "string" && nested.message.toLowerCase().includes("fetch failed")) {
      return true;
    }
    if (Array.isArray(nested.errors) && nested.errors.some((item) => isTransientNetworkError(item))) {
      return true;
    }
  }

  if (Array.isArray(asError.errors) && asError.errors.some((item) => isTransientNetworkError(item))) {
    return true;
  }

  return false;
};

const describeTelegramError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const logTransientTelegramIssue = (context: string, error: unknown, retryInMs: number): void => {
  const details = describeTelegramError(error);
  const signature = `${context}:${details}`;
  const now = Date.now();
  if (signature === lastTransientLogSignature && now - lastTransientLogAt < 60000) {
    return;
  }

  lastTransientLogSignature = signature;
  lastTransientLogAt = now;

  console.warn(
    `Telegram bot worker temporarily unavailable (${context}). ${details}. ` +
      `It will retry in ${Math.round(retryInMs / 1000)}s. ` +
      `If you are running locally, this usually means outbound access to Telegram is blocked or the API is unreachable.`
  );
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const telegramRequest = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${baseUrl()}/bot${config.telegram.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const error = new Error(`Telegram ${method} failed (${response.status}): ${details || response.statusText}`) as TelegramApiError;
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
};

const ensureBotUserId = async (): Promise<number> => {
  if (botUserId !== null) {
    return botUserId;
  }

  const response = await telegramRequest<{ ok: boolean; result: { id: number } }>("getMe", {});
  botUserId = response.result.id;
  return botUserId;
};

const sendMessage = (chatId: number, text: string): Promise<TelegramMessage> => {
  return telegramRequest<TelegramMessage>("sendMessage", { chat_id: chatId, text });
};

const deleteMessage = async (chatId: number, messageId: number): Promise<void> => {
  await telegramRequest("deleteMessage", { chat_id: chatId, message_id: messageId });
};

const sendVideo = async (chatId: number, filePath: string, caption?: string): Promise<void> => {
  const fileBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", new Blob([fileBuffer]), path.basename(filePath));
  if (caption) {
    form.append("caption", caption);
  }

  const response = await fetch(`${baseUrl()}/bot${config.telegram.botToken}/sendVideo`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Telegram sendVideo failed (${response.status}): ${details || response.statusText}`);
  }
};

const sendPhoto = async (chatId: number, photo: string, caption?: string): Promise<void> => {
  await telegramRequest("sendPhoto", {
    chat_id: chatId,
    photo,
    ...(caption ? { caption } : {}),
  });
};

const isMediaUrl = (text: string): boolean => {
  return /https?:\/\/(www\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|facebook\.com|x\.com|twitter\.com)/i.test(text);
};

const isImageUrl = (text: string): boolean => {
  return /https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(text.trim());
};

const extractUrl = (text: string): string | null => {
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
};

const rollDice = (expression: string): string | null => {
  const match = expression.trim().match(/^(\d+)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  if (!match) return null;
  const diceCount = Number(match[1]);
  const dieSides = Number(match[2]);
  const operator = match[3];
  const modifier = Number(match[4] || 0);
  if (diceCount < 1 || dieSides < 2 || diceCount > 100 || dieSides > 1000) return null;
  const rolls = Array.from({ length: diceCount }, () => 1 + Math.floor(Math.random() * dieSides));
  let total = rolls.reduce((sum, value) => sum + value, 0);
  const modifierText = operator ? ` ${operator}${modifier}` : "";
  if (operator === "+") total += modifier;
  if (operator === "-") total -= modifier;
  return `${diceCount}D${dieSides}${modifierText} = (${rolls.join(" + ")})${modifierText} = ${total}`;
};

const helpText = [
  "Comandos:",
  "/r 1d8 + 2 - rola dados",
  "",
  "Se alguem postar um link de video, eu tento baixar e reenviar no chat.",
].join("\n");

const downloadVideo = async (url: string): Promise<string | null> => {
  const tempDir = await fs.mkdtemp(path.join("/tmp", "dona-sonja-"));
  const outputTemplate = path.join(tempDir, "%(title)s.%(ext)s");
  try {
    await execFileAsync("yt-dlp", ["-f", "best[ext=mp4]/best", "-o", outputTemplate, url], { maxBuffer: 10 * 1024 * 1024 });
    const entries = await fs.readdir(tempDir);
    const file = entries.find((entry) => !entry.endsWith(".part")) || null;
    return file ? path.join(tempDir, file) : null;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const fetchDescription = async (url: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--dump-single-json", url], { maxBuffer: 10 * 1024 * 1024 });
    const info = JSON.parse(stdout);
    const description = typeof info.description === "string" ? info.description.trim() : "";
    return description || null;
  } catch {
    return null;
  }
};

const processMediaLink = async (chatId: number, url: string): Promise<void> => {
  const processing = await sendMessage(chatId, "🔥 Baixando vídeo... 🔥");
  let filePath: string | null = null;
  try {
    const [description, downloaded] = await Promise.all([fetchDescription(url), downloadVideo(url)]);
    filePath = downloaded;
    if (!filePath) {
      await sendMessage(chatId, "❌ Não foi possível baixar o vídeo.");
      return;
    }

    const header = await sendMessage(chatId, "segredo revelado:");
    await sendVideo(chatId, filePath, description ? description.replace(/\s+/g, " ").trim().slice(0, 1024) : undefined);
    setTimeout(() => {
      void deleteMessage(chatId, header.message_id).catch(() => undefined);
    }, 5000);
  } finally {
    try {
      await deleteMessage(chatId, processing.message_id);
    } catch {
      // ignore
    }
    if (filePath) {
      const tempDir = path.dirname(filePath);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
};

const processImageLink = async (chatId: number, url: string, sourceText: string): Promise<void> => {
  const processing = await sendMessage(chatId, "🔥 Baixando imagem... 🔥");
  try {
    const header = await sendMessage(chatId, "segredo revelado:");
    await sendPhoto(chatId, url, sourceText === url ? undefined : sourceText.replace(/\s+/g, " ").trim().slice(0, 1024));
    setTimeout(() => {
      void deleteMessage(chatId, header.message_id).catch(() => undefined);
    }, 5000);
  } finally {
    try {
      await deleteMessage(chatId, processing.message_id);
    } catch {
      // ignore
    }
  }
};

const handleText = async (message: NonNullable<TelegramUpdate["message"]>): Promise<void> => {
  const text = message.text?.trim() || "";
  if (!text) return;

  const selfId = await ensureBotUserId();
  if (message.from?.id === selfId) {
    return;
  }

  if (text.startsWith("/r")) {
    const expression = text.replace(/^\/r(?:@\w+)?\s*/i, "");
    const result = rollDice(expression);
    await sendMessage(message.chat.id, result ?? "Formato inválido. Exemplo: /r 1d8 + 2");
    return;
  }

  if (/^\/help(?:@\w+)?$/i.test(text)) {
    await sendMessage(message.chat.id, helpText);
    return;
  }

  if (isImageUrl(text)) {
    await processImageLink(message.chat.id, extractUrl(text) ?? text, text);
    return;
  }

  if (isMediaUrl(text)) {
    const url = extractUrl(text);
    if (url) {
      await processMediaLink(message.chat.id, url);
    }
  }
};

const pollOnce = async (): Promise<void> => {
  const response = await telegramRequest<{ result: TelegramUpdate[] }>("getUpdates", {
    offset: lastUpdateId > 0 ? lastUpdateId + 1 : undefined,
    timeout: 20,
    allowed_updates: ["message"],
  });

  for (const update of response.result) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    if (update.message) {
      await handleText(update.message);
    }
  }
};

const canStartPolling = async (): Promise<TelegramPollingProbeResult> => {
  try {
    await telegramRequest<{ ok: boolean; result: TelegramUpdate[] }>("getUpdates", {
      timeout: 0,
      limit: 1,
      allowed_updates: ["message"],
    });
    return "ready";
  } catch (error) {
    const telegramError = error as TelegramApiError;
    if (
      telegramError.status === 409 ||
      String(telegramError.message || "").includes("Conflict: terminated by other getUpdates request")
    ) {
      return "conflict";
    }

    if (isTransientNetworkError(error)) {
      logTransientTelegramIssue("startup probe", error, 5000);
      return "transient";
    }

    throw error;
  }
};

export const startTelegramBotWorker = async (): Promise<() => void> => {
  if (!config.telegram.botToken) {
    console.log("Telegram bot worker disabled because TELEGRAM_BOT_TOKEN is missing");
    return () => undefined;
  }

  if (polling) {
    return () => undefined;
  }

  const pollingAvailable = await canStartPolling().catch((error) => {
    console.error("Telegram bot worker startup probe failed", error);
    return "transient" as const;
  });

  if (pollingAvailable === "conflict") {
    console.warn("Telegram bot worker not started because another polling instance is already active");
    return () => undefined;
  }

  polling = true;
  retryDelayMs = pollingAvailable === "transient" ? 5000 : 2000;
  void (async () => {
    while (polling) {
      try {
        await pollOnce();
        retryDelayMs = 2000;
      } catch (error) {
        const telegramError = error as TelegramApiError;
        if (telegramError.status === 409 || String(telegramError.message || "").includes("Conflict: terminated by other getUpdates request")) {
          console.warn("Telegram bot worker stopped because another polling instance is already running");
          polling = false;
          break;
        }

        if (isTransientNetworkError(error)) {
          logTransientTelegramIssue("polling", error, retryDelayMs);
        } else {
          console.error("Telegram bot worker failed", error);
        }

        await sleep(retryDelayMs);
        retryDelayMs = Math.min(Math.floor(retryDelayMs * 2), 60000);
      }
    }
  })();

  return () => {
    polling = false;
  };
};
