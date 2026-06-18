import { Router } from "express";
import { z } from "zod";
import { authenticateGoogleIdToken, signAccessToken } from "../auth/auth.service";
import { requireAuth } from "../middleware/auth.middleware";

const loginSchema = z.object({
  idToken: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/google", async (req, res, next) => {
  try {
    const { idToken } = loginSchema.parse(req.body);
    const user = await authenticateGoogleIdToken(idToken);
    const accessToken = signAccessToken(user);

    res.json({ accessToken, user });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
