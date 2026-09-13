import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TrailerCaptionCalibration, TrailerCaptionCapacityEvidence, TrailerCaptionAlignmentResult } from "../services/trailer-caption-alignment.service";

const hash = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

const run = async (): Promise<void> => {
  if (!process.argv.includes("--fake-only")) throw new Error("Caption candidate verification requires --fake-only");
  if (process.env.NODE_ENV !== "development") throw new Error("Caption candidate verification is development-only");
  if (process.argv.includes("--scenario=model-unavailable") && process.env.TRAILER_CAPTION_MODEL_PATH) {
    throw new Error("Model-unavailable scenario requires an unset local model path");
  }
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-trailer-captions-"));
  const mediaRoot = path.join(root, "media");
  const dbPath = path.join(root, "captions.sqlite");
  try {
    // Creating the empty DB first prevents connectDb's legacy-database migration fallback.
    await fs.promises.writeFile(dbPath, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    Object.assign(process.env, {
      SQLITE_PATH: dbPath,
      SQLITE_RESET: "true",
      MEDIA_STORAGE_ROOT: mediaRoot,
      MEDIA_EPISODES_DIR: path.join(mediaRoot, "episodes"),
      MEDIA_EPISODES_STAGING_DIR: path.join(mediaRoot, "staging"),
      MEDIA_BACKUP_ROOT: path.join(mediaRoot, "backups"),
      MEDIA_BACKUP_EPISODES_DIR: path.join(mediaRoot, "backups", "episodes"),
      TRAILER_CANDIDATES_ROOT: path.join(root, "private", "candidates"),
      TRAILER_CANDIDATE_RENDER_ENABLED: "true",
      DISABLE_BACKGROUND_WORKERS: "true",
    });
    delete process.env.TRAILER_CAPTION_MODEL_PATH;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("Outbound network is forbidden in fake-only verification"); }) as typeof fetch;
    try {
      const [{ connectDb }, { episodeRepository }, { episodeSchema }, mediaLayout, candidateService, candidates, worker, alignment] = await Promise.all([
        import("../database/connect.js"),
        import("../database/repositories/episode.repository.js"),
        import("../schemas/episode.js"),
        import("../services/episode-media-layout.service.js"),
        import("../services/trailer-candidate.service.js"),
        import("../database/repositories/trailer-candidate.repository.js"),
        import("../workers/trailer-candidate.worker.js"),
        import("../services/trailer-caption-alignment.service.js"),
      ]);
      await connectDb();
      const createFixture = async (episodeId: number, text: string) => {
        episodeRepository.create(episodeSchema.parse({
          episodeId, title: `Caption offline fixture ${episodeId}`, summary: "Synthetic fake-only verification",
          pubDate: new Date("2026-01-01T00:00:00.000Z"), explicit: "no", authors: [], guests: [], tags: [], citations: [],
          musicCredits: [JSON.stringify({ name: "Synthetic Fixture", links: [{ url: "https://example.invalid/fixture" }] })],
          coverCredits: [], launchNotificationState: "idle",
        }));
        const coverPath = mediaLayout.getEpisodeMediaStagingPath(episodeId, "cover");
        const audioPath = mediaLayout.getEpisodeMediaStagingPath(episodeId, "trailer");
        await fs.promises.mkdir(path.dirname(coverPath), { recursive: true });
        await fs.promises.writeFile(coverPath, `synthetic-cover-${episodeId}`);
        await fs.promises.writeFile(audioPath, `synthetic-audio-${episodeId}`);
        const fingerprint = await candidateService.getCurrentTrailerCandidateSourceFingerprint(episodeId);
        const created = await candidateService.createTrailerCandidateWithTranscript(episodeId, "fake@example.invalid", fingerprint!, text);
        return candidates.trailerCandidateRepository.findById(created.candidateId)!;
      };
      const calibration: TrailerCaptionCalibration = {
        metricVersion: alignment.TRAILER_CAPTION_METRIC_VERSION,
        calibrationId: "synthetic-test-only", referenceSetId: "synthetic-test-only", referenceSetSha256: "a".repeat(64),
        sampleCount: 1, humanReviewed: true, alignerVersion: alignment.TRAILER_CAPTION_ALIGNER_VERSION,
        modelId: alignment.TRAILER_CAPTION_MODEL_ID, modelRevision: alignment.TRAILER_CAPTION_MODEL_REVISION,
        modelSha256: "b".repeat(64), werMax: 0, coverageMin: 1, onsetMaeMaxSeconds: 0.01, onsetP95MaxSeconds: 0.01,
        offsetMaeMaxSeconds: 0.01, offsetP95MaxSeconds: 0.01, reviewer: "test-only", reviewedAt: "2026-01-01T00:00:00Z", approved: true,
      };
      const capacity: TrailerCaptionCapacityEvidence = {
        imageDigest: `sha256:${"c".repeat(64)}`, measuredAt: "2026-01-01T00:00:00Z",
        modelRevision: alignment.TRAILER_CAPTION_MODEL_REVISION, maxPeakMemoryBytes: 1, maxDurationSeconds: 30,
        maxInputBytes: 1_000_000, approved: true,
      };
      const transcript = "Olá, mundo.";
      const referenceWords = [
        { startSeconds: 0.2, endSeconds: 1, text: "Olá" },
        { startSeconds: 1.1, endSeconds: 1.8, text: "mundo" },
      ];
      const first = await createFixture(992051, transcript);
      const firstTranscriptPath = await candidateService.trailerCandidateExistingFilePath(first.trailerTranscriptRelativePath!);
      const audioPath = await candidateService.trailerCandidateStoragePath(path.join(first.snapshotRelativePath, "trailer.mp3"));
      const firstAudioHash = hash(await fs.promises.readFile(audioPath));
      const transcriptHash = hash(await fs.promises.readFile(firstTranscriptPath));
      let renderedCaption = false;
      const fakeRunner = async (command: string, args: string[]) => {
        const target = args[args.length - 1];
        if (command === "ffprobe") {
          const source = target === audioPath;
          return { stdout: JSON.stringify(source
            ? { streams: [{ codec_type: "audio", duration: "3" }] }
            : { format: { duration: "3" }, streams: [
              { codec_type: "video", codec_name: "h264", profile: "Main", width: 1280, height: 1280, pix_fmt: "yuv420p", sample_aspect_ratio: "1:1", duration: "3" },
              { codec_type: "audio", codec_name: "aac", duration: "3" },
            ] }), stderr: "" };
        }
        if (command === "ffmpeg" && args.includes("null")) return { stdout: "", stderr: "" };
        const caption = args.some((arg) => arg.includes("subtitles="));
        if (caption) renderedCaption = true;
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, caption ? "FAKE-CAPTIONED-MP4" : "FAKE-WAVEFORM-MP4");
        return { stdout: "", stderr: "" };
      };
      const alignCaptions = async (_input: { candidate: typeof first; audioPath: string }): Promise<TrailerCaptionAlignmentResult> => ({
        status: "aligned", reason: "aligned", audioSha256: firstAudioHash, transcriptSha256: transcriptHash,
        modelSha256: calibration.modelSha256, alignerVersion: alignment.TRAILER_CAPTION_ALIGNER_VERSION,
        modelId: alignment.TRAILER_CAPTION_MODEL_ID, modelRevision: alignment.TRAILER_CAPTION_MODEL_REVISION,
        profileId: first.profileId, profileRevision: first.profileRevision,
        words: referenceWords,
      });
      await worker.processTrailerCandidate(first, {
        availableBytes: async () => 2 ** 40,
        processRunner: fakeRunner,
        alignCaptions,
        captionCalibration: calibration,
        captionCapacity: capacity,
        captionReferenceWords: referenceWords,
      });
      const ready = candidates.trailerCandidateRepository.findById(first.candidateId)!;
      assert.equal(ready.status, "ready");
      const readyPath = await candidateService.trailerCandidateExistingFilePath(ready.outputRelativePath!);
      assert.equal(await fs.promises.readFile(readyPath, "utf8"), "FAKE-CAPTIONED-MP4");
      assert.equal(renderedCaption, true, "eligible exact-text cues produce a separate captioned output before ready promotion");

      const second = await createFixture(992052, transcript);
      const secondTranscriptPath = await candidateService.trailerCandidateExistingFilePath(second.trailerTranscriptRelativePath!);
      const secondAudioPath = await candidateService.trailerCandidateStoragePath(path.join(second.snapshotRelativePath, "trailer.mp3"));
      await worker.processTrailerCandidate(second, {
        availableBytes: async () => 2 ** 40,
        processRunner: fakeRunner,
        captionCalibration: calibration,
        captionCapacity: capacity,
        alignCaptions: async () => ({
          status: "aligned", reason: "aligned", audioSha256: hash(await fs.promises.readFile(secondAudioPath)),
          transcriptSha256: hash(await fs.promises.readFile(secondTranscriptPath)).replace(/^./u, "0"),
          modelSha256: calibration.modelSha256, alignerVersion: alignment.TRAILER_CAPTION_ALIGNER_VERSION,
          modelId: alignment.TRAILER_CAPTION_MODEL_ID, modelRevision: alignment.TRAILER_CAPTION_MODEL_REVISION,
          profileId: second.profileId, profileRevision: second.profileRevision,
          words: referenceWords,
        }),
        captionReferenceWords: referenceWords,
      });
      const staleReady = candidates.trailerCandidateRepository.findById(second.candidateId)!;
      const stalePath = await candidateService.trailerCandidateExistingFilePath(staleReady.outputRelativePath!);
      assert.equal(staleReady.status, "ready", "transcript hash mismatch must not fail candidate generation");
      assert.equal(await fs.promises.readFile(stalePath, "utf8"), "FAKE-WAVEFORM-MP4", "stale cue evidence falls back to the already validated waveform");

      const noCalibration = await createFixture(992053, transcript);
      const noCalibrationAudio = await candidateService.trailerCandidateStoragePath(path.join(noCalibration.snapshotRelativePath, "trailer.mp3"));
      const noCalibrationTranscript = await candidateService.trailerCandidateExistingFilePath(noCalibration.trailerTranscriptRelativePath!);
      const noCalibrationRunner = async (command: string, args: string[]) => {
        if (command === "ffmpeg" && args.some((arg) => arg.includes("subtitles="))) throw new Error("synthetic caption filter failure");
        return fakeRunner(command, args);
      };
      await worker.processTrailerCandidate(noCalibration, {
        availableBytes: async () => 2 ** 40,
        processRunner: noCalibrationRunner,
        captionCalibration: null,
        captionCapacity: capacity,
        captionReferenceWords: referenceWords,
        alignCaptions: async () => ({
          status: "aligned", reason: "aligned", audioSha256: hash(await fs.promises.readFile(noCalibrationAudio)),
          transcriptSha256: hash(await fs.promises.readFile(noCalibrationTranscript)), modelSha256: calibration.modelSha256,
          alignerVersion: alignment.TRAILER_CAPTION_ALIGNER_VERSION, modelId: alignment.TRAILER_CAPTION_MODEL_ID,
          modelRevision: alignment.TRAILER_CAPTION_MODEL_REVISION, profileId: noCalibration.profileId,
          profileRevision: noCalibration.profileRevision, words: referenceWords,
        }),
      });
      const fallbackReady = candidates.trailerCandidateRepository.findById(noCalibration.candidateId)!;
      const fallbackPath = await candidateService.trailerCandidateExistingFilePath(fallbackReady.outputRelativePath!);
      assert.equal(fallbackReady.status, "ready", "missing quality calibration and caption failure do not block the waveform candidate");
      assert.equal(await fs.promises.readFile(fallbackPath, "utf8"), "FAKE-WAVEFORM-MP4");

      const unavailable = await alignment.alignTrailerTranscript({ candidate: first });
      assert.deepEqual(unavailable, { status: "unavailable", reason: "model_unavailable" });
      assert.equal(await fs.promises.access(dbPath).then(() => true), true);
      console.log("PASS: fake-only exact transcript captions, stale-hash fallback, and missing-model behavior");
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
};

run().catch((error) => { console.error(error instanceof Error ? error.message : "Caption verifier failed"); process.exitCode = 1; });
