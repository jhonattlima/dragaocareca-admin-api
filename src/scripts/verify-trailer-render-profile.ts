import assert from "node:assert/strict";
import {
  buildTrailerAssCaptions,
  buildTrailerCaptionRenderArgs,
  buildTrailerRenderArgs,
  TRAILER_RENDER_VISUAL_PROFILE,
  validateTrailerRenderEvidence,
  type TrailerRenderEvidence,
} from "../services/trailer-render-profile.service";

const assertThrows = (callback: () => unknown, pattern: RegExp): void => {
  assert.throws(callback, pattern);
};

const validEvidence: TrailerRenderEvidence = {
  profile: {
    profileId: "square-reels-karaoke-v2",
    revision: 2,
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
    filters: ["showwaves", "geq", "alphamerge", "subtitles"],
    encoders: ["libx264", "aac"],
    fonts: ["Montserrat ExtraBold"],
  },
  provenance: {
    sourceSha256: "c".repeat(64),
    sourceBytes: 1200,
    sourceDurationSeconds: 3,
    outputSha256: "d".repeat(64),
    outputBytes: 4200,
    outputDurationSeconds: 3,
    outputVideo: { codec: "h264", pixelFormat: "yuv420p", width: 1280, height: 1280, sampleAspectRatio: "1:1" },
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
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.width, 1280);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.height, 1280);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.captions.fontSize, 75);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.captions.maxLines, 2);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.captions.horizontalPadding, 35);
  assert.ok(TRAILER_RENDER_VISUAL_PROFILE.captions.anchorY > TRAILER_RENDER_VISUAL_PROFILE.captions.reservedTop);

  const renderArgs = buildTrailerRenderArgs({ coverPath: "/fixture/cover.jpg", audioPath: "/fixture/audio.mp3", outputPath: "/fixture/out.mp4", durationSeconds: 12.345 });
  const filterGraph = renderArgs[renderArgs.indexOf("-filter_complex") + 1];
  assert.ok(filterGraph.includes("showwaves=s=1280x220:mode=cline"));
  assert.ok(filterGraph.includes("alphamerge"));
  assert.ok(filterGraph.includes("geq=r='0+(255)*X/W':g='255+(-255)*X/W':b='255'"));
  assert.ok(filterGraph.includes("scale=1280:1280"));
  assert.ok(filterGraph.includes("overlay=0:820"));
  assert.ok(renderArgs.includes("avc1"));
  assert.throws(() => buildTrailerRenderArgs({ coverPath: "cover", audioPath: "audio", outputPath: "out", durationSeconds: 0 }), /duration/i);
  assert.throws(() => validateTrailerRenderEvidence({
    ...validEvidence,
    provenance: { ...validEvidence.provenance, outputVideo: { ...validEvidence.provenance.outputVideo, width: 1280, height: 720 } },
  }), /video stream facts/i);

  const ass = buildTrailerAssCaptions([{ words: [
    { startSeconds: 0, endSeconds: 0.25, text: "Uma" },
    { startSeconds: 0.25, endSeconds: 0.6, text: "frase" },
    { startSeconds: 0.6, endSeconds: 1, text: "bem" },
    { startSeconds: 1, endSeconds: 1.5, text: "comprida" },
    { startSeconds: 1.5, endSeconds: 1.8, text: "para" },
    { startSeconds: 1.8, endSeconds: 2.1, text: "testar" },
    { startSeconds: 2.1, endSeconds: 2.4, text: "quebra" },
    { startSeconds: 2.4, endSeconds: 2.8, text: "automática" },
    { startSeconds: 2.8, endSeconds: 3.1, text: "sem" },
    { startSeconds: 3.1, endSeconds: 3.3, text: "invadir" },
    { startSeconds: 3.3, endSeconds: 3.8, text: "a waveform {\\pos(1,1)}" },
  ] }]);
  assert.ok(ass.includes("PlayResY: 1280"));
  assert.ok(ass.includes("Style: Reels,Montserrat,75"));
  assert.ok(ass.includes("\\N"), "long captions wrap within their fixed area");
  assert.ok(ass.includes("｛") && ass.includes("＼pos(1,1)"), "transcript text cannot inject ASS override tags");
  assert.ok(ass.includes("\\pos(640,1245)"));

  const captionArgs = buildTrailerCaptionRenderArgs({ inputVideoPath: "/fixture/base.mp4", assPath: "/fixture/captions.ass", outputPath: "/fixture/final.mp4" });
  const captionFilter = captionArgs[captionArgs.indexOf("-vf") + 1];
  assert.ok(captionFilter.includes("fontsdir="));
  assert.ok(captionFilter.includes("setsar=1"));

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (() => { networkCalls += 1; throw new Error("network tripwire"); }) as typeof fetch;
  assert.deepEqual(validateTrailerRenderEvidence(validEvidence), validEvidence);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, concurrency: 2 } as unknown as TrailerRenderEvidence), /concurrency/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, approved: true } as unknown as TrailerRenderEvidence), /approved|measured/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, capability: { ...validEvidence.capability, filters: [] } }), /showwaves/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, provenance: { ...validEvidence.provenance, outputDurationSeconds: 4 } }), /duration/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, measuredLimit: { ...validEvidence.measuredLimit, timeoutMs: 0 } }), /timeout|measured/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, profile: { ...validEvidence.profile, container: "webm" } } as unknown as TrailerRenderEvidence), /container|codec/i);
  assertThrows(() => validateTrailerRenderEvidence({ ...validEvidence, capability: { ...validEvidence.capability, imageDigest: "not-a-digest" } }), /digest/i);
  assert.equal(networkCalls, 0, "offline verifier must not call fetch");
  globalThis.fetch = originalFetch;
  console.log("Trailer render profile verification passed.");
};

run();
