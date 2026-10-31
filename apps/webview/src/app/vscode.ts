type VsCodeApi = { postMessage(message: unknown): void };
let api: VsCodeApi | undefined;
let initialized = false;
export function getVsCodeApi(): VsCodeApi | undefined {
  if (!initialized) {
    api = (
      globalThis as typeof globalThis & { acquireVsCodeApi?: () => VsCodeApi }
    ).acquireVsCodeApi?.();
    initialized = true;
  }
  return api;
}
