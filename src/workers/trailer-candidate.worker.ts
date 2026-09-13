import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config/env";
import { trailerCandidateRepository, type TrailerCandidateRow, type TrailerCandidateCaptionProvenance } from "../database/repositories/trailer-candidate.repository";
import { acquireTrailerCandidateFileUse, cleanupTrailerCandidateFiles } from "../services/trailer-candidate-file-cleanup.service";
import { transcribeTrailerAudioSnapshot } from "../services/episode-transcription.service";
import {
  alignTrailerTranscript,
  evaluateTrailerCaptionQuality,
  type TrailerCaptionCalibration,
  type TrailerCaptionCapacityEvidence,
  type TrailerCaptionAlignmentResult,
  TRAILER_CAPTION_ALIGNER_VERSION,
  TRAILER_CAPTION_MODEL_ID,
  TRAILER_CAPTION_MODEL_REVISION,
} from "../services/trailer-caption-alignment.service";
import {
  getTrailerCandidateSnapshotPaths,
  trailerCandidateExistingFilePath,
  trailerCandidateStoragePath,
  trailerCandidateSourcesStillCurrent,
} from "../services/trailer-candidate.service";
import {
  readTrailerDurationSeconds,
  renderTrailerCandidateCaptions,
  renderTrailerCandidateOutput,
  resolveAttemptOutputPaths,
  runTrailerProcess,
  trailerRenderTimeoutMs,
  validateTrailerCandidateOutput,
  type TrailerProcessRunner,
} from "../services/trailer-candidate-renderer.service";

const pollIntervalMs = 30_000;
const CAPACITY_HEADROOM_BYTES = 1024 * 1024 * 1024;
const ESTIMATED_OUTPUT_BYTES_PER_SECOND = 200 * 1024;

export const requiredTrailerCandidateFreeBytes = (sourceBytes: number, durationSeconds: number): number => {
  if (!Number.isFinite(sourceBytes) || sourceBytes < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Invalid trailer candidate capacity inputs");
  }
  return CAPACITY_HEADROOM_BYTES + sourceBytes + Math.ceil(durationSeconds * ESTIMATED_OUTPUT_BYTES_PER_SECOND);
};

export type TrailerCandidateWorkerSeams = {
  availableBytes?: (rootPath: string) => Promise<number>;
  processRunner?: TrailerProcessRunner;
  transcribe?: (audioPath: string, onProgress: (progress: number) => void) => Promise<{ text: string; provider: string }>;
  /** Test-only injection: production has no approved calibration artifact in Phase 21. */
  alignCaptions?: (input: { candidate: TrailerCandidateRow; audioPath: string }) => Promise<TrailerCaptionAlignmentResult>;
  /** Test-only injection for deterministic branch coverage; never loaded from environment or request data. */
  captionCalibration?: TrailerCaptionCalibration | null;
  /** Test-only injection for deterministic branch coverage; production capacity remains unavailable. */
  captionCapacity?: TrailerCaptionCapacityEvidence | null;
  /** Synthetic reference timings are accepted only through this test seam. */
  captionReferenceWords?: import("../services/trailer-render-profile.service").TrailerTimedWord[];
};

const availableBytes = async (rootPath: string): Promise<number> => {
  const stats = await fs.promises.statfs(rootPath, { bigint: true });
  return Number(stats.bavail * stats.bsize);
};

const sha256File = async (filePath: string): Promise<string> => {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest("hex");
};

const safelyRemovePartial = async (relativePath: string): Promise<void> => {
  if (!relativePath.endsWith(".partial.mp4") || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) return;
  const absolute = await trailerCandidateStoragePath(relativePath);
  const stat = await fs.promises.lstat(absolute).catch(() => null);
  if (stat?.isFile() && !stat.isSymbolicLink()) await fs.promises.unlink(absolute);
};

const cleanupAttemptIntermediates = async (candidate: TrailerCandidateRow, attemptNumber: number): Promise<void> => {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) return;
  const base = candidate.snapshotRelativePath.replace(/[\\/]+$/u, "");
  for (const name of ["waveform.partial.mp4", "caption.partial.mp4", "captions.ass"] as const) {
    const relative = path.posix.join(base, "attempts", String(attemptNumber), name);
    try {
      const target = await trailerCandidateStoragePath(relative);
      const stat = await fs.promises.lstat(target);
      if (stat.isFile() && !stat.isSymbolicLink()) await fs.promises.unlink(target);
    } catch { /* absent, invalid, or concurrently cleaned */ }
  }
};

const cleanupInterruptedPartials = async (interrupted: TrailerCandidateRow[]): Promise<void> => {
  for (const candidate of interrupted) {
    for (const attempt of trailerCandidateRepository.listAttempts(candidate.candidateId)) {
      if (attempt.status === "interrupted" && attempt.outputPartialRelativePath) {
        await safelyRemovePartial(attempt.outputPartialRelativePath).catch(() => undefined);
        await cleanupAttemptIntermediates(candidate, attempt.attemptNumber);
      }
    }
  }
};

export const recoverTrailerCandidateJobs = async (): Promise<TrailerCandidateRow[]> => {
  const interrupted = trailerCandidateRepository.recoverProcessing();
  await cleanupInterruptedPartials(interrupted);
  return interrupted;
};

const processTrailerCandidateInternal = async (
  candidate: TrailerCandidateRow,
  seams: TrailerCandidateWorkerSeams = {},
): Promise<void> => {
  const rootPath = path.resolve(config.media.trailerCandidatesRoot);
  const runner = seams.processRunner ?? runTrailerProcess;
  let snapshot: Awaited<ReturnType<typeof getTrailerCandidateSnapshotPaths>>;
  let durationSeconds: number;
  try {
    snapshot = await getTrailerCandidateSnapshotPaths(candidate);
    durationSeconds = await readTrailerDurationSeconds(snapshot.audioPath, runner);
  } catch (error) {
    const claimed = trailerCandidateRepository.claim(candidate.candidateId, randomUUID());
    if (claimed) trailerCandidateRepository.markRetryable(candidate.candidateId, "invalid_snapshot", error instanceof Error ? error.message.slice(0, 2_000) : String(error));
    return;
  }

  const neededBytes = requiredTrailerCandidateFreeBytes(snapshot.sourceBytes, durationSeconds);
  let freeBytes: number;
  try {
    freeBytes = await (seams.availableBytes ?? availableBytes)(rootPath);
  } catch {
    trailerCandidateRepository.waitForCapacity(candidate.candidateId, "capacity_unavailable");
    return;
  }
  if (freeBytes < neededBytes) {
    trailerCandidateRepository.waitForCapacity(candidate.candidateId);
    return;
  }

  const claimed = trailerCandidateRepository.claim(candidate.candidateId, randomUUID());
  if (!claimed) return;
  let captionRevision = {
    sourceFingerprint: claimed.sourceFingerprint,
    audioSha256: claimed.audioSha256,
    transcriptSha256: claimed.trailerTranscriptSha256,
  };
  const attemptNumber = claimed.attemptCount;
  const candidateDirectory = await trailerCandidateStoragePath(candidate.snapshotRelativePath);
  const outputPaths = resolveAttemptOutputPaths(candidateDirectory, attemptNumber);
  await fs.promises.mkdir(outputPaths.directory, { recursive: true });
  const partialRelativePath = path.posix.join(candidate.snapshotRelativePath.replace(/[\\/]+$/, ""), "attempts", String(attemptNumber), path.basename(outputPaths.partial));
  const waveformPath = path.join(outputPaths.directory, "waveform.partial.mp4");
  const captionPath = path.join(outputPaths.directory, "caption.partial.mp4");
  const assPath = path.join(outputPaths.directory, "captions.ass");
  trailerCandidateRepository.setAttemptPartialPath(candidate.candidateId, attemptNumber, partialRelativePath);

  try {
    let transcriptValid = false;
    if (claimed.trailerTranscriptStatus === "done" && claimed.trailerTranscriptRelativePath && claimed.trailerTranscriptSha256) {
      try {
        const existingTranscriptPath = await trailerCandidateExistingFilePath(claimed.trailerTranscriptRelativePath);
        const evidence = await fs.promises.readFile(existingTranscriptPath);
        transcriptValid = createHash("sha256").update(evidence).digest("hex") === claimed.trailerTranscriptSha256;
        if (!transcriptValid) throw new Error("Private trailer transcript hash mismatch");
      } catch {
        transcriptValid = false;
      }
    }

    let candidateForCaption = claimed;
    if (!transcriptValid) {
      trailerCandidateRepository.updateTrailerTranscript(candidate.candidateId, { status: "processing", progress: 0, errorCategory: null });
      try {
        const transcribe = seams.transcribe ?? ((audioPath, onProgress) => transcribeTrailerAudioSnapshot(audioPath, onProgress));
        const result = await transcribe(snapshot.audioPath, (progress) => {
          trailerCandidateRepository.updateTrailerTranscript(candidate.candidateId, { status: "processing", progress });
        });
        const transcriptText = result.text.trim();
        if (transcriptText.length > 100_000) throw new Error("Transcript exceeds the private candidate limit");
        const bytes = Buffer.from(transcriptText, "utf8");
        const transcriptHash = createHash("sha256").update(bytes).digest("hex");
        const relativePath = path.posix.join(candidate.snapshotRelativePath.replace(/[\\/]+$/u, ""), "transcript.txt");
        const finalTranscriptPath = await trailerCandidateStoragePath(relativePath);
        const temporaryTranscriptPath = `${finalTranscriptPath}.partial`;
        await fs.promises.writeFile(temporaryTranscriptPath, bytes, { flag: "wx", mode: 0o600 });
        await fs.promises.rename(temporaryTranscriptPath, finalTranscriptPath);
        transcriptValid = true;
        trailerCandidateRepository.updateTrailerTranscript(candidate.candidateId, {
          status: "done", progress: 100, relativePath, sha256: transcriptHash, provider: result.provider, errorCategory: null,
        });
        candidateForCaption = trailerCandidateRepository.findById(candidate.candidateId) ?? claimed;
        captionRevision = {
          sourceFingerprint: candidateForCaption.sourceFingerprint,
          audioSha256: candidateForCaption.audioSha256,
          transcriptSha256: candidateForCaption.trailerTranscriptSha256,
        };
      } catch {
        trailerCandidateRepository.updateTrailerTranscript(candidate.candidateId, {
          status: "error", progress: null, errorCategory: "transcription_unavailable",
        });
      }
    }

    // The transcript is deliberately kept on the candidate record and private root;
    // a transcription failure does not block waveform-only candidate generation.
    await renderTrailerCandidateOutput({ ...snapshot, outputPath: waveformPath, durationSeconds }, runner);
    await validateTrailerCandidateOutput(waveformPath, durationSeconds, runner);

    let selectedOutputPath = waveformPath;
    let captionState: TrailerCandidateCaptionProvenance = {
      status: "waveform_only",
      reasonCode: candidateForCaption.captionMode === "disabled" ? "captions_disabled" : "quality_calibration_unavailable",
      audioSha256: candidateForCaption.audioSha256,
      transcriptSha256: candidateForCaption.trailerTranscriptSha256,
      profileRevision: candidateForCaption.profileRevision,
    };
    const qualityGateAvailable = Boolean(seams.captionCalibration?.approved && seams.captionCapacity?.approved);
    if (candidateForCaption.captionMode === "automatic" && !qualityGateAvailable) {
      captionState.reasonCode = seams.captionCalibration?.approved ? "capacity_unavailable" : "quality_calibration_unavailable";
    } else if (candidateForCaption.captionMode === "automatic" && (!transcriptValid
      || candidateForCaption.trailerTranscriptStatus !== "done" || !candidateForCaption.trailerTranscriptSha256
      || !candidateForCaption.trailerTranscriptRelativePath)) {
      captionState.status = "unavailable";
      captionState.reasonCode = "transcript_unavailable";
    } else if (candidateForCaption.captionMode === "automatic") {
      let renderingCaptions = false;
      captionState.reasonCode = "alignment_failed";
      try {
        const align = seams.alignCaptions ?? ((input) => alignTrailerTranscript(input));
        if (!trailerCandidateRepository.updateCaptionState(candidate.candidateId, captionRevision, {
          ...captionState,
          status: "aligning",
          reasonCode: null,
        })) {
          if (trailerCandidateRepository.markStale(candidate.candidateId, "source_changed", "Caption result no longer matches the current candidate revision")) {
            trailerCandidateRepository.queueFileCleanup(candidate.candidateId, candidate.snapshotRelativePath);
          }
          return;
        }
        const aligned = await align({ candidate: candidateForCaption, audioPath: snapshot.audioPath });
        const transcriptFilePath = await trailerCandidateExistingFilePath(candidateForCaption.trailerTranscriptRelativePath!);
        const transcriptText = await fs.promises.readFile(transcriptFilePath, "utf8");
        const sourceAudioHash = await sha256File(snapshot.audioPath);
        captionState = {
          status: "waveform_only",
          reasonCode: aligned.status === "unavailable"
            ? aligned.reason === "model_unavailable" ? "model_unavailable"
              : aligned.reason === "aligner_unavailable" ? "aligner_unavailable" : "alignment_failed"
            : "alignment_provenance_stale",
          audioSha256: candidateForCaption.audioSha256,
          transcriptSha256: candidateForCaption.trailerTranscriptSha256,
          alignerVersion: aligned.alignerVersion ?? null,
          modelId: aligned.modelId ?? null,
          modelRevision: aligned.modelRevision ?? null,
          modelSha256: aligned.modelSha256 ?? null,
          profileRevision: candidateForCaption.profileRevision,
        };
        if (
          aligned.status === "aligned" && aligned.words &&
          aligned.audioSha256 === sourceAudioHash && aligned.audioSha256 === candidateForCaption.audioSha256 &&
          aligned.transcriptSha256 === candidateForCaption.trailerTranscriptSha256 &&
          aligned.modelRevision === TRAILER_CAPTION_MODEL_REVISION && aligned.modelId === TRAILER_CAPTION_MODEL_ID &&
          aligned.alignerVersion === TRAILER_CAPTION_ALIGNER_VERSION &&
          aligned.profileId === candidateForCaption.profileId && aligned.profileRevision === candidateForCaption.profileRevision
        ) {
          captionState = { ...captionState, status: "waveform_only", reasonCode: "alignment_coverage_insufficient" };
          const quality = evaluateTrailerCaptionQuality({
            transcript: transcriptText,
            words: aligned.words,
            durationSeconds,
            sourceBytes: snapshot.sourceBytes,
            reference: seams.captionReferenceWords,
            calibration: seams.captionCalibration ?? null,
            capacity: seams.captionCapacity ?? null,
            alignmentProvenance: {
              alignerVersion: aligned.alignerVersion ?? "",
              modelId: aligned.modelId ?? "",
              modelRevision: aligned.modelRevision ?? "",
              modelSha256: aligned.modelSha256 ?? "",
            },
          });
          if (quality.eligible) {
            if (!trailerCandidateRepository.updateCaptionState(candidate.candidateId, captionRevision, {
              ...captionState,
              status: "rendering",
              reasonCode: null,
            })) {
              if (trailerCandidateRepository.markStale(candidate.candidateId, "source_changed", "Caption result no longer matches the current candidate revision")) {
                trailerCandidateRepository.queueFileCleanup(candidate.candidateId, candidate.snapshotRelativePath);
              }
              return;
            }
            renderingCaptions = true;
            await renderTrailerCandidateCaptions({
              inputVideoPath: waveformPath,
              assPath,
              outputPath: captionPath,
              durationSeconds,
              cues: [{ words: aligned.words }],
            }, runner);
            const captionEvidence = await validateTrailerCandidateOutput(captionPath, durationSeconds, runner);
            selectedOutputPath = captionPath;
            captionState = {
              ...captionState,
              status: "included",
              reasonCode: null,
              outputSha256: captionEvidence.outputSha256,
            };
          } else {
            const reasonCodes: Record<string, TrailerCandidateCaptionProvenance["reasonCode"]> = {
              calibration_unavailable: "quality_calibration_unavailable",
              capacity_unavailable: "capacity_unavailable",
              cue_coverage_insufficient: "alignment_coverage_insufficient",
              invalid_cue_timing: "alignment_timing_invalid",
              quality_below_calibration: "quality_below_calibration",
            };
            captionState.reasonCode = reasonCodes[quality.reason] ?? "quality_below_calibration";
          }
        }
      } catch {
        // Alignment and caption rendering are optional; the validated waveform remains authoritative.
        await fs.promises.unlink(captionPath).catch(() => undefined);
        await fs.promises.unlink(assPath).catch(() => undefined);
        captionState = {
          ...captionState,
          status: "waveform_only",
          reasonCode: renderingCaptions ? "caption_render_failed" : captionState.reasonCode ?? "alignment_failed",
          outputSha256: null,
        };
      }
    }
    if (selectedOutputPath === captionPath) await fs.promises.unlink(waveformPath).catch(() => undefined);
    await fs.promises.rename(selectedOutputPath, outputPaths.partial);
    await fs.promises.unlink(assPath).catch(() => undefined);
    const evidence = await validateTrailerCandidateOutput(outputPaths.partial, durationSeconds, runner);
    const newestRevision = trailerCandidateRepository.findCurrentByFingerprint(candidate.episodeId, candidate.sourceFingerprint);
    if (!await trailerCandidateSourcesStillCurrent(candidate) || newestRevision?.candidateId !== candidate.candidateId) {
      await fs.promises.unlink(outputPaths.partial).catch(() => undefined);
      if (trailerCandidateRepository.markStale(candidate.candidateId, "source_changed", "Candidate transcript or source was superseded before completion")) {
        trailerCandidateRepository.queueFileCleanup(candidate.candidateId, candidate.snapshotRelativePath);
      }
      return;
    }

    await fs.promises.rename(outputPaths.partial, outputPaths.ready);
    const outputRelativePath = path.posix.join(candidate.snapshotRelativePath.replace(/[\\/]+$/, ""), "attempts", String(attemptNumber), path.basename(outputPaths.ready));
    const markedReady = trailerCandidateRepository.markReady(candidate.candidateId, {
      relativePath: outputRelativePath,
      sha256: evidence.outputSha256,
      bytes: evidence.outputBytes,
      durationSeconds: evidence.durationSeconds,
      probeJson: evidence.probeJson,
    }, captionState, captionRevision);
    if (!markedReady) {
      await fs.promises.unlink(outputPaths.ready).catch(() => undefined);
      return;
    }
    trailerCandidateRepository.supersedeTerminalAndQueueCleanup(candidate.episodeId, candidate.candidateId);
  } catch (error) {
    await fs.promises.unlink(outputPaths.partial).catch(() => undefined);
    await fs.promises.unlink(waveformPath).catch(() => undefined);
    await fs.promises.unlink(captionPath).catch(() => undefined);
    await fs.promises.unlink(assPath).catch(() => undefined);
    trailerCandidateRepository.markRetryable(candidate.candidateId, "render_failed", error instanceof Error ? error.message.slice(0, 2_000) : String(error));
  }
};

export const processTrailerCandidate = async (
  candidate: TrailerCandidateRow,
  seams: TrailerCandidateWorkerSeams = {},
): Promise<void> => {
  const release = acquireTrailerCandidateFileUse(candidate.candidateId);
  try {
    await processTrailerCandidateInternal(candidate, seams);
  } finally {
    release();
    await cleanupTrailerCandidateFiles();
  }
};

export const processNextTrailerCandidate = async (seams: TrailerCandidateWorkerSeams = {}): Promise<void> => {
  const candidate = trailerCandidateRepository.listPending(1)[0];
  if (candidate) await processTrailerCandidate(candidate, seams);
};

let pollTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | null = null;
let recoveredAtStartup = false;

const runOnce = async (): Promise<void> => {
  if (activeRun) return activeRun;
  activeRun = (async () => {
    try {
      if (!recoveredAtStartup) {
        await recoverTrailerCandidateJobs();
        recoveredAtStartup = true;
      }
      await processNextTrailerCandidate();
    } catch (error) {
      console.error("Trailer candidate worker failed", error instanceof Error ? error.message : String(error));
    }
  })().finally(() => { activeRun = null; });
  return activeRun;
};

export const startTrailerCandidateWorker = async (): Promise<() => void> => {
  if (!config.trailerCandidateRenderEnabled) return () => undefined;
  recoveredAtStartup = false;
  await runOnce();
  if (!pollTimer) {
    pollTimer = setInterval(() => { void runOnce(); }, pollIntervalMs);
    pollTimer.unref();
  }
  return () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    recoveredAtStartup = false;
  };
};
