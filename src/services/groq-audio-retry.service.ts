const maximumWaitMs = 10 * 60_000;
const maximumRetries = 5;

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
    const headerSeconds = Number.parseFloat(response.headers.get("retry-after") ?? "");
    const messageSeconds = body.error?.message?.match(/try again in\s+(\d+(?:\.\d+)?)s/i)?.[1];
    const retryMs = Number.isFinite(headerSeconds) && headerSeconds >= 0
      ? headerSeconds * 1000
      : messageSeconds ? Number(messageSeconds) * 1000 : 60_000;
    const delayMs = Math.max(1000, Math.ceil(retryMs) + 1000);
    if (waitedMs + delayMs > maximumWaitMs) return response;

    await response.body?.cancel();
    console.info(`[transcription] provider=groq rate limited; retry=${attempt + 1} waitMs=${delayMs}`);
    await wait(delayMs);
    waitedMs += delayMs;
  }
};
