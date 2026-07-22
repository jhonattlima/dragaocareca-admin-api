import fs from "node:fs";
import { config } from "../config/env";

export type PublicSupportersResponse = {
  supportUrl: string;
  supporters: string[];
};

type SupportersFile = {
  supporters?: unknown;
};

const normalizeSupporterName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const uniqueSortedNames = (values: unknown[]): string[] => {
  const names = values
    .map(normalizeSupporterName)
    .filter((value): value is string => value !== null);

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "pt-BR"));
};

export const getPublicSupporters = (): PublicSupportersResponse => {
  const raw = fs.readFileSync(config.public.supportersDataFile, "utf8");
  const parsed = JSON.parse(raw) as SupportersFile;
  const supporters = Array.isArray(parsed.supporters) ? uniqueSortedNames(parsed.supporters) : [];

  return {
    supportUrl: config.public.supportersLink,
    supporters,
  };
};
