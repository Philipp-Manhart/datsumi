import { afterEach, describe, expect, it, vi } from "vitest";

import { completionBudget } from "./completionBudget";

afterEach(() => vi.useRealTimers());
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
describe("completion metadata budget", () => {
  it("returns grammar fallback promptly while metadata continues safely", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string[]) => void;
    const metadata = new Promise<string[]>((done) => {
      resolve = done;
    });
    const result = completionBudget(metadata, [], token);
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toEqual({ value: [], incomplete: true });
    resolve(["customers"]);
    await expect(completionBudget(metadata, [], token)).resolves.toEqual({
      value: ["customers"],
      incomplete: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("handles errors and cancellation without rejecting the completion request", async () => {
    await expect(
      completionBudget(Promise.reject(new Error("offline")), [], token),
    ).resolves.toEqual({ value: [], incomplete: false });
    await expect(
      completionBudget(new Promise<never>(() => {}), [], {
        ...token,
        isCancellationRequested: true,
      }),
    ).resolves.toEqual({ value: [], incomplete: true });
  });
});
