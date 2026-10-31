import type { TableInfo } from "@datsumi/core";
import { describe, expect, it } from "vitest";

import { Capture, cell, safeError } from "./backend";
import { parseServerConfiguration } from "./configuration";
import { parameter, parseResource, qualifiedName, whereFilters } from "./dialect";
const config = {
  host: "localhost",
  port: 5432,
  database: "db",
  username: "user",
  tls: "verify",
  ca: "",
  readOnly: false,
};
describe("server SQL safety", () => {
  it("allowlists server configuration and rejects embedded credentials/options", () => {
    expect(parseServerConfiguration(config)).toEqual(config);
    for (const extra of [
      { password: "secret" },
      { connectionString: "postgres://user:secret@host/db" },
      { ssl: { rejectUnauthorized: false } },
      { port: 0 },
      { tls: "prefer" },
    ])
      expect(() => parseServerConfiguration({ ...config, ...extra })).toThrow(/./);
  });
  it("rejects private keys in the non-secret CA field", () => {
    expect(() =>
      parseServerConfiguration({
        ...config,
        ca: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
      }),
    ).toThrow("never private keys");
  });
  it("quotes schema and table components independently in every dialect", () => {
    expect(qualifiedName("postgres", 'ta"ble', "schema")).toBe('"schema"."ta""ble"');
    expect(qualifiedName("mysql", "ta`ble", "db")).toBe("`db`.`ta``ble`");
    expect(qualifiedName("mssql", "ta]ble", "dbo")).toBe("[dbo].[ta]]ble]");
    expect(() => parseResource('["schema"]')).toThrow(/./);
    expect([parameter("postgres", 0), parameter("mysql", 0), parameter("mssql", 0)]).toEqual([
      "$1",
      "?",
      "@p0",
    ]);
  });
  it("parameterizes filters and rejects unknown identifiers/operators", () => {
    const info: TableInfo = {
      resourceId: "test",
      name: "test",
      kind: "table",
      ddl: "",
      editable: true,
      foreignKeys: [],
      indexes: [],
      columns: [
        {
          name: "name",
          type: "text",
          primaryKey: 0,
          notNull: false,
          defaultValue: null,
          generated: false,
        },
      ],
    };
    const values: unknown[] = [];
    expect(
      whereFilters(
        "postgres",
        info,
        [{ column: "name", operator: "contains", value: "x%' OR 1=1 --" }],
        values,
      ),
    ).toBe("\"name\" LIKE $1 ESCAPE '!'");
    expect(values).toEqual(["%x!%' OR 1=1 --%"]);
    expect(() =>
      whereFilters(
        "postgres",
        info,
        [{ column: 'name";DROP TABLE x', operator: "=", value: "x" }],
        [],
      ),
    ).toThrow("Unknown");
  });
  it("caps captures and preserves duplicate columns, binary markers, integer and numeric text", () => {
    const capture = new Capture();
    capture.fields([
      { name: "x", dataType: null },
      { name: "x", dataType: null },
    ]);
    for (let i = 0; i < 10001; i++)
      capture.row([BigInt("9007199254740993"), "12345678901234567890.123"]);
    expect(capture.results[0]?.rows).toHaveLength(10000);
    expect(capture.results[0]?.truncated).toBe(true);
    expect(capture.results[0]?.rows[0]).toEqual([
      { type: "integer", value: "9007199254740993" },
      "12345678901234567890.123",
    ]);
    expect(cell(Buffer.alloc(1000))).toMatchObject({ type: "blob", bytes: 1000 });
    expect(cell("x".repeat(20000))).toMatchObject({ type: "text", length: 20000 });
  });
  it("retains more than 10000 rows and full cell values for clipboard capture", () => {
    const capture = new Capture(true);
    capture.fields([{ name: "n", dataType: "BIGINT" }]);
    for (let i = 0; i < 12001; i++) capture.row([i]);
    expect(capture.results[0]?.rows).toHaveLength(12001);
    expect(capture.results[0]?.truncated).toBe(false);
    expect(cell("x".repeat(20000), true)).toBe("x".repeat(20000));
    expect(cell(Buffer.alloc(1000), true)).toEqual({
      type: "blob",
      bytes: 1000,
      hex: "00".repeat(1000),
    });
  });
  it("redacts passwords and credential-bearing URIs from worker failures", () => {
    expect(
      safeError(new Error("password sentinel postgres://u:other@host/db"), "sentinel").message,
    ).toBe("password [redacted] [connection redacted]");
  });
});
