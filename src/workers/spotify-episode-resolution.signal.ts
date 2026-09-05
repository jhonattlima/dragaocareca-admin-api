type WakeListener = () => void;

let listener: WakeListener | undefined;

export const setSpotifyResolutionWakeListener = (next: WakeListener | undefined): void => {
  listener = next;
};

export const signalSpotifyResolutionEnqueued = (): void => {
  listener?.();
};
