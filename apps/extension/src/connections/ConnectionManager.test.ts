import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryDriverRegistry, type DatabaseDriver } from "@datsumi/driver-api";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

import { ConnectionManager } from "./ConnectionManager";

function fixture(saved: unknown = []) {
  let storage = saved;
  const update = vi.fn<(key: string, value: unknown) => Promise<void>>(async (_key, value) => {
    storage = structuredClone(value);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only workspaceState is used by the manager.
  const context = { workspaceState: { get: () => storage, update } } as unknown as ExtensionContext;
  const driver = {
    isConnected: (session: { closed: boolean }) => !session.closed,
    descriptor: {
      id: "sqlite",
      displayName: "SQLite",
      family: "relational",
      supportedQueryLanguages: ["sql"],
      capabilities: ["query", "tables"],
    },
    connect: vi.fn<() => Promise<{ closed: boolean }>>(async () => ({ closed: false })),
    execute: vi.fn<DatabaseDriver["execute"]>(async () => ({
      kind: "table",
      columns: ["id"],
      rows: [[1]],
    })),
    disconnect: vi.fn<(session: { closed: boolean }) => Promise<void>>(async (session) => {
      session.closed = true;
    }),
    exportTable: vi.fn<NonNullable<DatabaseDriver["exportTable"]>>(async (_session, request) => {
      writeFileSync(request.path, "complete export");
      return 1;
    }),
    listResources: vi.fn<() => Promise<[]>>(async () => []),
  } satisfies DatabaseDriver<unknown, { closed: boolean }>;
  const registry = new InMemoryDriverRegistry();
  registry.register(driver);
  return { manager: new ConnectionManager(context, registry), driver, context, registry, update };
}

describe("connection management", () => {
  it("persists profiles, restores lazily, and avoids duplicate connections", async () => {
    const { manager, driver, context, registry } = fixture();
    const profile = await manager.addSqlite("/tmp/sample.db", true);
    expect(await manager.addSqlite("/tmp/sample.db", true)).toEqual(profile);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(profile.configuration).toEqual({ path: "/tmp/sample.db", readOnly: true });
    const restored = new ConnectionManager(context, registry);
    expect(restored.all()).toEqual([profile]);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    await Promise.all([restored.resources(profile.id), restored.resources(profile.id)]);
    expect(driver.connect).toHaveBeenCalledTimes(2);
    await manager.dispose();
    await restored.dispose();
    expect(driver.disconnect).toHaveBeenCalledTimes(2);
  });
  it("reconnects after worker cancellation and removes saved profiles", async () => {
    const { manager, driver, update } = fixture();
    const profile = await manager.addSqlite("/tmp/sample.db", false);
    const session = await driver.connect.mock.results[0]!.value;
    session.closed = true;
    await Promise.all([manager.resources(profile.id), manager.resources(profile.id)]);
    expect(driver.connect).toHaveBeenCalledTimes(2);
    await manager.remove(profile.id);
    expect(manager.all()).toEqual([]);
    expect(update).toHaveBeenLastCalledWith("datsumi.connections", []);
    await manager.dispose();
  });
  it("does not save invalid connections or retain sessions after storage failures", async () => {
    const { manager, driver, update } = fixture();
    driver.connect.mockRejectedValueOnce(new Error("not a database"));
    await expect(manager.addSqlite("/tmp/invalid.db", false)).rejects.toThrow("not a database");
    expect(manager.all()).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    update.mockRejectedValueOnce(new Error("storage failed"));
    await expect(manager.addSqlite("/tmp/sample.db", false)).rejects.toThrow("storage failed");
    expect(manager.all()).toEqual([]);
    expect(driver.disconnect).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });
  it("ignores corrupt stored profiles", async () => {
    const { manager } = fixture([
      null,
      {},
      { id: 1 },
      {
        id: "a",
        name: "bad",
        driverId: "sqlite",
        family: "relational",
        configuration: { path: "/tmp/a", readOnly: "false" },
      },
    ]);
    expect(manager.all()).toEqual([]);
    await manager.dispose();
  });
});

describe("atomic table exports", () => {
  it("preserves the destination on failure, cleans temporary files, and guards the source database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "datsumi-export-"));
    const source = join(directory, "source.sqlite"),
      target = join(directory, "output.csv");
    writeFileSync(source, "database");
    writeFileSync(target, "previous export");
    const { manager, driver } = fixture();
    try {
      const profile = await manager.addSqlite(source, false);
      const request = {
        path: target,
        format: "csv" as const,
        request: { resourceId: "table", offset: 0, limit: 100 },
      };
      driver.exportTable.mockImplementationOnce(async (_session, job) => {
        writeFileSync(job.path, "partial");
        throw new Error("Export failed");
      });
      await expect(manager.exportTable(profile.id, request)).rejects.toThrow("Export failed");
      expect(readFileSync(target, "utf8")).toBe("previous export");
      expect(readdirSync(directory).sort()).toEqual(["output.csv", "source.sqlite"]);
      expect(await manager.exportTable(profile.id, request)).toBe(1);
      expect(readFileSync(target, "utf8")).toBe("complete export");
      await expect(manager.exportTable(profile.id, { ...request, path: source })).rejects.toThrow(
        "Cannot overwrite",
      );
      expect(readFileSync(source, "utf8")).toBe("database");
      const otherSource = join(directory, "other.sqlite");
      writeFileSync(otherSource, "other database");
      const otherProfile = await manager.addSqlite(otherSource, false);
      await expect(
        manager.exportTable(otherProfile.id, { ...request, path: source }),
      ).rejects.toThrow("Cannot overwrite");
      expect(readFileSync(source, "utf8")).toBe("database");
    } finally {
      await manager.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

it("restores local DuckDB profiles without credentials and keeps creation flags ephemeral", async () => {
  const { manager, driver, registry, context } = fixture();
  const duckDriver = {
    ...driver,
    descriptor: { ...driver.descriptor, id: "duckdb", displayName: "DuckDB" },
  };
  registry.register(duckDriver);
  const profile = await manager.addDuckdb("/tmp/metrics.duckdb", false, true);
  expect(profile.configuration).toEqual({ path: "/tmp/metrics.duckdb", readOnly: false });
  expect(driver.connect).toHaveBeenCalledWith(profile, {
    path: "/tmp/metrics.duckdb",
    readOnly: false,
    create: true,
  });
  await manager.disconnect(profile.id);
  const restored = new ConnectionManager(context, registry);
  expect(restored.all()).toEqual([profile]);
  await restored.resources(profile.id);
  expect(driver.connect).toHaveBeenLastCalledWith(
    profile,
    profile.configuration,
    expect.anything(),
  );
  await restored.dispose();
  await manager.dispose();
});
