import assert from "node:assert/strict";
import {
  validateTrailerRenderEvidence,
  type TrailerRenderEvidence,
} from "../services/trailer-render-profile.service";

const assertThrows = (callback: () => unknown, pattern: RegExp): void => {
  assert.throws(callback, pattern);
};

const validEvidence: TrailerRenderEvidence = {
  profile: {
    profileId: "waveform-v1",
    revision: 1,
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    fastStart: true,
    argvSha256: "a".repeat(64),
  },
  capability: {
    imageDigest: "sha256:" + "b".repeat(64),
    ffmpegVersion: "5.1.9",
    ffprobeVersion: "5.1.9",
    filters: ["showwaves"],
    encoders: ["libx264", "aac"],
    fonts: ["DejaVu Sans"],
  },
  provenance: {
    sourceSha256: "c".repeat(64),
    sourceBytes: 1200,
    sourceDurationSeconds: 3,
    outputSha256: "d".repeat(64),
    outputBytes: 4200,
    outputDurationSeconds: 3,
    outputVideo: { codec: "h264", pixelFormat: "yuv420p" },
    outputAudio: { codec: "aac" },
    decoded: true,
  },
  measuredLimit: {
    maxInputBytes: 10_000,
    maxInputDurationSeconds: 30,
    timeoutMs: 60_000,
    minFreeBytes: 1_000_000,
    peakCpuPercent: 50,
    peakMemoryBytes: 100_000,
    peakDiskBytes: 10_000,
  },
  concurrency: 1,
  approved: false,
};

const run = (): void => {
  assert.deepEqual(validateTrailerRenderEvidence(validEvidence), validEvidence);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, concurrency: 2 }), /concurrency/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, approved: true }), /approval|measured/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, capability: { ...validEvidence.capability, filters: [] } }), /showwaves/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, provenance: { ...validEvidence.provenance, outputDurationSeconds: 4 } }), /duration/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, measuredLimit: { ...validEvidence.measuredLimit, timeoutMs: 0 } }), /timeout|measured/i);
  console.log("Trailer render profile verification passed.");
};

run();
