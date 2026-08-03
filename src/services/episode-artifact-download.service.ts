import fs from "node:fs";
import { createHash } from "node:crypto";
import type { ArtifactSourceEvidence } from "../database/repositories/artifact-job.repository";
import { getEpisodeMediaFinalPath, type EpisodeMediaKind } from "./episode-media-layout.service";

const artifactCatalog = [
  { selector: "episode", kind: "audio", fileName: "audio.mp3" },
  { selector: "trailer", kind: "trailer", fileName: "trailer.mp3" },
  { selector: "trailer-video", kind: "trailerVideo", fileName: "trailer.mp4" },
  { selector: "transcript", kind: "transcript", fileName: "transcript.txt" },
  { selector: "image", kind: "cover", fileName: "cover.jpeg" },
  { selector: "image-low", kind: "coverLow", fileName: "cover.webp" },
] as const satisfies ReadonlyArray<{
  selector: string;
  kind: EpisodeMediaKind;
  fileName: string;
}>;

export type EpisodeArtifactSelector = (typeof artifactCatalog)[number]["selector"];
export type EpisodeArtifactCatalogEntry = (typeof artifactCatalog)[number];

export class EpisodeArtifactSelectorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpisodeArtifactSelectorValidationError";
  }
}

export type EpisodeArtifactPreflightEntry = EpisodeArtifactCatalogEntry & {
  archiveEntryName: string;
  path: string;
};

export type EpisodeArtifactPreflightResult = {
  requested: EpisodeArtifactSelector[];
  available: EpisodeArtifactPreflightEntry[];
  missing: EpisodeArtifactSelector[];
};

export type EpisodeArtifactSourceEvidence = ArtifactSourceEvidence;

const isCatalogSelector = (selector: string): selector is EpisodeArtifactSelector =>
  artifactCatalog.some((entry) => entry.selector === selector);

export const episodeArtifactCatalog = (): readonly EpisodeArtifactCatalogEntry[] => artifactCatalog;

export const parseEpisodeArtifactSelectors = (artifacts: unknown): EpisodeArtifactCatalogEntry[] => {
  if (artifacts === undefined) {
    return [...artifactCatalog];
  }

  if (typeof artifacts !== "string" || artifacts.length === 0) {
    throw new EpisodeArtifactSelectorValidationError("artifacts must be one nonempty CSV query value");
  }

  const requestedSelectors = artifacts.split(",");
  if (requestedSelectors.some((selector) => selector.length === 0)) {
    throw new EpisodeArtifactSelectorValidationError("artifacts must not contain empty selector values");
  }

  for (const selector of requestedSelectors) {
    if (!isCatalogSelector(selector)) {
      throw new EpisodeArtifactSelectorValidationError(`unknown artifact selector: ${selector}`);
    }
  }

  const selectedSelectors = new Set(requestedSelectors);
  return artifactCatalog.filter((entry) => selectedSelectors.has(entry.selector));
};

const isMissingFinalPathError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export const preflightEpisodeArtifactDownloads = async (
  episodeId: number,
  selectedArtifacts: readonly EpisodeArtifactCatalogEntry[]
): Promise<EpisodeArtifactPreflightResult> => {
  const available: EpisodeArtifactPreflightEntry[] = [];
  const missing: EpisodeArtifactSelector[] = [];

  for (const artifact of selectedArtifacts) {
    const finalPath = getEpisodeMediaFinalPath(episodeId, artifact.kind);

    try {
      const stat = await fs.promises.lstat(finalPath);
      if (!stat.isFile()) {
        missing.push(artifact.selector);
        continue;
      }

      available.push({
        ...artifact,
        archiveEntryName: `episode-${episodeId}/${artifact.fileName}`,
        path: finalPath,
      });
    } catch (error) {
      if (isMissingFinalPathError(error)) {
        missing.push(artifact.selector);
        continue;
      }
      throw error;
    }
  }

  return {
    requested: selectedArtifacts.map((artifact) => artifact.selector),
    available,
    missing,
  };
};

export const collectEpisodeArtifactSourceEvidence = async (
  episodeId: number,
  selectedArtifacts: readonly EpisodeArtifactCatalogEntry[]
): Promise<EpisodeArtifactSourceEvidence[]> => {
  const evidence: EpisodeArtifactSourceEvidence[] = [];
  for (const artifact of selectedArtifacts) {
    const finalPath = getEpisodeMediaFinalPath(episodeId, artifact.kind);
    try {
      const stat = await fs.promises.lstat(finalPath);
      if (!stat.isFile()) {
        evidence.push({ selector: artifact.selector, missing: true });
        continue;
      }
      const hash = createHash("sha256");
      for await (const chunk of fs.createReadStream(finalPath)) hash.update(chunk);
      evidence.push({ selector: artifact.selector, sha256: hash.digest("hex") });
    } catch (error) {
      if (isMissingFinalPathError(error)) {
        evidence.push({ selector: artifact.selector, missing: true });
        continue;
      }
      throw error;
    }
  }
  return evidence;
};
