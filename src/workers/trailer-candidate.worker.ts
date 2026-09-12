import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { trailerCandidateRepository, type TrailerCandidateRow } from "../database/repositories/trailer-candidate.repository";
import { acquireTrailerCandidateFileUse, cleanupTrailerCandidateFiles } from "../services/trailer-candidate-file-cleanup.service";
import {
  getTrailerCandidateSnapshotPaths,
  trailerCandidateStoragePath,
  trailerCandidateSourcesStillCurrent,
} from "../services/trailer-candidate.service";
import {
  readTrailerDurationSeconds,
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
};

const availableBytes = async (rootPath: string): Promise<number> => {
  const stats = await fs.promises.statfs(rootPath, { bigint: true });
  return Number(stats.bavail * stats.bsize);
};

const safelyRemovePartial = async (relativePath: string): Promise<void> => {
  if (!relativePath.endsWith(".partial.mp4") || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) return;
  const absolute = await trailerCandidateStoragePath(relativePath);
  const stat = await fs.promises.lstat(absolute).catch(() => null);
  if (stat?.isFile() && !stat.isSymbolicLink()) await fs.promises.unlink(absolute);
};

const cleanupInterruptedPartials = async (interrupted: TrailerCandidateRow[]): Promise<void> => {
  for (const candidate of interrupted) {
    for (const attempt of trailerCandidateRepository.listAttempts(candidate.candidateId)) {
      if (attempt.status === "interrupted" && attempt.outputPartialRelativePath) {
        await safelyRemovePartial(attempt.outputPartialRelativePath).catch(() => undefined);
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
  const attemptNumber = claimed.attemptCount;
  const candidateDirectory = await trailerCandidateStoragePath(candidate.snapshotRelativePath);
  const outputPaths = resolveAttemptOutputPaths(candidateDirectory, attemptNumber);
  await fs.promises.mkdir(outputPaths.directory, { recursive: true });
  const partialRelativePath = path.posix.join(candidate.snapshotRelativePath.replace(/[\\/]+$/, ""), "attempts", String(attemptNumber), path.basename(outputPaths.partial));
  trailerCandidateRepository.setAttemptPartialPath(candidate.candidateId, attemptNumber, partialRelativePath);

  try {
    await renderTrailerCandidateOutput({ ...snapshot, outputPath: outputPaths.partial, durationSeconds }, runner);
    const evidence = await validateTrailerCandidateOutput(outputPaths.partial, durationSeconds, runner);
    if (!await trailerCandidateSourcesStillCurrent(candidate)) {
      await fs.promises.unlink(outputPaths.partial).catch(() => undefined);
      if (trailerCandidateRepository.markStale(candidate.candidateId)) {
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
    });
    if (!markedReady) {
      await fs.promises.unlink(outputPaths.ready).catch(() => undefined);
      return;
    }
    trailerCandidateRepository.supersedeTerminalAndQueueCleanup(candidate.episodeId, candidate.candidateId);
  } catch (error) {
    await fs.promises.unlink(outputPaths.partial).catch(() => undefined);
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
