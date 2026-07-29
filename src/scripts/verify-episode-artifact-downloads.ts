import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { connectDb } from "../database/connect";
import { episodeRepository } from "../database/repositories/episode.repository";
import { config } from "../config/env";
import {
  createEpisodeArtifactPreparationStageController,
  getEpisodeArtifactPreparationStatus,
  injectEpisodeArtifactPreparationFailure,
  injectEpisodeArtifactPreparationStageController,
  initializeEpisodeArtifactPreparations,
  prepareEpisodeArtifactArchive,
  processNextEpisodeArtifactPreparation,
  resetEpisodeArtifactPreparationFailure,
  resetEpisodeArtifactPreparationStageController,
  type EpisodeArtifactPreparationStatus,
} from "../services/episode-artifact-preparation.service";
import { parseEpisodeArtifactSelectors } from "../services/episode-artifact-download.service";
import { getEpisodeMediaFinalPath } from "../services/episode-media-layout.service";

const fixtureEpisodeId = 987654321;
const preparationRoot = path.join(config.media.storageRoot, ".artifact-preparations");
const resetDirectory = async (directory: string): Promise<void> => {
  await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
};

const resetVerifierFixtures = async (): Promise<void> => {
  await resetDirectory(preparationRoot);
  await fs.promises.rm(path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio")), { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio")), { recursive: true });
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "audio"), "final audio fixture");
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript"), "final transcript fixture");
  episodeRepository.delete(fixtureEpisodeId);
  episodeRepository.create({
    episodeId: fixtureEpisodeId, title: "Artifact verifier fixture", summary: "", pubDate: new Date("2026-01-01T00:00:00.000Z"),
    explicit: "no", authors: [], guests: [], tags: [], citations: [], musicCredits: [], coverCredits: [],
  });
};

const assertPublicSnapshot = (status: EpisodeArtifactPreparationStatus, state: string): void => {
  assert.equal(status.state, state);
  assert.ok(Number.isInteger(status.progress));
  assert.ok(status.progress >= 0 && status.progress <= 100);
  assert.ok(status.createdAt);
  assert.ok(status.updatedAt);
  assert.equal("archivePath" in status, false);
  assert.equal("snapshotPath" in status, false);
  assert.equal("temporaryArchivePath" in status, false);
};

const assertNoPartialOutput = async (jobId: string): Promise<void> => {
  const archives = await fs.promises.readdir(path.join(preparationRoot, "archives")).catch(() => [] as string[]);
  const snapshots = await fs.promises.readdir(path.join(preparationRoot, "snapshots", jobId)).catch(() => [] as string[]);
  assert.deepEqual(archives.filter((name) => name.includes(jobId) || name.endsWith(".part")), []);
  assert.deepEqual(snapshots, []);
};

const verifyPersistedLifecycle = async (): Promise<void> => {
  await resetVerifierFixtures();
  await initializeEpisodeArtifactPreparations({ now: new Date("2026-07-29T12:00:00.000Z") });
  const requested = parseEpisodeArtifactSelectors("transcript,episode,episode");
  const pending = await prepareEpisodeArtifactArchive(fixtureEpisodeId, requested);
  assertPublicSnapshot(pending, "pending");
  assert.equal(pending.progress, 0);
  const duplicate = await prepareEpisodeArtifactArchive(fixtureEpisodeId, parseEpisodeArtifactSelectors("episode,transcript"));
  assert.equal(duplicate.jobId, pending.jobId);

  const controller = createEpisodeArtifactPreparationStageController();
  injectEpisodeArtifactPreparationStageController(controller);
  const processing = processNextEpisodeArtifactPreparation();
  controller.release("processing-preflight");
  await controller.waitForCompletion("processing-preflight");
  const snapshotStage = await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, pending.jobId);
  assertPublicSnapshot(snapshotStage as EpisodeArtifactPreparationStatus, "processing");
  assert.equal(snapshotStage?.progress, 25);
  controller.release("processing-archive");
  await controller.waitForCompletion("processing-archive");
  const archiveStage = await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, pending.jobId);
  assert.ok((archiveStage?.progress ?? 0) >= 25);
  controller.release("processing-finalization");
  controller.release("terminal");
  const completed = await processing;
  assertPublicSnapshot(completed as EpisodeArtifactPreparationStatus, "completed");
  assert.equal(completed?.progress, 100);
  assert.equal(completed?.error, null);
  assert.equal((await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, pending.jobId))?.state, "completed");
  resetEpisodeArtifactPreparationStageController();
};

const verifyDeterministicFailureAndCleanup = async (): Promise<void> => {
  await resetVerifierFixtures();
  const pending = await prepareEpisodeArtifactArchive(fixtureEpisodeId, parseEpisodeArtifactSelectors("episode"));
  injectEpisodeArtifactPreparationFailure("Verifier forced archive failure");
  const failed = await processNextEpisodeArtifactPreparation();
  resetEpisodeArtifactPreparationFailure();
  assertPublicSnapshot(failed as EpisodeArtifactPreparationStatus, "failed");
  assert.equal(failed?.progress, 25);
  assert.equal(failed?.error, "Verifier forced archive failure");
  assert.equal((await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, pending.jobId))?.error, "Verifier forced archive failure");
  await assertNoPartialOutput(pending.jobId);
};

const verifyRecoveryAndRetention = async (): Promise<void> => {
  await resetVerifierFixtures();
  const pending = await prepareEpisodeArtifactArchive(fixtureEpisodeId, parseEpisodeArtifactSelectors("episode"));
  const controller = createEpisodeArtifactPreparationStageController();
  injectEpisodeArtifactPreparationStageController(controller);
  const processing = processNextEpisodeArtifactPreparation();
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.release("processing-preflight");
  controller.release("processing-archive");
  controller.release("processing-finalization");
  controller.release("terminal");
  await processing;
  resetEpisodeArtifactPreparationStageController();
  const interrupted = await prepareEpisodeArtifactArchive(fixtureEpisodeId, parseEpisodeArtifactSelectors("transcript"));
  const dbRow = await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, interrupted.jobId);
  assertPublicSnapshot(dbRow as EpisodeArtifactPreparationStatus, "pending");
  await initializeEpisodeArtifactPreparations({ recoverInterrupted: true });
  const recovered = await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, interrupted.jobId);
  assert.equal(recovered?.state, "pending");
  const now = new Date(Date.now() + 46 * 60 * 1000);
  await initializeEpisodeArtifactPreparations({ now });
  assert.equal(await getEpisodeArtifactPreparationStatus(fixtureEpisodeId, pending.jobId, { now }), null);
};

export const main = async (): Promise<void> => {
  if (path.basename(__filename) !== "verify-episode-artifact-downloads.js") throw new Error("expected compiled verifier execution");
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development for artifact-download verification");
  await connectDb();
  try {
    await verifyPersistedLifecycle();
    await verifyDeterministicFailureAndCleanup();
    await verifyRecoveryAndRetention();
  } finally {
    resetEpisodeArtifactPreparationFailure();
    resetEpisodeArtifactPreparationStageController();
    episodeRepository.delete(fixtureEpisodeId);
    await resetDirectory(preparationRoot);
  }
  console.log("verified persisted episode artifact job lifecycle, deterministic failure cleanup, recovery, and retention");
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
