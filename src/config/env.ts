import path from "node:path";
import dotenv from "dotenv";

const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : process.env.NODE_ENV === "development"
      ? ".env.dev"
      : ".env";

dotenv.config({ path: envFile });

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
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
  },
  transcription: {
    enabled: (process.env.EPISODE_TRANSCRIPTION_ENABLED ?? "false").toLowerCase() === "true",
    command: process.env.EPISODE_TRANSCRIPTION_COMMAND ?? "whisper-cli",
    modelPath: process.env.EPISODE_TRANSCRIPTION_MODEL_PATH ?? "",
    language: process.env.EPISODE_TRANSCRIPTION_LANGUAGE ?? "pt",
    timeoutMs: Number(process.env.EPISODE_TRANSCRIPTION_TIMEOUT_MS ?? 7200000),
    pollIntervalMs: Number(process.env.EPISODE_TRANSCRIPTION_POLL_INTERVAL_MS ?? 300000),
  },
  summary: {
    enabled: (process.env.EPISODE_SUMMARY_ENABLED ?? "false").toLowerCase() === "true",
    command: process.env.EPISODE_SUMMARY_COMMAND ?? "llama-cli",
    modelPath: process.env.EPISODE_SUMMARY_MODEL_PATH ?? "",
    contextSize: Number(process.env.EPISODE_SUMMARY_CONTEXT_SIZE ?? 4096),
    maxTokens: Number(process.env.EPISODE_SUMMARY_MAX_TOKENS ?? 256),
    timeoutMs: Number(process.env.EPISODE_SUMMARY_TIMEOUT_MS ?? 900000),
    promptVersion: process.env.EPISODE_SUMMARY_PROMPT_VERSION ?? "1",
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
    managingEditor: process.env.FEED_MANAGING_EDITOR ?? "contato@dragaocareca.com (Dragao Careca)",
    categoryList: (process.env.FEED_CATEGORY_LIST ?? "Comedy,Games,RPG")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    itunesAuthor: process.env.FEED_ITUNES_AUTHOR ?? "contato@dragaocareca.com (Dragao Careca)",
    itunesSummary:
      process.env.FEED_ITUNES_SUMMARY ??
      "Um podcast de entretenimento onde aventureiros contam historias e desbravam a cultura pop com muito humor, nostalgia e entrevistas curiosas.",
    itunesSubtitle: process.env.FEED_ITUNES_SUBTITLE ?? "Podcast sobre RPG, Filmes, Series e outros assuntos nerd.",
    itunesExplicit: process.env.FEED_ITUNES_EXPLICIT ?? "no",
    itunesType: process.env.FEED_ITUNES_TYPE ?? "episodic",
    itunesOwnerName: process.env.FEED_ITUNES_OWNER_NAME ?? "Jhonatt Lima e Diego Broniszak",
    itunesOwnerEmail: process.env.FEED_ITUNES_OWNER_EMAIL ?? "contato@dragaocareca.com",
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
    email: process.env.PUBLIC_EMAIL ?? "contato@dragaocareca.com",
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
