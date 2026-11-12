import type { TableInfo, QueryResult } from "@datsumi/core";
import { describe, it, expect, vi } from "vitest";

import { editableResult, refreshedChanges, updateSnapshot } from "./editableResult";
const info: TableInfo = {
  name: "customers",
  resourceId: "customers",
  kind: "table",
  ddl: "",
  editable: true,
  columns: ["id", "name"].map((name, index) => ({
    name,
    type: index ? "TEXT" : "INTEGER",
    primaryKey: index ? 0 : 1,
    notNull: false,
    defaultValue: null,
    generated: false,
  })),
  foreignKeys: [],
  indexes: [],
};
const result: Extract<QueryResult, { kind: "table" }> = {
  kind: "table",
  columns: ["id", "name"],
  columnMetadata: ["id", "name"].map((name) => ({
    name,
    sourceColumn: name,
    table: "customers",
    database: "main",
    dataType: "TEXT",
  })),
  rows: [
    [1, "Alex"],
    [2, "Sam"],
  ],
};
describe("safe editing of captured SELECT results", () => {
  it("accepts complete original columns and rejects ambiguous or derived results", () => {
    expect(
      editableResult("SELECT * FROM customers WHERE id>0 ORDER BY name", result, [info]).info,
    ).toBe(info);
    for (const query of [
      "UPDATE customers SET name=name RETURNING *",
      "SELECT DISTINCT * FROM customers",
      "SELECT c.* FROM customers c JOIN orders o ON o.customer_id=c.id",
      "WITH c AS (SELECT * FROM customers) SELECT * FROM c",
    ])
      expect(editableResult(query, result, [info]).info).toBeUndefined();
    expect(
      editableResult("SELECT * FROM customers", result, [{ ...info, editable: false }]).info,
    ).toBeUndefined();
    expect(
      editableResult(
        "SELECT name AS id, id AS name FROM customers",
        {
          ...result,
          columnMetadata: [
            {
              name: "id",
              sourceColumn: "name",
              table: "customers",
              database: "main",
              dataType: "TEXT",
            },
            {
              name: "name",
              sourceColumn: "id",
              table: "customers",
              database: "main",
              dataType: "INTEGER",
            },
          ],
        },
        [info],
      ).info,
    ).toBeUndefined();
    expect(
      editableResult(
        "SELECT id FROM customers",
        { ...result, columns: ["id"], columnMetadata: result.columnMetadata?.slice(0, 1) },
        [info],
      ).info,
    ).toBeUndefined();
  });
  it.each(["postgres", "mysql", "mariadb", "mssql", "oracle", "duckdb", "libsql", "turso"])(
    "allows safe %s SELECT * captures without assuming column origins",
    (driverId) => {
      const serverInfo = { ...info, name: "main.customers", schema: "main", driverId };
      const capture = {
        ...result,
        columnMetadata: result.columns.map((name) => ({ name, dataType: "TEXT" })),
      };
      expect(
        editableResult('SELECT * FROM "main"."customers" WHERE id=1;', capture, [serverInfo]).info,
      ).toBe(serverInfo);
      for (const query of [
        "SELECT name AS id,id AS name FROM main.customers",
        "SELECT * FROM main.customers c JOIN other o ON c.id=o.id",
        "SELECT * FROM main.customers UNION SELECT * FROM other",
        "SELECT * FROM main.customers()",
        "SELECT * FROM (VALUES(1,'fake')) customers",
        "SELECT * FROM main.customers; UPDATE main.customers SET name='changed'",
      ])
        expect(editableResult(query, capture, [serverInfo]).info).toBeUndefined();
      expect(
        editableResult("SELECT * FROM customers", capture, [
          serverInfo,
          { ...serverInfo, name: "other.customers", schema: "other" },
        ]).info,
      ).toBeUndefined();
      expect(
        editableResult("SELECT * FROM main.customers", capture, [
          { ...serverInfo, editable: false },
        ]).info,
      ).toBeUndefined();
    },
  );
  it("refreshes server captures using bound primary-key filters rather than SQLite SQL", async () => {
    const server = { ...info, driverId: "libsql", name: "main.customers" };
    const execute = vi.fn<Parameters<typeof refreshedChanges>[2]>();
    const browse = vi.fn<NonNullable<Parameters<typeof refreshedChanges>[3]>>(async () => ({
      offset: 0,
      limit: 2,
      hasMore: false,
      result: { ...result, rows: [[2, "changed"]] },
    }));
    const changes = [
      {
        kind: "update" as const,
        original: { id: 1, name: "Alex" },
        values: { id: 2, name: "changed" },
      },
    ];
    expect(await refreshedChanges(server, changes, execute, browse)).toEqual([[2, "changed"]]);
    expect(execute).not.toHaveBeenCalled();
    expect(browse).toHaveBeenCalledWith({
      resourceId: info.resourceId,
      offset: 0,
      limit: 2,
      filters: [{ column: "id", operator: "=", value: 2 }],
    });
  });
  it("refreshes only changed keys and patches the capture without re-running the query", async () => {
    const changes = [
      {
        kind: "update" as const,
        original: { id: 1, name: "Alex" },
        values: { id: { type: "integer" as const, value: "9007199254740993" }, name: "New" },
      },
    ];
    const execute = vi.fn<Parameters<typeof refreshedChanges>[2]>(async () => ({
      ...result,
      rows: [[{ type: "integer", value: "9007199254740993" }, "New"]],
    }));
    const refreshed = await refreshedChanges(info, changes, execute);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT "id", "name" FROM "customers" WHERE "id" IS $key0 LIMIT 1',
      { key0: { type: "integer", value: "9007199254740993" } },
    );
    expect(updateSnapshot(result, info, changes, refreshed).rows).toEqual([
      [{ type: "integer", value: "9007199254740993" }, "New"],
      [2, "Sam"],
    ]);
    const reversed = {
      ...result,
      columns: ["name", "id"],
      rows: [
        ["Alex", 1],
        ["Sam", 2],
      ],
    };
    expect(updateSnapshot(reversed, info, changes, refreshed).rows[0]).toEqual([
      "New",
      { type: "integer", value: "9007199254740993" },
    ]);
  });
});
