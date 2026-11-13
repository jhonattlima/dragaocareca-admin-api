import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openTranscriptionCheckpoint, TranscriptionDeferredError } from "../services/transcription-checkpoint.service";

const main = async (): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dc-transcription-checkpoints-"));
  const execute = promisify(execFile);
  const audioPath = path.join(root, "audio.mp3");
  try {
    await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "301", audioPath]);
    const options = { root: path.join(root, "checkpoints"), audioPath, model: "test", language: "pt", chunkSeconds: 300 };
    const first = await openTranscriptionCheckpoint(options);
    await first.saveChunk(0, "0:00 Primeiro trecho.");
    const deferred = await first.defer(60_000);
    assert(deferred instanceof TranscriptionDeferredError);
    const recovered = await openTranscriptionCheckpoint(options);
    assert.equal(recovered.getChunk(0), "0:00 Primeiro trecho.");
    assert.throws(() => recovered.assertReady(), TranscriptionDeferredError);
    const changedModel = await openTranscriptionCheckpoint({ ...options, model: "different" });
    assert.equal(changedModel.getChunk(0), undefined);
    const changedLanguage = await openTranscriptionCheckpoint({ ...options, language: "en" });
    assert.equal(changedLanguage.getChunk(0), undefined);
    const otherAudio = path.join(root, "other.mp3");
    await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "301", otherAudio]);
    assert.notEqual((await openTranscriptionCheckpoint({ ...options, audioPath: otherAudio })).key, first.key);

    process.env.NODE_ENV = "development";
    process.env.EPISODE_TRANSCRIPTION_ENABLED = "true";
    process.env.EPISODE_TRANSCRIPTION_PROVIDER = "groq";
    process.env.EPISODE_TRANSCRIPTION_GROQ_MODEL = "offline-whisper";
    process.env.GROQ_API_KEY = "offline";
    process.env.MEDIA_STORAGE_ROOT = path.join(root, "media");
    process.env.TRAILER_CANDIDATES_ROOT = path.join(root, "generated", "trailer-candidates");
    process.env.SQLITE_PATH = path.join(root, "fixture.sqlite");
    process.env.EPISODE_SUMMARY_ENABLED = "false";
    process.env.EPISODE_TRANSCRIPTION_POLL_INTERVAL_MS = "25";
    const { transcribeAudioWithCloudProvider, startEpisodeTranscriptionWorker, getEpisodeTranscriptionStatus } =
      await import("../services/episode-transcription.service.js");
    const transcribeSnapshot = async (source: string) => ({ text: await transcribeAudioWithCloudProvider(source, "groq"), provider: "groq" });
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (url, init) => {
      assert(String(url).endsWith("/audio/transcriptions"), "Only the Groq transcription endpoint may be called");
      assert.equal(init?.method, "POST");
      requests += 1;
      if (requests === 2 || requests === 4) return Response.json({ error: { message: "Please try again in 0s." } }, { status: 429, headers: { "retry-after": "0" } });
      const file = (init?.body as FormData).get("file") as File;
      return Response.json({ text: "offline", segments: file.name === "chunk_0001.wav"
        ? [{ start: 0, text: "Primeiro bloco." }, { start: 100, text: "Segundo bloco." }, { start: 200, text: "Terceiro bloco." }]
        : [{ start: 0, text: "Último bloco." }] });
    };
    try {
      await assert.rejects(transcribeSnapshot(audioPath), TranscriptionDeferredError);
      assert.equal(requests, 2);
      // A second invocation (as after process restart) must honour the durable deadline.
      await assert.rejects(transcribeSnapshot(audioPath), TranscriptionDeferredError);
      assert.equal(requests, 2);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const result = await transcribeSnapshot(audioPath);
      assert.equal(result.provider, "groq");
      assert.equal(requests, 3, "The successful first chunk must not be sent again");
      assert(result.text.includes("0:00 Primeiro bloco."));
      assert(result.text.includes("5:00 Último bloco."), "Chunk-local timestamps must use the episode offset");
      assert.equal((await transcribeSnapshot(audioPath)).text, result.text);
      assert.equal(requests, 3, "Completed checkpoint reuse must not consume quota");

      const { getEpisodeMediaStagingPath, getEpisodeMediaDraftStatePath } = await import("../services/episode-media-layout.service.js");
      const { createEpisodeDraftState, createTranscriptDraftState } = await import("../schemas/episode-draft-state.js");
      const episodeId = 991001;
      const stagedPath = getEpisodeMediaStagingPath(episodeId, "audio");
      await fs.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.copyFile(audioPath, stagedPath);
      const state = createEpisodeDraftState(episodeId, { version: 1,
        transcript: createTranscriptDraftState({ status: "processing", version: 1, progress: 50 }),
      });
      await fs.writeFile(getEpisodeMediaDraftStatePath(episodeId), JSON.stringify(state));
      const stopWorker = await startEpisodeTranscriptionWorker();
      try {
        const deadline = Date.now() + 5000;
        while (getEpisodeTranscriptionStatus(episodeId).status !== "done" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(getEpisodeTranscriptionStatus(episodeId).status, "done", "Startup must recover interrupted drafts");
        assert.equal(requests, 3, "Worker recovery must reuse the completed audio checkpoints");

        const waitingId = 991002;
        const waitingPath = getEpisodeMediaStagingPath(waitingId, "audio");
        await fs.mkdir(path.dirname(waitingPath), { recursive: true });
        await fs.copyFile(otherAudio, waitingPath);
        const waitingState = createEpisodeDraftState(waitingId, { version: 1,
          transcript: createTranscriptDraftState({ status: "pending", version: 1 }),
        });
        await fs.writeFile(getEpisodeMediaDraftStatePath(waitingId), JSON.stringify(waitingState));
        let observedQuotaWait = false;
        const retryDeadline = Date.now() + 5000;
        while (getEpisodeTranscriptionStatus(waitingId).status !== "done" && Date.now() < retryDeadline) {
          const status = getEpisodeTranscriptionStatus(waitingId);
          observedQuotaWait ||= status.status === "pending" && Boolean(status.transcriptError?.includes("automatic retry"));
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert(observedQuotaWait, "Quota exhaustion must leave the draft pending with its wait message");
        assert.equal(getEpisodeTranscriptionStatus(waitingId).status, "done", "The worker must resume automatically after quota renewal");
        assert.equal(requests, 6);
      } finally { stopWorker(); }
    } finally { globalThis.fetch = originalFetch; }
    await fs.copyFile(otherAudio, audioPath);
    await assert.rejects(first.assertSourceUnchanged(), /Audio changed/);
    console.log("Transcription checkpoint and Groq resume verification passed.");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
};

void main().catch((error) => { console.error(error); process.exitCode = 1; });
