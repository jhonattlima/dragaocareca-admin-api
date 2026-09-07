import { config } from "../config/env";

type UmamiPoint = { x: string | number; y: number };
type UmamiStats = { pageviews?: number; visitors?: number; visits?: number; bounces?: number; totaltime?: number; comparison?: UmamiStats };
type UmamiPageviews = { pageviews?: UmamiPoint[]; sessions?: UmamiPoint[] };

export type SiteUsageMetrics = {
  source: "umami";
  fetchedAt: string;
  ok: true;
  range: { requestedDays: number; currentStart: string; currentEnd: string; previousStart: string; previousEnd: string; timeZone: string };
  totals: { pageviews: number; visitors: number; sessions: number; bounces: number; totalTimeSeconds: number };
  comparison: { pageviews: number; visitors: number; sessions: number; bounces: number; totalTimeSeconds: number };
  series: Array<{ date: string; pageviews: number; sessions: number }>;
  topPages: Array<{ label: string; value: number }>;
  referrers: Array<{ label: string; value: number }>;
  campaigns: Array<{ label: string; value: number }>;
  browsers: Array<{ label: string; value: number }>;
  operatingSystems: Array<{ label: string; value: number }>;
  devices: Array<{ label: string; value: number }>;
};

export type SiteUsageMetricsError = {
  source: "umami";
  fetchedAt: string;
  ok: false;
  code: "disabled" | "missing_credentials" | "fetch_failed";
  message: string;
  details?: string;
};

type Fetcher = typeof fetch;

const asNumber = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

const toRows = (value: unknown): Array<{ label: string; value: number }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ label: typeof item?.x === "string" ? item.x : String(item?.x ?? "Unknown"), value: asNumber(item?.y) }))
    .filter((item) => item.label && item.value > 0)
    .slice(0, 10);
};

const period = (days: number) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const previousEnd = new Date(start);
  previousEnd.setMilliseconds(-1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { start, end, previousStart, previousEnd };
};

const requestJson = async (url: string, token: string, fetcher: Fetcher): Promise<unknown> => {
  const response = await fetcher(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(config.umami.timeoutMs),
  });
  if (!response.ok) throw new Error(`Umami returned HTTP ${response.status}`);
  return response.json();
};

const login = async (fetcher: Fetcher): Promise<string> => {
  const response = await fetcher(`${config.umami.baseUrl.replace(/\/+$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: config.umami.username, password: config.umami.password }),
    signal: AbortSignal.timeout(config.umami.timeoutMs),
  });
  if (!response.ok) throw new Error(`Umami login returned HTTP ${response.status}`);
  const body = await response.json() as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) throw new Error("Umami login did not return a token");
  return body.token;
};

const stats = (value: unknown) => {
  const input = (value ?? {}) as UmamiStats;
  return {
    pageviews: asNumber(input.pageviews), visitors: asNumber(input.visitors), sessions: asNumber(input.visits),
    bounces: asNumber(input.bounces), totalTimeSeconds: Math.round(asNumber(input.totaltime) / 1000),
  };
};

export async function getSiteUsageMetrics(days = 30, fetcher: Fetcher = globalThis.fetch): Promise<SiteUsageMetrics> {
  if (!config.umami.enabled) throw new Error("Umami metrics are disabled.");
  if (!config.umami.websiteId || !config.umami.username || !config.umami.password) throw new Error("Missing Umami metrics credentials.");
  const safeDays = Math.min(Math.max(Math.trunc(days), 1), 366);
  const { start, end, previousStart, previousEnd } = period(safeDays);
  const base = `${config.umami.baseUrl.replace(/\/+$/, "")}/api/websites/${encodeURIComponent(config.umami.websiteId)}`;
  const token = await login(fetcher);
  const params = (from: Date, to: Date, extra = "") => `startAt=${from.getTime()}&endAt=${to.getTime()}${extra}`;
  const [currentStats, previousStats, pageviews, paths, referrers, campaigns, browsers, operatingSystems, devices] = await Promise.all([
    requestJson(`${base}/stats?${params(start, end)}`, token, fetcher),
    requestJson(`${base}/stats?${params(previousStart, previousEnd)}`, token, fetcher),
    requestJson(`${base}/pageviews?${params(start, end, "&unit=day")}`, token, fetcher),
    requestJson(`${base}/metrics?${params(start, end, "&type=path&limit=10")}`, token, fetcher),
    requestJson(`${base}/metrics?${params(start, end, "&type=referrer&limit=10")}`, token, fetcher),
    requestJson(`${base}/metrics?${params(start, end, "&type=utmSource&limit=10")}`, token, fetcher),
    requestJson(`${base}/metrics?${params(start, end, "&type=browser&limit=10")}`, token, fetcher),
    requestJson(`${base}/metrics?${params(start, end, "&type=os&limit=10")}`, token, fetcher),
    requestJson(`${base}/metrics?${params(start, end, "&type=device&limit=10")}`, token, fetcher),
  ]);
  const current = stats(currentStats);
  const previous = stats(previousStats);
  const views = (pageviews ?? {}) as UmamiPageviews;
  const sessions = new Map((views.sessions ?? []).map((point) => [String(point.x), asNumber(point.y)]));
  return {
    source: "umami", fetchedAt: new Date().toISOString(), ok: true,
    range: { requestedDays: safeDays, currentStart: start.toISOString(), currentEnd: end.toISOString(), previousStart: previousStart.toISOString(), previousEnd: previousEnd.toISOString(), timeZone: "America/Sao_Paulo" },
    totals: current, comparison: previous,
    series: (views.pageviews ?? []).map((point) => ({ date: String(point.x), pageviews: asNumber(point.y), sessions: sessions.get(String(point.x)) ?? 0 })),
    topPages: toRows(paths), referrers: toRows(referrers), campaigns: toRows(campaigns), browsers: toRows(browsers), operatingSystems: toRows(operatingSystems), devices: toRows(devices),
  };
}

export async function getSiteUsageMetricsSafe(days = 30): Promise<SiteUsageMetrics | SiteUsageMetricsError> {
  try {
    return await getSiteUsageMetrics(days);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const code = details === "Umami metrics are disabled." ? "disabled" : details === "Missing Umami metrics credentials." ? "missing_credentials" : "fetch_failed";
    return { source: "umami", fetchedAt: new Date().toISOString(), ok: false, code, message: "Unable to fetch site usage metrics.", details };
  }
}
