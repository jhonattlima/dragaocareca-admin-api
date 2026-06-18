import { Schema, model } from "mongoose";

export interface EpisodeDocument {
  episodeId: number;
  title: string;
  summary: string;
  episodeNumber?: number;
  episodeType?: string;
  pubDate: Date;
  duration?: string;
  bytes?: number;
  explicit: "yes" | "no";
  authors: string[];
  guests: string[];
  tags: string[];
  citations: string[];
  fileName?: string;
  coverFileName?: string;
  coverLowFileName?: string;
  trailerFileName?: string;
  youtube?: string;
  spotifyId?: string;
  xmlSnapshot?: string;
  musicCredits: string[];
  coverCredits: string[];
  launchNotificationState?: "pending" | "sent";
  launchNotificationQueuedAt?: Date;
  launchNotificationSentAt?: Date;
  launchNotificationError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const episodeSchema = new Schema<EpisodeDocument>(
  {
    episodeId: { type: Number, required: true, unique: true, index: true },
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    episodeNumber: Number,
    episodeType: String,
    pubDate: { type: Date, required: true, index: true },
    duration: String,
    bytes: Number,
    explicit: { type: String, enum: ["yes", "no"], default: "no" },
    authors: { type: [String], default: [] },
    guests: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    citations: { type: [String], default: [] },
    fileName: String,
    coverFileName: String,
    coverLowFileName: String,
    trailerFileName: String,
    youtube: String,
    spotifyId: String,
    xmlSnapshot: String,
    musicCredits: { type: [String], default: [] },
    coverCredits: { type: [String], default: [] },
    launchNotificationState: { type: String, enum: ["pending", "sent"] },
    launchNotificationQueuedAt: Date,
    launchNotificationSentAt: Date,
    launchNotificationError: String,
  },
  { timestamps: true }
);

export const EpisodeModel = model<EpisodeDocument>("Episode", episodeSchema);
