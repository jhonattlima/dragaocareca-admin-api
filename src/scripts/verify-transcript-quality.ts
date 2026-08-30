import assert from "node:assert/strict";
import {
  assertTranscriptTimestampQuality,
  findTranscriptTimestampQualityIssues,
  formatTranscriptSegments,
  parseTranscriptTimestamps,
} from "../services/transcript-quality.service";

const goodTranscript = [
  "0:00 Abertura do episódio.",
  "0:45 Primeiro bloco de conversa.",
  "1:30 Segundo bloco de conversa.",
  "2:15 Encerramento.",
].join("\n\n");

assert.deepEqual(parseTranscriptTimestamps(goodTranscript).map((segment) => segment.seconds), [0, 45, 90, 135]);
assert.equal(formatTranscriptSegments([
  { start: 0, text: " Abertura." },
  { start: 65, text: " Continuação." },
], 120), "2:00 Abertura.\n\n3:05 Continuação.");
assert.deepEqual(findTranscriptTimestampQualityIssues(goodTranscript, 150), []);
assert.doesNotThrow(() => assertTranscriptTimestampQuality(goodTranscript, 150));

const sparseTranscript = "0:00 Início.\n\n4:22 Outro bloco.";
assert.ok(findTranscriptTimestampQualityIssues(sparseTranscript, 600).length > 0);
assert.throws(() => assertTranscriptTimestampQuality(sparseTranscript, 600), /timestamp quality/i);
assert.throws(() => assertTranscriptTimestampQuality("Sem timestamp.", 60), /no parseable timestamps/i);
assert.throws(() => assertTranscriptTimestampQuality("0:30 A\n\n0:10 B", 60), /not monotonic/i);

console.log("Transcript quality verification passed.");
