import { create } from "xmlbuilder2";
import { config } from "../config/env";
import type { EpisodeRow } from "../repositories/episode.repository";

const toRfc822 = (d: Date): string => d.toUTCString();
const toSaoPauloIso = (d: Date): string => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-03:00`;
};

const audioUrl = (fileName: string | undefined, episodeId: number): string => {
  const direct = `${config.feed.audioBase}${fileName ?? `episode_${episodeId}.mp3`}`;
  return `${config.feed.audioTrackerPrefix}${direct}`;
};

const imageUrl = (coverFileName: string | undefined, episodeId: number): string => {
  return `${config.feed.imageBase}${coverFileName ?? `episode_${episodeId}.jpeg`}`;
};

export const buildFeedXml = (episodes: EpisodeRow[]): string => {
  const latest = episodes[0]?.pubDate ? new Date(episodes[0].pubDate) : new Date();
  const cover = config.feed.defaultImage || imageUrl(episodes[0]?.coverFileName, episodes[0]?.episodeId ?? 1);

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("rss", {
      version: "2.0",
      "xmlns:atom": "http://www.w3.org/2005/Atom",
      "xmlns:itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    })
    .ele("channel");

  root.ele("title").txt(config.feed.title).up();
  root.ele("link").txt(config.feed.site).up();
  root.ele("description").txt(config.feed.description).up();
  for (const category of config.feed.categoryList) {
    root.ele("category").txt(category).up();
  }
  if (config.feed.generator) root.ele("generator").txt(config.feed.generator).up();
  root.ele("language").txt(config.feed.language).up();
  root.ele("lastBuildDate").txt(toRfc822(new Date())).up();
  if (config.feed.managingEditor) root.ele("managingEditor").txt(config.feed.managingEditor).up();
  root.ele("pubDate").txt(toSaoPauloIso(latest)).up();
  if (config.feed.copyright) root.ele("copyright").txt(config.feed.copyright).up();

  const image = root.ele("image");
  image.ele("url").txt(cover).up();
  image.ele("title").txt(config.feed.title).up();
  image.ele("link").txt(config.feed.site).up();
  image.up();

  root.ele("atom:link", {
    href: config.feed.selfUrl,
    rel: "self",
    type: "application/rss+xml",
  }).up();

  if (config.feed.itunesAuthor) root.ele("itunes:author").txt(config.feed.itunesAuthor).up();
  if (config.feed.itunesSummary) root.ele("itunes:summary").txt(config.feed.itunesSummary).up();
  if (config.feed.itunesSubtitle) root.ele("itunes:subtitle").txt(config.feed.itunesSubtitle).up();
  root.ele("itunes:image", { href: cover }).up();
  root.ele("itunes:explicit").txt(config.feed.itunesExplicit).up();
  root.ele("itunes:type").txt(config.feed.itunesType).up();

  if (config.feed.itunesOwnerName || config.feed.itunesOwnerEmail) {
    const owner = root.ele("itunes:owner");
    if (config.feed.itunesOwnerName) owner.ele("itunes:name").txt(config.feed.itunesOwnerName).up();
    if (config.feed.itunesOwnerEmail) owner.ele("itunes:email").txt(config.feed.itunesOwnerEmail).up();
    owner.up();
  }

  if (config.feed.itunesKeywords) root.ele("itunes:keywords").txt(config.feed.itunesKeywords).up();

  if (config.feed.itunesCategoryPrimary) {
    const c1 = root.ele("itunes:category", { text: config.feed.itunesCategoryPrimary });
    if (config.feed.itunesCategoryPrimarySub) c1.ele("itunes:category", { text: config.feed.itunesCategoryPrimarySub }).up();
    c1.up();
  }
  if (config.feed.itunesCategorySecondary) {
    const c2 = root.ele("itunes:category", { text: config.feed.itunesCategorySecondary });
    if (config.feed.itunesCategorySecondarySub) c2.ele("itunes:category", { text: config.feed.itunesCategorySecondarySub }).up();
    c2.up();
  }

  for (const ep of episodes) {
    if (ep.xmlSnapshot) {
      try {
        const sanitizedXml = ep.xmlSnapshot.replace(
          /<title>DC\s+\d+\s*-\s*/i,
          "<title>"
        );
        const legacyItem = create(sanitizedXml).root();
        root.import(legacyItem);
        continue;
      } catch {
        // Fall back to mapped fields if legacy XML payload is malformed.
      }
    }

    const item = root.ele("item");
    item.ele("title").txt(ep.title).up();
    item.ele("description").txt(ep.summary ?? "").up();
    item.ele("guid").txt(audioUrl(ep.fileName, ep.episodeId)).up();
    item.ele("link").txt(`${config.feed.baseLink}${ep.episodeId}`).up();
    item.ele("pubDate").txt(toRfc822(new Date(ep.pubDate))).up();
    if (config.feed.itunesAuthor) item.ele("itunes:author").txt(config.feed.itunesAuthor).up();
    item.ele("itunes:summary").txt(ep.summary ?? "").up();
    item.ele("itunes:episode").txt(String(ep.episodeId)).up();
    item.ele("itunes:explicit").txt(ep.explicit).up();
    if (ep.duration) item.ele("itunes:duration").txt(ep.duration).up();
    item.ele("itunes:image", { href: imageUrl(ep.coverFileName, ep.episodeId) }).up();
    item.ele("enclosure", {
      url: audioUrl(ep.fileName, ep.episodeId),
      type: "audio/mpeg",
      length: String(ep.bytes ?? 0),
    }).up();
    item.up();
  }

  return root.end({ prettyPrint: true });
};
