import assert from "node:assert/strict";
import { runGroqAudioRequest } from "../services/groq-audio-retry.service";

const main = async (): Promise<void> => {
  const delays: number[] = [];
  let requests = 0;
  const success = await runGroqAudioRequest(async () => {
    requests += 1;
    return requests === 1
      ? Response.json({ error: { message: "Please try again in 8.5s." } }, { status: 429 })
      : Response.json({ text: "Transcrição pronta" });
  }, async (delay) => { delays.push(delay); });
  assert.equal(success.status, 200);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [9500]);

  const limited = await runGroqAudioRequest(async () => Response.json(
    { error: { message: "Daily quota" } }, { status: 429, headers: { "retry-after": "3600" } },
  ), async () => { throw new Error("Must not wait beyond the budget"); });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.message, "Daily quota");

  let permanentRequests = 0;
  const permanent = await runGroqAudioRequest(async () => {
    permanentRequests += 1;
    return new Response(null, { status: 401 });
  });
  assert.equal(permanent.status, 401);
  assert.equal(permanentRequests, 1);

  let repeatedRequests = 0;
  const repeated = await runGroqAudioRequest(async () => {
    repeatedRequests += 1;
    return new Response(null, { status: 429, headers: { "retry-after": "1" } });
  }, async () => undefined);
  assert.equal(repeated.status, 429);
  assert.equal(repeatedRequests, 6);
  console.log("Groq audio retry verification passed.");
};

void main().catch((error) => { console.error(error); process.exitCode = 1; });
