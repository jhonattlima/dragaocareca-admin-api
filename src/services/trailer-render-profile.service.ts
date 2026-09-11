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
    outputVideo: { codec: string; pixelFormat: string };
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
  if (provenance.outputVideo.codec !== "h264" || provenance.outputVideo.pixelFormat !== "yuv420p") {
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
