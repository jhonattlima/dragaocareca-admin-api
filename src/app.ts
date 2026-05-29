import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import { swaggerSpec } from "./docs/openapi";
import { authRouter } from "./routes/auth.routes";
import { episodesRouter } from "./routes/episodes.routes";
import { feedRouter } from "./routes/feed.routes";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get("/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});

app.use("/v1/auth", authRouter);
app.use("/v1/episodes", episodesRouter);
app.use("/v1/feed", feedRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Validation failed", issues: error.issues });
    return;
  }

  if (error instanceof Error) {
    const authConfigError =
      error.message.includes("GOOGLE_CLIENT_ID") || error.message.includes("JWT_SECRET");
    res.status(authConfigError ? 500 : 400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected error" });
});
