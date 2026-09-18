import { create } from "xmlbuilder2";
import { config } from "../config/env";
import type { EpisodeRow } from "../database/repositories/episode.repository";

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
  const configuredBase = config.feed.audioBase;
  // Media files are now served from the canonical per-episode layout. Keep
  // accepting legacy configuration/file names, but never emit a dead /files
  // URL in the feed.
  const canonicalBase = configuredBase.replace(/\/files(?=\/|$)/u, "/media");
  const direct = /\/media(?:\/|$)/u.test(canonicalBase)
    ? `${canonicalBase.replace(/\/episodes\/?$/u, "").replace(/\/+$/u, "")}/episodes/${episodeId}/audio.mp3`
    : `${canonicalBase}${fileName ?? `episode_${episodeId}.mp3`}`;
  const trackerPrefix = config.feed.audioTrackerPrefix.trim();
  if (!trackerPrefix) return direct;

  // Podtrac's redirect prefix expects the origin URL without its scheme:
  // redirect.mp3/example.com/path.mp3, not redirect.mp3/https://example.com/.
  return `${trackerPrefix}${direct.replace(/^https?:\/\//u, "")}`;
};

const imageUrl = (coverFileName: string | undefined, episodeId: number): string => {
  const configuredBase = config.feed.imageBase;
  const canonicalBase = configuredBase.replace(/\/files(?=\/|$)/u, "/media");
  if (/\/media(?:\/|$)/u.test(canonicalBase)) {
    return `${canonicalBase.replace(/\/episodes\/?$/u, "").replace(/\/+$/u, "")}/episodes/${episodeId}/cover.jpeg`;
  }
  return `${canonicalBase}${coverFileName ?? `episode_${episodeId}.jpeg`}`;
};

const AUTHOR_CONTACTS: Record<string, { character: string; links: Array<[string, string]> }> = {
  "Jhonatt Lima": { character: "Tiamat", links: [["instagram", "https://www.instagram.com/jhonattlima"]] },
  "Gabriel Moraes": { character: "Galdrim", links: [["instagram", "https://www.instagram.com/gaabrielrmoraes"]] },
  "Diego Broniszak": { character: "Troah", links: [["instagram", "https://www.instagram.com/troah_o_bardo"]] },
  "Eric Farias": { character: "Bron", links: [["instagram", "https://www.instagram.com/eric_frs"]] },
  "Jader Brasil": { character: "Baldur", links: [["facebook", "https://www.facebook.com/jader.eb"], ["twitter", "https://www.twitter.com/balduroficial"]] },
  "Eduardo Montenegro": { character: "Aldabonero", links: [["instagram", "https://www.instagram.com/emontenegroo"]] },
  "Luísa Zelmanowicz": { character: "Lusa", links: [["instagram", "https://www.instagram.com/luzelmanowicz"]] },
  "Walquiria Lima": { character: "Wal", links: [["instagram", "https://www.instagram.com/wal_killer"]] },
  "Diogo Truylio": { character: "Aurin", links: [["instagram", "https://www.instagram.com/diogarts"]] },
  "Vicente Raiol": { character: "Kavartu", links: [["facebook", "https://www.facebook.com/vicente.raioI"]] },
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const safeUrl = (value: string): string => /^https?:\/\//u.test(value.trim()) ? value.trim() : "";

const linksHtml = (links: Array<[string, string]>): string => links
  .map(([label, url]) => {
    const href = safeUrl(url);
    return href ? ` <a href="${escapeHtml(href)}">[${escapeHtml(label)}]</a>` : "";
  }).join("");

const creditSection = (heading: string, rows: string[]): string => rows.length > 0
  ? `<p><h3>${heading}</h3></p> ${rows.map((row) => `<p>${row}</p>`).join("")}`
  : "";

const structuredMusicCredit = (value: string): { name: string; links: Array<[string, string]> } | null => {
  try {
    const parsed = JSON.parse(value) as { name?: unknown; links?: unknown };
    if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    const links = Array.isArray(parsed.links) ? parsed.links.flatMap((link) => {
      if (!link || typeof link !== "object") return [];
      const label = typeof (link as { label?: unknown }).label === "string" ? (link as { label: string }).label : "link";
      let url = typeof (link as { url?: unknown }).url === "string" ? (link as { url: string }).url : "";
      url = url.replace(/^Link:\s*/iu, "").trim();
      return url ? [[label, url] as [string, string]] : [];
    }) : [];
    return { name: parsed.name.trim(), links };
  } catch {
    return value.trim() ? { name: value.trim(), links: [] } : null;
  }
};

const episodeDescription = (episode: Pick<EpisodeRow, "summary" | "authors" | "guests" | "coverCredits" | "musicCredits">): string => {
  const supportCallout = `🐉 Guilda do Dragão Careca 🐉: Torne-se um integrante da nossa guilda! Descubra sobre os cargos e recompensas: ${config.public.supportersLink}`;
  const body = episode.summary?.trim() ? `<p>${escapeHtml(episode.summary.trim()).replace(/\r?\n/g, "<br>")}</p>` : "";
  const guests = episode.guests.map((name) => {
    const contact = AUTHOR_CONTACTS[name];
    return `${escapeHtml(name)}${contact ? `: ${linksHtml(contact.links)}` : ""}`;
  });
  const covers = episode.coverCredits.map((name) => {
    const contact = AUTHOR_CONTACTS[name];
    return `${escapeHtml(name)}${contact ? `: ${linksHtml(contact.links)}` : ""}`;
  });
  const music = episode.musicCredits.flatMap((value) => {
    const credit = structuredMusicCredit(value);
    return credit ? [`${escapeHtml(credit.name)}:${linksHtml(credit.links)}`] : [];
  });
  const authors = episode.authors.map((name) => {
    const contact = AUTHOR_CONTACTS[name];
    return `${escapeHtml(name)}${contact ? ` - ${escapeHtml(contact.character)}:${linksHtml(contact.links)}` : ""}`;
  });
  const credits = [
    creditSection("👤 Convidadas & convidados 👤", guests),
    creditSection("🎨 Arte de Capa 🎨", covers),
    creditSection("🎵 Créditos das Músicas 🎵", music),
    creditSection("✒️ Autores ✒️", authors),
  ].filter(Boolean).join("");
  const footer = `<p>🏰 Site 🏰: Venha saber mais sobre a gente e nossas aventuras! Clique <a href="${escapeHtml(config.feed.site)}">aqui!</a></p><p>✉️ Contato ✉️: <a href="mailto:contato@dragaocarecaoficial@gmail.com">dragaocarecaoficial@gmail.com</a></p>`;
  return `${escapeHtml(supportCallout)}${body}${footer}${credits}`;
};

const normalizeLegacySnapshotMedia = (xmlSnapshot: string, episodeId: number): string => {
  const canonicalImageBase = config.feed.imageBase.replace(/\/files(?=\/|$)/u, "/media");
  const canonical = `${canonicalImageBase.replace(/\/+$/u, "")}/episodes/${episodeId}/cover.jpeg`;
  const audio = audioUrl(undefined, episodeId);
  return xmlSnapshot
    .replace(/https?:\/\/[^\s"<>]+\/files\/images\/[^\s"<>]+/gu, canonical)
    .replace(/https?:\/\/[^\s"<>]+\/files\/episodes\/[^\s"<>]+/gu, audio);
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
        const legacyItem = create(normalizeLegacySnapshotMedia(ep.xmlSnapshot, ep.episodeId)).root();
        root.import(legacyItem);
        continue;
      } catch {
        // Fall back to mapped fields if legacy XML payload is malformed.
      }
    }

    const item = root.ele("item");
    item.ele("title").txt(ep.title).up();
    const description = episodeDescription(ep);
    item.ele("description").dat(description).up();
    item.ele("guid").txt(audioUrl(ep.fileName, ep.episodeId)).up();
    item.ele("link").txt(`${config.feed.baseLink}${ep.episodeId}`).up();
    item.ele("pubDate").txt(toRfc822(new Date(ep.pubDate))).up();
    if (config.feed.itunesAuthor) item.ele("itunes:author").txt(config.feed.itunesAuthor).up();
    item.ele("itunes:summary").dat(description).up();
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
