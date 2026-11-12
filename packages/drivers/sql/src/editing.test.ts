import type { TableInfo } from "@datsumi/core";
import { describe, expect, it, vi } from "vitest";

import type { Backend } from "./backend";
import type { ServerDriver } from "./configuration";
import { ServerDatabase } from "./database";

const info: TableInfo = {
  resourceId: '["main","items"]',
  name: "main.items",
  kind: "table",
  editable: true,
  ddl: "",
  foreignKeys: [],
  indexes: [],
  columns: ["id", "note"].map((name, index) => ({
    name,
    type: index ? "CLOB" : "NUMBER",
    primaryKey: index ? 0 : 1,
    notNull: !index,
    defaultValue: null,
    generated: false,
  })),
};
const request = {
  resourceId: info.resourceId,
  changes: [
    { kind: "update" as const, original: { id: 1, note: "before" }, values: { note: "after" } },
  ],
};
function fixture(driver: ServerDriver | "duckdb", nested = false) {
  const run = vi.fn<Backend["run"]>(async () => [
    { columns: [], rows: [], affected: 1, truncated: false },
  ]);
  const close = vi.fn<Backend["close"]>(async () => {});
  const db = new ServerDatabase(
    driver,
    { run, close, inTransaction: async () => nested },
    { database: "db", readOnly: false },
  );
  vi.spyOn(db, "schema").mockResolvedValue([info]);
  return { db, run, close };
}
describe("staged edit transaction boundaries", () => {
  it.each(["duckdb", "libsql", "turso"] as const)(
    "%s refuses nested edits before any write",
    async (driver) => {
      const { db, run } = fixture(driver, true);
      expect(await db.changes(request, false)).toHaveLength(1);
      await expect(db.changes(request, true)).rejects.toThrow("open SQL transaction");
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("starts Oracle batches implicitly and compares complete CLOB originals", async () => {
    const { db, run } = fixture("oracle");
    await db.changes(request, true);
    expect(run.mock.calls.map((call) => call[0])).toEqual([
      'UPDATE "main"."items" SET "note" = :1 WHERE "id" = :2 AND DBMS_LOB.COMPARE("note", TO_CLOB(:3)) = 0',
      "COMMIT",
    ]);
    expect(run.mock.calls[0]?.[1]).toEqual(["after", 1, "before"]);
  });
  it("preserves Oracle's existing transaction and rolls conflicts back only to its savepoint", async () => {
    const { db, run } = fixture("oracle", true);
    run.mockImplementation(async (text) => [
      { columns: [], rows: [], affected: text.startsWith("UPDATE") ? 0 : 1, truncated: false },
    ]);
    await expect(db.changes(request, true)).rejects.toThrow("Edit conflict");
    expect(
      run.mock.calls.map((call) => call[0]).filter((text) => !text.startsWith("UPDATE")),
    ).toEqual(["SAVEPOINT datsumi_batch", "ROLLBACK TO datsumi_batch"]);
  });
  it("does not attempt unsupported Oracle RELEASE SAVEPOINT or commit the caller's work", async () => {
    const { db, run } = fixture("oracle", true);
    await db.changes(request, true);
    expect(
      run.mock.calls.map((call) => call[0]).filter((text) => !text.startsWith("UPDATE")),
    ).toEqual(["SAVEPOINT datsumi_batch"]);
  });
  it("closes the session if rollback cannot be confirmed, without retrying writes", async () => {
    const { db, run, close } = fixture("libsql");
    run.mockImplementation(async (text) => {
      if (text === "ROLLBACK") throw new Error("disconnected");
      return [
        { columns: [], rows: [], affected: text.startsWith("UPDATE") ? 0 : 1, truncated: false },
      ];
    });
    await expect(db.changes(request, true)).rejects.toThrow("rollback could not be confirmed");
    expect(close).toHaveBeenCalledOnce();
    expect(run.mock.calls.filter((call) => call[0].startsWith("UPDATE"))).toHaveLength(1);
  });
});
