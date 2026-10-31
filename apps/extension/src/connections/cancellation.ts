import type { DriverCancellation } from "@datsumi/core";

export function abortCancellation(signal: AbortSignal): DriverCancellation {
  return {
    get isCancellationRequested() {
      return signal.aborted;
    },
    onCancellationRequested(callback) {
      signal.addEventListener("abort", callback, { once: true });
      return {
        dispose() {
          signal.removeEventListener("abort", callback);
        },
      };
    },
  };
}
