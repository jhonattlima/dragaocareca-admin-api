import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

type Fixture = { root: string; media: string; generated: string; database: string };

const createFixture = async (): Promise<Fixture> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dc-trailer-approval-"));
  const media = path.join(root, "media");
  const generated = path.join(root, "generated");
  process.env.NODE_ENV = "development";
  process.env.SQLITE_PATH = path.join(root, "approval.sqlite");
  process.env.SQLITE_RESET = "true";
  process.env.MEDIA_STORAGE_ROOT = media;
  process.env.MEDIA_EPISODES_DIR = path.join(media, "episodes");
  process.env.MEDIA_EPISODES_STAGING_DIR = path.join(media, "staging");
  process.env.MEDIA_BACKUP_ROOT = path.join(media, "backups");
  process.env.MEDIA_BACKUP_EPISODES_DIR = path.join(media, "backups", "episodes");
  process.env.TRAILER_CANDIDATES_ROOT = path.join(generated, "trailer-candidates");
  process.env.TRAILER_CANDIDATE_RENDER_ENABLED = "true";
  process.env.PROMOTION_ENABLED = "false";
  process.env.PROMOTION_LEGACY_LAUNCH_ENABLED = "false";
  process.env.META_INSTAGRAM_ENABLED = "false";
  process.env.META_FACEBOOK_REEL_ENABLED = "false";
  process.env.FEED_BASE_LINK = "https://example.test/episodes";
  process.env.FEED_AUDIO_BASE = "https://example.test/media";
  process.env.FEED_IMAGE_BASE = "https://example.test/images/";
  process.env.FEED_TITLE = "Test feed";
  process.env.FEED_DESCRIPTION = "Offline approval fixture";
  process.env.FEED_SITE = "https://example.test";
  return { root, media, generated, database: process.env.SQLITE_PATH };
};

class MemoryResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  jsonBody: unknown;
  _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { callback(); }
  setHeader(name: string, value: string): this { this.headers[name.toLowerCase()] = value; return this; }
  status(code: number): this { this.statusCode = code; return this; }
  json(body: unknown): this { this.jsonBody = body; this.end(); return this; }
}

type Handler = (req: any, res: MemoryResponse, next: (error?: unknown) => void) => void | Promise<void>;
type Layer = { route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: Handler }> } };
type Router = { stack?: Layer[] };

class Request extends Readable {
  params: Record<string, string>;
  body: unknown;
  headers = {};
  user?: { email: string };
  constructor(params: Record<string, string>, body: unknown) { super(); this.params = params; this.body = body; this.push(null); }
  _read(): void {}
}

const invoke = async (router: Router, routePath: string, req: Request): Promise<MemoryResponse> => {
  const route = router.stack?.find((layer) => layer.route?.path === routePath && layer.route.methods?.post)?.route;
  if (!route?.stack) throw new Error(`route not found: ${routePath}`);
  const response = new MemoryResponse();
  await new Promise<void>((resolve, reject) => {
    let index = 0;
    const next = (error?: unknown): void => {
      if (error) { reject(error); return; }
      const handler = route.stack?.[index++]?.handle;
      if (!handler) { resolve(); return; }
      Promise.resolve(handler(req, response, next)).then(() => {
        if (response.writableEnded) resolve();
      }).catch(reject);
    };
    response.once("finish", resolve);
    response.once("error", reject);
    next();
  });
  return response;
};

const episodeInput = (episodeId: number) => ({
  episodeId,
  title: `Approval fixture ${episodeId}`,
  summary: "Offline only",
  pubDate: new Date("2026-01-01T00:00:00.000Z"),
  explicit: "no" as const,
  authors: [], guests: [], tags: [], citations: [],
  musicCredits: [JSON.stringify({ name: "Fixture", links: [{ url: "https://example.test/fixture" }] })],
  coverCredits: [],
});

const main = async (): Promise<void> => {
  if (process.argv.includes("--fake-only") === false) throw new Error("Approval verifier requires --fake-only");
  if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") throw new Error("Approval verifier is development-only");
  const serverSource = await fs.promises.readFile(path.resolve(process.cwd(), "src/server.ts"), "utf8");
  const recoveryImport = serverSource.indexOf("recoverTrailerPromotionJournals");
  const recoveryCall = serverSource.indexOf("await recoverTrailerPromotionJournals()");
  const workerStart = serverSource.indexOf("await startEpisodeArtifactPreparationWorker()");
  assert.ok(recoveryImport >= 0 && recoveryCall > recoveryImport && workerStart > recoveryCall, "startup must reconcile unfinished trailer journals before workers start");
  const fixture = await createFixture();
  const originalWorkingDirectory = process.cwd();
  process.chdir(fixture.root);
  const originalFetch = globalThis.fetch;
  let transportCalls = 0;
  const metaCalls = { instagram: 0, facebook: 0 };
  globalThis.fetch = (async () => { throw new Error("network access is prohibited by approval verifier"); }) as typeof fetch;
  try {
    const [{ connectDb }, { getDb }, { episodeRepository }, { episodeSchema }, media, candidates, candidateRepoModule, { config }, { episodesRouter }, { episodePromotionRepository }, { episodePublicationRepository }, trailerVideoService] = await Promise.all([
      import("../database/connect.js"),
      import("../database/sqlite.js"),
      import("../database/repositories/episode.repository.js"),
      import("../schemas/episode.js"),
      import("../services/episode-media-layout.service.js"),
      import("../services/trailer-candidate.service.js"),
      import("../database/repositories/trailer-candidate.repository.js"),
      import("../config/env.js"),
      import("../routes/episodes.routes.js"),
      import("../database/repositories/episode-promotion.repository.js"),
      import("../database/repositories/episode-publication.repository.js"),
      import("../services/episode-trailer-video.service.js"),
    ]);
    const { trailerCandidateRepository: candidateRepo } = candidateRepoModule;
    await connectDb();
    config.auth.bypassInDev = true;

    const createReadyCandidate = async (episodeId: number, coverBytes: string, audioBytes: string) => {
      episodeRepository.create(episodeSchema.parse(episodeInput(episodeId)));
      const coverPath = media.getEpisodeMediaStagingPath(episodeId, "cover");
      const audioPath = media.getEpisodeMediaStagingPath(episodeId, "trailer");
      await fs.promises.mkdir(path.dirname(coverPath), { recursive: true });
      await fs.promises.writeFile(coverPath, coverBytes);
      await fs.promises.writeFile(audioPath, audioBytes);
      const created = await candidates.enqueueTrailerCandidate(episodeId, "operator@example.test");
      if (created.waitingForInput) throw new Error("candidate fixture unexpectedly lacks input");
      const row = candidateRepo.findById(created.candidate.candidateId);
      assert.ok(row);
      const outputPath = await candidates.trailerCandidateStoragePath(`${row.candidateId}/candidate.mp4`);
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, `candidate-output-${episodeId}`);
      assert.ok(candidateRepo.claim(row.candidateId, `attempt-${episodeId}`));
      assert.equal(candidateRepo.markReady(row.candidateId, {
        relativePath: `${row.candidateId}/candidate.mp4`,
        sha256: (await import("node:crypto")).createHash("sha256").update(`candidate-output-${episodeId}`).digest("hex"),
        bytes: Buffer.byteLength(`candidate-output-${episodeId}`),
        durationSeconds: 12,
        probeJson: JSON.stringify({ width: 1280, height: 1280, videoCodec: "h264", audioCodec: "aac" }),
      }), true);
      return candidateRepo.findById(row.candidateId)!;
    };

    const target = await createReadyCandidate(981001, "cover-a", "audio-a");
    const finalPath = media.getEpisodeMediaFinalPath(target.episodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.promises.writeFile(finalPath, "old-canonical");
    media.getEpisodeMediaRelativePath(target.episodeId, "trailerVideo");

    const approvalResponse = await invoke(episodesRouter as unknown as Router, "/:episodeId/trailer-candidates/:candidateId/decision", new Request({
      episodeId: String(target.episodeId), candidateId: target.candidateId,
    }, { decision: "approve", expectedSourceFingerprint: target.sourceFingerprint, expectedVersion: target.version }));
    assert.equal(approvalResponse.statusCode, 200);
    assert.equal((approvalResponse.jsonBody as any).status, "approved");
    assert.equal(await fs.promises.readFile(finalPath, "utf8"), `candidate-output-${target.episodeId}`);
    assert.equal(episodeRepository.findByEpisodeId(target.episodeId)?.trailerVideoFileName, `episodes/${target.episodeId}/trailer.mp4`);
    assert.equal((getDb().prepare("SELECT actor_email, decision FROM trailer_candidate_decisions WHERE candidate_id = ?").get(target.candidateId) as any).actor_email, "dev-bypass@local");
    const notification = episodePromotionRepository.findPromotionIntent(`episode:${target.episodeId}`);
    assert.ok(notification);
    assert.equal(notification?.effects.filter((effect: any) => effect.sourceRevision === notification.notification.sourceRevision).length, 2);
    const replacementEffects = episodePublicationRepository.list(target.episodeId);
    assert.equal(replacementEffects.length, 0, "disabled destinations must not receive publication rows");
    assert.equal(transportCalls, 0, "the feature-disabled verifier must not dispatch a live handoff");
    const replay = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: target.episodeId, candidateId: target.candidateId, decision: "approve",
      expectedSourceFingerprint: target.sourceFingerprint, expectedVersion: target.version, actorEmail: "operator@example.test",
    });
    assert.equal(replay.status, "replayed");
    assert.equal(transportCalls, 0);
    config.meta.instagramEnabled = false;
    config.meta.facebookReelEnabled = false;

    const stale = await createReadyCandidate(981002, "cover-stale", "audio-stale");
    const staleFinal = media.getEpisodeMediaFinalPath(stale.episodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(staleFinal), { recursive: true });
    await fs.promises.writeFile(staleFinal, "keep-stale-canonical");
    await fs.promises.writeFile(media.getEpisodeMediaStagingPath(stale.episodeId, "trailer"), "changed-audio");
    const staleResult = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: stale.episodeId, candidateId: stale.candidateId, decision: "approve",
      expectedSourceFingerprint: stale.sourceFingerprint, expectedVersion: stale.version, actorEmail: "operator@example.test",
    });
    assert.deepEqual(staleResult, { status: "conflict", code: "stale" });
    assert.equal(await fs.promises.readFile(staleFinal, "utf8"), "keep-stale-canonical");
    assert.equal(getDb().prepare("SELECT 1 FROM trailer_candidate_decisions WHERE candidate_id = ?").get(stale.candidateId), undefined);
    assert.equal(episodePublicationRepository.list(stale.episodeId).length, 0, "stale approval must create zero publication effects");

    const raced = await createReadyCandidate(981012, "cover-race", "audio-race");
    const racedFinal = media.getEpisodeMediaFinalPath(raced.episodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(racedFinal), { recursive: true });
    await fs.promises.writeFile(racedFinal, "keep-raced-canonical");
    const { withEpisodeSourceMutationLock } = await import("../services/episode-source-mutation-lock.service.js");
    let sourceWriteStarted: () => void = () => undefined;
    const sourceStarted = new Promise<void>((resolve) => { sourceWriteStarted = resolve; });
    let releaseSourceWrite: () => void = () => undefined;
    const sourceWriteRelease = new Promise<void>((resolve) => { releaseSourceWrite = resolve; });
    const sourceWrite = withEpisodeSourceMutationLock(raced.episodeId, async () => {
      await fs.promises.writeFile(media.getEpisodeMediaStagingPath(raced.episodeId, "trailer"), "audio-changed-under-guard");
      sourceWriteStarted();
      await sourceWriteRelease;
    });
    await sourceStarted;
    const racedApproval = (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: raced.episodeId, candidateId: raced.candidateId, decision: "approve",
      expectedSourceFingerprint: raced.sourceFingerprint, expectedVersion: raced.version, actorEmail: "operator@example.test",
    });
    releaseSourceWrite();
    await sourceWrite;
    assert.deepEqual(await racedApproval, { status: "conflict", code: "stale" }, "approval must wait for a source writer using the shared episode guard, then reject its now-stale render");
    assert.equal(await fs.promises.readFile(racedFinal, "utf8"), "keep-raced-canonical");
    assert.equal(getDb().prepare("SELECT 1 FROM trailer_candidate_decisions WHERE candidate_id = ?").get(raced.candidateId), undefined);

    const { episodeSourceMutationLockMiddleware } = await import("../services/episode-source-mutation-lock.service.js");
    const guardedResponse = new MemoryResponse();
    let middlewareNext: () => void = () => undefined;
    const middlewareEntered = new Promise<void>((resolve) => { middlewareNext = resolve; });
    episodeSourceMutationLockMiddleware(
      { params: { episodeId: "981014" } } as any,
      guardedResponse as any,
      () => middlewareNext(),
    );
    await middlewareEntered;
    guardedResponse.emit("close");
    let waitingWriterEntered = false;
    const waitingWriter = withEpisodeSourceMutationLock(981014, async () => { waitingWriterEntered = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(waitingWriterEntered, false, "a disconnected response must not release the source guard before its handler completes");
    guardedResponse.json({ done: true });
    await waitingWriter;
    assert.equal(waitingWriterEntered, true);

    const rejected = await createReadyCandidate(981003, "cover-reject", "audio-reject");
    const rejectFinal = media.getEpisodeMediaFinalPath(rejected.episodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(rejectFinal), { recursive: true });
    await fs.promises.writeFile(rejectFinal, "keep-rejected-canonical");
    const rejectResponse = await invoke(episodesRouter as unknown as Router, "/:episodeId/trailer-candidates/:candidateId/decision", new Request({
      episodeId: String(rejected.episodeId), candidateId: rejected.candidateId,
    }, { decision: "reject", expectedSourceFingerprint: rejected.sourceFingerprint, expectedVersion: rejected.version }));
    assert.equal(rejectResponse.statusCode, 200);
    assert.equal((rejectResponse.jsonBody as any).status, "rejected");
    assert.equal(await fs.promises.readFile(rejectFinal, "utf8"), "keep-rejected-canonical");
    assert.equal(episodePublicationRepository.list(rejected.episodeId).length, 0, "rejection must create zero publication effects");
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM trailer_promotion_journals WHERE episode_id = ?").get(rejected.episodeId)?.count, 0);
    const rejectedReplay = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: rejected.episodeId, candidateId: rejected.candidateId, decision: "reject",
      expectedSourceFingerprint: rejected.sourceFingerprint, expectedVersion: rejected.version, actorEmail: "operator@example.test",
    });
    assert.deepEqual(rejectedReplay, { status: "conflict", code: "stale" }, "a rejected candidate is superseded and must fail the current-revision guard before the decision replay check");

    const wrongFingerprint = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: rejected.episodeId, candidateId: rejected.candidateId, decision: "approve",
      expectedSourceFingerprint: "0".repeat(64), expectedVersion: rejected.version, actorEmail: "operator@example.test",
    });
    assert.deepEqual(wrongFingerprint, { status: "conflict", code: "fingerprint_mismatch" });

    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = true;
    const fakeDispatchCandidate = await createReadyCandidate(981004, "cover-fake", "audio-fake");
    const fakeDispatch = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: fakeDispatchCandidate.episodeId, candidateId: fakeDispatchCandidate.candidateId, decision: "approve",
      expectedSourceFingerprint: fakeDispatchCandidate.sourceFingerprint, expectedVersion: fakeDispatchCandidate.version,
      actorEmail: "operator@example.test",
      metaProvider: {
        async createInstagramContainer() { metaCalls.instagram += 1; return { id: "fake-instagram-container" }; },
        async getInstagramContainer() { metaCalls.instagram += 1; return { id: "fake-instagram-container", status: "FINISHED" }; },
        async publishInstagramContainer() { metaCalls.instagram += 1; return { id: "fake-instagram-published", permalink: "https://example.test/ig" }; },
        async uploadFacebookVideo() { metaCalls.facebook += 1; return { id: "fake-facebook-upload" }; },
        async getFacebookVideo() { metaCalls.facebook += 1; return { id: "fake-facebook-upload", status: "upload_complete" }; },
        async publishFacebookVideo() { metaCalls.facebook += 1; return { id: "fake-facebook-published", permalink: "https://example.test/fb" }; },
      },
      transport: {
        async sendPromotion(_request, effects) {
          transportCalls += 1;
          return { contract_version: "episode-promotion.v1", notification_id: `episode:${fakeDispatchCandidate.episodeId}`, status: "complete", effects: effects.map((effect) => ({ destination: effect.destination, status: "complete", acknowledged_at: new Date().toISOString() })) };
        },
      },
    });
    assert.equal(fakeDispatch.status, "approved");
    assert.equal(transportCalls, 1, "the fake Telegram handoff is dispatched exactly once after commit");
    assert.deepEqual(metaCalls, { instagram: 3, facebook: 2 });
    const fakeMetaEffects = episodePublicationRepository.list(fakeDispatchCandidate.episodeId);
    assert.deepEqual(fakeMetaEffects.map((effect: any) => effect.destination).sort(), ["facebook_native_video", "instagram_reel"]);
    assert.equal(new Set(fakeMetaEffects.map((effect: any) => effect.sourceRevision)).size, 1);
    assert.equal(fakeMetaEffects.every((effect: any) => effect.lifecycle === "published"), true, "both enabled fake destinations complete the approved revision");
    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = false;
    const instagramOnly = await createReadyCandidate(981009, "cover-ig", "audio-ig");
    const instagramOnlyApproval = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: instagramOnly.episodeId, candidateId: instagramOnly.candidateId, decision: "approve",
      expectedSourceFingerprint: instagramOnly.sourceFingerprint, expectedVersion: instagramOnly.version,
      actorEmail: "operator@example.test",
      metaProvider: {
        async createInstagramContainer() { return { id: "fake-ig-only-container" }; },
        async getInstagramContainer() { return { id: "fake-ig-only-container", status: "FINISHED" }; },
        async publishInstagramContainer() { return { id: "fake-ig-only-published" }; },
        async uploadFacebookVideo() { throw new Error("disabled Facebook destination was called"); },
        async getFacebookVideo() { throw new Error("disabled Facebook destination was called"); },
        async publishFacebookVideo() { throw new Error("disabled Facebook destination was called"); },
      },
    });
    assert.equal(instagramOnlyApproval.status, "approved");
    assert.deepEqual(episodePublicationRepository.list(instagramOnly.episodeId).map((effect: any) => effect.destination), ["instagram_reel"]);
    config.meta.instagramEnabled = false;
    config.meta.facebookReelEnabled = false;

    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = true;
    const afterCommit = await createReadyCandidate(981010, "cover-after-commit", "audio-after-commit");
    const afterCommitFinal = media.getEpisodeMediaFinalPath(afterCommit.episodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(afterCommitFinal), { recursive: true });
    await fs.promises.writeFile(afterCommitFinal, "old-before-commit-crash");
    const providerCallsBeforeCommitCrash = { ...metaCalls };
    const interruptedAfterCommit = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: afterCommit.episodeId, candidateId: afterCommit.candidateId, decision: "approve",
      expectedSourceFingerprint: afterCommit.sourceFingerprint, expectedVersion: afterCommit.version,
      actorEmail: "operator@example.test", faultAt: "after_commit",
    });
    assert.deepEqual(interruptedAfterCommit, { status: "conflict", code: "finalization_blocked" });
    assert.equal(await fs.promises.readFile(afterCommitFinal, "utf8"), `candidate-output-${afterCommit.episodeId}`);
    assert.equal(getDb().prepare("SELECT phase FROM trailer_promotion_journals WHERE candidate_id = ?").get(afterCommit.candidateId)?.phase, "committed");
    assert.deepEqual(metaCalls, providerCallsBeforeCommitCrash, "no Meta dispatcher may run before the approval commit returns");
    assert.equal(episodePublicationRepository.listDueSocialEffects().filter((row: any) => row.episodeId === afterCommit.episodeId).length, 2, "eligible replacement effects remain restart-dispatchable after commit");
    await (await import("../services/trailer-candidate-approval.service.js")).recoverTrailerPromotionJournals();
    const afterCommitBackups = (await fs.promises.readdir(path.dirname(afterCommitFinal))).filter((name) => name.startsWith(".trailer.mp4.backup-"));
    assert.equal(afterCommitBackups.length, 0, "startup cleanup removes the old file only after the approval transaction commits");
    const { dispatchEpisodeReplacementPublication } = await import("../services/episode-publication.service.js");
    const restartDelivery = await dispatchEpisodeReplacementPublication(afterCommit.episodeId, episodePublicationRepository.list(afterCommit.episodeId)[0].sourceRevision, {
      async createInstagramContainer() { metaCalls.instagram += 1; return { id: "restart-ig-container" }; },
      async getInstagramContainer() { metaCalls.instagram += 1; return { id: "restart-ig-container", status: "FINISHED" }; },
      async publishInstagramContainer() { metaCalls.instagram += 1; return { id: "restart-ig-published" }; },
      async uploadFacebookVideo() { metaCalls.facebook += 1; return { id: "restart-fb-upload" }; },
      async getFacebookVideo() { metaCalls.facebook += 1; return { id: "restart-fb-upload", status: "upload_complete" }; },
      async publishFacebookVideo() { metaCalls.facebook += 1; return { id: "restart-fb-published" }; },
    });
    assert.equal(restartDelivery.every((effect: any) => effect.lifecycle === "published"), true);
    const effectsAfterRestartDelivery = getDb().prepare("SELECT COUNT(*) AS count FROM episode_publication_effects WHERE episode_id = ?").get(afterCommit.episodeId)?.count;
    assert.equal(effectsAfterRestartDelivery, 2);
    const replayAfterCommit = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: afterCommit.episodeId, candidateId: afterCommit.candidateId, decision: "approve",
      expectedSourceFingerprint: afterCommit.sourceFingerprint, expectedVersion: afterCommit.version, actorEmail: "operator@example.test",
    });
    assert.equal(replayAfterCommit.status, "replayed");
    config.meta.instagramEnabled = false;
    config.meta.facebookReelEnabled = false;

    const { recoverTrailerPromotionJournals } = await import("../services/trailer-candidate-approval.service.js");
    const recoveryCases = [
      { episodeId: 981005, faultAt: "after_journal" as const, previous: "keep-before-rename", expectedBeforeRecovery: "keep-before-rename" },
      { episodeId: 981006, faultAt: "after_backup" as const, previous: "keep-in-backup", expectedBeforeRecovery: null },
      { episodeId: 981007, faultAt: "after_install" as const, previous: null, expectedBeforeRecovery: "candidate-output-981007" },
      { episodeId: 981013, faultAt: "during_commit" as const, previous: "keep-after-rollback", expectedBeforeRecovery: "keep-after-rollback" },
    ];
    for (const scenario of recoveryCases) {
      const interrupted = await createReadyCandidate(scenario.episodeId, `cover-${scenario.episodeId}`, `audio-${scenario.episodeId}`);
      const interruptedFinal = media.getEpisodeMediaFinalPath(scenario.episodeId, "trailerVideo");
      await fs.promises.mkdir(path.dirname(interruptedFinal), { recursive: true });
      if (scenario.previous) await fs.promises.writeFile(interruptedFinal, scenario.previous);
      const failed = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
        episodeId: interrupted.episodeId, candidateId: interrupted.candidateId, decision: "approve",
        expectedSourceFingerprint: interrupted.sourceFingerprint, expectedVersion: interrupted.version,
        actorEmail: "operator@example.test", faultAt: scenario.faultAt,
      });
      assert.deepEqual(failed, { status: "conflict", code: "finalization_blocked" });
      if (scenario.faultAt === "during_commit") {
        assert.equal(getDb().prepare("SELECT phase FROM trailer_promotion_journals WHERE candidate_id = ?").get(interrupted.candidateId)?.phase, "aborted");
        const retry = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
          episodeId: interrupted.episodeId, candidateId: interrupted.candidateId, decision: "approve",
          expectedSourceFingerprint: interrupted.sourceFingerprint, expectedVersion: interrupted.version,
          actorEmail: "operator@example.test",
        });
        assert.deepEqual(retry, { status: "conflict", code: "finalization_blocked" }, "an aborted approval must never be reported as a successful replay");
      }
      assert.equal(await fs.promises.readFile(interruptedFinal, "utf8").catch(() => null), scenario.expectedBeforeRecovery);
      assert.equal(episodePublicationRepository.list(scenario.episodeId).length, 0, "an interrupted approval cannot expose replacement effects before SQLite finalization");
      if (scenario.faultAt === "after_backup") {
        const siblings = await fs.promises.readdir(path.dirname(interruptedFinal));
        const backups = siblings.filter((name) => name.startsWith(".trailer.mp4.backup-"));
        assert.equal(backups.length, 1);
        assert.equal(await fs.promises.readFile(path.join(path.dirname(interruptedFinal), backups[0]), "utf8"), scenario.previous);
      }
      await recoverTrailerPromotionJournals();
      if (scenario.faultAt === "during_commit") {
        assert.equal(await fs.promises.readFile(interruptedFinal, "utf8"), scenario.expectedBeforeRecovery);
        assert.equal(getDb().prepare("SELECT phase FROM trailer_promotion_journals WHERE candidate_id = ?").get(interrupted.candidateId)?.phase, "aborted");
        continue;
      }
      assert.equal(await fs.promises.readFile(interruptedFinal, "utf8"), `candidate-output-${scenario.episodeId}`);
      assert.equal(getDb().prepare("SELECT phase FROM trailer_promotion_journals WHERE candidate_id = ?").get(interrupted.candidateId)?.phase, "committed");
      const recoveredReplay = await (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
        episodeId: interrupted.episodeId, candidateId: interrupted.candidateId, decision: "approve",
        expectedSourceFingerprint: interrupted.sourceFingerprint, expectedVersion: interrupted.version,
        actorEmail: "operator@example.test",
      });
      assert.equal(recoveredReplay.status, "replayed", "only a recovered committed journal with matching canonical hash may replay successfully");
      const effectsBeforeReplay = getDb().prepare("SELECT COUNT(*) AS count FROM promotion_effects WHERE episode_id = ?").get(scenario.episodeId)?.count;
      const backupNames = (await fs.promises.readdir(path.dirname(interruptedFinal))).filter((name) => name.startsWith(".trailer.mp4.backup-"));
      assert.equal(backupNames.length, 0, "committed journal may clean up the backup only after SQLite finalization");
      await recoverTrailerPromotionJournals();
      assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM promotion_effects WHERE episode_id = ?").get(scenario.episodeId)?.count, effectsBeforeReplay);
      assert.equal(episodePublicationRepository.list(scenario.episodeId).length, 0, "disabled Meta destinations stay effect-free through restart and retry");
      assert.equal(await fs.promises.readFile(interruptedFinal, "utf8"), `candidate-output-${scenario.episodeId}`);
    }
    config.auth.bypassInDev = false;
    const unauthorized = await invoke(episodesRouter as unknown as Router, "/:episodeId/trailer-candidates/:candidateId/decision", new Request({
      episodeId: String(rejected.episodeId), candidateId: rejected.candidateId,
    }, { decision: "approve", expectedSourceFingerprint: rejected.sourceFingerprint, expectedVersion: rejected.version }));
    assert.equal(unauthorized.statusCode, 401);
    config.auth.bypassInDev = true;
    const manualEpisodeId = 981008;
    episodeRepository.create(episodeSchema.parse(episodeInput(manualEpisodeId)));
    const manualFinal = media.getEpisodeMediaFinalPath(manualEpisodeId, "trailerVideo");
    const manualStage = media.getEpisodeMediaStagingPath(manualEpisodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(manualStage), { recursive: true });
    await fs.promises.mkdir(path.dirname(manualFinal), { recursive: true });
    await fs.promises.writeFile(manualFinal, "old-manual-canonical");
    await fs.promises.writeFile(manualStage, "manual-upload-bytes");
    const manualResult = await trailerVideoService.replaceEpisodeTrailerVideo(manualEpisodeId, manualStage);
    assert.equal(manualResult?.trailerVideoFileName, `episodes/${manualEpisodeId}/trailer.mp4`);
    assert.equal(await fs.promises.readFile(manualFinal, "utf8"), "manual-upload-bytes");
    assert.equal(getDb().prepare("SELECT phase FROM trailer_promotion_journals WHERE episode_id = ? AND candidate_id IS NULL").get(manualEpisodeId)?.phase, "committed", "manual upload must share the durable finalization journal");
    assert.equal(episodePublicationRepository.list(manualEpisodeId).length, 0, "manual upload keeps its existing no-dispatch semantics");

    config.meta.instagramEnabled = true;
    config.meta.facebookReelEnabled = false;
    const concurrent = await createReadyCandidate(981011, "cover-concurrent", "audio-concurrent");
    const concurrentFinal = media.getEpisodeMediaFinalPath(concurrent.episodeId, "trailerVideo");
    const concurrentStage = media.getEpisodeMediaStagingPath(concurrent.episodeId, "trailerVideo");
    await fs.promises.mkdir(path.dirname(concurrentFinal), { recursive: true });
    await fs.promises.writeFile(concurrentFinal, "old-concurrent-canonical");
    await fs.promises.mkdir(path.dirname(concurrentStage), { recursive: true });
    await fs.promises.writeFile(concurrentStage, "manual-wins-after-approval");
    let markInstagramStarted: () => void = () => undefined;
    const instagramStarted = new Promise<void>((resolve) => { markInstagramStarted = resolve; });
    let releaseInstagram: () => void = () => undefined;
    const instagramRelease = new Promise<void>((resolve) => { releaseInstagram = resolve; });
    const concurrentApproval = (await import("../services/trailer-candidate-approval.service.js")).decideTrailerCandidate({
      episodeId: concurrent.episodeId, candidateId: concurrent.candidateId, decision: "approve",
      expectedSourceFingerprint: concurrent.sourceFingerprint, expectedVersion: concurrent.version,
      actorEmail: "operator@example.test",
      metaProvider: {
        async createInstagramContainer() { markInstagramStarted(); await instagramRelease; return { id: "concurrent-ig-container" }; },
        async getInstagramContainer() { return { id: "concurrent-ig-container", status: "FINISHED" }; },
        async publishInstagramContainer() { return { id: "concurrent-ig-published" }; },
        async uploadFacebookVideo() { throw new Error("disabled Facebook destination was called"); },
        async getFacebookVideo() { throw new Error("disabled Facebook destination was called"); },
        async publishFacebookVideo() { throw new Error("disabled Facebook destination was called"); },
      },
    });
    await instagramStarted;
    let manualCompleted = false;
    const concurrentManual = trailerVideoService.replaceEpisodeTrailerVideo(concurrent.episodeId, concurrentStage)
      .then((value: any) => { manualCompleted = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(manualCompleted, false, "manual replacement must wait while candidate approval owns the episode finalization lock");
    assert.equal(await fs.promises.readFile(concurrentFinal, "utf8"), `candidate-output-${concurrent.episodeId}`);
    releaseInstagram();
    assert.equal((await concurrentApproval).status, "approved");
    assert.equal((await concurrentManual)?.trailerVideoFileName, `episodes/${concurrent.episodeId}/trailer.mp4`);
    assert.equal(await fs.promises.readFile(concurrentFinal, "utf8"), "manual-wins-after-approval", "serialized manual replacement must not be overwritten by the older approval");
    assert.equal(getDb().prepare("SELECT phase FROM trailer_promotion_journals WHERE episode_id = ? AND candidate_id IS NULL").get(concurrent.episodeId)?.phase, "committed");
    assert.equal(episodePublicationRepository.list(concurrent.episodeId).length, 1, "only the approved replacement creates a Meta effect; manual finalization adds none");
    config.meta.instagramEnabled = false;
    assert.equal(transportCalls, 1, "rejection, stale, replay, and invalid decisions must not dispatch extra effects");
    assert.equal((await fs.promises.readdir(fixture.root)).some((name) => name.includes("production")), false);
    console.log("trailer candidate approval passed: authenticated CAS, output/source validation, canonical replacement, journal restart recovery, replay, rejection isolation, stale conflicts, and fake-only after-commit handoff");
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalWorkingDirectory);
    const rootStat = await fs.promises.lstat(fixture.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || path.dirname(path.resolve(fixture.root)) !== path.resolve(os.tmpdir())) {
      throw new Error("Refusing to remove a trailer candidate approval root that no longer matches its temporary identity");
    }
    await fs.promises.rm(fixture.root, { recursive: true, force: false });
    assert.equal(await fs.promises.access(fixture.root).then(() => true).catch(() => false), false, "approval fixture root must be absent after cleanup");
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
