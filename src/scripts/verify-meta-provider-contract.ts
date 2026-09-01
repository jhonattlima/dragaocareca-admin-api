import assert from "node:assert/strict";
import fs from "node:fs";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const fail = (message: string): never => { throw new Error(`Meta provider preflight failed: ${message}`); };

const main = (): void => {
  if (!process.argv.includes("--official-preflight")) fail("--official-preflight is required");
  if (!process.argv.includes("--read-only-authorized")) fail("explicit read-only authorization is required");
  if (process.argv.some((value) => /write|publish|upload|container|synthetic|post/i.test(value) && !/read-only|no-write/i.test(value))) {
    fail("write authorization or provider write operation was requested");
  }

  const evidenceArg = arg("--evidence");
  const evidenceInput: string = typeof evidenceArg === "string" && evidenceArg.length > 0 ? evidenceArg : fail("--evidence is required");
  const evidence = fs.existsSync(evidenceInput) ? fs.readFileSync(evidenceInput, "utf8") : evidenceInput;
  const required = [
    "v25.0", "read-only", "HTTP 200", "me/accounts", "video_reels", "video_id", "upload_url",
    "rupload.facebook.com/video-upload", "fields=status", "upload_phase=finish", "video_state",
    "DRAFT", "SCHEDULED", "PUBLISHED", "CREATE_CONTENT", "MANAGE", "9:16", "540x960", "23",
    "4-60", "Page Access Token", "no POST", "redacted",
  ];
  for (const marker of required) assert.match(evidence, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing evidence: ${marker}`);
  assert.match(evidence, /https:\/\/www\.postman\.com\/meta\/facebook\/(?:documentation|folder)\//, "official source URL missing");
  assert.match(evidence, /historical.*(?:v15|v16)|(?:v15|v16).*historical/i, "historical samples must be explicitly excluded");
  assert.match(evidence, /no\s+(?:POST|PUT|DELETE|write|upload|publication|synthetic)/i, "zero-write result must be explicit");
  assert.doesNotMatch(evidence, /(?:access_token|app_secret|authorization: bearer)\s*[:=]\s*[^\s<\[]+/i, "credential material must be redacted");
  console.log("official Meta v25.0 preflight passed: current read-only evidence matches the pinned contract; no provider write was authorized or attempted");
};

main();
