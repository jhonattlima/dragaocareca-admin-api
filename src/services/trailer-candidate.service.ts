import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { episodeRepository } from "../database/repositories/episode.repository";
import { trailerCandidateRepository, type TrailerCandidateRow } from "../database/repositories/trailer-candidate.repository";
import { TRAILER_RENDER_VISUAL_PROFILE } from "./trailer-render-profile.service";
import {
  findExistingEpisodeMediaPath,
  getEpisodeMediaDraftTranscriptPath,
  getEpisodeMediaFinalPath,
  getEpisodeMediaStagingPath,
} from "./episode-media-layout.service";
import { checkTrailerVideoDraft, reserveTrailerVideoDraft } from "./episode-draft-reservation.service";

export type TrailerCandidateStatusDto = {
  candidateId: string;
  episodeId: number;
  version: number;
  status: TrailerCandidateRow["status"];
  progress: number;
  errorCategory: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrailerCandidateEnqueueResult = {
  candidate: TrailerCandidateStatusDto;
  reused: boolean;
  waitingForInput: false;
} | {
  candidate: null;
  reused: false;
  waitingForInput: true;
};

type Source = { kind: "cover" | "audio" | "transcript"; path: string; sha256: string; bytes: number };

const toStatusDto = (row: TrailerCandidateRow): TrailerCandidateStatusDto => ({
  candidateId: row.candidateId,
  episodeId: row.episodeId,
  version: row.version,
  status: row.status,
  progress: row.progress,
  errorCategory: row.errorCategory,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

export const assertPrivateTrailerCandidateRoot = async (): Promise<string> => {
  const mediaRoot = path.resolve(config.media.storageRoot);
  const candidateRoot = path.resolve(config.media.trailerCandidatesRoot);
  await fs.promises.mkdir(candidateRoot, { recursive: true });
  const [realMediaRoot, realCandidateRoot] = await Promise.all([
    fs.promises.realpath(mediaRoot).catch(() => mediaRoot),
    fs.promises.realpath(candidateRoot),
  ]);
  if (isWithin(realMediaRoot, realCandidateRoot)) {
    throw new Error("Trailer candidate storage must be outside the public media storage root");
  }
  return realCandidateRoot;
};

const hashFile = async (filePath: string): Promise<{ sha256: string; bytes: number }> => {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Trailer candidate source is not a regular file");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  if (bytes <= 0) throw new Error("Trailer candidate source is empty");
  return { sha256: hash.digest("hex"), bytes };
};

const resolveSources = async (episodeId: number): Promise<{ cover: string | null; audio: string | null; transcript: string | null; draftId: string | null }> => {
  const episode = episodeRepository.findByEpisodeId(episodeId);
  if (!episode) return { cover: null, audio: null, transcript: null, draftId: null };
  if (episode.isDraft) {
    const [coverExists, audioExists, transcriptExists] = await Promise.all([
      fs.promises.access(getEpisodeMediaStagingPath(episodeId, "cover")).then(() => true).catch(() => false),
      fs.promises.access(getEpisodeMediaStagingPath(episodeId, "trailer")).then(() => true).catch(() => false),
      fs.promises.access(getEpisodeMediaDraftTranscriptPath(episodeId)).then(() => true).catch(() => false),
    ]);
    const reservation = episodeRepository.findActiveTrailerVideoDraftByEpisodeId(episodeId);
    return {
      cover: coverExists ? getEpisodeMediaStagingPath(episodeId, "cover") : null,
      audio: audioExists ? getEpisodeMediaStagingPath(episodeId, "trailer") : null,
      transcript: transcriptExists ? getEpisodeMediaDraftTranscriptPath(episodeId) : null,
      draftId: reservation?.draftId ?? null,
    };
  }
  const [cover, audio, transcript] = await Promise.all([
    findExistingEpisodeMediaPath(episodeId, "cover", episode.coverFileName ?? null),
    findExistingEpisodeMediaPath(episodeId, "trailer", episode.trailerFileName ?? null),
    findExistingEpisodeMediaPath(episodeId, "transcript", episode.transcriptFileName ?? null),
  ]);
  return { cover, audio, transcript, draftId: null };
};

const fingerprint = (sources: readonly Source[]): string => createHash("sha256").update(JSON.stringify({
  cover: sources.find((source) => source.kind === "cover")?.sha256 ?? "missing",
  audio: sources.find((source) => source.kind === "audio")?.sha256 ?? "missing",
  transcript: sources.find((source) => source.kind === "transcript")?.sha256 ?? "missing",
  profileId: TRAILER_RENDER_VISUAL_PROFILE.profileId,
  profileRevision: TRAILER_RENDER_VISUAL_PROFILE.revision,
})).digest("hex");

const copySnapshot = async (sources: readonly Source[], candidateRoot: string, candidateId: string): Promise<string> => {
  const relativeDirectory = candidateId;
  const absoluteDirectory = path.resolve(candidateRoot, relativeDirectory);
  if (!isWithin(candidateRoot, absoluteDirectory) || absoluteDirectory === candidateRoot) throw new Error("Invalid private candidate path");
  await fs.promises.mkdir(absoluteDirectory, { recursive: false });
  try {
    for (const source of sources) {
      const fileName = source.kind === "cover" ? "cover.jpeg" : source.kind === "audio" ? "trailer.mp3" : "transcript.txt";
      const target = path.join(absoluteDirectory, fileName);
      await fs.promises.copyFile(source.path, target, fs.constants.COPYFILE_EXCL);
      const copied = await hashFile(target);
      if (copied.sha256 !== source.sha256 || copied.bytes !== source.bytes) throw new Error("Trailer source changed while snapshotting");
    }
    return path.posix.join(relativeDirectory, "");
  } catch (error) {
    await fs.promises.rm(absoluteDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

export const enqueueTrailerCandidate = async (episodeId: number, ownerEmail: string): Promise<TrailerCandidateEnqueueResult> => {
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) throw new Error("Invalid episodeId");
  const current = episodeRepository.findByEpisodeId(episodeId);
  if (current?.isDraft) {
    const reservation = await reserveTrailerVideoDraft(episodeId, ownerEmail);
    const checked = checkTrailerVideoDraft(reservation.draftId, episodeId, ownerEmail, { allowStaged: true });
    if (!checked.ok) throw new Error(checked.message);
  }

  const resolved = await resolveSources(episodeId);
  if (!resolved.cover || !resolved.audio) return { candidate: null, reused: false, waitingForInput: true };
  if (current?.isDraft && !resolved.draftId) throw new Error("Episode draft reservation is unavailable");

  const sources: Source[] = [];
  for (const [kind, filePath] of [["cover", resolved.cover], ["audio", resolved.audio], ["transcript", resolved.transcript]] as const) {
    if (!filePath) continue;
    const evidence = await hashFile(filePath);
    sources.push({ kind, path: filePath, ...evidence });
  }
  const sourceFingerprint = fingerprint(sources);
  const existing = trailerCandidateRepository.findCurrentByFingerprint(episodeId, sourceFingerprint);
  if (existing) return { candidate: toStatusDto(existing), reused: true, waitingForInput: false };

  const candidateRoot = await assertPrivateTrailerCandidateRoot();
  const candidateId = randomUUID();
  const snapshotRelativePath = await copySnapshot(sources, candidateRoot, candidateId);
  try {
    const afterCopy = await Promise.all(sources.map(async (source) => ({
      kind: source.kind,
      ...await hashFile(source.path),
    })));
    if (afterCopy.some((source) => source.sha256 !== sources.find((item) => item.kind === source.kind)?.sha256)) {
      throw new Error("Trailer source changed while snapshotting");
    }
    const result = trailerCandidateRepository.createOrReuse({
      candidateId,
      episodeId,
      draftId: resolved.draftId,
      sourceFingerprint,
      coverSha256: sources.find((source) => source.kind === "cover")?.sha256 as string,
      audioSha256: sources.find((source) => source.kind === "audio")?.sha256 as string,
      transcriptSha256: sources.find((source) => source.kind === "transcript")?.sha256 ?? null,
      profileId: TRAILER_RENDER_VISUAL_PROFILE.profileId,
      profileRevision: TRAILER_RENDER_VISUAL_PROFILE.revision,
      snapshotRelativePath,
    });
    if (result.reused) await fs.promises.rm(path.resolve(candidateRoot, candidateId), { recursive: true, force: true });
    return { candidate: toStatusDto(result.candidate), reused: result.reused, waitingForInput: false };
  } catch (error) {
    await fs.promises.rm(path.resolve(candidateRoot, candidateId), { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

export const getTrailerCandidateStatus = (candidateId: string): TrailerCandidateStatusDto | null => {
  const row = trailerCandidateRepository.findById(candidateId);
  return row ? toStatusDto(row) : null;
};

export const trailerCandidateStoragePath = async (relativePath: string): Promise<string> => {
  const candidateRoot = await assertPrivateTrailerCandidateRoot();
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error("Invalid private candidate relative path");
  }
  const target = path.resolve(candidateRoot, relativePath);
  if (!isWithin(candidateRoot, target) || target === candidateRoot) throw new Error("Invalid private candidate relative path");
  return target;
};

export const trailerCandidatePublicMediaBoundary = (): boolean => {
  return !isWithin(path.resolve(config.media.storageRoot), path.resolve(config.media.trailerCandidatesRoot));
};
