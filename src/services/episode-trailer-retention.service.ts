import fs from "node:fs";
import path from "node:path";
import {
  getEpisodeMediaBackupDirectory,
  getEpisodeMediaFinalPath,
  getEpisodeMediaDirectory,
} from "./episode-media-layout.service";

export type TrailerVideoRetentionEntry = {
  path: string;
  basename: string;
  current: boolean;
  eligible: boolean;
  sortKey: string | null;
  reason?: "malformed" | "ambiguous" | "unrelated";
};

export type TrailerVideoRetentionResult = {
  keepCount: number;
  kept: string[];
  deleted: string[];
  protectedEntries: string[];
  status: "complete" | "retryable-error";
  errorCategory: string | null;
  errorMessage: string | null;
};

const versionPattern = /^(?:trailer(?:[._-]v?(\d+)|[._-](\d{8,14}))|trailer[._-](\d{4}-\d{2}-\d{2}(?:[T._-]\d{2}[._:-]\d{2}[._:-]\d{2})?))\.mp4$/i;

const DEFAULT_KEEP_COUNT = 12;
const safeKeepCount = (value = process.env.YOUTUBE_TRAILER_RETENTION_KEEP_COUNT): number => {
  const parsed = value === undefined ? DEFAULT_KEEP_COUNT : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : DEFAULT_KEEP_COUNT;
};

const regularFile = async (filePath: string): Promise<boolean> =>
  fs.promises.lstat(filePath).then((stats) => stats.isFile()).catch(() => false);

const entryKey = (basename: string): { sortKey: string; ambiguous: boolean } | null => {
  const match = versionPattern.exec(basename);
  if (!match) return null;
  const tokens = [match[1], match[2], match[3]].filter(Boolean);
  if (tokens.length !== 1) return { sortKey: "", ambiguous: true };
  return { sortKey: tokens[0]!.replace(/[^0-9]/g, "").padStart(20, "0"), ambiguous: false };
};

const directoryEntries = async (directory: string): Promise<string[]> =>
  fs.promises.readdir(directory).catch(() => []);

export const discoverTrailerVideoVersions = async (episodeId: number): Promise<TrailerVideoRetentionEntry[]> => {
  const currentPath = path.resolve(getEpisodeMediaFinalPath(episodeId, "trailerVideo"));
  const directories = [getEpisodeMediaDirectory(episodeId), getEpisodeMediaBackupDirectory(episodeId)];
  const discovered: TrailerVideoRetentionEntry[] = [];

  for (const directory of directories) {
    for (const basename of await directoryEntries(directory)) {
      const candidate = path.resolve(directory, basename);
      if (candidate === currentPath) continue;
      if (!(await regularFile(candidate))) continue;
      const parsed = entryKey(basename);
      if (!parsed) {
        discovered.push({ path: candidate, basename, current: false, eligible: false, sortKey: null, reason: "unrelated" });
        continue;
      }
      if (parsed.ambiguous) {
        discovered.push({ path: candidate, basename, current: false, eligible: false, sortKey: null, reason: "ambiguous" });
        continue;
      }
      discovered.push({ path: candidate, basename, current: false, eligible: true, sortKey: parsed.sortKey });
    }
  }

  discovered.sort((left, right) => (right.sortKey ?? "").localeCompare(left.sortKey ?? "") || left.basename.localeCompare(right.basename));
  return [
    ...(await regularFile(currentPath)
      ? [{ path: currentPath, basename: path.basename(currentPath), current: true, eligible: false, sortKey: null }]
      : []),
    ...discovered,
  ];
};

const removeWithRollback = async (paths: string[]): Promise<void> => {
  // There is no filesystem operation to protect when every discovered version
  // is retained. In particular, do not derive a rollback directory from the
  // process cwd: containers commonly run from `/`, which is not writable.
  if (paths.length === 0) return;
  const rollbackRoot = await fs.promises.mkdtemp(path.join(path.dirname(paths[0] ?? process.cwd()), ".trailer-retention-"));
  const backups: Array<{ source: string; backup: string }> = [];
  try {
    for (const source of paths) {
      const backup = path.join(rollbackRoot, `${backups.length}-${path.basename(source)}`);
      await fs.promises.copyFile(source, backup);
      backups.push({ source, backup });
    }
    for (const { source } of backups) await fs.promises.unlink(source);
  } catch (error) {
    for (const { source, backup } of backups) {
      if (!(await regularFile(source))) await fs.promises.copyFile(backup, source).catch(() => undefined);
    }
    throw error;
  } finally {
    await fs.promises.rm(rollbackRoot, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const retainEpisodeTrailerVersions = async (
  episodeId: number,
  keepCount = safeKeepCount()
): Promise<TrailerVideoRetentionResult> => {
  const entries = await discoverTrailerVideoVersions(episodeId);
  const current = entries.find((entry) => entry.current);
  const prior = entries.filter((entry) => entry.eligible);
  const keep = new Set([...(current ? [current.path] : []), ...prior.slice(0, keepCount).map((entry) => entry.path)]);
  const deletable = prior.filter((entry) => !keep.has(entry.path));
  try {
    await removeWithRollback(deletable.map((entry) => entry.path));
    return {
      keepCount,
      kept: entries.filter((entry) => keep.has(entry.path)).map((entry) => entry.basename),
      deleted: deletable.map((entry) => entry.basename),
      protectedEntries: entries.filter((entry) => !entry.eligible).map((entry) => entry.basename),
      status: "complete",
      errorCategory: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      keepCount,
      kept: entries.map((entry) => entry.basename),
      deleted: [],
      protectedEntries: entries.filter((entry) => !entry.eligible).map((entry) => entry.basename),
      status: "retryable-error",
      errorCategory: "filesystem",
      errorMessage: error instanceof Error ? error.message : "Trailer retention cleanup failed.",
    };
  }
};
