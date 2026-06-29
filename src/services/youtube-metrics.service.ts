import { OAuth2Client } from "google-auth-library";
import { getDb, nowIso } from "../database/sqlite";
import { config } from "../config/env";

type Numeric = number;

type YouTubeReportRow = {
  date: string;
  views: Numeric;
  estimatedMinutesWatched: Numeric;
  subscribersGained: Numeric;
  subscribersLost: Numeric;
  subscribersCurrent: Numeric;
  likes: Numeric;
  comments: Numeric;
  shares: Numeric;
};

type YouTubeReportResponse = {
  columnHeaders?: Array<{ name?: string; dataType?: string }>;
  rows?: Array<Array<string | number>>;
};

type YouTubeChannelResponse = {
  items?: Array<{
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
    };
  }>;
};

type YouTubeMetricTotals = {
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
};

export type YouTubeMetricsSeriesPoint = YouTubeReportRow;

export interface YouTubeMetricsSnapshot {
  source: "youtube-analytics";
  fetchedAt: string;
  range: {
    requestedDays: number;
    lookbackDays: number;
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
    timeZone: string;
  };
  channel: {
    id: string;
    url: string;
    subscriberCount: number | null;
  };
  series: YouTubeMetricsSeriesPoint[];
  totals: YouTubeMetricTotals & {
    netSubscribers: number;
    averageViewDurationSeconds: number;
  };
  debug?: Record<string, unknown>;
}

export interface YouTubeMetricsErrorResponse {
  source: "youtube-analytics";
  fetchedAt: string;
  ok: false;
  code: "disabled" | "missing_credentials" | "fetch_failed";
  message: string;
  details?: string;
}

const metricFields = [
  "views",
  "estimatedMinutesWatched",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
  "shares",
];

const youtubeClient = new OAuth2Client(config.youtube.clientId || "", config.youtube.clientSecret || "");
const accessTokenRefreshMarginMs = 5 * 60 * 1000;

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

const isEnabled = (): boolean => config.youtube.enabled;

const assertConfig = (): void => {
  if (!isEnabled()) {
    throw new Error("YouTube metrics are disabled.");
  }

  if (!config.youtube.clientId || !config.youtube.clientSecret || !config.youtube.refreshToken) {
    throw new Error("Missing YouTube metrics credentials.");
  }

  youtubeClient.setCredentials({
    refresh_token: config.youtube.refreshToken,
  });
};

const getAccessToken = async (): Promise<string> => {
  assertConfig();

  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt - accessTokenRefreshMarginMs > now) {
    return cachedAccessToken;
  }

  const accessTokenResponse = await youtubeClient.getAccessToken();
  const token = accessTokenResponse?.token ?? null;
  if (!token) {
    throw new Error("Unable to obtain a YouTube access token.");
  }

  cachedAccessToken = token;
  cachedAccessTokenExpiresAt = youtubeClient.credentials.expiry_date ?? now + 55 * 60 * 1000;
  return token;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const getLocalDateString = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
};

const shiftDate = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toIsoDate(shifted);
};

const toNumber = (value: string | number | undefined): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const computeTotals = (series: YouTubeMetricsSeriesPoint[]): YouTubeMetricsSnapshot["totals"] => {
  const totals = series.reduce(
    (acc, point) => {
      acc.views += point.views;
      acc.estimatedMinutesWatched += point.estimatedMinutesWatched;
      acc.subscribersGained += point.subscribersGained;
      acc.subscribersLost += point.subscribersLost;
      acc.likes += point.likes;
      acc.comments += point.comments;
      acc.shares += point.shares;
      return acc;
    },
    {
      views: 0,
      estimatedMinutesWatched: 0,
      subscribersGained: 0,
      subscribersLost: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    }
  );

  const netSubscribers = totals.subscribersGained - totals.subscribersLost;
  const averageViewDurationSeconds = totals.views > 0 ? (totals.estimatedMinutesWatched * 60) / totals.views : 0;

  return {
    ...totals,
    netSubscribers,
    averageViewDurationSeconds,
  };
};

const buildDateSeries = (
  startDate: string,
  endDate: string,
  rowsByDate: Map<string, YouTubeMetricsSeriesPoint>,
  subscriberCount: number | null
): YouTubeMetricsSeriesPoint[] => {
  const series: YouTubeMetricsSeriesPoint[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    series.push(
      rowsByDate.get(cursor) ?? {
        date: cursor,
        views: 0,
        estimatedMinutesWatched: 0,
        subscribersGained: 0,
        subscribersLost: 0,
        subscribersCurrent: subscriberCount ?? 0,
        likes: 0,
        comments: 0,
        shares: 0,
      }
    );
    cursor = shiftDate(cursor, 1);
  }
  return series;
};

const ensurePayloadRow = (row: Array<string | number>): YouTubeMetricsSeriesPoint => {
  const [date, views, estimatedMinutesWatched, subscribersGained, subscribersLost, likes, comments, shares] = row;
  if (typeof date !== "string") {
    throw new Error("YouTube Analytics row is missing a date value.");
  }
  return {
    date,
    views: toNumber(views),
    estimatedMinutesWatched: toNumber(estimatedMinutesWatched),
    subscribersGained: toNumber(subscribersGained),
    subscribersLost: toNumber(subscribersLost),
    subscribersCurrent: 0,
    likes: toNumber(likes),
    comments: toNumber(comments),
    shares: toNumber(shares),
  };
};

const persistSample = (sample: YouTubeMetricsSeriesPoint): void => {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO youtube_metric_samples (
        channel_id, sample_date, views, estimated_minutes_watched, subscribers_gained,
        subscribers_lost, subscribers_current, likes, comments, shares, fetched_at, payload_json, created_at, updated_at
      ) VALUES (
        @channelId, @sampleDate, @views, @estimatedMinutesWatched, @subscribersGained,
        @subscribersLost, @subscribersCurrent, @likes, @comments, @shares, @fetchedAt, @payloadJson, @createdAt, @updatedAt
      )
      ON CONFLICT(channel_id, sample_date) DO UPDATE SET
        views = excluded.views,
        estimated_minutes_watched = excluded.estimated_minutes_watched,
        subscribers_gained = excluded.subscribers_gained,
        subscribers_lost = excluded.subscribers_lost,
        subscribers_current = excluded.subscribers_current,
        likes = excluded.likes,
        comments = excluded.comments,
        shares = excluded.shares,
        fetched_at = excluded.fetched_at,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `
  ).run({
    channelId: config.youtube.channelId || "MINE",
    sampleDate: sample.date,
    views: sample.views,
    estimatedMinutesWatched: sample.estimatedMinutesWatched,
    subscribersGained: sample.subscribersGained,
    subscribersLost: sample.subscribersLost,
    subscribersCurrent: sample.subscribersCurrent,
    likes: sample.likes,
    comments: sample.comments,
    shares: sample.shares,
    fetchedAt: now,
    payloadJson: JSON.stringify(sample),
    createdAt: now,
    updatedAt: now,
  });
};

const fetchChannelStatistics = async (): Promise<number | null> => {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    part: "statistics",
  });
  if (config.youtube.channelId) {
    params.set("id", config.youtube.channelId);
  } else {
    params.set("mine", "true");
  }

  const response = await fetch(`${config.youtube.dataBaseUrl}/channels?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.youtube.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`YouTube Data API request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as YouTubeChannelResponse;
  const subscriberCount = payload.items?.[0]?.statistics?.subscriberCount;
  if (typeof subscriberCount === "string") {
    const parsed = Number(subscriberCount);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const fetchAnalyticsReport = async (startDate: string, endDate: string): Promise<YouTubeReportResponse> => {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: metricFields.join(","),
    dimensions: "day",
    sort: "day",
  });

  const response = await fetch(`${config.youtube.baseUrl}/reports?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.youtube.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`YouTube Analytics request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return (await response.json()) as YouTubeReportResponse;
};

const normalizeReport = (response: YouTubeReportResponse): Map<string, YouTubeMetricsSeriesPoint> => {
  const rowsByDate = new Map<string, YouTubeMetricsSeriesPoint>();
  for (const row of response.rows ?? []) {
    if (!Array.isArray(row) || row.length < 8) {
      continue;
    }
    const sample = ensurePayloadRow(row);
    rowsByDate.set(sample.date, sample);
  }
  return rowsByDate;
};

export async function getYouTubeMetricsSnapshot(days = 90): Promise<YouTubeMetricsSnapshot> {
  assertConfig();

  const requestedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 90;
  const lookbackDays = Math.max(2, requestedDays * 2);
  const today = getLocalDateString(new Date(), config.youtube.timeZone);
  const currentEnd = shiftDate(today, -1);
  const previousStart = shiftDate(currentEnd, -(lookbackDays - 1));
  const currentStart = shiftDate(currentEnd, -(requestedDays - 1));
  const previousEnd = shiftDate(currentStart, -1);

  const [report, currentSubscriberCount] = await Promise.all([
    fetchAnalyticsReport(previousStart, currentEnd),
    fetchChannelStatistics(),
  ]);
  const rowsByDate = normalizeReport(report);
  const series = buildDateSeries(previousStart, currentEnd, rowsByDate, currentSubscriberCount);
  const seriesWithCurrentSubscribers = series.map((point) => ({
    ...point,
    subscribersCurrent: currentSubscriberCount ?? point.subscribersCurrent,
  }));
  const totals = computeTotals(seriesWithCurrentSubscribers.slice(-requestedDays));
  const snapshot: YouTubeMetricsSnapshot = {
    source: "youtube-analytics",
    fetchedAt: nowIso(),
    range: {
      requestedDays,
      lookbackDays,
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      timeZone: config.youtube.timeZone,
    },
    channel: {
      id: config.youtube.channelId || "MINE",
      url: config.youtube.channelId
        ? `https://www.youtube.com/channel/${config.youtube.channelId}/featured`
        : "https://studio.youtube.com",
      subscriberCount: currentSubscriberCount,
    },
    series: seriesWithCurrentSubscribers,
    totals,
    debug: {
      columnHeaders: report.columnHeaders ?? [],
      sampleCount: series.length,
    },
  };

  if (seriesWithCurrentSubscribers.length > 0) {
    persistSample(seriesWithCurrentSubscribers[seriesWithCurrentSubscribers.length - 1]);
  }

  return snapshot;
}

export async function getYouTubeMetricsSnapshotSafe(days = 90): Promise<YouTubeMetricsSnapshot | YouTubeMetricsErrorResponse> {
  try {
    return await getYouTubeMetricsSnapshot(days);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const code: YouTubeMetricsErrorResponse["code"] =
      details === "YouTube metrics are disabled."
        ? "disabled"
        : details === "Missing YouTube metrics credentials."
          ? "missing_credentials"
          : "fetch_failed";
    return {
      source: "youtube-analytics",
      fetchedAt: nowIso(),
      ok: false,
      code,
      message: "Unable to fetch YouTube metrics.",
      details,
    };
  }
}
