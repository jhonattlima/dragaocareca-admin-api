import assert from "node:assert/strict";

const main = (): void => {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("expected NODE_ENV=development");
  }

  assert.fail("YouTube trailer-job fake-provider verifier scaffold is not implemented");
};

void main();
