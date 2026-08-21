type GroqRateLimitedTask<T> = () => Promise<T>;

const minuteMs = 60_000;
const minIntervalMs = Number(process.env.GROQ_MIN_INTERVAL_MS ?? minuteMs);
const tokensPerMinute = Number(process.env.GROQ_TOKENS_PER_MINUTE ?? 8_000);
const dailyTokenLimit = Number(process.env.GROQ_DAILY_TOKEN_LIMIT ?? 200_000);
const maxRetries = Number(process.env.GROQ_RATE_LIMIT_RETRIES ?? 1);

let queueTail: Promise<void> = Promise.resolve();
let windowStartedAt = 0;
let windowTokens = 0;
let dailyDate = "";
let dailyTokens = 0;
let lastStartedAt = 0;

export class GroqRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("Groq rate limit reached");
    this.name = "GroqRateLimitError";
  }
}

export class GroqDailyQuotaError extends Error {
  constructor() {
    super("Groq daily token budget exhausted");
    this.name = "GroqDailyQuotaError";
  }
}

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const waitForCapacity = async (estimatedTokens: number): Promise<void> => {
  const requested = Math.max(1, Math.ceil(estimatedTokens));
  if (requested > tokensPerMinute) throw new GroqRateLimitError(minuteMs);

  while (true) {
    const now = Date.now();
    const date = todayUtc();
    if (date !== dailyDate) {
      dailyDate = date;
      dailyTokens = 0;
    }
    if (dailyTokens + requested > dailyTokenLimit) throw new GroqDailyQuotaError();
    if (!windowStartedAt || now - windowStartedAt >= minuteMs) {
      windowStartedAt = now;
      windowTokens = 0;
    }

    const intervalWait = lastStartedAt ? minIntervalMs - (now - lastStartedAt) : 0;
    const tokenWait = windowTokens + requested > tokensPerMinute ? windowStartedAt + minuteMs - now : 0;
    const waitMs = Math.max(intervalWait, tokenWait);
    if (waitMs > 0) {
      console.info(`[groq] rate limiter waiting ${waitMs}ms estimatedTokens=${requested}`);
      await sleep(waitMs);
      continue;
    }

    windowTokens += requested;
    dailyTokens += requested;
    lastStartedAt = Date.now();
    return;
  }
};

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const previous = queueTail;
  let release!: () => void;
  queueTail = new Promise<void>((resolve) => { release = resolve; });
  return previous.then(task).finally(release);
};

export const runGroqRateLimited = async <T>(input: { estimatedTokens: number; task: GroqRateLimitedTask<T> }): Promise<T> => enqueue(async () => {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await waitForCapacity(input.estimatedTokens);
    try {
      return await input.task();
    } catch (error) {
      if (!(error instanceof GroqRateLimitError) || attempt >= maxRetries) throw error;
      await sleep(error.retryAfterMs);
    }
  }
  throw new Error("Groq rate limiter exhausted retries");
});

export const groqRetryAfterMs = (response: Response): number => {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) return Math.max(1_000, Math.ceil(Number(retryAfter) * 1_000));
  const reset = response.headers.get("x-ratelimit-reset-tokens");
  const match = reset?.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (match) {
    const value = Number(match[1]);
    const unit = (match[2] ?? "s").toLowerCase();
    return Math.max(1_000, Math.ceil(value * (unit === "m" ? 60_000 : unit === "ms" ? 1 : 1_000)));
  }
  return minuteMs;
};
