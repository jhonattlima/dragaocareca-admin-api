import type { PublicationMetadata } from "../schemas/episode-publication";

export const MAX_SOCIAL_HASHTAGS = 30;

const truncateUtf8 = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let result = value;
  while (result.length > 0 && Buffer.byteLength(result, "utf8") > maxBytes) {
    result = result.slice(0, -1);
  }
  return result;
};

export const renderSocialCaption = (input: {
  title: string;
  summary: string;
  mentions: string[];
  hashtags: string[];
}): string => truncateUtf8([
  input.title,
  input.summary,
  input.mentions.join(" "),
  input.hashtags.slice(0, MAX_SOCIAL_HASHTAGS).join(" "),
].filter(Boolean).join("\n\n"), 2_100);

/** Rebuild captions from structured snapshot fields so retries of legacy rows
 * cannot resend a caption created before the current hashtag limit. */
export const renderStoredSocialCaption = (metadata: PublicationMetadata): string => renderSocialCaption({
  title: metadata.title,
  summary: metadata.summary,
  mentions: metadata.captionMentions,
  hashtags: metadata.hashtags,
});
