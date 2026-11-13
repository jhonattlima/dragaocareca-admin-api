import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export class TranscriptionDeferredError extends Error {
  constructor(public readonly retryAt: number) {
    super(`Transcription waiting for Groq quota; automatic retry after ${new Date(retryAt).toISOString()}`);
    this.name = "TranscriptionDeferredError";
  }
}

export const audioSha256 = async (audioPath: string): Promise<string> => {
  // Hash encoded audio packets, excluding ID3 tags and attached pictures.
  // Save Episode may rewrite those while speech processing is in flight.
  const { stdout } = await execute("ffmpeg", ["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", audioPath,
    "-map", "0:a:0", "-c:a", "copy", "-f", "hash", "-hash", "sha256", "-"],
  { timeout: 120_000, maxBuffer: 1024 * 1024 });
  const digest = stdout.trim().match(/^SHA256=([a-f0-9]{64})$/i)?.[1];
  if (!digest) throw new Error("Cannot fingerprint encoded audio");
  return digest.toLowerCase();
};

type Checkpoint = {
  key: string;
  chunks: Record<string, string>;
  retryAt: number | null;
};

export const openTranscriptionCheckpoint = async (input: {
  root: string;
  audioPath: string;
  model: string;
  language: string;
  chunkSeconds: number;
}) => {
  const audioDigest = await audioSha256(input.audioPath);
  const key = createHash("sha256").update(JSON.stringify({
    version: 2, audioDigest, model: input.model, language: input.language, chunkSeconds: input.chunkSeconds,
  })).digest("hex");
  const directory = path.join(input.root, key);
  const filePath = path.join(directory, "progress.json");
  let state: Checkpoint = { key, chunks: {}, retryAt: null };
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8")) as Checkpoint;
    if (parsed.key === key && parsed.chunks && typeof parsed.chunks === "object" && !Array.isArray(parsed.chunks)) {
      state = { key, chunks: Object.fromEntries(Object.entries(parsed.chunks)
        .filter(([index, text]) => /^\d+$/.test(index) && typeof text === "string" && text.trim())),
      retryAt: typeof parsed.retryAt === "number" && Number.isFinite(parsed.retryAt) ? parsed.retryAt : null };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Cannot read transcription checkpoint safely", { cause: error });
    }
  }

  const persist = async (): Promise<void> => {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await fs.promises.rename(temporary, filePath);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  };

  return {
    key,
    getChunk: (index: number): string | undefined => state.chunks[String(index)],
    assertReady: (): void => {
      if (state.retryAt && state.retryAt > Date.now()) throw new TranscriptionDeferredError(state.retryAt);
    },
    saveChunk: async (index: number, text: string): Promise<void> => {
      if (!text.trim()) throw new Error("Cannot checkpoint an empty transcription chunk");
      state.chunks[String(index)] = text;
      state.retryAt = null;
      await persist();
    },
    defer: async (delayMs: number): Promise<TranscriptionDeferredError> => {
      state.retryAt = Date.now() + Math.max(1000, delayMs);
      await persist();
      return new TranscriptionDeferredError(state.retryAt);
    },
    assertSourceUnchanged: async (): Promise<void> => {
      if (await audioSha256(input.audioPath) !== audioDigest) throw new Error("Audio changed during transcription; upload or retry the current audio");
    },
  };
};
