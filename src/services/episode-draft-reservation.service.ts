import { randomUUID } from "node:crypto";
import { episodeRepository } from "../database/repositories/episode.repository";
import type { EpisodeTrailerVideoDraftDto, EpisodeTrailerVideoDraftReservation } from "../schemas/episode-draft-state";
import { cleanupEpisodeMediaStaging } from "./episode-media-layout.service";

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

const normalizeOwner = (email: string): string => email.trim().toLowerCase();

export const cleanupExpiredTrailerVideoDrafts = async (now = new Date()): Promise<void> => {
  for (const draft of episodeRepository.expireTrailerVideoDrafts(now)) {
    await cleanupEpisodeMediaStaging(draft.episodeId).catch(() => undefined);
  }
};

export const reserveTrailerVideoDraft = async (episodeId: number, ownerEmail: string, now = new Date()): Promise<EpisodeTrailerVideoDraftDto> => {
  await cleanupExpiredTrailerVideoDrafts(now);
  if (episodeRepository.findByEpisodeId(episodeId)) {
    throw new Error("Episode already exists");
  }
  if (episodeRepository.findActiveTrailerVideoDraftByEpisodeId(episodeId)) {
    throw new Error("Episode draft is already reserved");
  }
  const reservation: EpisodeTrailerVideoDraftReservation = {
    draftId: randomUUID(),
    episodeId,
    ownerEmail: normalizeOwner(ownerEmail),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
    state: "reserved",
  };
  episodeRepository.createTrailerVideoDraft(reservation);
  return { draftId: reservation.draftId, episodeId, state: "reserved", expiresAt: reservation.expiresAt };
};

export type TrailerDraftCheck = { ok: true; reservation: EpisodeTrailerVideoDraftReservation } | { ok: false; status: 401 | 403 | 409; message: string };

export const checkTrailerVideoDraft = (draftId: unknown, episodeId: number, ownerEmail: string, options?: { allowStaged?: boolean }): TrailerDraftCheck => {
  if (typeof draftId !== "string" || !draftId.trim()) return { ok: false, status: 401, message: "Episode draft reservation is required" };
  const reservation = episodeRepository.findTrailerVideoDraft(draftId);
  if (!reservation) return { ok: false, status: 409, message: "Episode draft reservation is invalid" };
  if (new Date(reservation.expiresAt).getTime() <= Date.now()) return { ok: false, status: 409, message: "Episode draft reservation has expired" };
  if (reservation.episodeId !== episodeId) return { ok: false, status: 403, message: "Episode draft reservation does not match episodeId" };
  if (reservation.ownerEmail !== normalizeOwner(ownerEmail)) return { ok: false, status: 403, message: "Episode draft reservation belongs to another user" };
  if (reservation.state === "consumed" || reservation.state === "expired") return { ok: false, status: 409, message: "Episode draft reservation is no longer usable" };
  if (!options?.allowStaged && reservation.state !== "reserved") return { ok: false, status: 409, message: "Episode draft reservation is already staged" };
  return { ok: true, reservation };
};

export const consumeTrailerVideoDraft = (draftId: string, episodeId: number, ownerEmail: string): TrailerDraftCheck => {
  const checked = checkTrailerVideoDraft(draftId, episodeId, ownerEmail, { allowStaged: true });
  if (!checked.ok) return checked;
  if (!episodeRepository.updateTrailerVideoDraftState(draftId, "consumed")) return { ok: false, status: 409, message: "Episode draft reservation could not be consumed" };
  return checked;
};
