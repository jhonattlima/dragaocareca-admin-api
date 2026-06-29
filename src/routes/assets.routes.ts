import { Router } from "express";
import fs from "node:fs/promises";
import { getCoverMosaicBackgroundPath, getCoverMosaicTileUrls } from "../services/cover-mosaic.service";

export const assetsRouter = Router();

assetsRouter.get("/cover-mosaic.svg", async (_req, res, next) => {
  try {
    const filePath = getCoverMosaicBackgroundPath();
    const svg = await fs.readFile(filePath, "utf8");
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(svg);
  } catch (error) {
    next(error);
  }
});

assetsRouter.get("/cover-mosaic.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ tiles: getCoverMosaicTileUrls() });
});
