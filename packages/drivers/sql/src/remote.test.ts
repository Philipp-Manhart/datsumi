import { describe, expect, it } from "vitest";

import { parseRemoteConfiguration, parseSqlConfiguration } from "./configuration";
import { remoteBackend, statements } from "./remote";

describe("remote SQLite SQL", () => {
  it("normalizes TLS URLs without persisting secrets", () => {
    expect(
      parseRemoteConfiguration({ endpoint: "libsql://example.turso.io", readOnly: true }),
    ).toMatchObject({
      endpoint: "https://example.turso.io",
      tls: "verify",
      database: "main",
      readOnly: true,
    });
    for (const endpoint of [
      "file:test.db",
      "ws://example.com",
      "https://u:p@example.com",
      "https://example.com?authToken=secret",
      "https://example.com#secret",
      "https://example.com/\nsecret",
    ]) {
      expect(() => parseRemoteConfiguration({ endpoint, readOnly: false })).toThrow(Error);
    }
    expect(() =>
      parseRemoteConfiguration({
        endpoint: "https://example.com",
        readOnly: false,
        password: "secret",
      }),
    ).toThrow(Error);
    expect(() =>
      parseSqlConfiguration("postgres", { endpoint: "https://example.com", readOnly: false }),
    ).toThrow(Error);
    expect(() => parseSqlConfiguration("turso", { host: "localhost" })).toThrow(Error);
  });
  it("splits scripts with comments, quoted delimiters and triggers", () => {
    expect(statements("SELECT ';'; -- comment\n SELECT 2;")).toHaveLength(2);
    expect(
      statements(
        "CREATE TRIGGER t AFTER INSERT ON x BEGIN SELECT CASE WHEN 1 THEN ';' END; SELECT 2; END; SELECT 3;",
      ),
    ).toHaveLength(2);
    expect(statements(" -- comment\n/* test */")).toEqual([]);
    expect(() => statements("SELECT 1;".repeat(33))).toThrow("32");
  });
  it("retains numeric-indexed cells, exact integers, blobs and capture limits", async () => {
    const session = {
      execute: async () => ({
        columns: ["x", "x"],
        columnTypes: ["BIGINT", "BLOB"],
        rows: Array.from({ length: 12001 }, () => [9007199254740993n, new Uint8Array([0, 255])]),
        rowsAffected: 0,
      }),
      inTransaction: () => false,
      close: async () => {},
    };
    const backend = remoteBackend(session);
    const preview = (await backend.run("SELECT 1"))[0]!;
    expect(preview.rows).toHaveLength(10000);
    expect(preview.truncated).toBe(true);
    const full = (await backend.run("SELECT 1", [], true))[0]!;
    expect(full.rows).toHaveLength(12001);
    expect(full.truncated).toBe(false);
    expect(full.rows[0]).toEqual([
      { type: "integer", value: "9007199254740993" },
      { type: "blob", hex: "00ff", bytes: 2 },
    ]);
    expect(full.columns.map((c) => c.name)).toEqual(["x", "x"]);
  });
});
