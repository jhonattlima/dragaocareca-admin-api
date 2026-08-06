import { config } from "../../config/env";
import { getDb } from "../sqlite";

export type HashtagCallerClass = "automatic" | "manual";

export type YouTubeHashtagCacheKey = {
  normalizedTag: string;
  regionCode: string;
  relevanceLanguage: string;
  searchShapeVersion: string;
};

export type YouTubeHashtagCacheRow = YouTubeHashtagCacheKey & {
  approximateCount: number;
  retrievedAt: string;
  expiresAt: string;
  errorCategory: string | null;
};

type SqliteCacheRow = {
  normalized_tag: string;
  region_code: string;
  relevance_language: string;
  search_shape_version: string;
  approximate_count: number;
  retrieved_at: string;
  expires_at: string;
  error_category: string | null;
};

const mapRow = (row: SqliteCacheRow | undefined): YouTubeHashtagCacheRow | null =>
  row
    ? {
        normalizedTag: row.normalized_tag,
        regionCode: row.region_code,
        relevanceLanguage: row.relevance_language,
        searchShapeVersion: row.search_shape_version,
        approximateCount: row.approximate_count,
        retrievedAt: row.retrieved_at,
        expiresAt: row.expires_at,
        errorCategory: row.error_category ?? null,
      }
    : null;

const keyParams = (key: YouTubeHashtagCacheKey) => ({
  normalizedTag: key.normalizedTag,
  regionCode: key.regionCode,
  relevanceLanguage: key.relevanceLanguage,
  searchShapeVersion: key.searchShapeVersion,
});

export const getPacificQuotaDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export const createYouTubeHashtagCacheRepository = () => ({
  getFresh(key: YouTubeHashtagCacheKey, now: Date = new Date()): YouTubeHashtagCacheRow | null {
    const row = getDb()
      .prepare(
        `SELECT normalized_tag, region_code, relevance_language, search_shape_version,
                approximate_count, retrieved_at, expires_at, error_category
           FROM youtube_hashtag_count_cache
          WHERE normalized_tag = :normalizedTag
            AND region_code = :regionCode
            AND relevance_language = :relevanceLanguage
            AND search_shape_version = :searchShapeVersion
            AND expires_at > :now`
      )
      .get({ ...keyParams(key), now: now.toISOString() }) as SqliteCacheRow | undefined;
    return mapRow(row);
  },

  saveResult(input: { key: YouTubeHashtagCacheKey; approximateCount: number; retrievedAt: Date; expiresAt: Date }): YouTubeHashtagCacheRow {
    const row = {
      ...input.key,
      approximateCount: Math.max(0, Math.min(1_000_000, Math.trunc(input.approximateCount))),
      retrievedAt: input.retrievedAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    };
    getDb()
      .prepare(
        `INSERT INTO youtube_hashtag_count_cache
          (normalized_tag, region_code, relevance_language, search_shape_version,
           approximate_count, retrieved_at, expires_at, error_category)
         VALUES (:normalizedTag, :regionCode, :relevanceLanguage, :searchShapeVersion,
                 :approximateCount, :retrievedAt, :expiresAt, NULL)
         ON CONFLICT(normalized_tag, region_code, relevance_language, search_shape_version)
         DO UPDATE SET approximate_count = excluded.approximate_count,
                       retrieved_at = excluded.retrieved_at,
                       expires_at = excluded.expires_at,
                       error_category = NULL`
      )
      .run(row);
    return { ...row, errorCategory: null };
  },

  saveError(input: { key: YouTubeHashtagCacheKey; errorCategory: string; retrievedAt: Date; expiresAt: Date }): void {
    getDb()
      .prepare(
        `INSERT INTO youtube_hashtag_count_cache
          (normalized_tag, region_code, relevance_language, search_shape_version,
           approximate_count, retrieved_at, expires_at, error_category)
         VALUES (:normalizedTag, :regionCode, :relevanceLanguage, :searchShapeVersion,
                 0, :retrievedAt, :expiresAt, :errorCategory)
         ON CONFLICT(normalized_tag, region_code, relevance_language, search_shape_version)
         DO UPDATE SET retrieved_at = excluded.retrieved_at,
                       expires_at = excluded.expires_at,
                       error_category = excluded.error_category`
      )
      .run({ ...input.key, retrievedAt: input.retrievedAt.toISOString(), expiresAt: input.expiresAt.toISOString() });
  },

  admit(callerClass: HashtagCallerClass, quotaDate: string, limit: number): boolean {
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          `INSERT INTO youtube_hashtag_quota_admissions (quota_date, caller_class, admitted_count)
           VALUES (:quotaDate, :callerClass, 1)
           ON CONFLICT(quota_date, caller_class) DO UPDATE SET admitted_count = admitted_count + 1
             WHERE admitted_count < :limit`
        )
        .run({ quotaDate, callerClass, limit });
      db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  getAdmissionCount(callerClass: HashtagCallerClass, quotaDate: string): number {
    const row = getDb()
      .prepare("SELECT admitted_count FROM youtube_hashtag_quota_admissions WHERE quota_date = ? AND caller_class = ?")
      .get(quotaDate, callerClass) as { admitted_count?: number } | undefined;
    return row?.admitted_count ?? 0;
  },
});

export type YouTubeHashtagCacheRepository = ReturnType<typeof createYouTubeHashtagCacheRepository>;

export const defaultHashtagCacheKey = (normalizedTag: string): YouTubeHashtagCacheKey => ({
  normalizedTag,
  regionCode: config.youtube.hashtagAuthoring.regionCode,
  relevanceLanguage: config.youtube.hashtagAuthoring.relevanceLanguage,
  searchShapeVersion: "v1",
});
