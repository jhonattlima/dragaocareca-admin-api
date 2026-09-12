import fs from "node:fs";
import path from "node:path";
import { trailerCandidateRepository } from "../database/repositories/trailer-candidate.repository";
import { assertPrivateTrailerCandidateRoot } from "./trailer-candidate.service";

const activeFileUsers = new Map<string, number>();
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const acquireTrailerCandidateFileUse = (candidateId: string): (() => void) => {
  activeFileUsers.set(candidateId, (activeFileUsers.get(candidateId) ?? 0) + 1);
  return () => {
    const remaining = (activeFileUsers.get(candidateId) ?? 1) - 1;
    if (remaining <= 0) activeFileUsers.delete(candidateId);
    else activeFileUsers.set(candidateId, remaining);
  };
};

export const cleanupTrailerCandidateFiles = async (): Promise<{ removed: number; deferred: number }> => {
  let removed = 0;
  let deferred = 0;
  for (const cleanup of trailerCandidateRepository.listFileCleanup(500)) {
    if (activeFileUsers.has(cleanup.candidateId)) {
      deferred += 1;
      continue;
    }
    try {
      if (!candidateIdPattern.test(cleanup.candidateId) || cleanup.relativeDirectory.replace(/[\\/]+$/, "") !== cleanup.candidateId) {
        throw new Error("Invalid candidate cleanup identity");
      }
      const root = await assertPrivateTrailerCandidateRoot();
      const target = path.resolve(root, cleanup.candidateId);
      if (path.dirname(target) !== root || target === root) throw new Error("Invalid candidate cleanup path");
      const stat = await fs.promises.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Candidate cleanup target is not a private directory");
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
