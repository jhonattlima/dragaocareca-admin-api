import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { trailerCandidateRepository, type TrailerCandidateRow } from "../database/repositories/trailer-candidate.repository";
import { trailerPromotionJournalRepository, type TrailerPromotionJournal } from "../database/repositories/trailer-promotion-journal.repository";
import { episodeRepository, withImmediateTransaction } from "../database/repositories/episode.repository";
import { episodePromotionRepository } from "../database/repositories/episode-promotion.repository";
import { getDb, nowIso } from "../database/sqlite";
import { getEpisodeMediaFinalPath, getEpisodeMediaRelativePath, getEpisodeMediaStagingPath } from "./episode-media-layout.service";
import { getPromotionRequestFingerprint, buildEpisodePromotionRequest, type PromotionTransport } from "./episode-promotion.service";
import { dispatchPromotionAfterCommit } from "./episode-promotion-save.service";
import { trailerCandidateStoragePath, trailerCandidateSourcesStillCurrent } from "./trailer-candidate.service";
import { withEpisodeSourceMutationLock } from "./episode-source-mutation-lock.service";
import { createEpisodeReplacementPublicationInTransaction, dispatchEpisodeReplacementPublication } from "./episode-publication.service";
import type { MetaPublicationProvider } from "./meta-publication.provider";
import { obsoleteYoutubeTrailerJobsForCurrentSource, cleanupYoutubeTrailerVideos } from "./youtube-trailer-job.service";

export type TrailerCandidateDecision = "approve" | "reject";
export type TrailerCandidateDecisionInput = {
  episodeId: number;
  candidateId: string;
  decision: TrailerCandidateDecision;
  expectedSourceFingerprint: string;
  expectedVersion: number;
  actorEmail: string;
  transport?: PromotionTransport;
  metaProvider?: MetaPublicationProvider;
  faultAt?: "after_journal" | "after_backup" | "after_install" | "after_commit";
};
export type TrailerCandidateDecisionResult =
  | { status: "approved" | "rejected" | "replayed"; candidateId: string; episodeId: number; version: number; sourceFingerprint: string }
  | { status: "conflict"; code: "unauthorized" | "not_found" | "not_ready" | "stale" | "fingerprint_mismatch" | "already_decided" | "integrity_mismatch" | "finalization_blocked" };

const hashFile = async (filePath: string): Promise<{ sha256: string; bytes: number } | null> => {
  const stat = await fs.promises.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0) return null;
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
  }
  const after = await fs.promises.lstat(filePath).catch(() => null);
  if (!after?.isFile() || after.isSymbolicLink() || after.size !== bytes || stat.size !== bytes) return null;
  return { sha256: hash.digest("hex"), bytes };
};

const tempPath = (episodeId: number, journalId: string, kind: "prepared" | "backup"): string => {
  const finalPath = getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  return path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${kind}-${journalId}`);
};

const candidateOutputPath = async (candidate: TrailerCandidateRow): Promise<string> => {
  if (!candidate.outputRelativePath) throw new Error("Candidate output is unavailable");
  return trailerCandidateStoragePath(candidate.outputRelativePath);
};

const sourcePathFor = async (journal: TrailerPromotionJournal): Promise<string> => {
  if (journal.candidateId) {
    const candidate = trailerCandidateRepository.findById(journal.candidateId);
    if (!candidate) throw new Error("Journal candidate is unavailable");
    return candidateOutputPath(candidate);
  }
  return getEpisodeMediaStagingPath(journal.episodeId, "trailerVideo");
};

const currentHash = async (filePath: string): Promise<string | null> => (await hashFile(filePath))?.sha256 ?? null;
const canonicalHash = async (filePath: string): Promise<string | null> => {
  const stat = await fs.promises.lstat(filePath).catch(() => null);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error("Canonical trailer is not a regular file");
  const actual = await hashFile(filePath);
  if (!actual) throw new Error("Canonical trailer changed while hashing");
  return actual.sha256;
};

const rollbackUncommittedPromotion = async (journal: TrailerPromotionJournal): Promise<void> => {
  const current = trailerPromotionJournalRepository.findById(journal.journalId);
  if (!current || current.phase === "committed" || current.phase === "aborted") return;
  const finalPath = getEpisodeMediaFinalPath(journal.episodeId, "trailerVideo");
  if (await canonicalHash(finalPath) !== journal.newSha256) throw new Error("Cannot rollback trailer promotion because the installed file changed");
  const backupPath = tempPath(journal.episodeId, journal.journalId, "backup");
  if (journal.oldPresent) {
    if (await currentHash(backupPath) !== journal.oldSha256) throw new Error("Cannot rollback trailer promotion because the last-known-good backup is unavailable");
    await fs.promises.rename(backupPath, finalPath);
  } else {
    await fs.promises.rm(finalPath, { force: true });
  }
  await fs.promises.rm(tempPath(journal.episodeId, journal.journalId, "prepared"), { force: true }).catch(() => undefined);
  trailerPromotionJournalRepository.setPhase(journal.journalId, "aborted");
};

const commitFinalization = (journal: TrailerPromotionJournal): void => {
  withImmediateTransaction(() => {
    const episode = episodeRepository.findByEpisodeId(journal.episodeId);
    if (!episode) throw new Error("Episode not found during trailer finalization");
    const updated = episodeRepository.updateMedia(journal.episodeId, {
      trailerVideoFileName: getEpisodeMediaRelativePath(journal.episodeId, "trailerVideo"),
      trailerVideoSyncStatus: episode.trailerVideoFileName || episode.youtube ? "manual-sync-required" : "unpublished",
    });
    if (!updated) throw new Error("Episode metadata could not be finalized");

    if (journal.candidateId) {
      const candidate = trailerCandidateRepository.findById(journal.candidateId);
      if (!candidate) throw new Error("Approved candidate is unavailable");
      const decision = getDb().prepare("SELECT decision FROM trailer_candidate_decisions WHERE candidate_id = ?").get(journal.candidateId) as { decision: string } | undefined;
      if (decision?.decision !== "approved") throw new Error("Candidate approval record is unavailable");
      const request = buildEpisodePromotionRequest({
        episodeId: episode.episodeId,
        title: episode.title,
        episodeNumber: episode.episodeNumber,
        publicDownloadUrl: `${config.feed.audioBase.replace(/\/+$/, "")}/episodes/${episode.episodeId}/audio.mp3`,
        imageUrl: `${config.feed.imageBase}${episode.coverFileName ?? `episodes/${episode.episodeId}/cover.jpeg`}`,
        trailerMediaReference: getEpisodeMediaRelativePath(episode.episodeId, "trailerVideo"),
        trailerSha256: journal.newSha256,
        trailerByteCount: candidate.outputBytes ?? 1,
      });
      episodePromotionRepository.upsertPromotionIntent({
        request,
        requestFingerprint: getPromotionRequestFingerprint(request),
        withinTransaction: true,
      });
      createEpisodeReplacementPublicationInTransaction({
        episode: updated,
        source: {
          mediaReference: getEpisodeMediaRelativePath(episode.episodeId, "trailerVideo"),
          sha256: journal.newSha256,
          byteCount: candidate.outputBytes ?? 1,
          mimeType: "video/mp4",
        },
      });
    }
    getDb().prepare("UPDATE trailer_promotion_journals SET phase = 'committed', updated_at = ? WHERE journal_id = ?").run(nowIso(), journal.journalId);
  });
};

export const reconcileTrailerPromotionJournal = async (journalId: string, faultAt?: TrailerCandidateDecisionInput["faultAt"]): Promise<void> => {
  const journal = trailerPromotionJournalRepository.findById(journalId);
  if (!journal || journal.phase === "aborted") return;
  const finalPath = getEpisodeMediaFinalPath(journal.episodeId, "trailerVideo");
  const preparedPath = tempPath(journal.episodeId, journal.journalId, "prepared");
  const backupPath = tempPath(journal.episodeId, journal.journalId, "backup");
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });

  if (journal.phase === "committed") {
    if (await canonicalHash(finalPath) !== journal.newSha256) throw new Error("Committed trailer does not match its journal");
    const backupHash = await currentHash(backupPath);
    if (backupHash && backupHash !== journal.oldSha256) throw new Error("Committed trailer backup does not match its journal");
    if (backupHash === journal.oldSha256) await fs.promises.rm(backupPath, { force: true });
    const preparedHash = await currentHash(preparedPath);
    if (preparedHash === journal.newSha256) await fs.promises.rm(preparedPath, { force: true });
    if (!journal.candidateId) {
      await fs.promises.rm(getEpisodeMediaStagingPath(journal.episodeId, "trailerVideo"), { force: true }).catch(() => undefined);
      const obsoleteJobs = await obsoleteYoutubeTrailerJobsForCurrentSource(journal.episodeId).catch(() => []);
      await cleanupYoutubeTrailerVideos(obsoleteJobs).catch(() => undefined);
    }
    return;
  }

  let finalHash = await canonicalHash(finalPath);
  if (finalHash !== journal.newSha256) {
    let preparedHash = await currentHash(preparedPath);
    if (preparedHash !== journal.newSha256) {
      const sourcePath = await sourcePathFor(journal);
      const sourceHash = await currentHash(sourcePath);
      if (sourceHash !== journal.newSha256) throw new Error("Trailer promotion source hash no longer matches the journal");
      await fs.promises.copyFile(sourcePath, preparedPath);
      preparedHash = await currentHash(preparedPath);
      if (preparedHash !== journal.newSha256) throw new Error("Prepared trailer hash does not match the journal");
    }

    finalHash = await canonicalHash(finalPath);
    if (finalHash !== null) {
      if (!journal.oldPresent || finalHash !== journal.oldSha256) throw new Error("Canonical trailer changed while promotion was pending");
      const backupHash = await currentHash(backupPath);
      if (backupHash === null) await fs.promises.rename(finalPath, backupPath);
      else if (backupHash === journal.oldSha256) await fs.promises.rm(finalPath, { force: true });
      else throw new Error("Trailer promotion backup hash does not match the journal");
      trailerPromotionJournalRepository.setPhase(journal.journalId, "old_backed_up");
      if (faultAt === "after_backup") throw new Error("Injected trailer promotion failure after backup rename");
    } else if (journal.oldPresent) {
      const backupHash = await currentHash(backupPath);
      if (backupHash !== journal.oldSha256) throw new Error("Last-known-good trailer is unavailable during recovery");
    }

    const nowFinalHash = await canonicalHash(finalPath);
    if (nowFinalHash !== journal.newSha256) {
      const nowPreparedHash = await currentHash(preparedPath);
      if (nowPreparedHash !== journal.newSha256) throw new Error("Prepared trailer is unavailable during recovery");
      await fs.promises.rename(preparedPath, finalPath);
    }
    trailerPromotionJournalRepository.setPhase(journal.journalId, "new_installed");
    if (faultAt === "after_install") throw new Error("Injected trailer promotion failure after canonical rename");
  }

  if (await canonicalHash(finalPath) !== journal.newSha256) throw new Error("Canonical trailer does not match approved output");
  try {
    commitFinalization(journal);
  } catch (error) {
    await rollbackUncommittedPromotion(journal);
    throw error;
  }
  if (faultAt === "after_commit") throw new Error("Injected trailer promotion failure after SQLite finalization");
  await fs.promises.rm(preparedPath, { force: true }).catch(() => undefined);
  await fs.promises.rm(backupPath, { force: true }).catch(() => undefined);
  if (!journal.candidateId) {
    await fs.promises.rm(getEpisodeMediaStagingPath(journal.episodeId, "trailerVideo"), { force: true }).catch(() => undefined);
    const obsoleteJobs = await obsoleteYoutubeTrailerJobsForCurrentSource(journal.episodeId).catch((error: unknown) => {
      console.warn("YouTube trailer jobs could not be invalidated after manual replacement", error instanceof Error ? error.message : String(error));
      return [];
    });
    await cleanupYoutubeTrailerVideos(obsoleteJobs).catch((error: unknown) => {
      console.warn("Obsolete YouTube trailer videos could not be cleaned after manual replacement", error instanceof Error ? error.message : String(error));
    });
  }
};

export const recoverTrailerPromotionJournals = async (): Promise<void> => {
  for (const journal of trailerPromotionJournalRepository.listUnfinished()) {
    await reconcileTrailerPromotionJournal(journal.journalId);
  }
  for (const journal of trailerPromotionJournalRepository.listCommitted()) {
    await reconcileTrailerPromotionJournal(journal.journalId);
  }
};

const persistDecisionAndJournal = (candidate: TrailerCandidateRow, actorEmail: string, decision: TrailerCandidateDecision, journalId: string, oldSha256: string | null, oldPresent: boolean): void => {
  withImmediateTransaction(() => {
    const current = getDb().prepare("SELECT status, source_fingerprint, version FROM trailer_candidate_versions WHERE candidate_id = ?").get(candidate.candidateId) as { status: string; source_fingerprint: string; version: number } | undefined;
    if (!current || current.status !== "ready" || current.source_fingerprint !== candidate.sourceFingerprint || current.version !== candidate.version) {
      throw new Error("candidate_changed");
    }
    getDb().prepare(`INSERT INTO trailer_candidate_decisions (
      candidate_id, episode_id, decision, expected_source_fingerprint, expected_version, output_sha256, actor_email, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      candidate.candidateId, candidate.episodeId, decision === "approve" ? "approved" : "rejected",
      candidate.sourceFingerprint, candidate.version, candidate.outputSha256, actorEmail, nowIso(),
    );
    if (decision === "reject") {
      getDb().prepare("UPDATE trailer_candidate_versions SET status = 'superseded', updated_at = ? WHERE candidate_id = ? AND status = 'ready'").run(nowIso(), candidate.candidateId);
      return;
    }
    trailerPromotionJournalRepository.create({
      journalId, episodeId: candidate.episodeId, candidateId: candidate.candidateId,
      oldSha256, newSha256: candidate.outputSha256 as string, oldPresent,
    });
  });
};

const decideTrailerCandidateExclusive = async (input: TrailerCandidateDecisionInput): Promise<TrailerCandidateDecisionResult> => {
  if (!config.trailerCandidateRenderEnabled) return { status: "conflict", code: "not_ready" };
  const actorEmail = input.actorEmail.trim().toLowerCase();
  if (!actorEmail) return { status: "conflict", code: "unauthorized" };
  const candidate = trailerCandidateRepository.findById(input.candidateId);
  if (!candidate || candidate.episodeId !== input.episodeId) return { status: "conflict", code: "not_found" };
  if (candidate.sourceFingerprint !== input.expectedSourceFingerprint || candidate.version !== input.expectedVersion) return { status: "conflict", code: "fingerprint_mismatch" };

  const prior = getDb().prepare("SELECT decision FROM trailer_candidate_decisions WHERE candidate_id = ?").get(candidate.candidateId) as { decision: string } | undefined;
  if (prior) {
    if (prior.decision === "approved" && input.decision === "approve") {
      const journal = trailerPromotionJournalRepository.findByCandidate(candidate.candidateId);
      if (!journal || journal.phase === "aborted") return { status: "conflict", code: "finalization_blocked" };
      try { await reconcileTrailerPromotionJournal(journal.journalId); } catch { return { status: "conflict", code: "finalization_blocked" }; }
      const finalized = trailerPromotionJournalRepository.findById(journal.journalId);
      if (finalized?.phase !== "committed") return { status: "conflict", code: "finalization_blocked" };
      return { status: "replayed", candidateId: candidate.candidateId, episodeId: candidate.episodeId, version: candidate.version, sourceFingerprint: candidate.sourceFingerprint };
    }
    return { status: "conflict", code: "already_decided" };
  }
  if (candidate.status !== "ready") return { status: "conflict", code: "not_ready" };
  if (input.decision === "reject") {
    try { persistDecisionAndJournal(candidate, actorEmail, "reject", "", null, false); }
    catch { return { status: "conflict", code: "already_decided" }; }
    return { status: "rejected", candidateId: candidate.candidateId, episodeId: candidate.episodeId, version: candidate.version, sourceFingerprint: candidate.sourceFingerprint };
  }

  try {
    const sourcePath = await candidateOutputPath(candidate);
    const output = await hashFile(sourcePath);
    if (!output || output.sha256 !== candidate.outputSha256 || output.bytes !== candidate.outputBytes) return { status: "conflict", code: "integrity_mismatch" };
    const finalPath = getEpisodeMediaFinalPath(candidate.episodeId, "trailerVideo");
    let old: { sha256: string; bytes: number } | null;
    try {
      const oldHash = await canonicalHash(finalPath);
      old = oldHash ? await hashFile(finalPath) : null;
    } catch {
      throw new Error("Canonical trailer is not a valid last-known-good file");
    }
    // Writers use this same episode guard, so no source can change between
    // this asynchronous fingerprint check and the synchronous journal CAS.
    if (!await trailerCandidateSourcesStillCurrent(candidate)) return { status: "conflict", code: "stale" };
    const journalId = randomUUID();
    persistDecisionAndJournal(candidate, actorEmail, "approve", journalId, old?.sha256 ?? null, old !== null);
    if (input.faultAt === "after_journal") throw new Error("Injected trailer promotion failure after journal commit");
    await reconcileTrailerPromotionJournal(journalId, input.faultAt);
    const requestId = `episode:${candidate.episodeId}`;
    await dispatchPromotionAfterCommit(requestId, input.transport);
    const sourceRevision = (await import("../schemas/episode-publication.js")).publicationSourceRevision(candidate.episodeId, {
      mediaReference: getEpisodeMediaRelativePath(candidate.episodeId, "trailerVideo"),
      sha256: candidate.outputSha256 as string,
      byteCount: candidate.outputBytes as number,
      mimeType: "video/mp4",
    });
    await dispatchEpisodeReplacementPublication(candidate.episodeId, sourceRevision, input.metaProvider);
    return { status: "approved", candidateId: candidate.candidateId, episodeId: candidate.episodeId, version: candidate.version, sourceFingerprint: candidate.sourceFingerprint };
  } catch (error) {
    const journal = trailerPromotionJournalRepository.findByCandidate(candidate.candidateId);
    if (!journal && error instanceof Error && error.message === "candidate_changed") return { status: "conflict", code: "stale" };
    return { status: "conflict", code: "finalization_blocked" };
  }
};

export const decideTrailerCandidate = (input: TrailerCandidateDecisionInput): Promise<TrailerCandidateDecisionResult> =>
  withEpisodeSourceMutationLock(input.episodeId, () => decideTrailerCandidateExclusive(input));

export const finalizeManualTrailerVideo = async (episodeId: number, stagedFilePath: string): Promise<void> =>
  withEpisodeSourceMutationLock(episodeId, async () => {
    const expectedStagingPath = getEpisodeMediaStagingPath(episodeId, "trailerVideo");
    if (path.resolve(stagedFilePath) !== path.resolve(expectedStagingPath)) throw new Error("Invalid trailer-video upload staging file");
    const episode = episodeRepository.findByEpisodeId(episodeId);
    if (!episode) throw new Error("Episode not found");
    const stagedHash = await hashFile(stagedFilePath);
    if (!stagedHash) throw new Error("Trailer-video upload is missing");
    const finalPath = getEpisodeMediaFinalPath(episodeId, "trailerVideo");
    let old: { sha256: string; bytes: number } | null;
    try {
      const oldHash = await canonicalHash(finalPath);
      old = oldHash ? await hashFile(finalPath) : null;
    } catch {
      throw new Error("Canonical trailer is not a valid last-known-good file");
    }
    const journalId = randomUUID();
    try {
      withImmediateTransaction(() => {
        trailerPromotionJournalRepository.create({
          journalId,
          episodeId,
          candidateId: null,
          oldSha256: old?.sha256 ?? null,
          newSha256: stagedHash.sha256,
          oldPresent: old !== null,
        });
      });
      await reconcileTrailerPromotionJournal(journalId);
    } catch (error) {
      // Keep both the staged source and any journaled backup for startup recovery.
      throw error;
    }
  });
