import { connectDb } from "../database/connect";
import { publicEpisodesRouter } from "../routes/public-episodes.routes";

const assertCatalogContract = (data: unknown): void => {
  if (!Array.isArray(data)) {
    throw new Error("expected array response");
  }

  for (const item of data) {
    if (!item || typeof item !== "object") {
      throw new Error("catalog item must be an object");
    }

    const entry = item as Record<string, unknown>;
    if (typeof entry.episodeId !== "number") throw new Error("missing numeric episodeId");
    if (typeof entry.title !== "string" || !entry.title.trim()) throw new Error("missing title");
    if (typeof entry.pubDate !== "string" || Number.isNaN(Date.parse(entry.pubDate))) {
      throw new Error("invalid pubDate");
    }

    if (!Array.isArray(entry.guests)) {
      throw new Error("invalid guests contract");
    }

    for (const guest of entry.guests) {
      if (!guest || typeof guest !== "object" || typeof (guest as { name?: unknown }).name !== "string") {
        throw new Error("invalid guests[].name contract");
      }
    }

    for (const key of ["pageUrl", "audioUrl", "coverUrl", "trailerUrl"] as const) {
      const value = entry[key];
      if (value != null && (typeof value !== "string" || !/^https?:\/\//.test(value))) {
        throw new Error(`non-absolute ${key}`);
      }
    }

    if (Date.parse(entry.pubDate) > Date.now()) {
      throw new Error("future-dated episode leaked");
    }
  }

  for (let index = 1; index < data.length; index += 1) {
    const previous = data[index - 1] as { pubDate: string };
    const current = data[index] as { pubDate: string };
    if (Date.parse(previous.pubDate) < Date.parse(current.pubDate)) {
      throw new Error("catalog not newest-first");
    }
  }
};

const getCatalogRouteHandler = (): ((
  req: {
    header(name: string): string | undefined;
    protocol: string;
    get(name: string): string | undefined;
  },
  res: { json(body: unknown): void },
  next: (error?: unknown) => void
) => void | Promise<void>) => {
  const router = publicEpisodesRouter as unknown as {
    stack?: Array<{
      route?: {
        path?: string;
        stack?: Array<{ handle: (...args: unknown[]) => unknown }>;
      };
    }>;
  };
  const layer = router.stack?.find((entry) => entry.route?.path === "/");
  const handler = layer?.route?.stack?.[0]?.handle;

  if (typeof handler !== "function") {
    throw new Error("public catalog route handler not found");
  }

  return handler as (
    req: {
      header(name: string): string | undefined;
      protocol: string;
      get(name: string): string | undefined;
    },
    res: { json(body: unknown): void },
    next: (error?: unknown) => void
  ) => void | Promise<void>;
};

const requestCatalog = (): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const handler = getCatalogRouteHandler();
    const req = {
      header(name: string): string | undefined {
        return name.toLowerCase() === "x-forwarded-proto" ? undefined : undefined;
      },
      protocol: "https",
      get(name: string): string | undefined {
        return name.toLowerCase() === "host" ? "dragaocareca.test" : undefined;
      },
    };
    const res = {
      json(body: unknown): void {
        resolve(body);
      },
    };

    Promise.resolve(handler(req, res, reject)).catch(reject);
  });

const main = async (): Promise<void> => {
  await connectDb();
  const data = await requestCatalog();
  assertCatalogContract(data);
  console.log(`verified ${Array.isArray(data) ? data.length : 0} catalog items`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
