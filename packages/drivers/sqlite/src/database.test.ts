import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteDatabase, parseConfiguration } from "./database";

let directory: string;
let path: string;
let database: SqliteDatabase;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "datsumi-test-"));
  path = join(directory, "sample.sqlite");
  const seed = new DatabaseSync(path);
  seed.exec(`CREATE TABLE "odd""table" (id INTEGER PRIMARY KEY, name TEXT, payload BLOB);
    INSERT INTO "odd""table" VALUES (1, 'hello', X'00FF'), (2, NULL, NULL), (9007199254740993, 'large', X'AB');
    CREATE VIEW names AS SELECT name FROM "odd""table";
    CREATE TABLE compound(a TEXT, b INTEGER, PRIMARY KEY(a,b)) WITHOUT ROWID;
    INSERT INTO compound VALUES ('z',2), ('a',1);`);
  seed.close();
  database = new SqliteDatabase({ path, readOnly: false });
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

function execute(text: string, parameters?: Record<string, unknown>) {
  return database.execute({ language: "sql", text, ...(parameters ? { parameters } : {}) });
}

describe("SQLite database", () => {
  it("captures a complete result beyond preview limits without rerunning writes", () => {
    const result = database.execute({
      language: "sql",
      captureAll: true,
      text: "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<12001) SELECT x FROM n",
    });
    expect(result).toMatchObject({ truncated: false });
    if (result.kind !== "table") throw new Error("Expected table");
    expect(result.rows).toHaveLength(12001);
    expect(result.rows.at(-1)).toEqual([12001]);
    const full = database.execute({
      language: "sql",
      captureAll: true,
      text: "SELECT printf('%.*c',20000,'x'), zeroblob(1000)",
    });
    expect(full).toMatchObject({
      rows: [["x".repeat(20000), { type: "blob", bytes: 1000, hex: "00".repeat(1000) }]],
    });
  });

  it("discovers tables, views, and column metadata", () => {
    const resources = database.listResources();
    expect(resources.map((item) => [item.label, item.kind])).toEqual([
      ["compound", "table"],
      ['odd"table', "table"],
      ["names", "view"],
    ]);
    const table = resources.find((item) => item.label === 'odd"table')!;
    expect(database.listResources(table.id)).toMatchObject([
      { label: "id", kind: "column", description: "INTEGER · PK" },
      { label: "name", description: "TEXT" },
      { label: "payload", description: "BLOB" },
    ]);
  });
  it("does not hide user tables whose name only resembles SQLite's internal prefix", () => {
    execute("CREATE TABLE sqliteXuser(id INTEGER)");
    expect(database.listResources().some((resource) => resource.label === "sqliteXuser")).toBe(
      true,
    );
  });
  it("preserves duplicate columns, nulls, blobs, and unsafe integers in JSON", () => {
    const result = execute('SELECT id, id, name, payload FROM "odd""table" ORDER BY id');
    expect(result).toMatchObject({
      kind: "table",
      columns: ["id", "id", "name", "payload"],
      rows: [
        [1, 1, "hello", { type: "blob", hex: "00ff", bytes: 2 }],
        [2, 2, null, null],
        [
          { type: "integer", value: "9007199254740993" },
          { type: "integer", value: "9007199254740993" },
          "large",
          { type: "blob", hex: "ab", bytes: 1 },
        ],
      ],
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("binds parameters and rejects unsupported input", () => {
    expect(execute("SELECT $name AS name", { name: "'; DROP TABLE compound; --" })).toMatchObject({
      rows: [["'; DROP TABLE compound; --"]],
    });
    expect(
      execute('SELECT id FROM "odd""table" WHERE id=$key', {
        key: { type: "integer", value: "9007199254740993" },
      }),
    ).toMatchObject({ rows: [[{ type: "integer", value: "9007199254740993" }]] });
    expect(execute('SELECT name AS display FROM "odd""table" LIMIT 1')).toMatchObject({
      columnMetadata: [
        { name: "display", sourceColumn: "name", table: 'odd"table', database: "main" },
      ],
    });
    expect(() => execute("SELECT $bad", { bad: {} })).toThrow("Unsupported parameter");
    expect(() => database.execute({ language: "cypher", text: "RETURN 1" })).toThrow(
      "only supports SQL",
    );
  });
  it("pages quoted names and WITHOUT ROWID tables without a total count", () => {
    const id = database.listResources().find((item) => item.label === 'odd"table')!.id;
    const first = database.browseTable({ resourceId: id, offset: 0, limit: 2 });
    const last = database.browseTable({ resourceId: id, offset: 2, limit: 2 });
    expect(first.result.rows.map((row) => row[0])).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    expect(last.result.rows).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    expect(
      database.browseTable({ resourceId: database.listResources()[0]!.id, offset: 0, limit: 1 })
        .result.rows,
    ).toEqual([["a", 1]]);
    expect(() => database.browseTable({ resourceId: id, offset: -1, limit: 100 })).toThrow(
      "Invalid page",
    );
    expect(() =>
      database.browseTable({ resourceId: "not a table", offset: 0, limit: 100 }),
    ).toThrow("no longer exists");
  });
  it("executes writes and supports explicit transaction rollback", () => {
    expect(database.transactionState()).toBe("idle");
    execute("BEGIN");
    expect(database.transactionState()).toBe("open");
    expect(execute("INSERT INTO compound VALUES ('b', 3)")).toMatchObject({
      kind: "value",
      value: { changes: 1 },
    });
    execute("ROLLBACK");
    expect(database.transactionState()).toBe("idle");
    expect(execute("SELECT COUNT(*) FROM compound")).toMatchObject({ rows: [[2]] });
  });
  it("rejects multiple statements before applying changes", () => {
    expect(() => execute("DELETE FROM compound; SELECT 1;")).toThrow("one SQL statement");
    expect(
      execute("SELECT COUNT(*) FROM compound; -- trailing comment\n /* comment */"),
    ).toMatchObject({ rows: [[2]] });
    expect(execute("SELECT '; -- not a comment' AS value")).toMatchObject({
      rows: [["; -- not a comment"]],
    });
  });
  it("limits query rows, large text and binary previews", () => {
    expect(
      execute(
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<12000) SELECT x FROM n",
      ),
    ).toMatchObject({ truncated: true, rows: expect.arrayContaining([[10000]]) });
    const rows = execute("SELECT printf('%020000d',1), zeroblob(1000)");
    expect(rows).toMatchObject({
      rows: [
        [
          { type: "text", length: 20000 },
          { type: "blob", bytes: 1000 },
        ],
      ],
    });
    if (rows.kind !== "table") throw new Error("Expected rows");
    const blob = rows.rows[0]![1];
    if (typeof blob !== "object" || !blob || !("hex" in blob)) throw new Error("Expected blob");
    expect(blob.hex).toHaveLength(512);
  });
  it("enforces read-only connections", () => {
    const readonly = new SqliteDatabase({ path, readOnly: true });
    try {
      expect(() => readonly.execute({ language: "sql", text: "DELETE FROM compound" })).toThrow(
        /readonly/i,
      );
    } finally {
      readonly.close();
    }
  });
  it("refuses missing and invalid files without creating a database", () => {
    const missing = join(directory, "missing.db");
    expect(() => new SqliteDatabase({ path: missing, readOnly: false })).toThrow(/ENOENT/);
    expect(existsSync(missing)).toBe(false);
    const invalid = join(directory, "invalid.db");
    writeFileSync(invalid, "not a SQLite database");
    expect(() => new SqliteDatabase({ path: invalid, readOnly: false })).toThrow(/not a database/i);
    expect(() => parseConfiguration({ path, readOnly: "false" })).toThrow(
      "readOnly must be a boolean",
    );
  });
});

describe("SQLite workbench", () => {
  const id = () => database.listResources().find((item) => item.label === 'odd"table')!.id;
  it("filters and orders the entire table with bound values and validates identifiers", () => {
    expect(
      database.browseTable({
        resourceId: id(),
        offset: 0,
        limit: 1,
        filters: [{ column: "name", operator: "contains", value: "l" }],
        order: { column: "id", direction: "desc" },
      }).result.rows[0]?.[1],
    ).toBe("large");
    expect(
      database.browseTable({
        resourceId: id(),
        offset: 0,
        limit: 25,
        filters: [{ column: "name", operator: "IS NULL" }],
      }).result.rows,
    ).toHaveLength(1);
    expect(
      database.browseTable({
        resourceId: id(),
        offset: 0,
        limit: 25,
        filters: [{ column: "name", operator: "=", value: "'; DROP TABLE compound; --" }],
      }).result.rows,
    ).toHaveLength(0);
    expect(() =>
      database.browseTable({
        resourceId: id(),
        offset: 0,
        limit: 25,
        order: { column: "id; DROP TABLE compound", direction: "asc" },
      }),
    ).toThrow("Invalid sort");
    expect(() =>
      database.browseTable({
        resourceId: id(),
        offset: 0,
        limit: 25,
        filters: [{ column: "missing", operator: "=", value: "x" }],
      }),
    ).toThrow("Unknown filter");
  });
  it("inspects composite foreign keys, generated columns, indexes, defaults and view DDL", () => {
    execute(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, a TEXT, b INTEGER DEFAULT 1, computed TEXT GENERATED ALWAYS AS (a || b) VIRTUAL, FOREIGN KEY(a,b) REFERENCES compound(a,b) ON DELETE CASCADE)",
    );
    execute("CREATE INDEX child_ab ON child(a,b)");
    const info = database.schema().find((table) => table.name === "child")!;
    expect(info).toMatchObject({
      editable: true,
      foreignKeys: [
        { target: "compound", columns: ["a", "b"], targetColumns: ["a", "b"], onDelete: "CASCADE" },
      ],
      indexes: [{ name: "child_ab", columns: ["a", "b"] }],
    });
    expect(info.columns.find((col) => col.name === "computed")?.generated).toBe(true);
    expect(info.columns.find((col) => col.name === "b")?.defaultValue).toBe("1");
    expect(database.schema().find((table) => table.name === "names")).toMatchObject({
      editable: false,
      kind: "view",
    });
  });
  it("previews without executing, applies exact quoted data, and atomically rejects conflicts", () => {
    const original = {
      id: 1,
      name: "hello",
      payload: { type: "blob" as const, hex: "00ff", bytes: 2 },
    };
    const changes = {
      resourceId: id(),
      changes: [{ kind: "update" as const, original, values: { name: "what? 'quote'" } }],
    };
    const preview = database.changeRows(changes, false);
    expect(preview[0]).toContain("'what? ''quote''' ");
    expect(execute('SELECT name FROM "odd""table" WHERE id=1')).toMatchObject({
      rows: [["hello"]],
    });
    database.changeRows(changes, true);
    expect(execute('SELECT name FROM "odd""table" WHERE id=1')).toMatchObject({
      rows: [["what? 'quote'"]],
    });
    expect(() =>
      database.changeRows(
        {
          resourceId: id(),
          changes: [
            { kind: "insert", values: { id: 3, name: "must roll back" } },
            ...changes.changes,
          ],
        },
        true,
      ),
    ).toThrow("Conflict");
    expect(execute('SELECT COUNT(*) FROM "odd""table" WHERE id=3')).toMatchObject({ rows: [[0]] });
  });
  it("honors an outer transaction, preserves large keys, and rejects NULL keys and preview edits", () => {
    execute("BEGIN");
    database.changeRows(
      { resourceId: id(), changes: [{ kind: "insert", values: { id: 3, name: "uncommitted" } }] },
      true,
    );
    execute("ROLLBACK");
    expect(execute('SELECT COUNT(*) FROM "odd""table"')).toMatchObject({ rows: [[3]] });
    database.changeRows(
      {
        resourceId: id(),
        changes: [
          {
            kind: "delete",
            original: {
              id: { type: "integer", value: "9007199254740993" },
              name: "large",
              payload: { type: "blob", hex: "ab", bytes: 1 },
            },
            values: {},
          },
        ],
      },
      true,
    );
    expect(execute('SELECT COUNT(*) FROM "odd""table"')).toMatchObject({ rows: [[2]] });
    execute("CREATE TABLE nullable (id TEXT PRIMARY KEY, value TEXT)");
    execute("INSERT INTO nullable VALUES(NULL,'x')");
    const nullable = database.schema().find((table) => table.name === "nullable")!;
    expect(() =>
      database.changeRows(
        {
          resourceId: nullable.resourceId,
          changes: [{ kind: "delete", original: { id: null, value: "x" }, values: {} }],
        },
        true,
      ),
    ).toThrow("NULL primary keys");
    expect(() =>
      database.changeRows(
        {
          resourceId: id(),
          changes: [
            {
              kind: "update",
              original: { id: 1, name: "hello", payload: { type: "blob", hex: "00", bytes: 400 } },
              values: { name: "x" },
            },
          ],
        },
        false,
      ),
    ).toThrow("truncated");
  });
  it("keeps read-only edits disabled and opens complete text values by primary key", () => {
    const reader = new SqliteDatabase({ path, readOnly: true });
    try {
      expect(reader.schema().every((table) => !table.editable)).toBe(true);
      expect(() =>
        reader.changeRows({ resourceId: id(), changes: [{ kind: "insert", values: {} }] }, true),
      ).toThrow("writable");
    } finally {
      reader.close();
    }
    execute('UPDATE "odd""table" SET name=$value WHERE id=1', { value: "x".repeat(20000) });
    expect(database.readCell({ resourceId: id(), column: "name", key: { id: 1 } })).toHaveLength(
      20000,
    );
    expect(database.readCell({ resourceId: id(), column: "payload", key: { id: 1 } })).toBe("00ff");
  });
  it("exports filtered full values and refuses to overwrite the database", async () => {
    execute('UPDATE "odd""table" SET name=$value WHERE id=1', { value: "x".repeat(20000) });
    const output = join(directory, "rows.json");
    expect(
      database.exportTable({
        path: output,
        format: "json",
        request: {
          resourceId: id(),
          offset: 0,
          limit: 25,
          filters: [{ column: "id", operator: "=", value: 1 }],
        },
      }),
    ).toBe(1);
    const { readFileSync } = await import("node:fs");
    expect(JSON.parse(readFileSync(output, "utf8"))[0].name).toHaveLength(20000);
    expect(() =>
      database.exportTable({
        path,
        format: "csv",
        request: { resourceId: id(), offset: 0, limit: 25 },
      }),
    ).toThrow("Cannot overwrite");
  });
});
