import assert from "node:assert/strict";
import { parseTrailerVideoMaxBytes } from "../config/env";

const defaultLimit = 500 * 1024 * 1024;

assert.equal(parseTrailerVideoMaxBytes(undefined), defaultLimit);
assert.equal(parseTrailerVideoMaxBytes("1048576"), 1048576);

for (const invalidValue of ["1.5", "0", "-1", "not-a-number"]) {
  assert.throws(
    () => parseTrailerVideoMaxBytes(invalidValue),
    /EPISODE_TRAILER_VIDEO_MAX_BYTES must be a positive integer/
  );
}

console.log("Trailer-video upload configuration verification passed.");
