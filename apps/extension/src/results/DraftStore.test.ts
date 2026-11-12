import type { ConnectionProfile, TableInfo } from "@datsumi/core";
import { expect, it } from "vitest";
import type { Memento } from "vscode";

import { DraftStore } from "./DraftStore";
it("recovers only opted-in, destination-bound drafts and prunes on expiry/disable", async () => {
  const values = new Map<string, unknown>();
  const state = {
    get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  } as unknown as Memento;
  let enabled = true;
  const store = new DraftStore(state, () => ({ enabled, days: 7 }));
  const profile = {
    id: "p",
    driverId: "libsql",
    configuration: { endpoint: "https://first.example" },
  } as unknown as ConnectionProfile;
  const info = { resourceId: "items", columns: [{ name: "id" }] } as unknown as TableInfo;
  const key = store.key(profile, info),
    changes = [{ kind: "update" as const, original: { id: 1 }, values: { note: "draft" } }];
  await store.save(key, changes);
  expect(store.load(key)?.changes).toEqual(changes);
  expect(
    store.load(
      store.key({ ...profile, configuration: { endpoint: "https://other.example" } }, info),
    ),
  ).toBeUndefined();
  values.set("datsumi.drafts", { [key]: { savedAt: Date.now() - 8 * 86400000, changes } });
  expect(store.load(key)).toBeUndefined();
  enabled = false;
  await store.save(key, changes);
  expect(values.get("datsumi.drafts")).toEqual({});
  expect(store.load(key)).toBeUndefined();
});
