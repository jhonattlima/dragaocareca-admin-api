import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { ZipArchive } from "archiver" with { "resolution-mode": "import" };
import { config } from "../config/env";
import { artifactJobRepository, type ArtifactJobRow, type ArtifactSourceEvidence } from "../database/repositories/artifact-job.repository";
import {
  collectEpisodeArtifactSourceEvidence,
  parseEpisodeArtifactSelectors,
  preflightEpisodeArtifactDownloads,
  type EpisodeArtifactCatalogEntry,
  type EpisodeArtifactSelector,
} from "./episode-artifact-download.service";

const preparationRoot = path.join(config.media.storageRoot, ".artifact-preparations");
const snapshotsRoot = path.join(preparationRoot, "snapshots");
const archivesRoot = path.join(preparationRoot, "archives");
const retentionMs = 24 * 60 * 60 * 1000;

export type EpisodeArtifactPreparationState = "pending" | "processing" | "completed" | "failed";
export type EpisodeArtifactPreparationStage = "pending" | "processing-preflight" | "processing-archive" | "processing-finalization" | "terminal";

export type EpisodeArtifactPreparationStatus = {
  jobId: string;
  episodeId: number;
  requested: EpisodeArtifactSelector[];
  available: EpisodeArtifactSelector[];
  missing: EpisodeArtifactSelector[];
  state: string;
  progress: number;
  stateText: string;
  queuePosition: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EpisodeArtifactPreparationDownload = { status: EpisodeArtifactPreparationStatus; stream: fs.ReadStream };

export type EpisodeArtifactPreparationStageController = {
  waitFor(stage: EpisodeArtifactPreparationStage): Promise<void>;
  waitForCompletion(stage: EpisodeArtifactPreparationStage): Promise<void>;
  complete(stage: EpisodeArtifactPreparationStage): void;
  release(stage: EpisodeArtifactPreparationStage): void;
  releaseAll(): void;
};

let activeProcess: Promise<EpisodeArtifactPreparationStatus | null> | null = null;
const activeCreationByCacheKey = new Map<string, Promise<EpisodeArtifactPreparationStatus>>();
let failureMessage: string | null = null;
let stageController: EpisodeArtifactPreparationStageController | null = null;

const isMissingPathError = (error: unknown): boolean => ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException | undefined)?.code ?? "");
const cacheKey = (episodeId: number, requested: readonly EpisodeArtifactSelector[]): string => `${episodeId}:${requested.join(",")}`;
const snapshotDirectory = (jobId: string): string => path.join(snapshotsRoot, jobId);
const finalArchivePath = (jobId: string): string => path.join(archivesRoot, `episode-${jobId}-artifacts.zip`);
const temporaryArchivePath = (jobId: string): string => path.join(archivesRoot, `.episode-${jobId}-artifacts.zip.part`);

const ensureRoots = async (): Promise<void> => {
  await Promise.all([snapshotsRoot, archivesRoot].map((directory) => fs.promises.mkdir(directory, { recursive: true })));
};

const controllerFor = (stage: EpisodeArtifactPreparationStage): Promise<void> => stageController?.waitFor(stage) ?? Promise.resolve();
const publicStateText = (job: ArtifactJobRow): string => {
  if (job.status === "pending") return "Queued for preparation";
  if (job.status === "completed") return "Archive ready";
  if (job.status === "failed") return "Preparation failed";
  return job.progress === 0 ? "Preparing artifact snapshot" : job.progress < 99 ? "Assembling archive" : "Finalizing archive";
};

const evidenceMatches = (left: readonly ArtifactSourceEvidence[], right: readonly ArtifactSourceEvidence[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const hasCurrentSourceEvidence = async (job: ArtifactJobRow): Promise<boolean> => {
  if (job.sourceEvidence.length !== job.requested.length) return false;
  const selected = parseEpisodeArtifactSelectors(job.requested.join(","));
  return evidenceMatches(job.sourceEvidence, await collectEpisodeArtifactSourceEvidence(job.episodeId, selected));
};

const invalidateCompletedJob = async (job: ArtifactJobRow): Promise<void> => {
  await removeJobFiles(job.jobId, job);
  artifactJobRepository.remove(job.jobId);
};

const toStatus = (job: ArtifactJobRow): EpisodeArtifactPreparationStatus => {
  const queuePosition = job.status === "pending"
    ? artifactJobRepository.listPending().findIndex((candidate) => candidate.jobId === job.jobId) + 1
    : null;
  return {
    jobId: job.jobId,
    episodeId: job.episodeId,
    requested: job.requested as EpisodeArtifactSelector[],
    available: job.available as EpisodeArtifactSelector[],
    missing: job.missing as EpisodeArtifactSelector[],
    state: job.status,
    progress: Math.max(0, Math.min(100, Math.trunc(job.progress))),
    stateText: publicStateText(job),
    queuePosition: queuePosition && queuePosition > 0 ? queuePosition : null,
    downloadUrl: job.status === "completed" ? `/v1/episodes/${job.episodeId}/artifacts/jobs/${job.jobId}/download` : null,
    expiresAt: job.expiresAt,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
};

const removeJobFiles = async (jobId: string, job?: ArtifactJobRow | null): Promise<void> => {
  // Persisted paths are metadata, not authority. Cleanup must remain scoped to
  // the server-derived paths for this opaque job ID, even if a row is tampered.
  await Promise.all([
    fs.promises.rm(snapshotDirectory(jobId), { recursive: true, force: true }),
    fs.promises.rm(finalArchivePath(jobId), { force: true }),
    fs.promises.rm(temporaryArchivePath(jobId), { force: true }),
  ]);
};

const removeTemporaryJobFiles = async (jobId: string): Promise<void> => {
  await Promise.all([
    fs.promises.rm(snapshotDirectory(jobId), { recursive: true, force: true }),
    fs.promises.rm(temporaryArchivePath(jobId), { force: true }),
  ]);
};

const digestSnapshot = async (sourcePath: string, destinationPath: string): Promise<number> => {
  let bytes = 0;
  const output = fs.createWriteStream(destinationPath, { flags: "wx" });
  try {
    for await (const chunk of fs.createReadStream(sourcePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (!output.write(buffer)) await once(output, "drain");
    }
    output.end();
    await once(output, "finish");
    return bytes;
  } catch (error) {
    output.destroy();
    throw error;
  }
};

const assembleArchive = async (job: ArtifactJobRow, snapshots: Array<{ filePath: string; entryName: string }>): Promise<void> => {
  const temporaryPath = job.temporaryArchivePath as string;
  const finalPath = job.archivePath as string;
  await fs.promises.mkdir(archivesRoot, { recursive: true });
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  const { ZipArchive } = require("archiver") as { ZipArchive: new () => ZipArchive };
  const archive = new ZipArchive();
  try {
    for (const snapshot of snapshots) archive.file(snapshot.filePath, { name: snapshot.entryName });
    await controllerFor("processing-archive");
    if (failureMessage) throw new Error(failureMessage);
    archive.on("error", (error: Error) => output.destroy(error));
    archive.on("progress", (progress: { fs?: { processedBytes?: number; totalBytes?: number } }) => {
      const processedBytes = progress.fs?.processedBytes ?? 0;
      const totalBytes = progress.fs?.totalBytes ?? 0;
      if (totalBytes > 0) artifactJobRepository.updateProgress(job.jobId, Math.floor((processedBytes / totalBytes) * 99));
    });
    const closed = once(output, "close");
    archive.pipe(output);
    await archive.finalize();
    await closed;
    stageController?.complete("processing-archive");
    await controllerFor("processing-finalization");
    await fs.promises.rename(temporaryPath, finalPath);
    const stat = await fs.promises.lstat(finalPath);
    if (!stat.isFile()) throw new Error("Final archive is not a regular file");
    stageController?.complete("processing-finalization");
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
};

export const createEpisodeArtifactPreparationStageController = (): EpisodeArtifactPreparationStageController => {
  const released = new Set<EpisodeArtifactPreparationStage>();
  const waiters = new Map<EpisodeArtifactPreparationStage, Array<() => void>>();
  const completed = new Set<EpisodeArtifactPreparationStage>();
  const completionWaiters = new Map<EpisodeArtifactPreparationStage, Array<() => void>>();
  return {
    waitFor(stage) {
      if (released.has(stage)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const stageWaiters = waiters.get(stage) ?? [];
        stageWaiters.push(resolve);
        waiters.set(stage, stageWaiters);
      });
    },
    waitForCompletion(stage) {
      if (completed.has(stage)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const stageWaiters = completionWaiters.get(stage) ?? [];
        stageWaiters.push(resolve);
        completionWaiters.set(stage, stageWaiters);
      });
    },
    complete(stage) {
      completed.add(stage);
      for (const resolve of completionWaiters.get(stage) ?? []) resolve();
      completionWaiters.delete(stage);
    },
    release(stage) {
      released.add(stage);
      for (const resolve of waiters.get(stage) ?? []) resolve();
      waiters.delete(stage);
    },
    releaseAll() {
      for (const stage of ["pending", "processing-preflight", "processing-archive", "processing-finalization", "terminal"] as const) this.release(stage);
    },
  };
};

export const injectEpisodeArtifactPreparationStageController = (controller: EpisodeArtifactPreparationStageController): void => {
  if (config.nodeEnv === "production") throw new Error("Stage controller is verifier-only");
  stageController = controller;
};

export const resetEpisodeArtifactPreparationStageController = (): void => { stageController = null; };
export const injectEpisodeArtifactPreparationFailure = (message = "Verifier-forced archive failure"): void => {
  if (config.nodeEnv === "production") throw new Error("Failure injection is verifier-only");
  failureMessage = message;
};
export const resetEpisodeArtifactPreparationFailure = (): void => { failureMessage = null; };

export const initializeEpisodeArtifactPreparations = async (options: { now?: Date; recoverInterrupted?: boolean } = {}): Promise<void> => {
  await ensureRoots();
  const now = options.now ?? new Date();
  const expired = artifactJobRepository.cleanupExpired(now);
  for (const job of expired) await removeJobFiles(job.jobId, job);
  if (options.recoverInterrupted ?? true) {
    const recovered = artifactJobRepository.recoverProcessing();
    for (const job of recovered) await removeJobFiles(job.jobId, job);
  }
  if (options.recoverInterrupted ?? true) {
    const archiveEntries = await fs.promises.readdir(archivesRoot, { withFileTypes: true });
    await Promise.all(archiveEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".part"))
      .map((entry) => fs.promises.rm(path.join(archivesRoot, entry.name), { force: true })));
  }
};

export const prepareEpisodeArtifactArchive = async (episodeId: number, selectedArtifacts: readonly EpisodeArtifactCatalogEntry[], options: { now?: Date } = {}): Promise<EpisodeArtifactPreparationStatus> => {
  const requested = selectedArtifacts.map((artifact) => artifact.selector);
  const selectorKey = cacheKey(episodeId, requested);
  const existingCreation = activeCreationByCacheKey.get(selectorKey);
  if (existingCreation) return existingCreation;

  const creation = (async (): Promise<EpisodeArtifactPreparationStatus> => {
    await initializeEpisodeArtifactPreparations({ now: options.now, recoverInterrupted: false });
    const active = artifactJobRepository.findActive(episodeId, selectorKey);
    if (active) return toStatus(active);
    const completed = artifactJobRepository.findCompleted(episodeId, selectorKey);
    if (completed && completed.expiresAt && Date.parse(completed.expiresAt) > (options.now ?? new Date()).getTime()) {
      const finalPath = completed.archivePath;
      if (finalPath) {
        try {
          if ((await fs.promises.lstat(finalPath)).isFile() && await hasCurrentSourceEvidence(completed)) return toStatus(completed);
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
      await invalidateCompletedJob(completed);
    }
    const preflight = await preflightEpisodeArtifactDownloads(episodeId, selectedArtifacts);
    const jobId = randomUUID();
    const archivePath = finalArchivePath(jobId);
    const job = artifactJobRepository.create({
      jobId, episodeId, selectorKey, requested, available: preflight.available.map((artifact) => artifact.selector), missing: preflight.missing,
      archiveFileName: path.basename(archivePath), archivePath, snapshotPath: snapshotDirectory(jobId), temporaryArchivePath: temporaryArchivePath(jobId),
      sourceEvidence: await collectEpisodeArtifactSourceEvidence(episodeId, selectedArtifacts),
    });
    return toStatus(job);
  })();
  activeCreationByCacheKey.set(selectorKey, creation);
  try {
    return await creation;
  } finally {
    if (activeCreationByCacheKey.get(selectorKey) === creation) activeCreationByCacheKey.delete(selectorKey);
  }
};

export const getEpisodeArtifactPreparationStatus = async (episodeId: number, jobId: string, options: { now?: Date } = {}): Promise<EpisodeArtifactPreparationStatus | null> => {
  await initializeEpisodeArtifactPreparations({ now: options.now, recoverInterrupted: false });
  const job = artifactJobRepository.findByJobId(episodeId, jobId);
  if (!job) return null;
  if (job.status === "completed" && !await hasCurrentSourceEvidence(job)) {
    await invalidateCompletedJob(job);
    return null;
  }
  return toStatus(job);
};

export const getValidatedEpisodeArtifactPreparationDownload = async (episodeId: number, jobId: string, options: { now?: Date } = {}): Promise<EpisodeArtifactPreparationDownload | null> => {
  const status = await getEpisodeArtifactPreparationStatus(episodeId, jobId, options);
  if (!status || status.state !== "completed") return null;
  const job = artifactJobRepository.findByJobId(episodeId, jobId);
  if (!job?.archivePath) return null;
  const expectedPath = finalArchivePath(job.jobId);
  if (path.resolve(job.archivePath) !== path.resolve(expectedPath)) return null;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(job.archivePath);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
  const evidenceIsCurrent = await hasCurrentSourceEvidence(job);
  if (!stat.isFile() || !evidenceIsCurrent) {
    if (!evidenceIsCurrent) await invalidateCompletedJob(job);
    return null;
  }
  return { status, stream: fs.createReadStream(job.archivePath) };
};

export const processNextEpisodeArtifactPreparation = async (options: { now?: Date } = {}): Promise<EpisodeArtifactPreparationStatus | null> => {
  if (activeProcess) return activeProcess;
  activeProcess = (async () => {
    await initializeEpisodeArtifactPreparations({ now: options.now, recoverInterrupted: false });
    const pending = artifactJobRepository.listPending()[0];
    if (!pending) return null;
    const processing = artifactJobRepository.transitionToProcessing(pending.jobId);
    if (!processing) return null;
    await controllerFor("processing-preflight");
    try {
      const selected = parseEpisodeArtifactSelectors(processing.requested.join(","));
      const preflight = await preflightEpisodeArtifactDownloads(processing.episodeId, selected);
      const snapshots: Array<{ filePath: string; entryName: string }> = [];
      await fs.promises.mkdir(snapshotDirectory(processing.jobId), { recursive: true });
      for (const artifact of preflight.available) {
        const snapshotPath = path.join(snapshotDirectory(processing.jobId), artifact.fileName);
        await digestSnapshot(artifact.path, snapshotPath);
        snapshots.push({ filePath: snapshotPath, entryName: artifact.archiveEntryName });
      }
      stageController?.complete("processing-preflight");
      const sourceEvidence = await collectEpisodeArtifactSourceEvidence(processing.episodeId, selected);
      if (!evidenceMatches(sourceEvidence, await collectEpisodeArtifactSourceEvidence(processing.episodeId, selected))) {
        throw new Error("Artifact sources changed during preparation");
      }
      artifactJobRepository.updateSourceEvidence(processing.jobId, sourceEvidence);
      await assembleArchive({ ...processing, archivePath: processing.archivePath ?? finalArchivePath(processing.jobId), temporaryArchivePath: processing.temporaryArchivePath ?? temporaryArchivePath(processing.jobId) }, snapshots);
      const completed = artifactJobRepository.complete(processing.jobId, path.basename(processing.archivePath ?? finalArchivePath(processing.jobId)), processing.archivePath ?? finalArchivePath(processing.jobId), new Date((options.now ?? new Date()).getTime() + retentionMs).toISOString());
      await removeTemporaryJobFiles(processing.jobId);
      await controllerFor("terminal");
      return completed ? toStatus(completed) : null;
    } catch {
      await removeJobFiles(processing.jobId, processing);
      console.error("Episode artifact preparation failed", { episodeId: processing.episodeId, selectors: processing.requested, reason: "archive preparation failed" });
      const failed = artifactJobRepository.fail(processing.jobId);
      await controllerFor("terminal");
      return failed ? toStatus(failed) : null;
    }
  })().finally(() => { activeProcess = null; });
  return activeProcess;
};

export const cleanupExpiredEpisodeArtifactPreparations = async (now = new Date()): Promise<void> => {
  for (const job of artifactJobRepository.cleanupExpired(now)) await removeJobFiles(job.jobId, job);
};
