import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import type { ZipArchive } from "archiver" with { "resolution-mode": "import" };
import { config } from "../config/env";
import {
  parseEpisodeArtifactSelectors,
  preflightEpisodeArtifactDownloads,
  type EpisodeArtifactCatalogEntry,
  type EpisodeArtifactSelector,
} from "./episode-artifact-download.service";

const preparationRoot = path.join(config.media.storageRoot, ".artifact-preparations");
const manifestsRoot = path.join(preparationRoot, "manifests");
const snapshotsRoot = path.join(preparationRoot, "snapshots");
const archivesRoot = path.join(preparationRoot, "archives");
const retentionMs = 24 * 60 * 60 * 1000;

export type EpisodeArtifactPreparationState = "queued" | "preparing" | "ready" | "failed" | "expired";

type SourceEvidence = { digest: string } | { missing: true };

type PreparationManifest = {
  jobId: string;
  cacheKey: string;
  episodeId: number;
  requested: EpisodeArtifactSelector[];
  available: EpisodeArtifactSelector[];
  missing: EpisodeArtifactSelector[];
  evidence: Record<EpisodeArtifactSelector, SourceEvidence>;
  state: EpisodeArtifactPreparationState;
  progress: number;
  stateText: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  archiveFileName: string | null;
};

export type EpisodeArtifactPreparationStatus = {
  jobId: string;
  episodeId: number;
  requested: EpisodeArtifactSelector[];
  available: EpisodeArtifactSelector[];
  missing: EpisodeArtifactSelector[];
  state: EpisodeArtifactPreparationState;
  progress: number;
  stateText: string;
  queuePosition: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
};

export type EpisodeArtifactPreparationDownload = {
  status: EpisodeArtifactPreparationStatus;
  stream: fs.ReadStream;
};

let activeProcess: Promise<EpisodeArtifactPreparationStatus | null> | null = null;
const activePreparationByCacheKey = new Map<string, Promise<EpisodeArtifactPreparationStatus>>();

const isMissingPathError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

const logPreparation = (event: string, manifest: PreparationManifest): void => {
  console.info("[artifact-preparation]", { event, episodeId: manifest.episodeId, selectors: manifest.requested });
};

const nowIso = (now: Date): string => now.toISOString();
const manifestPath = (jobId: string): string => path.join(manifestsRoot, `${jobId}.json`);
const snapshotDirectory = (jobId: string): string => path.join(snapshotsRoot, jobId);
const archivePath = (fileName: string): string => path.join(archivesRoot, fileName);
const cacheKey = (episodeId: number, requested: readonly EpisodeArtifactSelector[]): string => `${episodeId}:${requested.join(",")}`;

const ensureRoots = async (): Promise<void> => {
  await Promise.all([manifestsRoot, snapshotsRoot, archivesRoot].map((directory) => fs.promises.mkdir(directory, { recursive: true })));
};

const writeManifest = async (manifest: PreparationManifest): Promise<void> => {
  await ensureRoots();
  const target = manifestPath(manifest.jobId);
  const temporary = path.join(manifestsRoot, `.${manifest.jobId}.${randomUUID()}.part`);
  await fs.promises.writeFile(temporary, JSON.stringify(manifest));
  await fs.promises.rename(temporary, target);
};

const readManifest = async (jobId: string): Promise<PreparationManifest | null> => {
  try {
    return JSON.parse(await fs.promises.readFile(manifestPath(jobId), "utf8")) as PreparationManifest;
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
};

const listManifests = async (): Promise<PreparationManifest[]> => {
  await ensureRoots();
  const entries = await fs.promises.readdir(manifestsRoot, { withFileTypes: true });
  const manifests = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readManifest(entry.name.slice(0, -5))));
  return manifests.filter((manifest): manifest is PreparationManifest => manifest !== null)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
};

const digestFile = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};

const buildEvidence = async (
  episodeId: number,
  selectedArtifacts: readonly EpisodeArtifactCatalogEntry[]
): Promise<{ available: EpisodeArtifactSelector[]; missing: EpisodeArtifactSelector[]; evidence: Record<EpisodeArtifactSelector, SourceEvidence> }> => {
  const preflight = await preflightEpisodeArtifactDownloads(episodeId, selectedArtifacts);
  const evidence = {} as Record<EpisodeArtifactSelector, SourceEvidence>;
  for (const artifact of preflight.available) evidence[artifact.selector] = { digest: await digestFile(artifact.path) };
  for (const selector of preflight.missing) evidence[selector] = { missing: true };
  return { available: preflight.available.map((artifact) => artifact.selector), missing: preflight.missing, evidence };
};

const evidenceMatches = (left: Record<EpisodeArtifactSelector, SourceEvidence>, right: Record<EpisodeArtifactSelector, SourceEvidence>): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const toStatus = async (manifest: PreparationManifest, now: Date): Promise<EpisodeArtifactPreparationStatus> => {
  const queued = manifest.state === "queued";
  const queuePosition = queued
    ? (await listManifests()).filter((candidate) => candidate.state === "queued").findIndex((candidate) => candidate.jobId === manifest.jobId) + 1
    : null;
  return {
    jobId: manifest.jobId,
    episodeId: manifest.episodeId,
    requested: manifest.requested,
    available: manifest.available,
    missing: manifest.missing,
    state: manifest.state,
    progress: Math.max(0, Math.min(100, Math.trunc(manifest.progress))),
    stateText: manifest.stateText,
    queuePosition: queuePosition && queuePosition > 0 ? queuePosition : null,
    downloadUrl: manifest.state === "ready" ? `/v1/episodes/${manifest.episodeId}/artifacts/preparations/${manifest.jobId}/download` : null,
    expiresAt: manifest.expiresAt,
  };
};

const expireManifest = async (manifest: PreparationManifest, now: Date, event: "expired" | "invalidated"): Promise<PreparationManifest> => {
  if (manifest.archiveFileName) await fs.promises.rm(archivePath(manifest.archiveFileName), { force: true });
  await fs.promises.rm(snapshotDirectory(manifest.jobId), { recursive: true, force: true });
  const expired = { ...manifest, state: "expired" as const, progress: 0, stateText: event === "invalidated" ? "Artifact sources changed" : "Preparation expired", updatedAt: nowIso(now), archiveFileName: null };
  await writeManifest(expired);
  logPreparation(event, expired);
  return expired;
};

const revalidateReadyManifest = async (manifest: PreparationManifest, now: Date): Promise<PreparationManifest> => {
  if (manifest.state !== "ready") return manifest;
  if (!manifest.expiresAt || Date.parse(manifest.expiresAt) <= now.getTime()) return expireManifest(manifest, now, "expired");
  if (!manifest.archiveFileName) return expireManifest(manifest, now, "invalidated");
  try {
    if (!(await fs.promises.lstat(archivePath(manifest.archiveFileName))).isFile()) return expireManifest(manifest, now, "invalidated");
  } catch (error) {
    if (isMissingPathError(error)) return expireManifest(manifest, now, "invalidated");
    throw error;
  }
  const current = await buildEvidence(manifest.episodeId, parseEpisodeArtifactSelectors(manifest.requested.join(",")));
  return evidenceMatches(manifest.evidence, current.evidence) ? manifest : expireManifest(manifest, now, "invalidated");
};

const copySnapshot = async (sourcePath: string, destinationPath: string): Promise<{ digest: string; bytes: number }> => {
  const hash = createHash("sha256");
  let bytes = 0;
  const output = fs.createWriteStream(destinationPath, { flags: "wx" });
  try {
    for await (const chunk of fs.createReadStream(sourcePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.length;
      if (!output.write(buffer)) await once(output, "drain");
    }
    output.end();
    await once(output, "finish");
    return { digest: hash.digest("hex"), bytes };
  } catch (error) {
    output.destroy();
    throw error;
  }
};

const createArchive = async (manifest: PreparationManifest, snapshots: Array<{ filePath: string; entryName: string; bytes: number }>): Promise<string> => {
  const fileName = `${manifest.jobId}-${randomUUID()}.zip`;
  const finalPath = archivePath(fileName);
  const temporaryPath = path.join(archivesRoot, `.${fileName}.part`);
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  const { ZipArchive } = require("archiver") as { ZipArchive: new () => ZipArchive };
  const archive = new ZipArchive();
  const totalBytes = snapshots.reduce((total, snapshot) => total + snapshot.bytes, 0);
  let progressWrite = Promise.resolve();
  archive.on("progress", (progress: { fs: { processedBytes: number } }) => {
    const percentage = totalBytes === 0 ? 0 : Math.min(99, Math.floor((progress.fs.processedBytes / totalBytes) * 100));
    progressWrite = progressWrite.then(() => writeManifest({
      ...manifest,
      progress: percentage,
      stateText: "Preparing archive",
      updatedAt: nowIso(new Date()),
    }));
  });
  try {
    archive.on("error", (error: Error) => output.destroy(error));
    for (const snapshot of snapshots) archive.file(snapshot.filePath, { name: snapshot.entryName });
    const completed = once(output, "close");
    archive.pipe(output);
    await archive.finalize();
    await completed;
    await progressWrite;
    await fs.promises.rename(temporaryPath, finalPath);
    return fileName;
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
};

export const initializeEpisodeArtifactPreparations = async (
  options: { now?: Date; recoverInterrupted?: boolean } = {}
): Promise<void> => {
  const now = options.now ?? new Date();
  const recoverInterrupted = options.recoverInterrupted ?? true;
  await ensureRoots();
  const manifests = await listManifests();
  for (const manifest of manifests) {
    if (recoverInterrupted && manifest.state === "preparing") {
      await fs.promises.rm(snapshotDirectory(manifest.jobId), { recursive: true, force: true });
      await writeManifest({ ...manifest, state: "queued", progress: 0, stateText: "Queued for preparation", updatedAt: nowIso(now) });
    } else if (manifest.state === "ready") {
      await revalidateReadyManifest(manifest, now);
    }
  }
  const knownJobIds = new Set(manifests.map((manifest) => manifest.jobId));
  const [rootFiles, archiveFiles, snapshotDirectories] = await Promise.all([
    fs.promises.readdir(preparationRoot, { withFileTypes: true }),
    fs.promises.readdir(archivesRoot, { withFileTypes: true }),
    fs.promises.readdir(snapshotsRoot, { withFileTypes: true }),
  ]);
  await Promise.all([
    ...rootFiles.filter((entry) => entry.isFile() && entry.name.endsWith(".part"))
      .map((entry) => fs.promises.rm(path.join(preparationRoot, entry.name), { force: true })),
    ...archiveFiles.filter((entry) => entry.isFile() && entry.name.endsWith(".part"))
      .map((entry) => fs.promises.rm(path.join(archivesRoot, entry.name), { force: true })),
    ...snapshotDirectories.filter((entry) => entry.isDirectory() && !knownJobIds.has(entry.name))
      .map((entry) => fs.promises.rm(path.join(snapshotsRoot, entry.name), { recursive: true, force: true })),
  ]);
};

export const prepareEpisodeArtifactArchive = async (
  episodeId: number,
  selectedArtifacts: readonly EpisodeArtifactCatalogEntry[],
  options: { now?: Date } = {}
): Promise<EpisodeArtifactPreparationStatus> => {
  const now = options.now ?? new Date();
  const requested = selectedArtifacts.map((artifact) => artifact.selector);
  const requestedCacheKey = cacheKey(episodeId, requested);
  const existingOperation = activePreparationByCacheKey.get(requestedCacheKey);
  if (existingOperation) return existingOperation;

  let operation: Promise<EpisodeArtifactPreparationStatus>;
  operation = (async (): Promise<EpisodeArtifactPreparationStatus> => {
    await initializeEpisodeArtifactPreparations({ now, recoverInterrupted: false });
    const candidates = (await listManifests()).filter((manifest) => manifest.cacheKey === requestedCacheKey);
    const activeManifest = candidates.find((manifest) => manifest.state === "queued" || manifest.state === "preparing");
    if (activeManifest) return toStatus(activeManifest, now);

    for (const candidate of candidates) {
      if (candidate.state !== "ready") continue;
      const refreshed = await revalidateReadyManifest(candidate, now);
      if (refreshed.state === "ready") {
        logPreparation("cache-hit", refreshed);
        return toStatus(refreshed, now);
      }
    }

    const source = await buildEvidence(episodeId, selectedArtifacts);
    const manifest: PreparationManifest = {
      jobId: randomUUID(), cacheKey: requestedCacheKey, episodeId, requested,
      available: source.available, missing: source.missing, evidence: source.evidence,
      state: "queued", progress: 0, stateText: "Queued for preparation", createdAt: nowIso(now), updatedAt: nowIso(now), expiresAt: null, archiveFileName: null,
    };
    await writeManifest(manifest);
    logPreparation("queued", manifest);
    return toStatus(manifest, now);
  })().finally(() => {
    if (activePreparationByCacheKey.get(requestedCacheKey) === operation) activePreparationByCacheKey.delete(requestedCacheKey);
  });
  activePreparationByCacheKey.set(requestedCacheKey, operation);
  return operation;
};

export const getEpisodeArtifactPreparationStatus = async (
  episodeId: number,
  jobId: string,
  options: { now?: Date } = {}
): Promise<EpisodeArtifactPreparationStatus | null> => {
  const manifest = await readManifest(jobId);
  if (!manifest || manifest.episodeId !== episodeId) return null;
  return toStatus(await revalidateReadyManifest(manifest, options.now ?? new Date()), options.now ?? new Date());
};

export const getValidatedEpisodeArtifactPreparationDownload = async (
  episodeId: number,
  jobId: string,
  options: { now?: Date } = {}
): Promise<EpisodeArtifactPreparationDownload | null> => {
  const status = await getEpisodeArtifactPreparationStatus(episodeId, jobId, options);
  if (!status || status.state !== "ready") return null;
  const manifest = await readManifest(jobId);
  if (!manifest?.archiveFileName) return null;
  return { status, stream: fs.createReadStream(archivePath(manifest.archiveFileName)) };
};

export const processNextEpisodeArtifactPreparation = async (options: { now?: Date } = {}): Promise<EpisodeArtifactPreparationStatus | null> => {
  if (activeProcess) return activeProcess;
  activeProcess = (async (): Promise<EpisodeArtifactPreparationStatus | null> => {
    const now = options.now ?? new Date();
    const manifest = (await listManifests()).find((candidate) => candidate.state === "queued");
    if (!manifest) return null;
    const preparing = { ...manifest, state: "preparing" as const, progress: 0, stateText: "Preparing archive", updatedAt: nowIso(now) };
    await writeManifest(preparing);
    logPreparation("started", preparing);
    try {
      const selected = parseEpisodeArtifactSelectors(preparing.requested.join(","));
      const preflight = await preflightEpisodeArtifactDownloads(preparing.episodeId, selected);
      const snapshots: Array<{ filePath: string; entryName: string; bytes: number }> = [];
      const evidence = {} as Record<EpisodeArtifactSelector, SourceEvidence>;
      await fs.promises.mkdir(snapshotDirectory(preparing.jobId), { recursive: true });
      for (const artifact of preflight.available) {
        const snapshotPath = path.join(snapshotDirectory(preparing.jobId), artifact.fileName);
        const copied = await copySnapshot(artifact.path, snapshotPath);
        snapshots.push({ filePath: snapshotPath, entryName: artifact.archiveEntryName, bytes: copied.bytes });
        evidence[artifact.selector] = { digest: copied.digest };
      }
      for (const selector of preflight.missing) evidence[selector] = { missing: true };
      const afterSnapshot = await buildEvidence(preparing.episodeId, selected);
      if (!evidenceMatches(evidence, afterSnapshot.evidence)) throw new Error("Artifact sources changed during preparation");
      const archiveFileName = await createArchive(preparing, snapshots);
      const ready: PreparationManifest = {
        ...preparing, available: preflight.available.map((artifact) => artifact.selector), missing: preflight.missing, evidence,
        state: "ready", progress: 100, stateText: "Archive ready", updatedAt: nowIso(now), expiresAt: new Date(now.getTime() + retentionMs).toISOString(), archiveFileName,
      };
      await writeManifest(ready);
      logPreparation("completed", ready);
      return toStatus(ready, now);
    } catch (_error) {
      await fs.promises.rm(snapshotDirectory(preparing.jobId), { recursive: true, force: true });
      const failed = { ...preparing, state: "failed" as const, progress: 0, stateText: "Preparation failed", updatedAt: nowIso(now) };
      await writeManifest(failed);
      logPreparation("failed", failed);
      return toStatus(failed, now);
    }
  })().finally(() => { activeProcess = null; });
  return activeProcess;
};
