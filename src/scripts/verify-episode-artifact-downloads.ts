import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  EpisodeArtifactSelectorValidationError,
  parseEpisodeArtifactSelectors,
  preflightEpisodeArtifactDownloads,
} from "../services/episode-artifact-download.service";
import { getEpisodeMediaFinalPath } from "../services/episode-media-layout.service";

const fixtureEpisodeId = 987654321;

const selectors = (artifacts: unknown): string[] => parseEpisodeArtifactSelectors(artifacts).map((artifact) => artifact.selector);

const assertInvalidSelectorInput = (artifacts: unknown): void => {
  assert.throws(
    () => parseEpisodeArtifactSelectors(artifacts),
    EpisodeArtifactSelectorValidationError,
    "invalid selector input must fail before storage access"
  );
};

const verifySelectorContract = (): void => {
  assert.deepEqual(selectors(undefined), ["episode", "trailer", "transcript", "image", "image-low"]);
  assert.deepEqual(selectors("image-low,episode,episode,image"), ["episode", "image", "image-low"]);

  for (const invalidInput of ["", "episode,", ",episode", "episode,,trailer", "unknown", ["episode"], 12, null]) {
    assertInvalidSelectorInput(invalidInput);
  }
};

const createFixtures = async (): Promise<{ directory: string }> => {
  const audioPath = getEpisodeMediaFinalPath(fixtureEpisodeId, "audio");
  const directory = path.dirname(audioPath);

  await fs.promises.lstat(directory).then(
    () => {
      throw new Error("artifact verifier fixture directory already exists");
    },
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  );

  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(audioPath, "final audio fixture");
  await fs.promises.writeFile(getEpisodeMediaFinalPath(fixtureEpisodeId, "transcript"), "final transcript fixture");
  await fs.promises.mkdir(getEpisodeMediaFinalPath(fixtureEpisodeId, "cover"));

  return { directory };
};

const verifyPreflightContract = async (): Promise<void> => {
  const { directory } = await createFixtures();

  try {
    const preflight = await preflightEpisodeArtifactDownloads(fixtureEpisodeId, parseEpisodeArtifactSelectors(undefined));

    assert.deepEqual(preflight.requested, ["episode", "trailer", "transcript", "image", "image-low"]);
    assert.deepEqual(preflight.available.map((artifact) => artifact.selector), ["episode", "transcript"]);
    assert.deepEqual(preflight.available.map((artifact) => artifact.archiveEntryName), [
      `episode-${fixtureEpisodeId}/audio.mp3`,
      `episode-${fixtureEpisodeId}/transcript.txt`,
    ]);
    assert.deepEqual(preflight.missing, ["trailer", "image", "image-low"]);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
};

export const main = async (): Promise<void> => {
  const compiledScriptName = path.basename(__filename);

  if (compiledScriptName !== "verify-episode-artifact-downloads.js") {
    throw new Error(`expected compiled verifier execution, received ${compiledScriptName}`);
  }

  if (process.env.NODE_ENV !== "development") {
    throw new Error("expected NODE_ENV=development for artifact-download verification");
  }

  verifySelectorContract();
  await verifyPreflightContract();
  console.log("verified episode artifact selector and final-file preflight contract");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
