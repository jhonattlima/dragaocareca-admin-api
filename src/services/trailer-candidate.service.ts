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

export type TrailerCandidateReviewStatusDto = {
  candidateId: string;
  episodeId: number;
  version: number;
  status: TrailerCandidateRow["status"];
  progress: number;
  errorCategory: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
  resolution: string | null;
  profileId: string;
  profileRevision: number;
  sourceFingerprint: string;
  isCurrent: boolean;
  outputValid: boolean;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
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

const safeCandidateErrorMessage = (category: string | null): string | null => {
  if (!category) return null;
  const messages: Record<string, string> = {
    capacity: "Trailer generation is waiting for available processing capacity.",
    capacity_unavailable: "Trailer generation is waiting for available processing capacity.",
    invalid_snapshot: "The private source snapshot could not be validated. Generate the trailer again.",
    source_changed: "The cover, trailer audio, or transcript changed. Generate a new trailer to review the latest inputs.",
    stale_source: "The source files changed while this trailer was being generated. Generate it again before review.",
    timeout: "Trailer generation took too long. You can try generating it again.",
    render_failed: "Trailer generation failed. Check the source files and try again.",
    probe_failed: "The generated trailer could not be validated. Try generating it again.",
    output_invalid: "The generated trailer is no longer available for review. Generate it again.",
    snapshot_invalid: "The private source snapshot could not be validated. Generate the trailer again.",
    interrupted: "Trailer generation was interrupted. Try generating it again.",
  };
  return messages[category] ?? "Trailer generation could not be completed. Try again or upload an MP4 manually.";
};

const safeCandidateErrorCategory = (category: string | null): string | null => {
  if (!category) return null;
  const allowed = new Set(["capacity", "capacity_unavailable", "source_changed", "stale_source", "timeout", "render_failed", "probe_failed", "output_invalid", "snapshot_invalid", "invalid_snapshot", "interrupted"]);
  return allowed.has(category) ? category : "generation_failed";
};

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

const currentEpisodeFingerprint = async (episodeId: number): Promise<string | null> => {
  const resolved = await resolveSources(episodeId);
  if (!resolved.cover || !resolved.audio) return null;
  const sources: Source[] = [];
  for (const [kind, filePath] of [["cover", resolved.cover], ["audio", resolved.audio], ["transcript", resolved.transcript]] as const) {
    if (!filePath) continue;
    const evidence = await hashFile(filePath);
    sources.push({ kind, path: filePath, ...evidence });
  }
  return fingerprint(sources);
};

const isValidReadyOutput = async (candidate: TrailerCandidateRow): Promise<boolean> => {
  if (candidate.status !== "ready" || !candidate.outputRelativePath || !candidate.outputSha256 || !candidate.outputBytes || candidate.outputBytes <= 0) return false;
  try {
    const outputPath = await trailerCandidateStoragePath(candidate.outputRelativePath);
    const evidence = await hashFile(outputPath);
    return evidence.sha256 === candidate.outputSha256 && evidence.bytes === candidate.outputBytes;
  } catch {
    return false;
  }
};

const parseResolution = (probeJson: string | null): string | null => {
  if (!probeJson) return null;
  try {
    const probe = JSON.parse(probeJson) as { streams?: Array<{ codec_type?: unknown; width?: unknown; height?: unknown }> };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    if (!Number.isSafeInteger(video?.width) || !Number.isSafeInteger(video?.height)
      || (video?.width as number) <= 0 || (video?.height as number) <= 0) return null;
    return `${video?.width}×${video?.height}`;
  } catch {
    return null;
  }
};

const toReviewStatusDto = async (candidate: TrailerCandidateRow, currentFingerprint: string | null): Promise<TrailerCandidateReviewStatusDto> => {
  const isCurrent = currentFingerprint !== null && candidate.sourceFingerprint === currentFingerprint
    && ["pending", "processing", "waiting_capacity", "retryable", "ready"].includes(candidate.status);
  const outputValid = isCurrent && await isValidReadyOutput(candidate);
  return {
    candidateId: candidate.candidateId,
    episodeId: candidate.episodeId,
    version: candidate.version,
    status: candidate.status,
    progress: candidate.progress,
    errorCategory: safeCandidateErrorCategory(candidate.errorCategory),
    errorMessage: safeCandidateErrorMessage(safeCandidateErrorCategory(candidate.errorCategory)),
    durationSeconds: candidate.durationSeconds,
    resolution: parseResolution(candidate.probeJson),
    profileId: candidate.profileId,
    profileRevision: candidate.profileRevision,
    sourceFingerprint: candidate.sourceFingerprint,
    isCurrent,
    outputValid,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    readyAt: candidate.readyAt,
  };
};

export const getCurrentTrailerCandidateReviewStatus = async (episodeId: number): Promise<TrailerCandidateReviewStatusDto | null> => {
  const currentFingerprint = await currentEpisodeFingerprint(episodeId);
  if (!currentFingerprint) return null;
  const candidate = trailerCandidateRepository.findCurrentByFingerprint(episodeId, currentFingerprint);
  return candidate ? toReviewStatusDto(candidate, currentFingerprint) : null;
};

export const getTrailerCandidateReviewStatus = async (episodeId: number, candidateId: string): Promise<TrailerCandidateReviewStatusDto | null> => {
  const candidate = trailerCandidateRepository.findById(candidateId);
  if (!candidate || candidate.episodeId !== episodeId) return null;
  return toReviewStatusDto(candidate, await currentEpisodeFingerprint(episodeId));
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
    findExistingEpisodeMediaPath(episodeId, "cover"),
    findExistingEpisodeMediaPath(episodeId, "trailer"),
    findExistingEpisodeMediaPath(episodeId, "transcript"),
  ]);
  const stagedCover = getEpisodeMediaStagingPath(episodeId, "cover");
  const stagedAudio = getEpisodeMediaStagingPath(episodeId, "trailer");
  const stagedTranscript = getEpisodeMediaDraftTranscriptPath(episodeId);
  const exists = (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true).catch(() => false);
  const [hasStagedCover, hasStagedAudio, hasStagedTranscript] = await Promise.all([
    exists(stagedCover), exists(stagedAudio), exists(stagedTranscript),
  ]);
  return {
    cover: hasStagedCover ? stagedCover : cover,
    audio: hasStagedAudio ? stagedAudio : audio,
    transcript: hasStagedTranscript ? stagedTranscript : transcript,
    draftId: null,
  };
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
  const stat = await fs.promises.lstat(target);
  if (stat.isSymbolicLink()) throw new Error("Invalid private candidate file");
  const realTarget = await fs.promises.realpath(target);
  if (!isWithin(candidateRoot, realTarget) || realTarget === candidateRoot) throw new Error("Invalid private candidate relative path");
  return realTarget;
};

export type TrailerCandidateSnapshotPaths = { coverPath: string; audioPath: string; transcriptPath: string | null; sourceBytes: number };

export const getTrailerCandidateSnapshotPaths = async (candidate: TrailerCandidateRow): Promise<TrailerCandidateSnapshotPaths> => {
  const base = candidate.snapshotRelativePath.replace(/[\\/]+$/, "");
  const coverPath = await trailerCandidateStoragePath(path.posix.join(base, "cover.jpeg"));
  const audioPath = await trailerCandidateStoragePath(path.posix.join(base, "trailer.mp3"));
  const transcriptPath = candidate.transcriptSha256
    ? await trailerCandidateStoragePath(path.posix.join(base, "transcript.txt"))
    : null;
  const expected: Array<{ path: string; sha256: string }> = [
    { path: coverPath, sha256: candidate.coverSha256 },
    { path: audioPath, sha256: candidate.audioSha256 },
  ];
  if (transcriptPath && candidate.transcriptSha256) expected.push({ path: transcriptPath, sha256: candidate.transcriptSha256 });
  let sourceBytes = 0;
  for (const source of expected) {
    const actual = await hashFile(source.path);
    if (actual.sha256 !== source.sha256) throw new Error("Trailer candidate snapshot hash mismatch");
    sourceBytes += actual.bytes;
  }
  return { coverPath, audioPath, transcriptPath, sourceBytes };
};

export const trailerCandidateSourcesStillCurrent = async (candidate: TrailerCandidateRow): Promise<boolean> => {
  const resolved = await resolveSources(candidate.episodeId);
  if (!resolved.cover || !resolved.audio) return false;
  const sources: Source[] = [];
  for (const [kind, filePath] of [["cover", resolved.cover], ["audio", resolved.audio], ["transcript", resolved.transcript]] as const) {
    if (!filePath) continue;
    const evidence = await hashFile(filePath);
    sources.push({ kind, path: filePath, ...evidence });
  }
  return fingerprint(sources) === candidate.sourceFingerprint;
};

export const trailerCandidatePublicMediaBoundary = (): boolean => {
  return !isWithin(path.resolve(config.media.storageRoot), path.resolve(config.media.trailerCandidatesRoot));
};
