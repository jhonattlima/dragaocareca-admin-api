import fs from "node:fs";
import { config } from "../config/env";

export type PublicAboutResponse = {
  title: string;
  description: string;
};

export type PublicContactResponse = {
  email: string;
  characterSheetsBaseUrl: string;
};

export type PublicSiteConfigResponse = {
  email: string;
  supportersUrl: string;
  characterSheetsBaseUrl: string;
  maxEpisodesPerPage: number;
  transitionTimeMs: number;
  disqus: {
    shortName: string;
  };
};

export type PublicSocialResponse = typeof config.public.social;

export type PublicAuthorContact = {
  name: string;
  character: string | null;
  contacts: Record<string, string>;
};

export type PublicContactsResponse = {
  authors: PublicAuthorContact[];
};

type RawPublicAuthorContact = {
  name?: unknown;
  character?: unknown;
  contacts?: unknown;
};

type RawLegacyContactsFile = {
  "0"?: unknown;
  authors?: unknown;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeContactsMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => {
        const normalized = normalizeString(entry);
        return normalized ? [key, normalized] : null;
      })
      .filter((entry): entry is [string, string] => entry !== null)
  );
};

const normalizeAuthor = (value: unknown): PublicAuthorContact | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as RawPublicAuthorContact;
  const name = normalizeString(candidate.name);
  if (!name) {
    return null;
  }

  return {
    name,
    character: normalizeString(candidate.character),
    contacts: normalizeContactsMap(candidate.contacts),
  };
};

export const getPublicAbout = (): PublicAboutResponse => ({
  title: config.public.aboutTitle,
  description: config.public.aboutDescription,
});

export const getPublicContact = (): PublicContactResponse => ({
  email: config.public.email,
  characterSheetsBaseUrl: config.public.characterSheetsBaseUrl,
});

export const getPublicSiteConfig = (): PublicSiteConfigResponse => ({
  email: config.public.email,
  supportersUrl: config.public.supportersLink,
  characterSheetsBaseUrl: config.public.characterSheetsBaseUrl,
  maxEpisodesPerPage: config.public.maxEpisodesPerPage,
  transitionTimeMs: config.public.transitionTimeMs,
  disqus: {
    shortName: config.public.disqusShortName,
  },
});

export const getPublicSocial = (): PublicSocialResponse => ({
  ...config.public.social,
});

export const getPublicContacts = (): PublicContactsResponse => {
  const raw = fs.readFileSync(config.public.contactsDataFile, "utf8");
  const parsed = JSON.parse(raw) as RawLegacyContactsFile;
  const source = Array.isArray(parsed.authors) ? parsed.authors : Array.isArray(parsed["0"]) ? parsed["0"] : [];
  const authors = source
    .map(normalizeAuthor)
    .filter((entry): entry is PublicAuthorContact => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  return { authors };
};
