import type { RequestHandler } from "express";

const episodeSourceMutationLocks = new Map<number, Promise<void>>();

export const withEpisodeSourceMutationLock = async <T>(episodeId: number, work: () => Promise<T>): Promise<T> => {
  const previous = episodeSourceMutationLocks.get(episodeId) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  episodeSourceMutationLocks.set(episodeId, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (episodeSourceMutationLocks.get(episodeId) === current) episodeSourceMutationLocks.delete(episodeId);
  }
};

export const episodeSourceMutationLockMiddleware: RequestHandler = (req, res, next) => {
  const episodeId = Number(req.params.episodeId);
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    next();
    return;
  }

  void withEpisodeSourceMutationLock(episodeId, async () => {
    await new Promise<void>((resolve) => {
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        res.off("finish", release);
        res.off("close", release);
        resolve();
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    });
  }).catch(next);
};
