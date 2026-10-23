// Long work on the main thread, in slices: hand the page back whenever a slice has run
// for `sliceMs`, so the tab stays responsive. A MessageChannel message is a macrotask
// that isn't clamped like setTimeout (nor throttled to 1/s in a background tab).

const macrotask = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });

export type Pace = () => Promise<void>;

export function pacer(signal?: AbortSignal, sliceMs = 24): Pace {
  let last = performance.now();
  return async () => {
    signal?.throwIfAborted();
    if (performance.now() - last < sliceMs) return;
    await macrotask();
    signal?.throwIfAborted();
    last = performance.now();
  };
}
