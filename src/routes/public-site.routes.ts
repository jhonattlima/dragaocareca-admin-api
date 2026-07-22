import { Router } from "express";
import {
  getPublicAbout,
  getPublicContact,
  getPublicContacts,
  getPublicSiteConfig,
  getPublicSocial,
} from "../services/public-site-content.service";

export const publicSiteRouter = Router();

publicSiteRouter.get("/about", async (_req, res, next) => {
  try {
    res.json(getPublicAbout());
  } catch (error) {
    next(error);
  }
});

publicSiteRouter.get("/contact", async (_req, res, next) => {
  try {
    res.json(getPublicContact());
  } catch (error) {
    next(error);
  }
});

publicSiteRouter.get("/site-config", async (_req, res, next) => {
  try {
    res.json(getPublicSiteConfig());
  } catch (error) {
    next(error);
  }
});

publicSiteRouter.get("/social", async (_req, res, next) => {
  try {
    res.json(getPublicSocial());
  } catch (error) {
    next(error);
  }
});

publicSiteRouter.get("/contacts", async (_req, res, next) => {
  try {
    res.json(getPublicContacts());
  } catch (error) {
    next(error);
  }
});
