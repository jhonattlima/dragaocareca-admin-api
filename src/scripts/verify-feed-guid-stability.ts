import assert from "node:assert/strict";
import { buildFeedXml } from "../services/feed.service";
import type { EpisodeRow } from "../database/repositories/episode.repository";

const baseEpisode = (episodeId: number): EpisodeRow => ({
  episodeId,
  isDraft: false,
  title: `GUID fixture ${episodeId}`,
  summary: "",
  pubDate: "2026-10-08T12:00:00.000Z",
  explicit: "no",
  authors: [],
  guests: [],
  tags: [],
  citations: [],
  musicCredits: [],
  coverCredits: [],
  instagramCaptionMentions: [],
  instagramHashtags: [],
  launchNotificationState: "idle",
});

const itemFor = (xml: string, title: string): string => {
  const item = (xml.match(/<item>[\s\S]*?<\/item>/gu) ?? [])
    .find((candidate) => candidate.includes(`<title>${title}</title>`));
  assert.ok(item, `missing item for ${title}`);
  return item;
};

const guidFor = (item: string): { value: string; isPermalink: string | null } => {
  const match = item.match(/<guid(?: isPermaLink="([^"]+)")?>([^<]+)<\/guid>/u);
  assert.ok(match, "missing GUID");
  return { isPermalink: match[1] ?? null, value: match[2] };
};

const legacyGuid = "https://www.dragaocareca.com/files/episodes/episode_356.mp3";
const legacy = {
  ...baseEpisode(356),
  title: "Legacy item",
  xmlSnapshot: `<guid>${legacyGuid}</guid><title>Legacy item</title><enclosure url="https://www.dragaocareca.com/files/episodes/episode_356.mp3" length="1" type="audio/mpeg"></enclosure><itunes:image href="https://www.dragaocareca.com/files/images/episode_356.jpeg"></itunes:image>`,
};
const current = { ...baseEpisode(364), title: "Current item", fileName: "episode_364.mp3" };
const future = { ...baseEpisode(365), title: "Future item", fileName: "episode_365.mp3" };

const xml = buildFeedXml([legacy, current, future]);
const legacyItem = itemFor(xml, legacy.title);
const currentItem = itemFor(xml, current.title);
const futureItem = itemFor(xml, future.title);

assert.deepEqual(guidFor(legacyItem), { value: legacyGuid, isPermalink: null });
assert.match(legacyItem, /<enclosure url="https?:\/\/[^"]+\/media\/episodes\/356\/audio\.mp3"/u);
assert.match(legacyItem, /<itunes:image href="https?:\/\/[^"]+\/media(?:\/images)?\/episodes\/356\/cover\.jpeg"/u);

const currentGuid = guidFor(currentItem);
assert.equal(currentGuid.isPermalink, null);
assert.match(currentGuid.value, /\/media\/episodes\/364\/audio\.mp3$/u);

assert.deepEqual(guidFor(futureItem), { value: "365", isPermalink: "false" });
assert.match(futureItem, /<enclosure url="https?:\/\/[^"]+\/media\/episodes\/365\/audio\.mp3"/u);

console.log("Feed GUID stability verified.");
