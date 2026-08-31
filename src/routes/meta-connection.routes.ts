import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { getMetaConnectionStatus } from "../services/meta-connection.service";

export const metaConnectionRouter = Router();

metaConnectionRouter.get("/status", requireAuth, async (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json(await getMetaConnectionStatus());
  } catch (error) {
    next(error);
  }
});
