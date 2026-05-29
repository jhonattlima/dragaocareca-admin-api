import dotenv from "dotenv";

dotenv.config();

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: required(process.env.MONGODB_URI, "MONGODB_URI"),
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
};
