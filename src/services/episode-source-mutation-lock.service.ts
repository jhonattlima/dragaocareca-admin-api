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
      let responseClosed = false;
      let handlerCompleted = false;
      const release = (): void => {
        if (released) return;
        released = true;
        res.off("finish", release);
        res.off("close", release);
        resolve();
      };
      const completeHandler = (): void => {
        handlerCompleted = true;
        if (responseClosed) release();
      };
      const originalJson = res.json.bind(res);
      res.json = ((...args: Parameters<typeof res.json>) => {
        completeHandler();
        return originalJson(...args);
      }) as typeof res.json;
      const originalEnd = res.end.bind(res);
      res.end = ((...args: Parameters<typeof res.end>) => {
        completeHandler();
        return originalEnd(...args);
      }) as typeof res.end;
      res.once("finish", release);
      res.once("close", () => {
        responseClosed = true;
        if (handlerCompleted) release();
      });
      next();
    });
  }).catch(next);
};
