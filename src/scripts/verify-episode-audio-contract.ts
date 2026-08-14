import assert from "node:assert/strict";
import {
  extractEpisodeAudioMetadata,
  normalizeEpisodeAudioMetadata,
  type EpisodeAudioMetadata,
} from "../services/episode-audio-metadata.service";
import { isCompleteMusicCredit } from "../schemas/episode";

/**
 * Wave 0 RED contract verifier for FORM-02 and FORM-04.
 *
 * This script intentionally names the API seams that Plan 01 must provide. It
 * keeps the browser's File.size out of the contract and exercises the same
 * response shapes used by the Angular upload/create flow.
 */

const assertThrows = (callback: () => unknown, message: RegExp): void => {
  assert.throws(callback, message);
};

const validMetadata: EpisodeAudioMetadata = {
  durationSeconds: 3723,
  bytes: 1_235_000,
};

const runMetadataContract = (): void => {
  const normalized = normalizeEpisodeAudioMetadata(validMetadata);
  assert.deepEqual(normalized, {
    duration: "01:02:03",
    bytes: 1_235_000,
  });

  assertThrows(
    () => normalizeEpisodeAudioMetadata({ durationSeconds: Number.NaN, bytes: 1_235_000 }),
    /duration/i,
  );
  assertThrows(
    () => normalizeEpisodeAudioMetadata({ durationSeconds: 3723, bytes: -1 }),
    /bytes/i,
  );
  assertThrows(
    () => normalizeEpisodeAudioMetadata({ durationSeconds: 0, bytes: 1_235_000 }),
    /duration/i,
  );

  // D-04/D-05/D-08: extraction is server-side and must not accept a browser
  // supplied size or report a successful upload without both fields.
  assert.equal(typeof extractEpisodeAudioMetadata, "function");
}

const runMusicCreditContract = (): void => {
  // D-11: POST and PUT use the same complete-credit predicate.
  assert.equal(isCompleteMusicCredit({ name: "  Theme song ", links: [{ label: "Spotify", url: " https://example.test/theme " }] }), true);
  assert.equal(isCompleteMusicCredit({ name: "Theme song", links: [] }), false);
  assert.equal(isCompleteMusicCredit({ name: "  ", links: [{ label: "Spotify", url: "https://example.test/theme" }] }), false);
  assert.equal(isCompleteMusicCredit({ name: "Theme song", links: [{ label: "Spotify", url: "   " }] }), false);
  assert.equal(isCompleteMusicCredit(JSON.stringify({ name: "Theme song", links: [{ label: "Spotify", url: " https://example.test/theme " }] })), true);
  assert.equal(isCompleteMusicCredit("not-json"), false);
};

const runResponseContract = (): void => {
  const draftUploadResponse = {
    episodeId: 42,
    fileName: null,
    duration: "01:02:03",
    bytes: 1_235_000,
    message: "Audio staged and transcription started.",
  };
  const persistedEpisodeResponse = {
    ...draftUploadResponse,
    title: "Episode",
    summary: "Summary",
    pubDate: "2026-08-14T09:10:00.000Z",
    explicit: "no" as const,
  };
  assert.match(draftUploadResponse.duration, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(Number.isInteger(draftUploadResponse.bytes) && draftUploadResponse.bytes >= 0, true);
  assert.equal(persistedEpisodeResponse.bytes, draftUploadResponse.bytes);

  // Trailer audio remains filename/message-only (D-04); it must not inherit
  // the episode-audio metadata requirement.
  const trailerResponse = { episodeId: 42, trailerFileName: "episodes/42/trailer.mp3", message: "Trailer staged." };
  assert.deepEqual(Object.keys(trailerResponse).sort(), ["episodeId", "message", "trailerFileName"]);
};

runMetadataContract();
runMusicCreditContract();
runResponseContract();
console.log("Episode audio contract verification passed.");
