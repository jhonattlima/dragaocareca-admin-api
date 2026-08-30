export type TranscriptTimestamp = {
  seconds: number;
  text: string;
};

const TIMESTAMP_PATTERN = /^\s*\[?((?:\d+:)?\d{1,3}):([0-5]\d)\]?\s+(.+?)\s*$/;

export const parseTranscriptTimestamps = (text: string): TranscriptTimestamp[] => text
  .split(/\r?\n/)
  .map((line) => {
    const match = line.match(TIMESTAMP_PATTERN);
    if (!match) return null;
    const minuteOrHour = Number(match[1]);
    const seconds = Number(match[2]);
    const parts = match[1].split(":");
    const absoluteSeconds = parts.length === 1
      ? minuteOrHour * 60 + seconds
      : Number(parts[0]) * 3600 + Number(parts[1]) * 60 + seconds;
    return { seconds: absoluteSeconds, text: match[3] };
  })
  .filter((segment): segment is TranscriptTimestamp => segment !== null);

export const formatTranscriptTimestamp = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

export const formatTranscriptSegments = (segments: Array<{ start: number; text: string }>, offsetSeconds = 0): string => segments
  .filter((segment) => Number.isFinite(segment.start) && segment.text.trim())
  .map((segment) => `${formatTranscriptTimestamp(segment.start + offsetSeconds)} ${segment.text.trim()}`)
  .join("\n\n");

export const findTranscriptTimestampQualityIssues = (
  text: string,
  durationSeconds: number,
  maxGapSeconds = 120,
): string[] => {
  const timestamps = parseTranscriptTimestamps(text);
  const issues: string[] = [];
  const expectedMinimum = Math.max(1, Math.ceil(durationSeconds / maxGapSeconds));

  if (timestamps.length < expectedMinimum) {
    issues.push(`timestamp coverage is too sparse (${timestamps.length} segments for ${Math.ceil(durationSeconds)}s)`);
  }
  if (timestamps.length === 0) {
    issues.push("transcript has no parseable timestamps");
    return issues;
  }
  if (timestamps[0].seconds > 30) {
    issues.push("transcript starts too late");
  }
  for (let index = 1; index < timestamps.length; index += 1) {
    const gap = timestamps[index].seconds - timestamps[index - 1].seconds;
    if (gap < 0) issues.push("timestamps are not monotonic");
    if (gap > maxGapSeconds) issues.push(`timestamp gap exceeds ${maxGapSeconds}s`);
  }
  return [...new Set(issues)];
};

export const assertTranscriptTimestampQuality = (text: string, durationSeconds: number): void => {
  const issues = findTranscriptTimestampQualityIssues(text, durationSeconds);
  if (issues.length > 0) {
    throw new Error(`Transcript timestamp quality check failed: ${issues.join("; ")}`);
  }
};
