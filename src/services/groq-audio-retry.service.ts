const maximumWaitMs = 10 * 60_000;
const maximumRetries = 5;

export const groqAudioRetryDelayMs = (response: Response, message = ""): number => {
  const header = response.headers.get("retry-after") ?? "";
  const seconds = Number(header);
  const dateDelay = Date.parse(header) - Date.now();
  const messageSeconds = message.match(/try again in\s+(\d+(?:\.\d+)?)s/i)?.[1];
  const retryMs = header.trim() && Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Number.isFinite(dateDelay) && dateDelay > 0 ? dateDelay
    : messageSeconds ? Number(messageSeconds) * 1000 : 60_000;
  return Math.max(1000, Math.ceil(retryMs) + 1000);
};

export const runGroqAudioRequest = async (
  request: () => Promise<Response>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> => {
  let waitedMs = 0;
  for (let attempt = 0; ; attempt += 1) {
    const response = await request();
    if (response.status !== 429 || attempt >= maximumRetries) return response;

    const body = await response.clone().json().catch(() => ({})) as { error?: { message?: string } };
    const delayMs = groqAudioRetryDelayMs(response, body.error?.message);
    if (waitedMs + delayMs > maximumWaitMs) return response;

    await response.body?.cancel();
    console.info(`[transcription] provider=groq rate limited; retry=${attempt + 1} waitMs=${delayMs}`);
    await wait(delayMs);
    waitedMs += delayMs;
  }
};
