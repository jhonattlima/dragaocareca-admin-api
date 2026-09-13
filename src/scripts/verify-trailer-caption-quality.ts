import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateTrailerCaptionQuality,
  normalizePortugueseTokens,
  TRAILER_CAPTION_ALIGNER_VERSION,
  TRAILER_CAPTION_METRIC_VERSION,
  TRAILER_CAPTION_MODEL_ID,
  TRAILER_CAPTION_MODEL_REVISION,
  type TrailerCaptionCalibration,
  type TrailerCaptionCapacityEvidence,
} from "../services/trailer-caption-alignment.service";
import { buildTrailerAssCaptions, TRAILER_RENDER_VISUAL_PROFILE } from "../services/trailer-render-profile.service";

type Fixture = {
  id: string;
  transcript: string;
  words: Array<{ startSeconds: number; endSeconds: number; text: string }>;
  durationSeconds: number;
  reference?: Array<{ startSeconds: number; endSeconds: number; text: string }>;
  expected: Record<string, number | boolean>;
};

const close = (actual: number | null, expected: number): void => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs((actual as number) - expected) < 1e-9, `expected ${expected}, got ${actual}`);
};

const run = async (): Promise<void> => {
  if (!process.argv.includes("--fixtures-only")) throw new Error("Caption quality verification requires --fixtures-only");
  if (process.env.NODE_ENV !== "development") throw new Error("Caption quality verification is development-only");
  const fixturePath = path.resolve(__dirname, "../../src/scripts/fixtures/trailer-caption-quality-fixtures.json");
  const data = JSON.parse(await fs.readFile(fixturePath, "utf8")) as { metricVersion: string; cases: Fixture[] };
  assert.equal(data.metricVersion, TRAILER_CAPTION_METRIC_VERSION);
  assert.ok(data.cases.length >= 8);
  assert.deepEqual(normalizePortugueseTokens("Ação CAFÉ 344"), ["ação", "café", "344"]);

  const calibration: TrailerCaptionCalibration = {
    metricVersion: TRAILER_CAPTION_METRIC_VERSION, calibrationId: "synthetic-only", referenceSetId: "synthetic-only",
    referenceSetSha256: "a".repeat(64), sampleCount: 1, humanReviewed: true,
    alignerVersion: TRAILER_CAPTION_ALIGNER_VERSION, modelId: TRAILER_CAPTION_MODEL_ID,
    modelRevision: TRAILER_CAPTION_MODEL_REVISION, modelSha256: "b".repeat(64), werMax: 1, coverageMin: 0,
    onsetMaeMaxSeconds: 1, onsetP95MaxSeconds: 1, offsetMaeMaxSeconds: 1, offsetP95MaxSeconds: 1,
    reviewer: "synthetic-fixture-only", reviewedAt: "2026-01-01T00:00:00.000Z", approved: true,
  };
  const capacity: TrailerCaptionCapacityEvidence = {
    imageDigest: `sha256:${"c".repeat(64)}`, measuredAt: "2026-01-01T00:00:00.000Z",
    modelRevision: TRAILER_CAPTION_MODEL_REVISION, maxPeakMemoryBytes: 1, maxDurationSeconds: 100,
    maxInputBytes: 1_000_000, approved: true,
  };

  for (const fixture of data.cases) {
    const metrics = evaluateTrailerCaptionQuality({
      transcript: fixture.transcript,
      words: fixture.words,
      durationSeconds: fixture.durationSeconds,
      reference: fixture.reference,
    });
    for (const [key, expected] of Object.entries(fixture.expected)) {
      const actual = metrics[key as keyof typeof metrics];
      if (typeof expected === "number") close(actual as number | null, expected);
      else assert.equal(actual, expected, `${fixture.id}: ${key}`);
    }
    assert.equal(metrics.eligible, false, `${fixture.id}: synthetic fixtures must never imply production eligibility`);
    const gated = evaluateTrailerCaptionQuality({
      transcript: fixture.transcript, words: fixture.words, durationSeconds: fixture.durationSeconds,
      reference: fixture.reference ?? fixture.words, calibration, capacity,
    });
    if (!metrics.cuePositiveDuration || !metrics.cueMonotonic || !metrics.cueNonOverlapping || !metrics.cueWithinDuration) {
      assert.equal(gated.eligible, false, `${fixture.id}: invalid cues fail closed even with test-only evidence`);
    }
  }

  const noCalibration = evaluateTrailerCaptionQuality({
    transcript: "ação", words: [{ startSeconds: 0, endSeconds: 0.5, text: "ação" }], durationSeconds: 1,
  });
  assert.equal(noCalibration.eligible, false);
  assert.equal(noCalibration.reason, "calibration_unavailable");
  const noCapacity = evaluateTrailerCaptionQuality({
    transcript: "ação", words: [{ startSeconds: 0, endSeconds: 0.5, text: "ação" }], durationSeconds: 1,
    reference: [{ startSeconds: 0, endSeconds: 0.5, text: "ação" }], calibration, capacity: null,
  });
  assert.equal(noCapacity.eligible, false);
  assert.equal(noCapacity.reason, "capacity_unavailable");

  const ass = buildTrailerAssCaptions([{ words: [{ startSeconds: 0, endSeconds: 0.5, text: "{\\an8}mal\nicious" }] }]);
  assert.equal(ass.includes("{\\an8}mal"), false, "untrusted transcript markup is neutralized before ASS interpolation");
  assert.equal(ass.includes("mal\nicious"), false, "control/newline characters cannot inject ASS events");
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.width, 1280);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.height, 1280);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.captions.fontName, "Montserrat");
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.captions.fontSize, 75);
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.waveform.gradientStart, "#00ffff");
  assert.equal(TRAILER_RENDER_VISUAL_PROFILE.waveform.gradientEnd, "#ff00ff");
  console.log(`PASS: ${data.cases.length} synthetic metric fixtures; production quality/capacity gates remain unavailable`);
};

run().catch((error) => { console.error(error instanceof Error ? error.message : "Caption quality verifier failed"); process.exitCode = 1; });
