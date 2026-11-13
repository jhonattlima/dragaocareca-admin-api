import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execute = promisify(execFile);
const main = async (): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dc-audio-tags-"));
  const originalCwd = process.cwd();
  process.env.NODE_ENV = "development";
  process.env.MEDIA_STORAGE_ROOT = path.join(root, "media");
  process.env.MEDIA_EPISODES_STAGING_DIR = path.join(root, "staging");
  process.env.TRAILER_CANDIDATES_ROOT = path.join(root, "generated", "trailer-candidates");
  process.env.SQLITE_PATH = path.join(root, "database.sqlite");
  process.env.SQLITE_RESET = "false";
  process.env.AUTH_BYPASS = "true";
  process.env.PROMOTION_ENABLED = "false";
  process.env.PROMOTION_LEGACY_LAUNCH_ENABLED = "false";
  process.env.YOUTUBE_TRAILER_JOB_ENABLED = "false";
  process.env.EPISODE_TRANSCRIPTION_ENABLED = "false";
  process.env.EPISODE_SUMMARY_ENABLED = "false";
  process.env.EPISODE_AUDIO_ALBUM = "Season 4";
  process.env.FEED_BASE_LINK = "https://example.test";
  process.env.FEED_AUDIO_BASE = "https://example.test/media/";
  process.env.FEED_IMAGE_BASE = "https://example.test/media/";
  process.env.FEED_TITLE = "Fixture";
  process.env.FEED_DESCRIPTION = "Fixture";
  process.env.FEED_SITE = "https://example.test";
  process.chdir(root);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Live network forbidden in metadata verifier"); };
  try {
    const { withEpisodeAudioTags, buildEpisodeAudioTags } = await import("../services/episode-audio-tags.service.js");
    const { getEpisodeMediaFinalPath, getEpisodeMediaStagingPath } = await import("../services/episode-media-layout.service.js");
    const { audioSha256, openTranscriptionCheckpoint } = await import("../services/transcription-checkpoint.service.js");
    const id = 990353;
    const audio = getEpisodeMediaFinalPath(id, "audio");
    const cover = getEpisodeMediaFinalPath(id, "cover");
    await fs.mkdir(path.dirname(audio), { recursive: true });
    await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=500:duration=2", "-metadata", "title=Old title", audio]);
    await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64", "-frames:v", "1", "-threads", "1", cover]);
    const input = { title: "Quando fui tapeado! | DC 353", episodeNumber: 353, episodeType: "Nenhum",
      pubDate: new Date("2025-06-05T12:00:00Z"), authors: ["Troah", " Bron ", "Tiamat", "Galdrim"],
      guests: [JSON.stringify({ name: "Ória", links: [{ label: "Instagram", url: "https://example.test" }] }), "bron"],
    };
    assert.deepEqual(buildEpisodeAudioTags(input), {
      title: "DC 353 - Quando fui tapeado!", artist: "Bron, Galdrim, Ória, Tiamat, Troah", album: "Season 4",
      date: "2025-06-05", track: "353", genre: "Podcast", album_artist: "Dragão Careca",
    });
    assert.equal(buildEpisodeAudioTags({ ...input, episodeType: "Leitura de pergaminhos", title: "Leitura de pergaminhos - Teste | DC 353" }).title,
      "DC 353 - Leitura de pergaminhos - Teste");
    assert.equal(buildEpisodeAudioTags({ ...input, pubDate: new Date("2025-06-06T01:55:00Z") }).date, "2025-06-05");
    assert.equal(buildEpisodeAudioTags(input, "Season 5").album, "Season 5");
    assert.throws(() => buildEpisodeAudioTags({ ...input, episodeNumber: undefined }), /Episode number/);
    const beforeBytes = await fs.readFile(audio);
    const beforeAudio = await audioSha256(audio);
    const checkpoint = await openTranscriptionCheckpoint({ root: path.join(root, "checkpoints"), audioPath: audio,
      model: "offline", language: "pt", chunkSeconds: 300 });
    await checkpoint.saveChunk(0, "0:00 Teste");
    const readTags = async () => JSON.parse((await execute("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", audio])).stdout);
    await withEpisodeAudioTags(id, input, async (metadata) => {
      assert(metadata);
      assert.equal(metadata.bytes, (await fs.stat(audio)).size);
      assert.equal((await readTags()).format.tags.title, "DC 353 - Quando fui tapeado!");
    });
    assert.equal(await audioSha256(audio), beforeAudio, "Encoded audio is preserved");
    await checkpoint.assertSourceUnchanged();
    assert.equal((await openTranscriptionCheckpoint({ root: path.join(root, "checkpoints"), audioPath: audio,
      model: "offline", language: "pt", chunkSeconds: 300 })).getChunk(0), "0:00 Teste", "ID3 rewrite preserves speech checkpoints");
    const image = await execute("ffmpeg", ["-v", "error", "-i", audio, "-map", "0:v:0", "-c", "copy", "-f", "image2pipe", "-"], { encoding: "buffer" });
    assert.equal(createHash("sha256").update(image.stdout).digest("hex"), createHash("sha256").update(await fs.readFile(cover)).digest("hex"));
    const goodBytes = await fs.readFile(audio);
    await assert.rejects(withEpisodeAudioTags(id, { ...input, title: "Must roll back" }, async () => { throw new Error("save failed"); }), /save failed/);
    assert.deepEqual(await fs.readFile(audio), goodBytes, "Failed save restores original MP3 byte-for-byte");
    await fs.writeFile(cover, "invalid image");
    let saved = false;
    await assert.rejects(withEpisodeAudioTags(id, input, async () => { saved = true; }));
    assert.equal(saved, false, "Invalid cover must never call save/publication");
    assert.deepEqual(await fs.readFile(audio), goodBytes);
    await execute("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", "-threads", "1", cover]);
    await withEpisodeAudioTags(id, { ...input, title: "Título atualizado" }, async () => undefined);
    assert.equal((await readTags()).streams.filter((stream: { codec_type: string }) => stream.codec_type === "video").length, 1);
    assert.equal((await readTags()).format.tags.title, "DC 353 - Título atualizado");
    await assert.rejects(withEpisodeAudioTags(id, { ...input, title: "Committed title" }, async (_metadata, onCommitted) => {
      onCommitted();
      throw new Error("post-commit delivery failed");
    }), /post-commit/);
    assert.equal((await readTags()).format.tags.title, "DC 353 - Committed title", "Delivery failure cannot roll back committed file metadata");
    assert.equal((await fs.readdir(path.dirname(audio))).some((name) => name.startsWith(".audio-")), false);

    // Exercise both actual Save handlers with a temporary database and media.
    const { episodesRouter } = await import("../routes/episodes.routes.js");
    const invokeSave = async (method: "post" | "put", episodeId: number, body: object) => {
      const layer = episodesRouter.stack.find((entry: any) => entry.route?.path === (method === "post" ? "/" : "/:episodeId") && entry.route.methods[method]);
      assert(layer?.route);
      let json: any;
      let error: unknown;
      const response = { status: (_code: number) => response, json: (value: unknown) => { json = value; return response; } };
      const handler = layer.route.stack.at(-1)!.handle as unknown as (req: object, res: object, next: (value?: unknown) => void) => Promise<void>;
      await handler({ body, params: { episodeId: String(episodeId) }, user: { email: "fixture@example.test" } }, response, (value: unknown) => { error = value; });
      if (error) throw error;
      return json;
    };
    const routeId = 990354;
    const stagedAudio = getEpisodeMediaStagingPath(routeId, "audio");
    const stagedCover = getEpisodeMediaStagingPath(routeId, "cover");
    await fs.mkdir(path.dirname(stagedAudio), { recursive: true });
    await fs.writeFile(stagedAudio, beforeBytes);
    await fs.copyFile(cover, stagedCover);
    const body = { ...input, episodeId: routeId, summary: "Synthetic fixture", explicit: "no", youtube: "https://www.youtube.com/watch?v=fixture",
      musicCredits: [JSON.stringify({ name: "Fixture", links: [{ label: "Source", url: "https://example.test" }] })], bytes: 1 };
    const created = await invokeSave("post", routeId, body);
    const finalAudio = getEpisodeMediaFinalPath(routeId, "audio");
    assert.equal(created.bytes, (await fs.stat(finalAudio)).size, "POST returns final authoritative enclosure bytes");
    const updated = await invokeSave("put", routeId, { ...body, title: "Novo título", bytes: 1 });
    assert.equal(updated.bytes, (await fs.stat(finalAudio)).size, "PUT refreshes authoritative enclosure bytes");
    assert.equal(JSON.parse((await execute("ffprobe", ["-v", "error", "-show_format", "-of", "json", finalAudio])).stdout).format.tags.title, "DC 353 - Novo título");
    console.log("Episode MP3 metadata verified: tags, JPEG, byte counts, unchanged audio/checkpoints, rollback, POST/PUT Save.");
    // Let the local cover-mosaic write finish before removing its isolated cwd.
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
};
void main().catch((error) => { console.error(error); process.exitCode = 1; });
