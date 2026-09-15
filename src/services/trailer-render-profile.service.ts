import path from "node:path";

export const TRAILER_RENDER_VISUAL_PROFILE = Object.freeze({
  profileId: "square-reels-karaoke-v2",
  revision: 2,
  width: 1280,
  height: 1280,
  frameRate: 25,
  videoCodec: "h264-main" as const,
  videoLevel: "4.0",
  audioCodec: "aac" as const,
  pixelFormat: "yuv420p" as const,
  sampleAspectRatio: "1:1",
  fastStart: true,
  waveform: {
    mode: "cline" as const,
    width: 1280,
    height: 220,
    top: 820,
    gradientStart: "#00ffff",
    gradientEnd: "#ff00ff",
  },
  captions: {
    fontName: "Montserrat",
    fontFile: path.resolve(__dirname, "../../assets/fonts/Montserrat-ExtraBold.ttf"),
    fontSize: 75,
    primaryColor: "&H000000FF", // ASS uses BBGGRR: red
    secondaryColor: "&H00FF0000", // ASS uses BBGGRR: blue
    outlineColor: "&H00000000",
    outlinePx: 3,
    horizontalPadding: 35,
    reservedTop: 1040,
    anchorY: 1245,
    maxLines: 2,
    maxCharactersPerLine: 24,
    karaoke: "word" as const,
  },
} as const);

export type TrailerTimedWord = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type TrailerCaptionCue = {
  words: TrailerTimedWord[];
};

export type TrailerRenderInputs = {
  coverPath: string;
  audioPath: string;
  outputPath: string;
  durationSeconds: number;
};

export type TrailerCaptionRenderInputs = {
  inputVideoPath: string;
  assPath: string;
  outputPath: string;
};

const escapeFilterPath = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

const formatAssTime = (seconds: number): string => {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const wholeSeconds = Math.floor((centiseconds % 6_000) / 100);
  const remainder = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(remainder).padStart(2, "0")}`;
};

const safeAssText = (value: string): string => value
  .replace(/[\r\n\u0000-\u001f]+/g, " ")
  .replace(/\\/g, "＼")
  .replace(/\{/g, "｛")
  .replace(/\}/g, "｝")
  .trim();

const hexColorToRgb = (value: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`Invalid trailer profile color: ${value}`);
  const hex = match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
};

const colorChannelExpression = (start: number, end: number): string =>
  start === end ? String(start) : `${start}+(${end - start})*X/W`;

const splitCaptionWords = (words: TrailerTimedWord[]): TrailerTimedWord[][][] => {
  const lines: TrailerTimedWord[][] = [];
  let line: TrailerTimedWord[] = [];
  let length = 0;
  for (const word of words) {
    const cleanText = safeAssText(word.text);
    if (!cleanText) continue;
    const nextLength = length + (line.length ? 1 : 0) + cleanText.length;
    if (line.length && nextLength > TRAILER_RENDER_VISUAL_PROFILE.captions.maxCharactersPerLine) {
      lines.push(line);
      line = [];
      length = 0;
    }
    line.push({ ...word, text: cleanText });
    length += (line.length > 1 ? 1 : 0) + cleanText.length;
  }
  if (line.length) lines.push(line);

  const events: TrailerTimedWord[][][] = [];
  for (let index = 0; index < lines.length; index += TRAILER_RENDER_VISUAL_PROFILE.captions.maxLines) {
    events.push(lines.slice(index, index + TRAILER_RENDER_VISUAL_PROFILE.captions.maxLines));
  }
  return events;
};

export const buildTrailerAssCaptions = (cues: TrailerCaptionCue[]): string => {
  const profile = TRAILER_RENDER_VISUAL_PROFILE;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${profile.width}`,
    `PlayResY: ${profile.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Reels,${profile.captions.fontName},${profile.captions.fontSize},${profile.captions.primaryColor},${profile.captions.secondaryColor},${profile.captions.outlineColor},&H80000000,-1,0,0,0,95,100,0,0,1,${profile.captions.outlinePx},0,2,${profile.captions.horizontalPadding},${profile.captions.horizontalPadding},35,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text",
  ];
  const events: string[] = [];

  for (const cue of cues) {
    const words = cue.words.filter((word) =>
      Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds) &&
      word.startSeconds >= 0 && word.endSeconds > word.startSeconds && safeAssText(word.text)
    );
    for (const eventLines of splitCaptionWords(words)) {
      const eventWords = eventLines.flat();
      if (!eventWords.length) continue;
      const start = eventWords[0].startSeconds;
      const end = eventWords[eventWords.length - 1].endSeconds;
      const text = eventLines
        .map((line) => line
          .map((word, index) => {
            const nextWord = line[index + 1];
            const duration = Math.max(1, Math.round(((nextWord?.startSeconds ?? word.endSeconds) - word.startSeconds) * 100));
            return `{\\kf${duration}}${safeAssText(word.text)}`;
          })
          .join(" "))
        .join("\\N");
      events.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Reels,,0,0,,{\\an2\\pos(${profile.width / 2},${profile.captions.anchorY})}${text}`);
    }
  }

  return `${header.join("\n")}\n${events.join("\n")}\n`;
};

export const buildTrailerRenderArgs = (input: TrailerRenderInputs): string[] => {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error("Trailer source duration must be positive");
  }
  const profile = TRAILER_RENDER_VISUAL_PROFILE;
  const [startRed, startGreen, startBlue] = hexColorToRgb(profile.waveform.gradientStart);
  const [endRed, endGreen, endBlue] = hexColorToRgb(profile.waveform.gradientEnd);
  const graph = [
    `[1:a]showwaves=s=${profile.waveform.width}x${profile.waveform.height}:mode=${profile.waveform.mode}:colors=white:draw=full,format=gray[wave_mask]`,
    `color=c=black:s=${profile.waveform.width}x${profile.waveform.height},geq=r='${colorChannelExpression(startRed, endRed)}':g='${colorChannelExpression(startGreen, endGreen)}':b='${colorChannelExpression(startBlue, endBlue)}':a=255,format=rgba[wave_gradient]`,
    "[wave_gradient][wave_mask]alphamerge[wave]",
    `[0:v]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[cover]`,
    `[cover][wave]overlay=0:${profile.waveform.top}:shortest=1,setsar=1[v]`,
  ].join(";");

  return [
    "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
    "-loop", "1", "-i", input.coverPath, "-i", input.audioPath,
    "-filter_complex", graph, "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-profile:v", "main", "-level:v", profile.videoLevel,
    "-tag:v", "avc1", "-r", String(profile.frameRate), "-pix_fmt", profile.pixelFormat,
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
    "-movflags", "+faststart", "-t", input.durationSeconds.toFixed(3), "-shortest", input.outputPath,
  ];
};

export const buildTrailerCaptionRenderArgs = (input: TrailerCaptionRenderInputs): string[] => {
  const filter = `subtitles=filename='${escapeFilterPath(input.assPath)}':fontsdir='${escapeFilterPath(path.dirname(TRAILER_RENDER_VISUAL_PROFILE.captions.fontFile))}',setsar=1`;
  return [
    "-hide_banner", "-loglevel", "error", "-i", input.inputVideoPath,
    "-vf", filter, "-c:v", "libx264", "-profile:v", "main", "-level:v", TRAILER_RENDER_VISUAL_PROFILE.videoLevel,
    "-tag:v", "avc1", "-r", String(TRAILER_RENDER_VISUAL_PROFILE.frameRate), "-pix_fmt", TRAILER_RENDER_VISUAL_PROFILE.pixelFormat,
    "-c:a", "copy", "-movflags", "+faststart", input.outputPath,
  ];
};

export type TrailerRenderProfile = {
  profileId: string;
  revision: number;
  container: "mp4";
  videoCodec: "h264";
  audioCodec: "aac";
  pixelFormat: "yuv420p";
  fastStart: true;
  argvSha256: string;
};

export type TrailerRenderCapability = {
  imageDigest: string;
  ffmpegVersion: string;
  ffprobeVersion: string;
  filters: string[];
  encoders: string[];
  fonts: string[];
};

export type TrailerRenderEvidence = {
  profile: TrailerRenderProfile;
  capability: TrailerRenderCapability;
  provenance: {
    sourceSha256: string;
    sourceBytes: number;
    sourceDurationSeconds: number;
    outputSha256: string;
    outputBytes: number;
    outputDurationSeconds: number;
    outputVideo: { codec: string; pixelFormat: string; width: number; height: number; sampleAspectRatio: string };
    outputAudio: { codec: string };
    decoded: boolean;
  };
  measuredLimit: {
    maxInputBytes: number;
    maxInputDurationSeconds: number;
    timeoutMs: number;
    minFreeBytes: number;
    peakCpuPercent: number;
    peakMemoryBytes: number;
    peakDiskBytes: number;
  };
  concurrency: 1;
  approved: false;
};

const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/i;

const requirePositive = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} measured value is missing or invalid`);
};

const requireHash = (value: string, field: string): void => {
  if (!SHA256.test(value)) throw new Error(`${field} SHA-256 provenance is missing or invalid`);
};

export const validateTrailerRenderEvidence = (evidence: TrailerRenderEvidence): TrailerRenderEvidence => {
  if (!evidence || evidence.profile.revision < 1 || !evidence.profile.profileId.trim()) {
    throw new Error("Trailer render profile revision is missing or invalid");
  }
  if (evidence.profile.container !== "mp4" || evidence.profile.videoCodec !== "h264" || evidence.profile.audioCodec !== "aac") {
    throw new Error("Trailer render profile container or codec is unsupported");
  }
  if (evidence.profile.pixelFormat !== "yuv420p" || evidence.profile.fastStart !== true) {
    throw new Error("Trailer render profile pixel format or fast-start state is unsupported");
  }
  requireHash(evidence.profile.argvSha256, "Fixed FFmpeg argv");

  const capability = evidence.capability;
  if (!capability.imageDigest.startsWith("sha256:") || !/^[a-f0-9]{64}$/i.test(capability.imageDigest.slice(7))) {
    throw new Error("FFmpeg capability image digest is missing or invalid");
  }
  for (const value of [capability.ffmpegVersion, capability.ffprobeVersion]) {
    if (!value.trim()) throw new Error("FFmpeg capability version is missing");
  }
  if (!capability.filters.includes("showwaves")) throw new Error("FFmpeg showwaves capability is missing");
  if (!capability.encoders.includes("libx264") || !capability.encoders.includes("aac")) {
    throw new Error("FFmpeg libx264/AAC capability is missing");
  }
  if (capability.fonts.length === 0 || capability.fonts.some((font) => !font.trim())) {
    throw new Error("FFmpeg font capability is missing");
  }

  const provenance = evidence.provenance;
  requireHash(provenance.sourceSha256, "Source");
  requireHash(provenance.outputSha256, "Output");
  requirePositive(provenance.sourceBytes, "Source bytes");
  requirePositive(provenance.outputBytes, "Output bytes");
  requirePositive(provenance.sourceDurationSeconds, "Source duration");
  requirePositive(provenance.outputDurationSeconds, "Output duration");
  if (Math.abs(provenance.sourceDurationSeconds - provenance.outputDurationSeconds) > 0.1) {
    throw new Error("Source and output duration metadata do not match");
  }
  if (
    provenance.outputVideo.codec !== "h264" || provenance.outputVideo.pixelFormat !== TRAILER_RENDER_VISUAL_PROFILE.pixelFormat ||
    provenance.outputVideo.width !== TRAILER_RENDER_VISUAL_PROFILE.width || provenance.outputVideo.height !== TRAILER_RENDER_VISUAL_PROFILE.height ||
    provenance.outputVideo.sampleAspectRatio !== TRAILER_RENDER_VISUAL_PROFILE.sampleAspectRatio
  ) {
    throw new Error("Output video stream facts do not match the profile");
  }
  if (provenance.outputAudio.codec !== "aac" || provenance.decoded !== true) {
    throw new Error("Output audio stream or decode facts do not match the profile");
  }

  const limits = evidence.measuredLimit;
  for (const [field, value] of Object.entries(limits)) requirePositive(value, field);
  if (evidence.concurrency !== 1) throw new Error("Trailer render concurrency must remain one");
  if (evidence.approved !== false) throw new Error("Trailer render profile remains not-approved pending deploy-owned measurements");
  return evidence;
};
