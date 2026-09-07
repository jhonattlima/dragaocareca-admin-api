import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { getSpotifyMetricsSnapshotSafe } from "../services/spotify-metrics.service";
import { getYouTubeMetricsSnapshotSafe } from "../services/youtube-metrics.service";
import { getSiteUsageMetricsSafe } from "../services/umami-metrics.service";

export const metricsRouter = Router();

metricsRouter.get("/spotify", requireAuth, async (_req, res, next) => {
  try {
    const rawDays = typeof _req.query.days === "string" ? Number.parseInt(_req.query.days, 10) : 30;
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const snapshot = await getSpotifyMetricsSnapshotSafe(days);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

metricsRouter.get("/youtube", requireAuth, async (_req, res, next) => {
  try {
    const rawDays = typeof _req.query.days === "string" ? Number.parseInt(_req.query.days, 10) : 90;
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 90;
    const snapshot = await getYouTubeMetricsSnapshotSafe(days);
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

metricsRouter.get("/site-usage", requireAuth, async (req, res, next) => {
  try {
    const rawDays = typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : 30;
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    res.json(await getSiteUsageMetricsSafe(days));
  } catch (error) {
    next(error);
  }
});
