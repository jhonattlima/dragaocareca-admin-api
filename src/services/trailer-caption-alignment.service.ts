import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { TrailerCandidateRow } from "../database/repositories/trailer-candidate.repository";
import { trailerCandidateExistingFilePath, getTrailerCandidateSnapshotPaths } from "./trailer-candidate.service";
import type { TrailerTimedWord } from "./trailer-render-profile.service";

export const TRAILER_CAPTION_METRIC_VERSION = "pt-br-word-alignment-metrics/v1" as const;
export const TRAILER_CAPTION_ALIGNER_VERSION = "whisperx==3.8.6" as const;
export const TRAILER_CAPTION_MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese" as const;
export const TRAILER_CAPTION_MODEL_REVISION = "634ac655299bcdc46c83bc01da9bab52d2987e4f" as const;
const MAX_TRANSCRIPT_BYTES = 20_000;
const MAX_ALIGNMENT_OUTPUT_BYTES = 1_000_000;
const ALIGNMENT_TIMEOUT_MS = 300_000;

export type TrailerCaptionCalibration = {
  metricVersion: typeof TRAILER_CAPTION_METRIC_VERSION;
  calibrationId: string;
  referenceSetId: string;
  referenceSetSha256: string;
  sampleCount: number;
  humanReviewed: true;
  alignerVersion: typeof TRAILER_CAPTION_ALIGNER_VERSION;
  modelId: typeof TRAILER_CAPTION_MODEL_ID;
  modelRevision: typeof TRAILER_CAPTION_MODEL_REVISION;
  modelSha256: string;
  werMax: number;
  coverageMin: number;
  onsetMaeMaxSeconds: number;
  onsetP95MaxSeconds: number;
  offsetMaeMaxSeconds: number;
  offsetP95MaxSeconds: number;
  reviewer: string;
  reviewedAt: string;
  approved: boolean;
};

export type TrailerCaptionCapacityEvidence = {
  imageDigest: string;
  measuredAt: string;
  modelRevision: typeof TRAILER_CAPTION_MODEL_REVISION;
  maxPeakMemoryBytes: number;
  maxDurationSeconds: number;
  maxInputBytes: number;
  approved: boolean;
};

export type TrailerCaptionAlignmentResult = {
  status: "aligned" | "unavailable";
  reason: "aligned" | "aligner_unavailable" | "model_unavailable" | "alignment_failed";
  audioSha256?: string;
  transcriptSha256?: string;
  modelSha256?: string;
  alignerVersion?: typeof TRAILER_CAPTION_ALIGNER_VERSION;
  modelId?: typeof TRAILER_CAPTION_MODEL_ID;
  modelRevision?: typeof TRAILER_CAPTION_MODEL_REVISION;
  profileId?: string;
  profileRevision?: number;
  words?: TrailerTimedWord[];
};

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const sha256File = async (filePath: string): Promise<string> => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest("hex");
};

export const normalizePortugueseTokens = (text: string): string[] =>
  text.normalize("NFC").toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]+/gu) ?? [];

const percentile95 = (values: number[]): number => {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};

const wordErrorRate = (reference: string[], actual: string[]): number => {
  if (!reference.length) return actual.length ? 1 : 0;
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (reference[row - 1] === actual[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[actual.length] / reference.length;
};

export type TrailerCaptionQualityMetrics = {
  metricVersion: typeof TRAILER_CAPTION_METRIC_VERSION;
  transcriptTokenCount: number;
  cueTokenCount: number;
  alignedCoverage: number;
  normalizedWordErrorRate: number;
  cueMonotonic: boolean;
  cueNonOverlapping: boolean;
  cueWithinDuration: boolean;
  cuePositiveDuration: boolean;
  onsetMaeSeconds: number | null;
  onsetP95Seconds: number | null;
  offsetMaeSeconds: number | null;
  offsetP95Seconds: number | null;
  eligible: boolean;
  reason: string;
};

export const evaluateTrailerCaptionQuality = (input: {
  transcript: string;
  words: TrailerTimedWord[];
  durationSeconds: number;
  sourceBytes?: number;
  reference?: TrailerTimedWord[];
  calibration?: TrailerCaptionCalibration | null;
  capacity?: TrailerCaptionCapacityEvidence | null;
  alignmentProvenance?: {
    alignerVersion: string;
    modelId: string;
    modelRevision: string;
    modelSha256: string;
  };
}): TrailerCaptionQualityMetrics => {
  const expectedTokens = normalizePortugueseTokens(input.transcript);
  const actualTokens = input.words.flatMap((word) => normalizePortugueseTokens(word.text));
  const cuePositiveDuration = input.words.every((word) => Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds) && word.endSeconds > word.startSeconds);
  const cueMonotonic = input.words.every((word, index) => index === 0 || word.startSeconds >= input.words[index - 1].startSeconds);
  const cueNonOverlapping = input.words.every((word, index) => index === 0 || word.startSeconds >= input.words[index - 1].endSeconds);
  const cueWithinDuration = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0 && input.words.every((word) =>
    word.startSeconds >= 0 && word.endSeconds <= input.durationSeconds,
  );
  const alignedCoverage = expectedTokens.length ? Math.min(1, actualTokens.length / expectedTokens.length) : 0;
  const normalizedWordErrorRate = wordErrorRate(expectedTokens, actualTokens);
  const onsetErrors: number[] = [];
  const offsetErrors: number[] = [];
  const referenceTokens = input.reference?.flatMap((word) => normalizePortugueseTokens(word.text)) ?? [];
  const referenceMatches = input.reference && input.reference.length === input.words.length &&
    referenceTokens.length === actualTokens.length && referenceTokens.every((token, index) => token === actualTokens[index]);
  if (referenceMatches && input.reference) {
    for (let index = 0; index < input.words.length; index += 1) {
      onsetErrors.push(Math.abs(input.words[index].startSeconds - input.reference[index].startSeconds));
      offsetErrors.push(Math.abs(input.words[index].endSeconds - input.reference[index].endSeconds));
    }
  }
  const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const calibration = input.calibration;
  const capacity = input.capacity;
  let reason = "calibration_unavailable";
  let eligible = false;
  if (!calibration?.approved || calibration.metricVersion !== TRAILER_CAPTION_METRIC_VERSION || calibration.humanReviewed !== true) {
    reason = "calibration_unavailable";
  } else if (
    !capacity?.approved || capacity.modelRevision !== TRAILER_CAPTION_MODEL_REVISION ||
    !/^sha256:[a-f0-9]{64}$/iu.test(capacity.imageDigest) || !Number.isFinite(capacity.maxPeakMemoryBytes) ||
    capacity.maxPeakMemoryBytes <= 0 || input.durationSeconds > capacity.maxDurationSeconds ||
    (input.sourceBytes !== undefined && input.sourceBytes > capacity.maxInputBytes)
  ) {
    reason = "capacity_unavailable";
  } else if (!input.words.length || !expectedTokens.length || !actualTokens.length) {
    reason = "cue_coverage_insufficient";
  } else if (!cuePositiveDuration || !cueMonotonic || !cueNonOverlapping || !cueWithinDuration) {
    reason = "invalid_cue_timing";
  } else if (
    calibration.alignerVersion !== TRAILER_CAPTION_ALIGNER_VERSION || calibration.modelId !== TRAILER_CAPTION_MODEL_ID ||
    calibration.modelRevision !== TRAILER_CAPTION_MODEL_REVISION || !/^[a-f0-9]{64}$/iu.test(calibration.referenceSetSha256) ||
    !/^[a-f0-9]{64}$/iu.test(calibration.modelSha256) || calibration.sampleCount < 1 || !calibration.reviewer.trim() ||
    input.alignmentProvenance?.alignerVersion !== calibration.alignerVersion || input.alignmentProvenance.modelId !== calibration.modelId ||
    input.alignmentProvenance.modelRevision !== calibration.modelRevision || input.alignmentProvenance.modelSha256 !== calibration.modelSha256 ||
    !Number.isFinite(Date.parse(calibration.reviewedAt)) ||
    alignedCoverage < calibration.coverageMin || normalizedWordErrorRate > calibration.werMax ||
    onsetErrors.length !== input.words.length || offsetErrors.length !== input.words.length ||
    (mean(onsetErrors) ?? Infinity) > calibration.onsetMaeMaxSeconds || percentile95(onsetErrors) > calibration.onsetP95MaxSeconds ||
    (mean(offsetErrors) ?? Infinity) > calibration.offsetMaeMaxSeconds || percentile95(offsetErrors) > calibration.offsetP95MaxSeconds
  ) {
    reason = "quality_below_calibration";
  } else {
    eligible = true;
    reason = "eligible";
  }
  return {
    metricVersion: TRAILER_CAPTION_METRIC_VERSION,
    transcriptTokenCount: expectedTokens.length,
    cueTokenCount: actualTokens.length,
    alignedCoverage,
    normalizedWordErrorRate,
    cueMonotonic,
    cueNonOverlapping,
    cueWithinDuration,
    cuePositiveDuration,
    onsetMaeSeconds: mean(onsetErrors),
    onsetP95Seconds: onsetErrors.length ? percentile95(onsetErrors) : null,
    offsetMaeSeconds: mean(offsetErrors),
    offsetP95Seconds: offsetErrors.length ? percentile95(offsetErrors) : null,
    eligible,
    reason,
  };
};

const readLocalModelManifest = async (modelPath: string): Promise<{ modelSha256: string } | null> => {
  try {
    const resolved = path.resolve(modelPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return null;
    const manifestPath = path.join(resolved, "dragaocareca-model-manifest.json");
    const manifestBytes = await fs.readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
    if (manifest.modelId !== TRAILER_CAPTION_MODEL_ID || manifest.revision !== TRAILER_CAPTION_MODEL_REVISION) return null;
    if (typeof manifest.modelSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.modelSha256) || !Array.isArray(manifest.files) || !manifest.files.length) return null;
    const files: Array<{ path: string; sha256: string }> = [];
    const declaredPaths = new Set<string>();
    for (const item of manifest.files) {
      if (!item || typeof item.path !== "string" || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.sha256)) return null;
      const relative = item.path.replace(/\\/gu, "/");
      if (path.isAbsolute(relative) || relative.split("/").includes("..") || declaredPaths.has(relative)) return null;
      declaredPaths.add(relative);
      const filePath = path.resolve(resolved, relative);
      const targetStat = await fs.lstat(filePath);
      if (!targetStat.isFile() || targetStat.isSymbolicLink() || path.relative(resolved, filePath).startsWith(`..${path.sep}`)) return null;
      files.push({ path: relative, sha256: await sha256File(filePath) });
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const actualPaths: string[] = [];
    const visit = async (directory: string, prefix = ""): Promise<boolean> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (relative === "dragaocareca-model-manifest.json") continue;
        if (entry.isSymbolicLink()) return false;
        if (entry.isDirectory()) {
          if (!await visit(path.join(directory, entry.name), relative)) return false;
        } else if (entry.isFile()) actualPaths.push(relative);
        else return false;
      }
      return true;
    };
    if (!await visit(resolved)) return null;
    actualPaths.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    if (actualPaths.length !== files.length || actualPaths.some((relative, index) => relative !== files[index].path)) return null;
    const computed = sha256(files.map((file) => `${file.path}:${file.sha256}`).join("\n"));
    if (computed !== manifest.modelSha256.toLowerCase()) return null;
    return { modelSha256: computed };
  } catch { return null; }
};

const runAligner = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(process.env.TRAILER_CAPTION_PYTHON ?? "python3", args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1" },
  });
  let stdout = "";
  let outputBytes = 0;
  let settled = false;
  const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("timeout")); }, ALIGNMENT_TIMEOUT_MS);
  const finish = (error?: Error, output?: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(output ?? "");
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_ALIGNMENT_OUTPUT_BYTES) { child.kill("SIGKILL"); finish(new Error("output_limit")); return; }
    stdout += chunk.toString("utf8");
  });
  child.stderr?.resume(); // Never retain or relay transcript/model paths from third-party diagnostics.
  child.once("error", () => finish(new Error("unavailable")));
  child.once("close", (code) => code === 0 ? finish(undefined, stdout) : finish(new Error("alignment_failed")));
});

export const alignTrailerTranscript = async (input: {
  candidate: TrailerCandidateRow;
}): Promise<TrailerCaptionAlignmentResult> => {
  let snapshot: Awaited<ReturnType<typeof getTrailerCandidateSnapshotPaths>>;
  try { snapshot = await getTrailerCandidateSnapshotPaths(input.candidate); }
  catch { return { status: "unavailable", reason: "alignment_failed" }; }
  if (!input.candidate.trailerTranscriptSha256 || !input.candidate.trailerTranscriptRelativePath) {
    return { status: "unavailable", reason: "alignment_failed" };
  }
  const audioPath = snapshot.audioPath;
  const transcriptPath = await trailerCandidateExistingFilePath(input.candidate.trailerTranscriptRelativePath).catch(() => undefined);
  if (!transcriptPath) return { status: "unavailable", reason: "alignment_failed" };
  let transcript: Buffer;
  try {
    transcript = await fs.readFile(transcriptPath);
  } catch { return { status: "unavailable", reason: "alignment_failed" }; }
  if (!transcript.length || transcript.length > MAX_TRANSCRIPT_BYTES || sha256(transcript) !== input.candidate.trailerTranscriptSha256) {
    return { status: "unavailable", reason: "alignment_failed" };
  }
  const modelPath = process.env.TRAILER_CAPTION_MODEL_PATH;
  if (!modelPath) return { status: "unavailable", reason: "model_unavailable" };
  const model = await readLocalModelManifest(modelPath);
  if (!model) return { status: "unavailable", reason: "model_unavailable" };
  const audioSha256 = await sha256File(audioPath);
  const scriptPath = path.resolve(__dirname, "../../scripts/whisperx_align.py");
  const args = [scriptPath, "--audio", audioPath, "--transcript", path.resolve(transcriptPath), "--model-dir", path.resolve(modelPath)];
  try {
    const output = await runAligner(args);
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { words?: unknown }).words)) throw new Error("invalid output");
    const adapter = parsed as { words: Array<Record<string, unknown>>; status?: string; alignerVersion?: string; modelId?: string; modelRevision?: string; modelSha256?: string; audioSha256?: string; transcriptSha256?: string };
    if (adapter.status !== "aligned" || adapter.alignerVersion !== TRAILER_CAPTION_ALIGNER_VERSION || adapter.modelId !== TRAILER_CAPTION_MODEL_ID || adapter.modelRevision !== TRAILER_CAPTION_MODEL_REVISION ||
      adapter.modelSha256 !== model.modelSha256 || adapter.audioSha256 !== audioSha256 || adapter.transcriptSha256 !== sha256(transcript)) throw new Error("provenance mismatch");
    const words = adapter.words.map((word) => ({
      startSeconds: word.start,
      endSeconds: word.end,
      text: word.text,
    }));
    if (words.some((word) => typeof word.text !== "string" || typeof word.startSeconds !== "number" || typeof word.endSeconds !== "number")) {
      throw new Error("invalid cue");
    }
    return {
      status: "aligned", reason: "aligned", audioSha256, transcriptSha256: sha256(transcript),
      modelSha256: model.modelSha256, alignerVersion: TRAILER_CAPTION_ALIGNER_VERSION,
      modelId: TRAILER_CAPTION_MODEL_ID, modelRevision: TRAILER_CAPTION_MODEL_REVISION,
      profileId: input.candidate.profileId, profileRevision: input.candidate.profileRevision,
      words: words as TrailerTimedWord[],
    };
  } catch {
    return { status: "unavailable", reason: "alignment_failed" };
  }
};
