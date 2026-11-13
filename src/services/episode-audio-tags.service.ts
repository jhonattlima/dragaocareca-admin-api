import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config/env";
import type { EpisodeInput } from "../schemas/episode";
import { buildCanonicalEpisodeTitle } from "./episode-title.service";
import { findExistingEpisodeMediaPath } from "./episode-media-layout.service";
import { extractEpisodeAudioMetadata, type NormalizedEpisodeAudioMetadata } from "./episode-audio-metadata.service";
import { audioSha256 } from "./transcription-checkpoint.service";

const execute = promisify(execFile);
type TagInput = Pick<EpisodeInput, "title" | "episodeNumber" | "episodeType" | "pubDate" | "authors" | "guests">;

const participantName = (value: string): string => {
  const text = value.trim();
  if (!text.startsWith("{")) return text.normalize("NFC");
  let entry: unknown;
  try { entry = JSON.parse(text); } catch { throw new Error("Invalid structured participant for MP3 artist metadata"); }
  if (!entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string") {
    throw new Error("Participant name is required for MP3 artist metadata");
  }
  return (entry as { name: string }).name.trim().normalize("NFC");
};

export const buildEpisodeAudioTags = (input: TagInput, album = config.episodeAudio.album, timeZone = config.episodeAudio.timeZone) => {
  if (!Number.isInteger(input.episodeNumber) || input.episodeNumber! <= 0) {
    throw new Error("Episode number is required for MP3 metadata (episode ID is not the track number)");
  }
  if (!album.trim()) throw new Error("EPISODE_AUDIO_ALBUM must not be blank");
  const canonical = buildCanonicalEpisodeTitle(input).replace(/\s*\|\s*DC\s+\d+\s*$/iu, "")
    .replace(/^DC\s+\d+\s*-\s*/iu, "").trim();
  const names = new Map<string, string>();
  for (const value of [...input.authors, ...input.guests]) {
    const name = participantName(value);
    if (name && !names.has(name.toLocaleLowerCase("pt-BR"))) names.set(name.toLocaleLowerCase("pt-BR"), name);
  }
  const release = new Date(input.pubDate);
  if (!Number.isFinite(release.getTime())) throw new Error("Invalid release date for MP3 metadata");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(release);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return {
    title: `DC ${input.episodeNumber} - ${canonical}`,
    artist: [...names.values()].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })).join(", "),
    album: album.trim(), date: `${part("year")}-${part("month")}-${part("day")}`,
    track: String(input.episodeNumber), genre: "Podcast", album_artist: "Dragão Careca",
  };
};

type Probe = {
  format?: { tags?: Record<string, string> };
  streams?: Array<{ codec_type?: string; codec_name?: string; disposition?: { attached_pic?: number }; tags?: Record<string, string> }>;
};

/** Called under the episode source mutation lock, before save/publication. */
export const withEpisodeAudioTags = async <T>(
  episodeId: number,
  input: TagInput,
  save: (metadata: NormalizedEpisodeAudioMetadata | null, onCommitted: () => void) => Promise<T>,
): Promise<T> => {
  const audioPath = await findExistingEpisodeMediaPath(episodeId, "audio");
  // Preserve metadata-only editing of historical episodes with missing media.
  if (!audioPath) return save(null, () => undefined);
  const coverPath = await findExistingEpisodeMediaPath(episodeId, "cover");
  if (!coverPath) throw new Error("Upload the JPEG cover before saving MP3 metadata");
  for (const filePath of [audioPath, coverPath]) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Episode audio and cover must be regular files");
  }
  const tags = buildEpisodeAudioTags(input);
  const token = randomUUID();
  const temporary = path.join(path.dirname(audioPath), `.audio-tags-${token}.mp3`);
  const backup = path.join(path.dirname(audioPath), `.audio-before-tags-${token}.mp3`);
  let replaced = false;
  let backupCreated = false;
  let committed = false;
  try {
    const before = await audioSha256(audioPath);
    await execute("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
      "-protocol_whitelist", "file,pipe", "-i", audioPath,
      "-protocol_whitelist", "file,pipe", "-f", "image2", "-pattern_type", "none", "-i", coverPath,
      "-map", "0:a:0", "-map", "1:v:0", "-map_metadata", "0", "-c", "copy", "-id3v2_version", "4",
      ...Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
      "-metadata:s:v:0", "title=Album cover", "-metadata:s:v:0", "comment=Cover (Front)",
      "-disposition:v:0", "attached_pic", temporary,
    ], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    const { stdout } = await execute("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", temporary],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const probe = JSON.parse(stdout) as Probe;
    const actual = Object.fromEntries(Object.entries(probe.format?.tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    for (const [key, value] of Object.entries(tags)) {
      if ((actual[key] ?? "") !== value) throw new Error(`MP3 metadata verification failed for ${key}`);
    }
    const pictures = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
    if (pictures.length !== 1 || pictures[0].codec_name !== "mjpeg" || pictures[0].disposition?.attached_pic !== 1 ||
      pictures[0].tags?.comment?.toLowerCase() !== "cover (front)") throw new Error("MP3 front-cover JPEG verification failed");
    if (await audioSha256(temporary) !== before) throw new Error("MP3 metadata rewrite changed encoded audio");
    const metadata = await extractEpisodeAudioMetadata(temporary);
    await fs.chmod(temporary, (await fs.stat(audioPath)).mode & 0o777);
    await fs.link(audioPath, backup);
    backupCreated = true;
    await fs.rename(temporary, audioPath);
    replaced = true;
    const result = await save(metadata, () => { committed = true; });
    await fs.unlink(backup).catch((error: unknown) => console.warn("Could not remove saved MP3 metadata rollback file", error));
    backupCreated = false;
    return result;
  } catch (error) {
    if (committed && backupCreated) {
      // Downstream delivery may fail after the database commit. Its MP3 must
      // retain the tags/byte count corresponding to that committed record.
      await fs.unlink(backup).catch((cleanupError: unknown) => console.warn("Could not remove committed MP3 rollback file", cleanupError));
      backupCreated = false;
    } else if (replaced && backupCreated) {
      // Rename is atomic. If restoration fails, retain the rollback file for recovery.
      await fs.rename(backup, audioPath);
      backupCreated = false;
    }
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
    if (!replaced && backupCreated) await fs.rm(backup, { force: true });
  }
};
