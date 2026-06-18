import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/auth.service";
import { config } from "../config/env";

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (config.nodeEnv === "development" && config.auth.bypassInDev) {
    req.user = { email: "dev-bypass@local" };
    next();
    return;
  }

  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing Bearer token" });
    return;
  }

  const token = raw.slice("Bearer ".length).trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (_error) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};
