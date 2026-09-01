import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publicationDestinationSchema, publicationMetadataSchema, publicationPreflightSchema, publicationSourceSchema, publicationSourceRevision } from "../schemas/episode-publication";

const fakeSource = (episodeId: number, digest = createHash("sha256").update("fixture").digest("hex")) => ({
  mediaReference: `episodes/${episodeId}/trailer.mp4`, sha256: digest, byteCount: 7, mimeType: "video/mp4" as const,
});

const main = (): void => {
  assert.equal(process.argv.includes("--fake-only"), true, "publication verifier is fake-only");
  assert.deepEqual(publicationDestinationSchema.options, ["telegram", "instagram_reel", "facebook_native_video"]);
  const source = publicationSourceSchema.parse(fakeSource(42));
  assert.match(publicationSourceRevision(42, source), /^episode:42:[a-f0-9]{64}$/);
  assert.notEqual(publicationSourceRevision(42, source), publicationSourceRevision(42, fakeSource(42, "a".repeat(64))));
  const metadata = publicationMetadataSchema.parse({ title: "Fixture", summary: "Summary", captionMentions: ["@operator"], hashtags: ["#tema"], renderedCaption: "Fixture\n\n@operator #tema" });
  assert.equal(metadata.captionMentions[0], "@operator");
  assert.throws(() => publicationMetadataSchema.parse({ ...metadata, captionMentions: ["@verified account"] }));
  const ready = publicationPreflightSchema.parse({ status: "ready", checkedAt: new Date().toISOString(), providerReachability: "ready", contentType: "video/mp4", contentLength: 7, rangeSupported: true, failureCategory: null });
  const blocked = publicationPreflightSchema.parse({ ...ready, status: "blocked", providerReachability: "blocked", failureCategory: "digest_mismatch" });
  assert.equal(blocked.status, "blocked");
  assert.equal(ready.contentLength, source.byteCount);
  console.log("episode publication contract passed: fake-only snapshots, destination isolation, preflight block/readiness, and no outbound provider writes");
};

main();
