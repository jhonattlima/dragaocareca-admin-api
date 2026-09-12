import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../sqlite";

export type TrailerPromotionJournalPhase = "prepared" | "old_backed_up" | "new_installed" | "committed" | "aborted";
export type TrailerPromotionJournal = {
  journalId: string;
  episodeId: number;
  candidateId: string | null;
  oldSha256: string | null;
  newSha256: string;
  oldPresent: boolean;
  phase: TrailerPromotionJournalPhase;
  createdAt: string;
  updatedAt: string;
};

type JournalSqlRow = {
  journal_id: string; episode_id: number; candidate_id: string | null; old_sha256: string | null;
  new_sha256: string; old_present: number; phase: TrailerPromotionJournalPhase; created_at: string; updated_at: string;
};

const map = (row: JournalSqlRow | undefined): TrailerPromotionJournal | null => row ? ({
  journalId: row.journal_id,
  episodeId: row.episode_id,
  candidateId: row.candidate_id,
  oldSha256: row.old_sha256,
  newSha256: row.new_sha256,
  oldPresent: row.old_present === 1,
  phase: row.phase,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
}) : null;

const find = (journalId: string): TrailerPromotionJournal | null => map(
  getDb().prepare("SELECT * FROM trailer_promotion_journals WHERE journal_id = ?").get(journalId) as JournalSqlRow | undefined,
);

export const trailerPromotionJournalRepository = {
  create(input: Omit<TrailerPromotionJournal, "journalId" | "phase" | "createdAt" | "updatedAt"> & { journalId?: string }): TrailerPromotionJournal {
    const journalId = input.journalId ?? randomUUID();
    const now = nowIso();
    getDb().prepare(`INSERT INTO trailer_promotion_journals (
      journal_id, episode_id, candidate_id, old_sha256, new_sha256, old_present, phase, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`).run(
      journalId, input.episodeId, input.candidateId, input.oldSha256, input.newSha256, input.oldPresent ? 1 : 0, now, now,
    );
    return find(journalId) as TrailerPromotionJournal;
  },
  findById: find,
  findByCandidate(candidateId: string): TrailerPromotionJournal | null {
    return map(getDb().prepare("SELECT * FROM trailer_promotion_journals WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1").get(candidateId) as JournalSqlRow | undefined);
  },
  listUnfinished(): TrailerPromotionJournal[] {
    return (getDb().prepare("SELECT * FROM trailer_promotion_journals WHERE phase NOT IN ('committed', 'aborted') ORDER BY created_at, journal_id").all() as JournalSqlRow[]).map((row) => map(row) as TrailerPromotionJournal);
  },
  listCommitted(): TrailerPromotionJournal[] {
    return (getDb().prepare("SELECT * FROM trailer_promotion_journals WHERE phase = 'committed' ORDER BY updated_at, journal_id").all() as JournalSqlRow[]).map((row) => map(row) as TrailerPromotionJournal);
  },
  setPhase(journalId: string, phase: TrailerPromotionJournalPhase): TrailerPromotionJournal | null {
    getDb().prepare("UPDATE trailer_promotion_journals SET phase = ?, updated_at = ? WHERE journal_id = ? AND phase NOT IN ('committed', 'aborted')").run(phase, nowIso(), journalId);
    return find(journalId);
  },
};
