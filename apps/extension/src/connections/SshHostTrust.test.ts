import { describe, expect, it, vi } from "vitest";

import { SshHostTrust } from "./SshHostTrust";
const settings = { host: "vps", port: 22, username: "app", keyPath: "" };
function fixture(accept = true) {
  const values = new Map<string, unknown>();
  const confirm = vi.fn<() => Promise<boolean>>(async () => accept);
  const trust = new SshHostTrust(
    {
      keys: () => [...values.keys()],
      get<T>(key: string, fallback: T): T {
        return values.has(key) ? (values.get(key) as T) : fallback;
      },
      async update(key, value) {
        if (value === undefined) values.delete(key);
        else values.set(key, value);
      },
    },
    confirm,
  );
  return { values, confirm, trust };
}
describe("SSH host key trust", () => {
  it("asks once, pins by host and port, and rejects changed keys without prompting", async () => {
    const { trust, confirm } = fixture();
    expect(await trust.verify(settings, "SHA256:first")).toBe(true);
    expect(await trust.verify({ ...settings, username: "other" }, "SHA256:first")).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    await expect(trust.verify(settings, "SHA256:changed")).rejects.toThrow("changed");
    expect(confirm).toHaveBeenCalledOnce();
    await trust.forget(settings);
    expect(await trust.verify(settings, "SHA256:changed")).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it("does not persist a rejected fingerprint", async () => {
    const { trust, values } = fixture(false);
    expect(await trust.verify(settings, "SHA256:first")).toBe(false);
    expect(values.size).toBe(0);
  });
});

it("serializes first-use trust so concurrent connections cannot replace a pinned key", async () => {
  const { trust, confirm } = fixture();
  expect(
    await Promise.all([
      trust.verify(settings, "SHA256:first"),
      trust.verify(settings, "SHA256:first"),
    ]),
  ).toEqual([true, true]);
  expect(confirm).toHaveBeenCalledOnce();
  await expect(trust.verify(settings, "SHA256:other")).rejects.toThrow("changed");
});

it("lists trusted hosts even when Test Connection did not save a database profile", async () => {
  const { trust } = fixture();
  await trust.verify(settings, "SHA256:test-only");
  expect(trust.list()).toEqual([{ ...settings, username: "", fingerprint: "SHA256:test-only" }]);
  await trust.forget(settings);
  expect(trust.list()).toHaveLength(0);
});
