import { Router } from "express";
import { getPublicSupporters } from "../services/public-supporters.service";

export const publicSupportersRouter = Router();

publicSupportersRouter.get("/", async (_req, res, next) => {
  try {
    res.json(getPublicSupporters());
  } catch (error) {
    next(error);
  }
});
