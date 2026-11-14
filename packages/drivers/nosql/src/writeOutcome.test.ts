import { expect, it, vi } from "vitest";

import { confirmedWrite } from "./writeOutcome";

it("does not retry a mutation whose acknowledgement was lost or expose raw transport details", async () => {
  const write = vi.fn<() => Promise<number>>(async () => {
    throw new Error("private endpoint and token fixture");
  });
  await expect(confirmedWrite(write)).rejects.toThrow("Write outcome unknown");
  expect(write).toHaveBeenCalledOnce();
  await expect(confirmedWrite(async () => 0)).resolves.toBe(0);
});
