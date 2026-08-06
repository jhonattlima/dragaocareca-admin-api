import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EpisodeHashtagAuthoringFocus = "foundation" | "lookup" | "lifecycle" | "route";

export type HashtagAuthoringVerifierSeams = {
  generateCandidates: (...args: unknown[]) => Promise<unknown>;
  lookupCount: (...args: unknown[]) => Promise<unknown>;
  now: () => Date;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
  admitLookup: (caller: "automatic" | "manual") => boolean;
};

type Fixture = { root: string; mediaRoot: string; sqlitePath: string };

const parseFocus = (argumentsList: string[]): EpisodeHashtagAuthoringFocus | null => {
  const focusArguments = argumentsList.filter((argument) => argument.startsWith("--focus="));
  if (focusArguments.length > 1) throw new Error("only one --focus argument is allowed");
  if (focusArguments.length === 0) return null;
  const focus = focusArguments[0].slice("--focus=".length);
  if (focus === "foundation" || focus === "lookup" || focus === "lifecycle" || focus === "route") return focus;
  throw new Error("expected --focus=foundation, --focus=lookup, --focus=lifecycle, or --focus=route");
};

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dragaocareca-episode-hashtag-authoring-"));
  const mediaRoot = path.join(root, "media");
  const sqlitePath = path.join(root, "episode-hashtag-authoring.sqlite");
  await fs.promises.mkdir(mediaRoot);
  return { root, mediaRoot, sqlitePath };
};

const assertFixtureIsolation = async (fixture: Fixture): Promise<void> => {
  assert.match(fixture.root, /^\/tmp\/dragaocareca-episode-hashtag-authoring-/);
  assert.equal(await fs.promises.stat(fixture.mediaRoot).then((entry) => entry.isDirectory()), true);
  assert.equal(fs.existsSync(fixture.sqlitePath), false);
};

const createOfflineSeams = (): HashtagAuthoringVerifierSeams => {
  let timerId = 0;
  return {
    generateCandidates: async () => ({ candidates: [] }),
    lookupCount: async () => ({ approximateCount: 0 }),
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    setTimer: (_callback, _delayMs) => ++timerId,
    clearTimer: (_timer) => undefined,
    admitLookup: (_caller) => true,
  };
};

const verifyNoNetworkContract = (seams: HashtagAuthoringVerifierSeams): void => {
  assert.equal(typeof seams.generateCandidates, "function");
  assert.equal(typeof seams.lookupCount, "function");
  assert.equal(typeof seams.now, "function");
  assert.equal(typeof seams.setTimer, "function");
  assert.equal(typeof seams.clearTimer, "function");
  assert.equal(typeof seams.admitLookup, "function");
  assert.equal(typeof globalThis.fetch, "function", "runtime fetch must remain available for production only");
};

const verifyFoundationFocus = async (fixture: Fixture): Promise<void> => {
  await assertFixtureIsolation(fixture);
  verifyNoNetworkContract(createOfflineSeams());
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");

  // Parse before creating a fixture so malformed focus invocations cannot touch persistence.
  const focus = parseFocus(process.argv.slice(2));
  const fixture = await createFixture();
  try {
    if (!focus || focus === "foundation") await verifyFoundationFocus(fixture);
    if (focus && focus !== "foundation") {
      // Later plans replace these branches with real offline service/route assertions.
      verifyNoNetworkContract(createOfflineSeams());
    }
    console.log(`offline hashtag-authoring ${focus ?? "all"} scaffold verified`);
  } finally {
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

if (require.main === module) void main();
