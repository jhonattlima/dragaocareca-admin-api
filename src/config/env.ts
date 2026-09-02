import path from "node:path";
import dotenv from "dotenv";

const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : process.env.NODE_ENV === "development"
      ? ".env.dev"
      : ".env";

dotenv.config({ path: envFile, quiet: true });

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const parseTrailerVideoMaxBytes = (value: string | undefined): number => {
  if (value === undefined || value === "") {
    return 500 * 1024 * 1024;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("EPISODE_TRAILER_VIDEO_MAX_BYTES must be a positive integer");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("EPISODE_TRAILER_VIDEO_MAX_BYTES must be a positive integer");
  }

  return parsed;
};

const boundedPositiveInteger = (value: string | undefined, defaultValue: number, name: string, maximum: number): number => {
  if (value === undefined || value === "") return defaultValue;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
};

const boundedNonNegativeInteger = (value: string | undefined, defaultValue: number, name: string, maximum: number): number => {
  if (value === undefined || value === "") return defaultValue;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${name} must be a non-negative integer no greater than ${maximum}`);
  }
  return parsed;
};

const parseBoolean = (value: string | undefined, defaultValue = false): boolean =>
  value === undefined ? defaultValue : value.toLowerCase() === "true";

const parsePromotionRetryDelays = (env: Record<string, string | undefined>): [number, number, number, number] => [
  boundedPositiveInteger(env.PROMOTION_RETRY_DELAY_1_MS, 1_000, "PROMOTION_RETRY_DELAY_1_MS", 3_600_000),
  boundedPositiveInteger(env.PROMOTION_RETRY_DELAY_2_MS, 5_000, "PROMOTION_RETRY_DELAY_2_MS", 3_600_000),
  boundedPositiveInteger(env.PROMOTION_RETRY_DELAY_3_MS, 30_000, "PROMOTION_RETRY_DELAY_3_MS", 3_600_000),
  boundedPositiveInteger(env.PROMOTION_RETRY_DELAY_4_MS, 300_000, "PROMOTION_RETRY_DELAY_4_MS", 3_600_000),
];

const promotionEnabled = parseBoolean(process.env.PROMOTION_ENABLED);
const legacyLaunchEnabled = parseBoolean(process.env.PROMOTION_LEGACY_LAUNCH_ENABLED, true);

export type HashtagAuthoringConfig = {
  enabled: boolean;
  provider: "gemini" | "groq";
  primaryProvider: "gemini" | "groq";
  geminiModel: string;
  groqModel: string;
  geminiPromptVersion: string;
  cacheSuccessTtlMs: number;
  cacheZeroResultTtlMs: number;
  lookupLaneCount: 1;
  automaticDailyCalls: 90;
  manualDailyCalls: 10;
  regionCode: string;
  relevanceLanguage: string;
  requestTimeoutMs: number;
  retryDelaysMs: [number, number, number, number];
};

type HashtagAuthoringEnv = Record<string, string | undefined>;

export const parseHashtagAuthoringConfig = (env: HashtagAuthoringEnv = process.env): HashtagAuthoringConfig => {
  const automaticDailyCalls = boundedPositiveInteger(
    env.YOUTUBE_HASHTAG_AUTOMATIC_DAILY_CALLS,
    90,
    "YOUTUBE_HASHTAG_AUTOMATIC_DAILY_CALLS",
    90
  );
  const manualDailyCalls = boundedPositiveInteger(
    env.YOUTUBE_HASHTAG_MANUAL_DAILY_CALLS,
    10,
    "YOUTUBE_HASHTAG_MANUAL_DAILY_CALLS",
    10
  );
  if (automaticDailyCalls + manualDailyCalls !== 100) {
    throw new Error("YOUTUBE_HASHTAG_AUTOMATIC_DAILY_CALLS and YOUTUBE_HASHTAG_MANUAL_DAILY_CALLS must total 100");
  }

  const lookupLaneCount = boundedPositiveInteger(env.YOUTUBE_HASHTAG_LOOKUP_LANE_COUNT, 1, "YOUTUBE_HASHTAG_LOOKUP_LANE_COUNT", 1);
  if (lookupLaneCount !== 1) {
    throw new Error("YOUTUBE_HASHTAG_LOOKUP_LANE_COUNT must be 1");
  }

  return {
    enabled: (env.YOUTUBE_HASHTAG_AUTHORING_ENABLED ?? "false").toLowerCase() === "true",
    provider: (env.YOUTUBE_HASHTAG_PROVIDER ?? env.EPISODE_SUMMARY_PROVIDER ?? "groq").toLowerCase() === "gemini" ? "gemini" : "groq",
    primaryProvider: (env.YOUTUBE_HASHTAG_PRIMARY_PROVIDER ?? env.YOUTUBE_HASHTAG_PROVIDER ?? "gemini").toLowerCase() === "gemini" ? "gemini" : "groq",
    geminiModel: env.YOUTUBE_HASHTAG_GEMINI_MODEL ?? "gemini-3.6-flash",
    groqModel: env.YOUTUBE_HASHTAG_GROQ_MODEL ?? env.EPISODE_SUMMARY_GROQ_MODEL ?? "openai/gpt-oss-120b",
    geminiPromptVersion: env.YOUTUBE_HASHTAG_GEMINI_PROMPT_VERSION ?? "1",
    cacheSuccessTtlMs: boundedPositiveInteger(
      env.YOUTUBE_HASHTAG_CACHE_SUCCESS_TTL_MS,
      60 * 60 * 1000,
      "YOUTUBE_HASHTAG_CACHE_SUCCESS_TTL_MS",
      7 * 24 * 60 * 60 * 1000
    ),
    cacheZeroResultTtlMs: boundedPositiveInteger(
      env.YOUTUBE_HASHTAG_CACHE_ZERO_RESULT_TTL_MS,
      60 * 60 * 1000,
      "YOUTUBE_HASHTAG_CACHE_ZERO_RESULT_TTL_MS",
      7 * 24 * 60 * 60 * 1000
    ),
    lookupLaneCount: 1,
    automaticDailyCalls: 90,
    manualDailyCalls: 10,
    regionCode: env.YOUTUBE_HASHTAG_REGION_CODE ?? "BR",
    relevanceLanguage: env.YOUTUBE_HASHTAG_RELEVANCE_LANGUAGE ?? "pt",
    requestTimeoutMs: boundedPositiveInteger(
      env.YOUTUBE_HASHTAG_REQUEST_TIMEOUT_MS,
      15_000,
      "YOUTUBE_HASHTAG_REQUEST_TIMEOUT_MS",
      120_000
    ),
    retryDelaysMs: [
      boundedPositiveInteger(env.YOUTUBE_HASHTAG_RETRY_DELAY_1_MS, 60_000, "YOUTUBE_HASHTAG_RETRY_DELAY_1_MS", 3_600_000),
      boundedPositiveInteger(env.YOUTUBE_HASHTAG_RETRY_DELAY_2_MS, 300_000, "YOUTUBE_HASHTAG_RETRY_DELAY_2_MS", 3_600_000),
      boundedPositiveInteger(env.YOUTUBE_HASHTAG_RETRY_DELAY_3_MS, 900_000, "YOUTUBE_HASHTAG_RETRY_DELAY_3_MS", 3_600_000),
      boundedPositiveInteger(env.YOUTUBE_HASHTAG_RETRY_DELAY_4_MS, 3_600_000, "YOUTUBE_HASHTAG_RETRY_DELAY_4_MS", 3_600_000),
    ],
  };
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  sqlitePath: process.env.SQLITE_PATH ?? path.resolve(process.cwd(), "data", "database", "dragaocareca-admin.sqlite"),
  sqliteReset: (process.env.SQLITE_RESET ?? "false").toLowerCase() === "true",
  auth: {
    bypassInDev: (process.env.AUTH_BYPASS ?? "false").toLowerCase() === "true",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    jwtSecret: process.env.JWT_SECRET ?? "",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
    allowedGoogleEmails: (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    apiBaseUrl: process.env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org",
    pollIntervalMs: Number(process.env.TELEGRAM_POLL_INTERVAL_MS ?? 60000),
    ytDlpCommand: process.env.TELEGRAM_YTDLP_COMMAND ?? "yt-dlp",
  },
  promotion: {
    enabled: promotionEnabled,
    botUrl: process.env.PROMOTION_BOT_URL ?? "http://bot:8080/internal/promotions",
    launchNotificationBotUrl: process.env.LAUNCH_NOTIFICATION_BOT_URL ?? "http://bot:3001/internal/launch-notifications",
    sharedSecret: process.env.PROMOTION_SHARED_SECRET ?? "",
    sharedSecretConfigured: Boolean(process.env.PROMOTION_SHARED_SECRET),
    requestTimeoutMs: boundedPositiveInteger(process.env.PROMOTION_REQUEST_TIMEOUT_MS, 10_000, "PROMOTION_REQUEST_TIMEOUT_MS", 120_000),
    retryAttempts: boundedPositiveInteger(process.env.PROMOTION_RETRY_ATTEMPTS, 5, "PROMOTION_RETRY_ATTEMPTS", 20),
    retryBackoffMs: parsePromotionRetryDelays(process.env),
    pollIntervalMs: boundedPositiveInteger(process.env.PROMOTION_POLL_INTERVAL_MS, 30_000, "PROMOTION_POLL_INTERVAL_MS", 3_600_000),
    legacyLaunchEnabled,
    activeOwner: promotionEnabled ? "promotion" as const : legacyLaunchEnabled ? "legacy-launch" as const : "none" as const,
  },
  spotify: {
    enabled: (process.env.SPOTIFY_METRICS_ENABLED ?? "false").toLowerCase() === "true",
    podcastId: process.env.SPOTIFY_PODCAST_ID ?? "",
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    spDc: process.env.SPOTIFY_SP_DC ?? "",
    spKey: process.env.SPOTIFY_SP_KEY ?? "",
    baseUrl: process.env.SPOTIFY_METRICS_BASE_URL ?? "https://generic.wg.spotify.com/podcasters/v0",
    timeoutMs: Number(process.env.SPOTIFY_METRICS_TIMEOUT_MS ?? 15000),
    sampleIntervalMs: Number(process.env.SPOTIFY_METRICS_SAMPLE_INTERVAL_MS ?? 86400000),
  },
  youtube: {
    enabled: (process.env.YOUTUBE_METRICS_ENABLED ?? "false").toLowerCase() === "true",
    clientId: process.env.YOUTUBE_CLIENT_ID ?? "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN ?? "",
    channelId: process.env.YOUTUBE_CHANNEL_ID ?? "",
    baseUrl: process.env.YOUTUBE_ANALYTICS_BASE_URL ?? "https://youtubeanalytics.googleapis.com/v2",
    dataBaseUrl: process.env.YOUTUBE_DATA_BASE_URL ?? "https://youtube.googleapis.com/youtube/v3",
    timeZone: process.env.YOUTUBE_METRICS_TIME_ZONE ?? "America/Sao_Paulo",
    timeoutMs: Number(process.env.YOUTUBE_METRICS_TIMEOUT_MS ?? 15000),
    sampleIntervalMs: Number(process.env.YOUTUBE_METRICS_SAMPLE_INTERVAL_MS ?? 86400000),
    hashtagAuthoring: parseHashtagAuthoringConfig(),
    trailerJob: {
      enabled: (process.env.YOUTUBE_TRAILER_JOB_ENABLED ?? "false").toLowerCase() === "true",
      providerTimeoutMs: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_PROVIDER_TIMEOUT_MS, 30_000, "YOUTUBE_TRAILER_JOB_PROVIDER_TIMEOUT_MS", 300_000),
      processingPollIntervalMs: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_PROCESSING_POLL_INTERVAL_MS, 60_000, "YOUTUBE_TRAILER_JOB_PROCESSING_POLL_INTERVAL_MS", 3_600_000),
      retryInitialDelayMs: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_RETRY_INITIAL_DELAY_MS, 60_000, "YOUTUBE_TRAILER_JOB_RETRY_INITIAL_DELAY_MS", 900_000),
      retryMaxDelayMs: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_RETRY_MAX_DELAY_MS, 900_000, "YOUTUBE_TRAILER_JOB_RETRY_MAX_DELAY_MS", 3_600_000),
      retryAttempts: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_RETRY_ATTEMPTS, 5, "YOUTUBE_TRAILER_JOB_RETRY_ATTEMPTS", 20),
      workerCount: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_WORKER_COUNT, 1, "YOUTUBE_TRAILER_JOB_WORKER_COUNT", 1),
      chunkBytes: boundedPositiveInteger(process.env.YOUTUBE_TRAILER_JOB_CHUNK_BYTES, 8 * 1024 * 1024, "YOUTUBE_TRAILER_JOB_CHUNK_BYTES", 32 * 1024 * 1024),
    },
    trailerPublication: {
      enabled: (process.env.YOUTUBE_TRAILER_PUBLICATION_ENABLED ?? "false").toLowerCase() === "true",
      channelId: "UCq-TjauoYJrr3po121gA6iw",
      playlistId: "PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t",
      requiredScopes: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.force-ssl",
      ] as const,
      retentionKeepCount: boundedNonNegativeInteger(
        process.env.YOUTUBE_TRAILER_RETENTION_KEEP_COUNT,
        12,
        "YOUTUBE_TRAILER_RETENTION_KEEP_COUNT",
        10_000,
      ),
    },
  },
  meta: {
    graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v25.0",
    userAccessToken: process.env.META_USER_ACCESS_TOKEN ?? "",
    pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN ?? "",
    systemUserAccessToken: process.env.META_SYSTEM_USER_ACCESS_TOKEN ?? "",
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    pageId: process.env.META_PAGE_ID ?? "",
    instagramAccountId: process.env.META_INSTAGRAM_ACCOUNT_ID ?? "",
    instagramEnabled: parseBoolean(process.env.META_INSTAGRAM_ENABLED),
    facebookReelEnabled: parseBoolean(process.env.META_FACEBOOK_REEL_ENABLED),
    providerMediaBaseUrl: process.env.META_PROVIDER_MEDIA_BASE_URL ?? "https://api.dragaocareca.com/media/episodes",
    providerMediaEpisodeId: Number(process.env.META_PROVIDER_MEDIA_EPISODE_ID ?? 0),
    providerMediaExposureEnabled: parseBoolean(process.env.META_PROVIDER_MEDIA_EXPOSURE_ENABLED),
  },
  transcription: {
    enabled: (process.env.EPISODE_TRANSCRIPTION_ENABLED ?? "false").toLowerCase() === "true",
    provider: process.env.EPISODE_TRANSCRIPTION_PROVIDER ?? "internal",
    command: process.env.EPISODE_TRANSCRIPTION_COMMAND ?? "whisper-cli",
    modelPath: process.env.EPISODE_TRANSCRIPTION_MODEL_PATH ?? "",
    language: process.env.EPISODE_TRANSCRIPTION_LANGUAGE ?? "pt",
    whisperThreads: Number(process.env.EPISODE_TRANSCRIPTION_WHISPER_THREADS ?? 4),
    fasterWhisperPython: process.env.EPISODE_TRANSCRIPTION_FASTER_WHISPER_PYTHON ?? "python3",
    fasterWhisperScript: process.env.EPISODE_TRANSCRIPTION_FASTER_WHISPER_SCRIPT ?? path.resolve(process.cwd(), "scripts/faster_whisper_transcribe.py"),
    fasterWhisperModel: process.env.EPISODE_TRANSCRIPTION_FASTER_WHISPER_MODEL ?? "small",
    fasterWhisperDevice: process.env.EPISODE_TRANSCRIPTION_FASTER_WHISPER_DEVICE ?? "cpu",
    fasterWhisperComputeType: process.env.EPISODE_TRANSCRIPTION_FASTER_WHISPER_COMPUTE_TYPE ?? "int8",
    timeoutMs: Number(process.env.EPISODE_TRANSCRIPTION_TIMEOUT_MS ?? 7200000),
    pollIntervalMs: Number(process.env.EPISODE_TRANSCRIPTION_POLL_INTERVAL_MS ?? 300000),
    geminiModel: process.env.EPISODE_TRANSCRIPTION_GEMINI_MODEL ?? "gemini-3.6-flash",
    geminiMaxOutputTokens: Number(process.env.EPISODE_TRANSCRIPTION_GEMINI_MAX_OUTPUT_TOKENS ?? 32768),
    geminiThinkingLevel: process.env.EPISODE_TRANSCRIPTION_GEMINI_THINKING_LEVEL ?? "minimal",
    groqModel: process.env.EPISODE_TRANSCRIPTION_GROQ_MODEL ?? "whisper-large-v3-turbo",
  },
  summary: {
    enabled: (process.env.EPISODE_SUMMARY_ENABLED ?? "false").toLowerCase() === "true",
    provider: process.env.EPISODE_SUMMARY_PROVIDER ?? "groq",
    primaryProvider: process.env.EPISODE_SUMMARY_PRIMARY_PROVIDER ?? process.env.EPISODE_SUMMARY_PROVIDER ?? "groq",
    command: process.env.EPISODE_SUMMARY_COMMAND ?? "llama-cli",
    modelPath: process.env.EPISODE_SUMMARY_MODEL_PATH ?? "",
    contextSize: Number(process.env.EPISODE_SUMMARY_CONTEXT_SIZE ?? 3072),
    maxTokens: Number(process.env.EPISODE_SUMMARY_MAX_TOKENS ?? 700),
    timeoutMs: Number(process.env.EPISODE_SUMMARY_TIMEOUT_MS ?? 900000),
    promptVersion: process.env.EPISODE_SUMMARY_PROMPT_VERSION ?? "4",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    geminiModel: process.env.EPISODE_SUMMARY_GEMINI_MODEL ?? "gemini-3.6-flash",
    geminiApiBaseUrl: process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
    geminiThinkingLevel: process.env.EPISODE_SUMMARY_GEMINI_THINKING_LEVEL ?? "low",
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    groqModel: process.env.EPISODE_SUMMARY_GROQ_MODEL ?? "openai/gpt-oss-120b",
    groqApiBaseUrl: process.env.GROQ_API_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  feed: {
    baseLink: required(process.env.FEED_BASE_LINK, "FEED_BASE_LINK"),
    audioBase: required(process.env.FEED_AUDIO_BASE, "FEED_AUDIO_BASE"),
    audioTrackerPrefix: process.env.FEED_AUDIO_TRACKER_PREFIX ?? "",
    imageBase: required(process.env.FEED_IMAGE_BASE, "FEED_IMAGE_BASE"),
    title: required(process.env.FEED_TITLE, "FEED_TITLE"),
    description: required(process.env.FEED_DESCRIPTION, "FEED_DESCRIPTION"),
    site: required(process.env.FEED_SITE, "FEED_SITE"),
    language: process.env.FEED_LANGUAGE ?? "pt-BR",
    selfUrl: process.env.FEED_SELF_URL ?? "https://www.feed.dragaocareca.com/",
    defaultImage: process.env.FEED_DEFAULT_IMAGE ?? "https://www.dragaocareca.com/files/images/2026-04-10-v4.jpeg",
    copyright: process.env.FEED_COPYRIGHT ?? "© Dragao Careca - 2019 ©",
    generator: process.env.FEED_GENERATOR ?? "go podcast v1.3.1 (github.com/eduncan911/podcast)",
    managingEditor: process.env.FEED_MANAGING_EDITOR ?? "dragaocarecaoficial@gmail.com (Dragao Careca)",
    categoryList: (process.env.FEED_CATEGORY_LIST ?? "Comedy,Games,RPG")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    itunesAuthor: process.env.FEED_ITUNES_AUTHOR ?? "dragaocarecaoficial@gmail.com (Dragao Careca)",
    itunesSummary:
      process.env.FEED_ITUNES_SUMMARY ??
      "Um podcast de entretenimento onde aventureiros contam historias e desbravam a cultura pop com muito humor, nostalgia e entrevistas curiosas.",
    itunesSubtitle: process.env.FEED_ITUNES_SUBTITLE ?? "Podcast sobre RPG, Filmes, Series e outros assuntos nerd.",
    itunesExplicit: process.env.FEED_ITUNES_EXPLICIT ?? "no",
    itunesType: process.env.FEED_ITUNES_TYPE ?? "episodic",
    itunesOwnerName: process.env.FEED_ITUNES_OWNER_NAME ?? "Jhonatt Lima e Diego Broniszak",
    itunesOwnerEmail: process.env.FEED_ITUNES_OWNER_EMAIL ?? "dragaocarecaoficial@gmail.com",
    itunesKeywords: process.env.FEED_ITUNES_KEYWORDS ?? "Entertainment,Games,Fiction",
    itunesCategoryPrimary: process.env.FEED_ITUNES_CATEGORY_PRIMARY ?? "Comedy",
    itunesCategoryPrimarySub: process.env.FEED_ITUNES_CATEGORY_PRIMARY_SUB ?? "Improv",
    itunesCategorySecondary: process.env.FEED_ITUNES_CATEGORY_SECONDARY ?? "Leisure",
    itunesCategorySecondarySub: process.env.FEED_ITUNES_CATEGORY_SECONDARY_SUB ?? "Games",
  },
  public: {
    supportersLink: process.env.PUBLIC_SUPPORTERS_LINK ?? "http://bit.ly/guildadc",
    supportersDataFile:
      process.env.PUBLIC_SUPPORTERS_DATA_FILE ??
      path.resolve(process.cwd(), "data", "public", "supporters.json"),
    aboutTitle: process.env.PUBLIC_ABOUT_TITLE ?? "Dragão Careca",
    aboutDescription:
      process.env.PUBLIC_ABOUT_DESCRIPTION ??
      "Dragão Careca é um podcast de humor com temática de RPG, cultura pop e aventuras improvisadas.",
    email: process.env.PUBLIC_EMAIL ?? "dragaocarecaoficial@gmail.com",
    characterSheetsBaseUrl: process.env.PUBLIC_CHARACTER_SHEETS_BASE_URL ?? "https://ficha.dragaocareca.com/#",
    maxEpisodesPerPage: Number(process.env.PUBLIC_MAX_EPISODES_PER_PAGE ?? 10),
    transitionTimeMs: Number(process.env.PUBLIC_TRANSITION_TIME_MS ?? 7000),
    disqusShortName: process.env.PUBLIC_DISQUS_SHORT_NAME ?? "dragaocareca",
    social: {
      twitter: process.env.PUBLIC_SOCIAL_TWITTER ?? "https://twitter.com/Dragao_Careca",
      youtube:
        process.env.PUBLIC_SOCIAL_YOUTUBE ??
        "https://www.youtube.com/channel/UCq-TjauoYJrr3po121gA6iw?sub_confirmation=1",
      instagram: process.env.PUBLIC_SOCIAL_INSTAGRAM ?? "https://www.instagram.com/dragaocareca",
      facebook: process.env.PUBLIC_SOCIAL_FACEBOOK ?? "https://www.facebook.com/dragaocareca",
      spotify: process.env.PUBLIC_SOCIAL_SPOTIFY ?? "https://open.spotify.com/show/4uTtWo6e9TIDnAy5r6UWIZ",
      deezer: process.env.PUBLIC_SOCIAL_DEEZER ?? "https://www.deezer.com/br/show/615692",
      googlePodcasts:
        process.env.PUBLIC_SOCIAL_GOOGLE_PODCASTS ??
        "https://podcasts.google.com/?feed=aHR0cDovL2ZlZWQuZHJhZ2FvY2FyZWNhLmNvbS8",
      applePodcasts:
        process.env.PUBLIC_SOCIAL_APPLE_PODCASTS ??
        "https://podcasts.apple.com/br/podcast/drag%C3%A3o-careca/id1482299800",
      pocketCast: process.env.PUBLIC_SOCIAL_POCKET_CAST ?? "https://pca.st/17w8yhs3",
      castBox: process.env.PUBLIC_SOCIAL_CASTBOX ?? "https://castbox.fm/ch/2414107",
      rss: process.env.PUBLIC_SOCIAL_RSS ?? "https://feed.dragaocareca.com",
    },
    contactsDataFile:
      process.env.PUBLIC_CONTACTS_DATA_FILE ??
      path.resolve(process.cwd(), "data", "public", "contacts.json"),
  },
  media: {
    trailerVideoMaxBytes: parseTrailerVideoMaxBytes(process.env.EPISODE_TRAILER_VIDEO_MAX_BYTES),
    storageRoot: process.env.MEDIA_STORAGE_ROOT ?? path.resolve(process.cwd(), "data", "media"),
    backupRoot:
      process.env.MEDIA_BACKUP_ROOT ??
      path.resolve(process.env.MEDIA_STORAGE_ROOT ?? path.resolve(process.cwd(), "data", "media"), "backups"),
    episodesDir:
      process.env.MEDIA_EPISODES_DIR ??
      path.resolve(process.env.MEDIA_STORAGE_ROOT ?? path.resolve(process.cwd(), "data", "media"), "episodes"),
    episodesStagingDir:
      process.env.MEDIA_EPISODES_STAGING_DIR ??
      path.resolve(process.env.MEDIA_STORAGE_ROOT ?? path.resolve(process.cwd(), "data", "media"), "staging"),
    backupEpisodesDir:
      process.env.MEDIA_BACKUP_EPISODES_DIR ??
      path.resolve(process.env.MEDIA_BACKUP_ROOT ?? path.resolve(process.cwd(), "data", "media"), "backups"),
  },
};
