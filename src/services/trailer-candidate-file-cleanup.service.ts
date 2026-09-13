import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "../config/env";
import { trailerCandidateRepository } from "../database/repositories/trailer-candidate.repository";
import { assertPrivateTrailerCandidateRoot } from "./trailer-candidate.service";

const activeFileUsers = new Map<string, number>();
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fileSha256 = async (filePath: string): Promise<string> => createHash("sha256").update(await fs.promises.readFile(filePath)).digest("hex");

const queueExpiredCandidates = (now: Date): void => {
  const retentionDays = config.trailerCandidateRetentionDays;
  if (retentionDays === null) return;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  for (const identity of trailerCandidateRepository.listRetentionCandidates(cutoff, 500)) {
    trailerCandidateRepository.queueRetentionCleanup(identity, cutoff);
  }
};

export const acquireTrailerCandidateFileUse = (candidateId: string): (() => void) => {
  activeFileUsers.set(candidateId, (activeFileUsers.get(candidateId) ?? 0) + 1);
  return () => {
    const remaining = (activeFileUsers.get(candidateId) ?? 1) - 1;
    if (remaining <= 0) activeFileUsers.delete(candidateId);
    else activeFileUsers.set(candidateId, remaining);
  };
};

export const cleanupTrailerCandidateFiles = async (now = new Date()): Promise<{ removed: number; deferred: number }> => {
  let removed = 0;
  let deferred = 0;
  queueExpiredCandidates(now);
  for (const cleanup of trailerCandidateRepository.listFileCleanup(500)) {
    if (activeFileUsers.has(cleanup.candidateId)) {
      deferred += 1;
      continue;
    }
    try {
      if (!candidateIdPattern.test(cleanup.candidateId) || cleanup.relativeDirectory.replace(/[\\/]+$/, "") !== cleanup.candidateId) {
        throw new Error("Invalid candidate cleanup identity");
      }
      if (!trailerCandidateRepository.canCleanupFiles(cleanup.candidateId, cleanup.relativeDirectory)) {
        throw new Error("Candidate cleanup identity is no longer eligible");
      }
      const root = await assertPrivateTrailerCandidateRoot();
      const target = path.resolve(root, cleanup.candidateId);
      if (path.dirname(target) !== root || target === root) throw new Error("Invalid candidate cleanup path");
      const stat = await fs.promises.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Candidate cleanup target is not a private directory");
      const candidate = trailerCandidateRepository.findById(cleanup.candidateId);
      if (stat && candidate) {
        const coverPath = path.join(target, "cover.jpeg");
        const audioPath = path.join(target, "trailer.mp3");
        if (await fileSha256(coverPath) !== candidate.coverSha256 || await fileSha256(audioPath) !== candidate.audioSha256) {
          throw new Error("Candidate source snapshot no longer matches its recorded hashes");
        }
        if (candidate.outputRelativePath && candidate.outputSha256) {
          const outputPath = path.resolve(root, candidate.outputRelativePath);
          if (!outputPath.startsWith(`${target}${path.sep}`) || await fileSha256(outputPath) !== candidate.outputSha256) {
            throw new Error("Candidate output no longer matches its recorded hash");
          }
        }
      }
      if (!trailerCandidateRepository.canCleanupFiles(cleanup.candidateId, cleanup.relativeDirectory)) {
        throw new Error("Candidate cleanup identity changed during verification");
      }
      if (stat) await fs.promises.rm(target, { recursive: true, force: false });
      trailerCandidateRepository.completeFileCleanup(cleanup.candidateId);
      removed += 1;
    } catch (error) {
      trailerCandidateRepository.failFileCleanup(cleanup.candidateId, error instanceof Error ? error.message : String(error));
      console.warn("Could not clean private trailer candidate files; cleanup remains retryable", error instanceof Error ? error.message : String(error));
    }
  }
  return { removed, deferred };
};
