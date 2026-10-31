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
