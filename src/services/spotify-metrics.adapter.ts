type NumericValue = number | null;

type RawMetricSummary = {
  current: NumericValue;
  previous: NumericValue;
  deltaPercent: NumericValue;
  currentSource?: string;
  previousSource?: string;
  source?: string;
};

type RawSnapshot = {
  source: string;
  fetchedAt: string;
  range: {
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
  };
  metadata?: Record<string, unknown>;
  current?: {
    streams?: Record<string, unknown>;
    aggregate?: Record<string, unknown>;
    listeners?: Record<string, unknown>;
  };
  previous?: {
    streams?: Record<string, unknown>;
    aggregate?: Record<string, unknown>;
    listeners?: Record<string, unknown>;
  };
  summary?: {
    plays?: RawMetricSummary;
    publicValue?: RawMetricSummary;
    consumingTime?: RawMetricSummary;
    followers?: RawMetricSummary;
    followersCurrent?: number | null;
  };
  episodes?: Array<Record<string, unknown>>;
  samplePerformance?: Record<string, unknown> | null;
  debug?: Record<string, unknown>;
};

export type SpotifyMetricsSnapshot = RawSnapshot;

export const normalizeSpotifyMetricsSnapshot = (snapshot: RawSnapshot): RawSnapshot => {
  return {
    ...snapshot,
    source: "spotify-connector",
    summary: {
      plays: snapshot.summary?.plays ?? { current: null, previous: null, deltaPercent: null },
      publicValue: snapshot.summary?.publicValue ?? { current: null, previous: null, deltaPercent: null, source: "unavailable" },
      consumingTime: snapshot.summary?.consumingTime ?? { current: null, previous: null, deltaPercent: null },
      followers:
        snapshot.summary?.followers ?? {
          current: snapshot.summary?.followersCurrent ?? null,
          previous: null,
          deltaPercent: null,
          source: "unavailable",
        },
      followersCurrent: snapshot.summary?.followersCurrent ?? snapshot.summary?.followers?.current ?? null,
    },
  };
};
