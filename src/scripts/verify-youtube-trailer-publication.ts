import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

type Fixture = {
  root: string;
  mediaRoot: string;
  stagingRoot: string;
  sqlitePath: string;
};

type RuntimeModules = {
  config: typeof import("../config/env.js").config;
  getDb: typeof import("../database/sqlite.js").getDb;
  episodeRepository: typeof import("../database/repositories/episode.repository.js").episodeRepository;
  youtubeTrailerJobRepository: typeof import("../database/repositories/youtube-trailer-job.repository.js").youtubeTrailerJobRepository;
  reserveTrailerVideoDraft: typeof import("../services/episode-draft-reservation.service.js").reserveTrailerVideoDraft;
  checkTrailerVideoDraft: typeof import("../services/episode-draft-reservation.service.js").checkTrailerVideoDraft;
  restoreTrailerVideoDraftForRetry: typeof import("../services/episode-draft-reservation.service.js").restoreTrailerVideoDraftForRetry;
  replaceEpisodeTrailerVideo: typeof import("../services/episode-trailer-video.service.js").replaceEpisodeTrailerVideo;
  getEpisodeMediaFinalPath: typeof import("../services/episode-media-layout.service.js").getEpisodeMediaFinalPath;
  getEpisodeMediaStagingPath: typeof import("../services/episode-media-layout.service.js").getEpisodeMediaStagingPath;
  prepareEpisodeArtifactArchive: typeof import("../services/episode-artifact-preparation.service.js").prepareEpisodeArtifactArchive;
  processNextEpisodeArtifactPreparation: typeof import("../services/episode-artifact-preparation.service.js").processNextEpisodeArtifactPreparation;
  getValidatedEpisodeArtifactPreparationDownload: typeof import("../services/episode-artifact-preparation.service.js").getValidatedEpisodeArtifactPreparationDownload;
  parseEpisodeArtifactSelectors: typeof import("../services/episode-artifact-download.service.js").parseEpisodeArtifactSelectors;
  publishYoutubeTrailer: typeof import("../services/youtube-trailer-publication.service.js").publishYoutubeTrailer;
  discoverTrailerVideoVersions: typeof import("../services/episode-trailer-retention.service.js").discoverTrailerVideoVersions;
  fingerprintYoutubeTrailerSource: typeof import("../services/youtube-trailer-job.service.js").fingerprintYoutubeTrailerSource;
};

/**
 * Contract-only fake for later publication plans. It records every provider
 * action and deliberately has no OAuth or HTTP implementation.
 */
export class FakeYoutubeTrailerPublicationProvider {
  readonly events: string[] = [];
  readonly videoId = "fake-private-publication-video";
  privacyStatus: "private" | "public" = "private";
  playlistInserted = false;
  playlistInsertCount = 0;
  metadata: { title: string; description: string; categoryId?: string } | null = null;
  failPlaylistInsert = false;
  failPublicUpdate = false;

  async checkReadiness(): Promise<void> {
    this.events.push("readiness");
  }

  async beginPrivatePublication(): Promise<{ providerVideoId: string; privacyStatus: "private" }> {
    this.events.push("begin-private-publication");
    return { providerVideoId: "fake-private-publication-video", privacyStatus: "private" };
  }

  async beginPrivateSession(): Promise<{ sessionUri: string; privacyStatus: "private" }> { throw new Error("not used by publication verifier"); }
  async resumeRange(): Promise<{ confirmedBytes: number; providerVideoId: string | null }> { throw new Error("not used by publication verifier"); }
  async uploadChunk(): Promise<{ confirmedBytes: number; providerVideoId: string | null }> { throw new Error("not used by publication verifier"); }
  async pollProcessing(): Promise<never> { throw new Error("not used by publication verifier"); }
  async cancel(): Promise<{ accepted: boolean; boundary: "local-cancelled" }> { throw new Error("not used by publication verifier"); }

  async getVideo(providerVideoId: string): Promise<{ videoId: string; channelId: string; privacyStatus: "private" | "public"; uploadStatus: "processed"; processingStatus: "succeeded"; title: string | null; description: string | null; categoryId: string }> {
    assert.equal(providerVideoId, this.videoId);
    this.events.push("provider-read");
    return { videoId: providerVideoId, channelId: "UCq-TjauoYJrr3po121gA6iw", privacyStatus: this.privacyStatus, uploadStatus: "processed", processingStatus: "succeeded", title: this.metadata?.title ?? null, description: this.metadata?.description ?? null, categoryId: "22" };
  }

  async updateMetadata(providerVideoId: string, metadata: { title: string; description: string; categoryId?: string }): Promise<ReturnType<FakeYoutubeTrailerPublicationProvider["getVideo"]> extends Promise<infer T> ? T : never> {
    assert.equal(providerVideoId, this.videoId);
    this.events.push("metadata-update");
    this.metadata = metadata;
    return this.getVideo(providerVideoId);
  }

  async findPlaylistMembership(providerVideoId: string): Promise<{ playlistId: string; videoId: string; itemId: string } | null> {
    assert.equal(providerVideoId, this.videoId);
    this.events.push("playlist-read");
    return this.playlistInserted ? { playlistId: "PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t", videoId: providerVideoId, itemId: "fake-playlist-item" } : null;
  }

  async insertPlaylistItem(providerVideoId: string): Promise<{ playlistId: string; videoId: string; itemId: string }> {
    assert.equal(providerVideoId, this.videoId);
    this.events.push("playlist-insert");
    if (this.failPlaylistInsert) throw new Error("fake playlist failure");
    this.playlistInserted = true;
    this.playlistInsertCount += 1;
    return { playlistId: "PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t", videoId: providerVideoId, itemId: "fake-playlist-item" };
  }

  async publishVideo(providerVideoId: string): Promise<Awaited<ReturnType<FakeYoutubeTrailerPublicationProvider["getVideo"]>>> {
    assert.equal(providerVideoId, this.videoId);
    this.events.push("public-update");
    if (this.failPublicUpdate) throw new Error("fake public update failure");
    this.privacyStatus = "public";
    return { videoId: providerVideoId, channelId: "UCq-TjauoYJrr3po121gA6iw", privacyStatus: "public", uploadStatus: "processed", processingStatus: "succeeded", title: this.metadata?.title ?? null, description: this.metadata?.description ?? null, categoryId: "22" };
  }

  normalizeFailure(error: unknown): { code: "retryable"; message: string } {
    return { code: "retryable", message: error instanceof Error ? error.message : "fake failure" };
  }

  async requestLiveProvider(): Promise<never> {
    throw new Error("live provider access must be injected into the verifier");
  }
}

export const installNetworkTripwire = (): (() => void) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network/OAuth access is forbidden in the offline verifier");
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
};

const invokePublicationRoute = async (body: unknown, authorization?: string): Promise<{ status: number; headers: Record<string, string>; json: Record<string, unknown> }> => {
  const require = createRequire(__filename);
  const { episodesRouter } = require("../routes/episodes.routes.js") as { episodesRouter: { stack: Array<{ route?: { path?: string; stack: Array<{ handle: (req: any, res: any, next: (error?: unknown) => void) => unknown }> } }> } };
  const layer = episodesRouter.stack.find((candidate) => candidate.route?.path === "/:episodeId/youtube-trailer-jobs/:jobId/publish");
  assert.ok(layer?.route, "compiled router must contain the publication operation");
  const handlers = layer.route.stack;
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      status(code: number) { this.statusCode = code; return this; },
      setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
      json(value: Record<string, unknown>) { resolve({ status: this.statusCode, headers: this.headers, json: value }); return this; },
    };
    const request = {
      method: "POST",
      headers: { ...(authorization ? { authorization } : {}) },
      params: { episodeId: "170000001", jobId: "00000000-0000-4000-8000-000000000017" },
      body,
      user: undefined,
    };
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { reject(error); return; }
      const handler = handlers[index++]?.handle;
      if (!handler) { reject(new Error("publication route ended without a response")); return; }
      try { void handler(request, response, next); } catch (caught) { reject(caught); }
    };
    next();
  });
};

const verifyProtectedPublicationBoundary = async (): Promise<void> => {
  const require = createRequire(__filename);
  const publicationModule = require("../services/youtube-trailer-publication.service.js") as {
    publishYoutubeTrailer: (episodeId: number, jobId: string, input: { title: string; hashtags: string[] }) => Promise<Record<string, unknown>>;
  };
  const originalPublish = publicationModule.publishYoutubeTrailer;
  const calls: Array<{ episodeId: number; jobId: string; input: { title: string; hashtags: string[] } }> = [];
  publicationModule.publishYoutubeTrailer = async (episodeId, jobId, input) => {
    calls.push({ episodeId, jobId, input });
    return {
      jobId,
      episodeId,
      status: "public_confirmed",
      url: "https://www.youtube.com/watch?v=fake-private-publication-video",
      cleanup: { status: "complete", error: null },
      error: { category: null, occurredAt: null },
    };
  };

  const { config } = require("../config/env.js") as { config: { auth: { jwtSecret: string }; youtube: { trailerPublication: { enabled: boolean; channelId: string; playlistId: string; requiredScopes: readonly string[]; retentionKeepCount: number } } } };
  const { signAccessToken } = require("../auth/auth.service.js") as { signAccessToken: (user: { email: string }) => string };
  const { swaggerSpec } = require("../docs/openapi.js") as { swaggerSpec: { components: { schemas: Record<string, any> }; paths: Record<string, any> } };
  assert.equal(config.youtube.trailerPublication.enabled, true);
  assert.equal(config.youtube.trailerPublication.channelId, "UCq-TjauoYJrr3po121gA6iw");
  assert.equal(config.youtube.trailerPublication.playlistId, "PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t");
  assert.deepEqual(config.youtube.trailerPublication.requiredScopes, [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ]);
  assert.equal(config.youtube.trailerPublication.retentionKeepCount, 12);

  try {
    const unauthorized = await invokePublicationRoute({ title: "Fixture", hashtags: [] });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers["cache-control"], "no-store", "no-store must be set before authentication");

    const token = signAccessToken({ email: "offline-verifier@local" });
    const malformed = await invokePublicationRoute({ title: "Fixture", hashtags: [], providerVideoId: "secret" }, `Bearer ${token}`);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers["cache-control"], "no-store");
    assert.equal(calls.length, 0, "strict validation must reject provider-controlled fields before delegation");

    const valid = await invokePublicationRoute({ title: "Fixture", hashtags: ["#fase17"] }, `Bearer ${token}`);
    assert.equal(valid.status, 200);
    assert.equal(valid.headers["cache-control"], "no-store");
    assert.deepEqual(calls, [{ episodeId: 170000001, jobId: "00000000-0000-4000-8000-000000000017", input: { title: "Fixture", hashtags: ["#fase17"] } }]);
    assert.deepEqual(Object.keys(valid.json).sort(), ["cleanup", "episodeId", "error", "jobId", "status", "url"]);
    assert.equal("providerVideoId" in valid.json, false);
    assert.equal("accessToken" in valid.json, false);
    assert.equal("sourcePath" in valid.json, false);

    const route = swaggerSpec.paths["/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}/publish"]?.post;
    assert.ok(route, "OpenAPI must document the publication route");
    assert.deepEqual(route.security, [{ bearerAuth: [] }]);
    assert.equal(route.responses["200"].headers["Cache-Control"].schema.example, "no-store");
    assert.equal(route.requestBody.content["application/json"].schema.$ref, "#/components/schemas/YoutubeTrailerPublicationRequest");
    assert.equal(route.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/YoutubeTrailerPublicationResponse");
    assert.equal(swaggerSpec.components.schemas.YoutubeTrailerPublicationRequest.additionalProperties, false);
    assert.equal(swaggerSpec.components.schemas.YoutubeTrailerPublicationRequest.properties.title.maxLength, 100);
    assert.equal(swaggerSpec.components.schemas.YoutubeTrailerPublicationRequest.properties.hashtags.maxItems, 3);
  } finally {
    publicationModule.publishYoutubeTrailer = originalPublish;
  }
};

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dragaocareca-phase17-publication-"));
  const fixture = {
    root,
    mediaRoot: path.join(root, "media"),
    stagingRoot: path.join(root, "staging"),
    sqlitePath: path.join(root, "phase17.sqlite"),
  };
  await Promise.all([fixture.mediaRoot, fixture.stagingRoot].map((directory) => fs.promises.mkdir(directory, { recursive: true })));
  return fixture;
};

const assertFixtureIsolation = async (fixture: Fixture, modules: RuntimeModules): Promise<void> => {
  assert.match(fixture.root, /^\/tmp\/dragaocareca-phase17-publication-/);
  assert.equal(modules.config.sqlitePath, fixture.sqlitePath);
  assert.equal(modules.config.media.storageRoot, fixture.mediaRoot);
  assert.equal(modules.config.media.episodesStagingDir, fixture.stagingRoot);
  assert.equal(await fs.promises.stat(fixture.mediaRoot).then((entry) => entry.isDirectory()), true);
  assert.equal(await fs.promises.stat(fixture.sqlitePath).then((entry) => entry.isFile()), true);
};

const seedEpisode = (modules: RuntimeModules, episodeId: number): void => {
  modules.episodeRepository.delete(episodeId);
  modules.episodeRepository.create({
    episodeId,
    title: "Phase 17 verifier fixture",
    summary: "A saved summary used only by the offline fixture.",
    pubDate: new Date("2026-01-01T00:00:00.000Z"),
    explicit: "no",
    authors: [], guests: [], tags: [], citations: [], musicCredits: [], coverCredits: [],
  });
};

const writeCurrentAndLegacyVersions = async (modules: RuntimeModules, episodeId: number): Promise<void> => {
  const currentPath = modules.getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  await fs.promises.mkdir(path.dirname(currentPath), { recursive: true });
  await fs.promises.writeFile(currentPath, "last-known-good-final");
  await fs.promises.writeFile(path.join(path.dirname(currentPath), "trailer.v1.mp4"), "legacy-version-one");
  await fs.promises.writeFile(path.join(path.dirname(currentPath), "trailer.v2.mp4"), "legacy-version-two");
  modules.episodeRepository.updateMedia(episodeId, {
    fileName: `episodes/${episodeId}/audio.mp3`,
    trailerVideoFileName: `episodes/${episodeId}/trailer.mp4`,
  });
  await fs.promises.writeFile(modules.getEpisodeMediaFinalPath(episodeId, "audio"), "audio-fixture");
  await fs.promises.writeFile(modules.getEpisodeMediaFinalPath(episodeId, "transcript"), "transcript-fixture");
};

const archiveEntryNames = (bytes: Buffer): string[] => {
  const names: string[] = [];
  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
};

const readStream = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const verifyArtifactDownloadFixture = async (modules: RuntimeModules, episodeId: number): Promise<void> => {
  const selected = modules.parseEpisodeArtifactSelectors("episode,trailer-video");
  const fixtureNow = new Date("2026-01-02T00:00:00.000Z");
  const pending = await modules.prepareEpisodeArtifactArchive(episodeId, selected);
  assert.equal(pending.state, "pending");
  const completed = await modules.processNextEpisodeArtifactPreparation({ now: fixtureNow });
  assert.equal(completed?.state, "completed");
  const download = await modules.getValidatedEpisodeArtifactPreparationDownload(episodeId, pending.jobId, { now: fixtureNow });
  assert.ok(download, "completed artifact job must expose a validated download stream");
  assert.deepEqual(archiveEntryNames(await readStream(download.stream)), [
    `episode-${episodeId}/audio.mp3`,
    `episode-${episodeId}/trailer.mp4`,
  ]);
};

const verifyDraftPromotionAndRollback = async (modules: RuntimeModules, fixture: Fixture, currentEpisodeId: number): Promise<void> => {
  const owner = "phase17-verifier@local";
  const draftEpisodeId = currentEpisodeId + 1;
  const reservation = await modules.reserveTrailerVideoDraft(draftEpisodeId, owner);
  const stagingPath = modules.getEpisodeMediaStagingPath(draftEpisodeId, "trailerVideo");
  await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
  await fs.promises.writeFile(stagingPath, "draft-video");
  modules.episodeRepository.updateTrailerVideoDraftState(reservation.draftId, "staged");
  assert.equal(modules.checkTrailerVideoDraft(reservation.draftId, draftEpisodeId, "other@local").ok, false);
  assert.equal(modules.checkTrailerVideoDraft(reservation.draftId, draftEpisodeId, owner, { allowStaged: true }).ok, true);

  // Failed create compensation: no episode/final artifact is published, and the
  // reservation is restored so the operator can retry the same draft safely.
  modules.restoreTrailerVideoDraftForRetry(reservation.draftId, draftEpisodeId, owner);
  await fs.promises.rm(stagingPath, { force: true });
  const restoredDraftEpisode = modules.episodeRepository.findByEpisodeId(draftEpisodeId);
  assert.ok(restoredDraftEpisode?.isDraft, "failed create compensation may retain the server-owned draft row");
  assert.equal(await fs.promises.stat(modules.getEpisodeMediaFinalPath(draftEpisodeId, "trailerVideo")).then(() => true).catch(() => false), false);
  assert.equal(modules.episodeRepository.findTrailerVideoDraft(reservation.draftId)?.state, "reserved");

  // Successful promotion consumes the same reservation and makes only the
  // canonical final file visible.
  await fs.promises.writeFile(stagingPath, "promoted-draft-video");
  modules.episodeRepository.updateTrailerVideoDraftState(reservation.draftId, "staged");
  seedEpisode(modules, draftEpisodeId);
  const consumed = modules.episodeRepository.consumeTrailerVideoDraft(reservation.draftId, draftEpisodeId, owner);
  assert.equal(consumed, true);
  const finalPath = modules.getEpisodeMediaFinalPath(draftEpisodeId, "trailerVideo");
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.promises.rename(stagingPath, finalPath);
  modules.episodeRepository.updateMedia(draftEpisodeId, { trailerVideoFileName: `episodes/${draftEpisodeId}/trailer.mp4` });
  assert.equal(await fs.promises.readFile(finalPath, "utf8"), "promoted-draft-video");
  assert.equal(modules.episodeRepository.findTrailerVideoDraft(reservation.draftId)?.state, "consumed");

  // Metadata failure during replacement must roll back to the last-known-good
  // final artifact and clean the staging file.
  const rollbackStaging = modules.getEpisodeMediaStagingPath(currentEpisodeId, "trailerVideo");
  await fs.promises.mkdir(path.dirname(rollbackStaging), { recursive: true });
  await fs.promises.writeFile(rollbackStaging, "failed-replacement");
  const originalUpdateMedia = modules.episodeRepository.updateMedia;
  (modules.episodeRepository as unknown as { updateMedia: typeof originalUpdateMedia }).updateMedia = () => null;
  await assert.rejects(() => modules.replaceEpisodeTrailerVideo(currentEpisodeId, rollbackStaging));
  (modules.episodeRepository as unknown as { updateMedia: typeof originalUpdateMedia }).updateMedia = originalUpdateMedia;
  assert.equal(await fs.promises.readFile(modules.getEpisodeMediaFinalPath(currentEpisodeId, "trailerVideo"), "utf8"), "last-known-good-final");
  assert.equal(await fs.promises.stat(rollbackStaging).then(() => true).catch(() => false), false);
  assert.equal(fixture.root.startsWith(path.dirname(fixture.mediaRoot)), true);
};

const verifyPublicationPersistenceGuards = (modules: RuntimeModules, episodeId: number): void => {
  const columns = new Set((modules.getDb().prepare("PRAGMA table_info(youtube_trailer_jobs)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const column of [
    "publication_status",
    "publication_lease_id",
    "metadata_snapshot_json",
    "metadata_digest",
    "metadata_accepted_at",
    "playlist_membership_confirmed_at",
    "public_confirmed_at",
    "canonical_url",
    "retention_status",
    "retention_error_category",
    "retention_error_message",
    "retention_error_at",
  ]) assert.equal(columns.has(column), true, `publication column ${column} must be initialized additively`);

  const source = { episodeId, sourceFileName: `episodes/${episodeId}/trailer-video.mp4`, sourceSha256: "a".repeat(64), sourceBytes: 10 };
  const repository = modules.youtubeTrailerJobRepository;
  const created = repository.createOrReuse({ ...source, jobId: "phase17-publication-job" });
  const claimed = repository.claim(source, created.jobId, created.revision, "worker-lease");
  assert.ok(claimed);
  const transferring = repository.updateProvider(
    { ...source, jobId: created.jobId, revision: claimed.revision, leaseId: "worker-lease" },
    { providerVideoId: "provider-video", providerPrivacyStatus: "private" },
    "processing"
  );
  assert.ok(transferring);
  const ready = repository.markReady({ ...source, jobId: created.jobId, revision: transferring.revision, leaseId: "worker-lease" });
  assert.ok(ready);
  const publicationLease = repository.claimPublication(source, created.jobId, ready.revision, "publication-lease");
  assert.ok(publicationLease);
  const publicConfirmed = repository.updatePublication(
    { ...source, jobId: created.jobId, revision: publicationLease.revision, leaseId: "publication-lease" },
    {
      publicationStatus: "public_confirmed",
      metadataSnapshotJson: JSON.stringify({ title: "Trailer - fixture", description: "saved summary" }),
      metadataDigest: "digest",
      metadataAcceptedAt: "2026-01-02T00:00:00.000Z",
      playlistMembershipConfirmedAt: "2026-01-02T00:00:01.000Z",
      publicConfirmedAt: "2026-01-02T00:00:02.000Z",
      canonicalUrl: "https://www.youtube.com/watch?v=provider-video",
      retentionStatus: "retryable-error",
      retentionErrorCategory: "filesystem",
      retentionErrorMessage: "cleanup can be retried",
      retentionErrorAt: "2026-01-02T00:00:03.000Z",
    }
  );
  assert.equal(publicConfirmed?.canonicalUrl, "https://www.youtube.com/watch?v=provider-video");
  assert.equal(publicConfirmed?.retentionStatus, "retryable-error");
  const publishedEpisode = modules.episodeRepository.updateYoutubePublication(episodeId, publicConfirmed?.canonicalUrl ?? null, "synced");
  assert.equal(publishedEpisode?.youtube, "https://www.youtube.com/watch?v=provider-video");
  assert.equal(publishedEpisode?.trailerVideoSyncStatus, "synced");
  const replacedEpisode = modules.episodeRepository.updateMedia(episodeId, { trailerVideoSyncStatus: "manual-sync-required" });
  assert.equal(replacedEpisode?.youtube, "https://www.youtube.com/watch?v=provider-video");
  assert.equal(replacedEpisode?.trailerVideoSyncStatus, "manual-sync-required");
  assert.equal(
    repository.updatePublication(
      { ...source, jobId: created.jobId, revision: publicationLease.revision, leaseId: "stale-lease" },
      { canonicalUrl: "https://www.youtube.com/watch?v=stale" }
    ),
    null,
    "stale publication leases must not write a URL"
  );
};

const prepareReadyPublicationJob = async (modules: RuntimeModules, episodeId: number, jobId: string): Promise<void> => {
  const source = await modules.fingerprintYoutubeTrailerSource(episodeId);
  const repository = modules.youtubeTrailerJobRepository;
  const created = repository.createOrReuse({ ...source, jobId });
  const claimed = repository.claim(source, created.jobId, created.revision, `${jobId}-worker`);
  assert.ok(claimed);
  const processing = repository.updateProvider(
    { ...source, jobId, revision: claimed.revision, leaseId: `${jobId}-worker` },
    { providerVideoId: "fake-private-publication-video", providerPrivacyStatus: "private", providerUploadStatus: "processed", providerProcessingStatus: "succeeded" },
    "processing"
  );
  assert.ok(processing);
  const ready = repository.markReady({ ...source, jobId, revision: processing.revision, leaseId: `${jobId}-worker` });
  assert.ok(ready);
};

const retryFailedPublicationJob = async (modules: RuntimeModules, episodeId: number, jobId: string): Promise<void> => {
  const row = modules.youtubeTrailerJobRepository.findByJobId(episodeId, jobId);
  assert.equal(row?.status, "ready", "publication failure recovery preserves the ready job for retry");
  assert.equal(row?.publicationStatus, "failed");
};

const verifyMetadataBoundaries = async (modules: RuntimeModules, episodeId: number): Promise<void> => {
  const invalidInputs: Array<{ name: string; input: { title: string; hashtags: string[] }; message: RegExp }> = [
    { name: "over-limit Unicode title", input: { title: "😀".repeat(101), hashtags: [] }, message: /100|invalid/u },
    { name: "empty title", input: { title: "", hashtags: [] }, message: /invalid/u },
    { name: "whitespace title", input: { title: "   ", hashtags: [] }, message: /invalid/u },
    { name: "angle-bracket title", input: { title: "Bad <title>", hashtags: [] }, message: /invalid/u },
    { name: "malformed hashtag", input: { title: "Fixture", hashtags: ["fase17"] }, message: /invalid/u },
    { name: "invalid hashtag characters", input: { title: "Fixture", hashtags: ["#bad tag"] }, message: /invalid/u },
    { name: "more than three hashtags", input: { title: "Fixture", hashtags: ["#one", "#two", "#three", "#four"] }, message: /three|invalid/u },
  ];

  for (const invalid of invalidInputs) {
    const provider = new FakeYoutubeTrailerPublicationProvider();
    await assert.rejects(
      () => modules.publishYoutubeTrailer(episodeId, `metadata-${invalid.name.replaceAll(" ", "-")}`, invalid.input, provider),
      invalid.message,
      `${invalid.name} must reject at the service boundary`
    );
    assert.deepEqual(provider.events, [], `${invalid.name} must not delegate to the provider`);
  }

  const validJobId = "phase17-metadata-boundary-job";
  await prepareReadyPublicationJob(modules, episodeId, validJobId);
  const provider = new FakeYoutubeTrailerPublicationProvider();
  const exactTitle = "😀".repeat(100);
  const result = await modules.publishYoutubeTrailer(episodeId, validJobId, { title: exactTitle, hashtags: [] }, provider);
  assert.equal(result.status, "public_confirmed");
  assert.equal([...provider.metadata!.title].length, 100, "exact 100-code-point title must be accepted");
};

const verifyPublicationFailureRecovery = async (modules: RuntimeModules, episodeId: number): Promise<void> => {
  const scenarios = [
    { jobId: "phase17-playlist-failure-job", failure: "playlist" as const },
    { jobId: "phase17-public-update-failure-job", failure: "public-update" as const },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const scenarioEpisodeId = episodeId + index * 3;
    await prepareReadyPublicationJob(modules, scenarioEpisodeId, scenario.jobId);
    const provider = new FakeYoutubeTrailerPublicationProvider();
    if (scenario.failure === "playlist") provider.failPlaylistInsert = true;
    else provider.failPublicUpdate = true;

    const failed = await modules.publishYoutubeTrailer(scenarioEpisodeId, scenario.jobId, { title: "Failure Fixture", hashtags: ["#fase17"] }, provider);
    assert.equal(failed.status, "failed");
    assert.equal(provider.privacyStatus, "private", `${scenario.failure} failure must preserve private provider state`);
    assert.equal(failed.url, null, `${scenario.failure} failure must not persist a canonical URL`);
    assert.equal(modules.episodeRepository.findByEpisodeId(scenarioEpisodeId)?.youtube ?? null, null, `${scenario.failure} failure must not persist episode URL`);
    assert.equal(modules.youtubeTrailerJobRepository.findByJobId(scenarioEpisodeId, scenario.jobId)?.publicationStatus, "failed");

    if (scenario.failure === "playlist") provider.failPlaylistInsert = false;
    else provider.failPublicUpdate = false;
    await retryFailedPublicationJob(modules, scenarioEpisodeId, scenario.jobId);
    const retried = await modules.publishYoutubeTrailer(scenarioEpisodeId, scenario.jobId, { title: "Failure Fixture", hashtags: ["#fase17"] }, provider);
    assert.equal(retried.status, "public_confirmed", `${scenario.failure} retry must confirm publication`);
    assert.equal(provider.privacyStatus, "public");
    assert.equal(retried.url, "https://www.youtube.com/watch?v=fake-private-publication-video");
    assert.equal(provider.videoId, "fake-private-publication-video", "retry must reuse the same provider video");
    assert.equal(provider.playlistInsertCount, 1, "retry must not create a duplicate playlist item");
  }
};

const verifyRetentionDeletionFailureRecovery = async (modules: RuntimeModules, episodeId: number): Promise<void> => {
  const currentPath = modules.getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  await fs.promises.mkdir(path.dirname(currentPath), { recursive: true });
  await fs.promises.writeFile(currentPath, "retention-current");
  for (let version = 1; version <= 14; version += 1) {
    await fs.promises.writeFile(path.join(path.dirname(currentPath), `trailer.v${version}.mp4`), `retention-${version}`);
  }
  modules.episodeRepository.updateMedia(episodeId, { trailerVideoFileName: `episodes/${episodeId}/trailer.mp4` });
  const jobId = "phase17-retention-failure-job";
  await prepareReadyPublicationJob(modules, episodeId, jobId);
  const provider = new FakeYoutubeTrailerPublicationProvider();
  const originalUnlink = fs.promises.unlink;
  let injected = false;
  try {
    fs.promises.unlink = (async (filePath: fs.PathLike): Promise<void> => {
      if (!injected && String(filePath).includes(`trailer.v2.mp4`)) {
        injected = true;
        throw new Error("fake retention unlink failure");
      }
      await originalUnlink(filePath);
    }) as typeof fs.promises.unlink;
    const failed = await modules.publishYoutubeTrailer(episodeId, jobId, { title: "Retention Failure", hashtags: ["#fase17"] }, provider);
    assert.equal(failed.status, "public_confirmed");
    assert.equal(failed.url, "https://www.youtube.com/watch?v=fake-private-publication-video");
    assert.equal(failed.cleanup.status, "retryable-error");
    assert.equal(modules.youtubeTrailerJobRepository.findByJobId(episodeId, jobId)?.publicationStatus, "public_confirmed");
    assert.equal(modules.episodeRepository.findByEpisodeId(episodeId)?.youtube, failed.url);
    assert.equal((await fs.promises.readdir(path.dirname(currentPath))).filter((name) => /^trailer\.v\d+\.mp4$/u.test(name)).length, 14, "cleanup failure must preserve every eligible version");
  } finally {
    fs.promises.unlink = originalUnlink;
  }

  const retried = await modules.publishYoutubeTrailer(episodeId, jobId, { title: "Retention Failure", hashtags: ["#fase17"] }, provider);
  assert.equal(retried.status, "public_confirmed");
  assert.equal(retried.cleanup.status, "complete");
  assert.equal((await fs.promises.readdir(path.dirname(currentPath))).filter((name) => /^trailer\.v\d+\.mp4$/u.test(name)).length, 12, "cleanup retry must keep current plus twelve prior versions");
};

const verifyPublicationAndRetention = async (modules: RuntimeModules, episodeId: number): Promise<void> => {
  const currentPath = modules.getEpisodeMediaFinalPath(episodeId, "trailerVideo");
  for (let version = 1; version <= 14; version += 1) {
    await fs.promises.writeFile(path.join(path.dirname(currentPath), `trailer.v${version}.mp4`), `legacy-${version}`);
  }
  await fs.promises.writeFile(path.join(path.dirname(currentPath), "trailer-not-a-version.mp4"), "protected");
  const discovered = await modules.discoverTrailerVideoVersions(episodeId);
  assert.equal(discovered.find((entry) => entry.basename === "trailer-not-a-version.mp4")?.eligible, false);

  const provider = new FakeYoutubeTrailerPublicationProvider();
  const result = await modules.publishYoutubeTrailer(episodeId, "phase17-publish-job", { title: "Trailer - Fixture", hashtags: ["#fase17"] }, provider);
  assert.equal(result.status, "public_confirmed", JSON.stringify(result));
  assert.equal(result.cleanup.status, "complete");
  assert.equal(modules.episodeRepository.findByEpisodeId(episodeId)?.youtube, "https://www.youtube.com/watch?v=fake-private-publication-video");
  assert.equal(provider.metadata?.description, modules.episodeRepository.findByEpisodeId(episodeId)?.summary);
  assert.deepEqual(provider.events.map((event) => event === "provider-read" ? "provider-read" : event), [
    "provider-read", "metadata-update", "provider-read", "playlist-read", "playlist-insert", "playlist-read", "provider-read", "public-update", "provider-read",
  ]);
  assert.equal((await fs.promises.readdir(path.dirname(currentPath))).filter((name) => /^trailer\.v\d+\.mp4$/u.test(name)).length, 12);
  const repeated = await modules.publishYoutubeTrailer(episodeId, "phase17-publish-job", { title: "Trailer - Fixture", hashtags: ["#fase17"] }, provider);
  assert.equal(repeated.url, result.url);
  assert.equal(provider.events.length, 9, "repeated publication must not call provider again");
  await assert.rejects(() => modules.publishYoutubeTrailer(episodeId, "phase17-publish-job", { title: "<invalid>", hashtags: [] }, provider), /invalid|100 characters/u);
};

const verifyExistingVerifierCommandContract = async (): Promise<void> => {
  const packageJson = JSON.parse(await fs.promises.readFile(path.resolve("package.json"), "utf8")) as { scripts?: Record<string, string> };
  for (const scriptName of ["verify:episode-artifact-downloads", "verify:trailer-video-upload-lifecycle", "verify:youtube-trailer-publication"]) {
    const command = packageJson.scripts?.[scriptName];
    if (typeof command !== "string") throw new Error(`${scriptName} must remain registered`);
    assert.match(command, /dist\/scripts\/verify-/);
    assert.match(command, /NODE_ENV=development/);
  }
};

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV !== "development") throw new Error("expected NODE_ENV=development");
  const fixture = await createFixture();
  const restoreNetwork = installNetworkTripwire();
  let db: { close(): void } | undefined;
  try {
    process.env.SQLITE_PATH = fixture.sqlitePath;
    process.env.MEDIA_STORAGE_ROOT = fixture.mediaRoot;
    process.env.MEDIA_EPISODES_STAGING_DIR = fixture.stagingRoot;
    process.env.YOUTUBE_TRAILER_PUBLICATION_ENABLED = "true";
    process.env.JWT_SECRET = "offline-verifier-secret";
    process.env.AUTH_BYPASS = "false";
    const modules = await (async (): Promise<RuntimeModules> => {
      const [{ config }, { getDb }, { episodeRepository }, { youtubeTrailerJobRepository }, draft, trailer, media, preparation, artifact, publication, retention, jobService] = await Promise.all([
        import("../config/env.js"),
        import("../database/sqlite.js"),
        import("../database/repositories/episode.repository.js"),
        import("../database/repositories/youtube-trailer-job.repository.js"),
        import("../services/episode-draft-reservation.service.js"),
        import("../services/episode-trailer-video.service.js"),
        import("../services/episode-media-layout.service.js"),
        import("../services/episode-artifact-preparation.service.js"),
        import("../services/episode-artifact-download.service.js"),
        import("../services/youtube-trailer-publication.service.js"),
        import("../services/episode-trailer-retention.service.js"),
        import("../services/youtube-trailer-job.service.js"),
      ]);
      await import("../database/connect.js").then(({ connectDb }) => connectDb());
      db = getDb();
      return { config, getDb, episodeRepository, youtubeTrailerJobRepository, ...draft, ...trailer, ...media, ...preparation, ...artifact, ...publication, ...retention, ...jobService } as RuntimeModules;
    })();
    await assertFixtureIsolation(fixture, modules);
    await assert.rejects(() => fetch("https://www.googleapis.com/oauth2/v3/token"), /network\/OAuth access is forbidden/);
    const provider = new FakeYoutubeTrailerPublicationProvider();
    await provider.checkReadiness();
    assert.deepEqual(provider.events, ["readiness"]);

    const currentEpisodeId = 170000001;
    seedEpisode(modules, currentEpisodeId);
    await writeCurrentAndLegacyVersions(modules, currentEpisodeId);
    await verifyArtifactDownloadFixture(modules, currentEpisodeId);
    verifyPublicationPersistenceGuards(modules, currentEpisodeId);
    await prepareReadyPublicationJob(modules, currentEpisodeId, "phase17-publish-job");
    await verifyPublicationAndRetention(modules, currentEpisodeId);
    seedEpisode(modules, currentEpisodeId + 2);
    await writeCurrentAndLegacyVersions(modules, currentEpisodeId + 2);
    seedEpisode(modules, currentEpisodeId + 5);
    await writeCurrentAndLegacyVersions(modules, currentEpisodeId + 5);
    seedEpisode(modules, currentEpisodeId + 3);
    await writeCurrentAndLegacyVersions(modules, currentEpisodeId + 3);
    seedEpisode(modules, currentEpisodeId + 4);
    await verifyMetadataBoundaries(modules, currentEpisodeId + 3);
    await verifyPublicationFailureRecovery(modules, currentEpisodeId + 2);
    await verifyRetentionDeletionFailureRecovery(modules, currentEpisodeId + 4);
    await verifyDraftPromotionAndRollback(modules, fixture, currentEpisodeId);
    await verifyProtectedPublicationBoundary();

    await verifyExistingVerifierCommandContract();
    console.log("offline Phase 17 publication harness verified isolated fixtures, artifact downloads, draft promotion/rollback, fake-provider injection, and network/OAuth tripwire");
  } finally {
    restoreNetwork();
    db?.close();
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
