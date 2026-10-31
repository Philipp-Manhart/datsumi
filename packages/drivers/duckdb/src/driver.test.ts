/* oxlint-disable no-await-in-loop -- Exercise the real sequential worker session and native cancellation. */
import { mkdtempSync, copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConnectionProfile } from "@datsumi/core";
import { build } from "esbuild";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// @ts-expect-error JavaScript build helper has no declarations.
import { duckDbNativePlugin } from "../build.mjs";
import { parseDuckDbConfiguration } from "./configuration";
import { DuckDbDriver } from "./index";
const directory = mkdtempSync(join(tmpdir(), "datsumi-duckdb-"));
const worker = join(directory, "duckdb.cjs");
const driver = new DuckDbDriver(async () => worker);
const profile: ConnectionProfile = {
  id: "test",
  name: "DuckDB",
  driverId: "duckdb",
  family: "relational",
  configuration: { path: ":memory:", readOnly: false },
};
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const apiRequire = createRequire(require.resolve("@duckdb/node-api"));
  const bindingRequire = createRequire(apiRequire.resolve("@duckdb/node-bindings"));
  const native = bindingRequire.resolve(
    `@duckdb/node-bindings-${process.platform}-${process.arch}/duckdb.node`,
  );
  mkdirSync(join(directory, "native"));
  copyFileSync(native, join(directory, "native", "duckdb.node"));
  const lib =
    process.platform === "win32"
      ? "duckdb.dll"
      : process.platform === "darwin"
        ? "libduckdb.dylib"
        : "libduckdb.so";
  copyFileSync(join(native, "..", lib), join(directory, "native", lib));
  await build({
    entryPoints: [new URL("./entry-duckdb.ts", import.meta.url).pathname],
    outfile: worker,
    bundle: true,
    platform: "node",
    format: "cjs",
    plugins: [duckDbNativePlugin],
  });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const run = (session: Awaited<ReturnType<typeof driver.connect>>, text: string) =>
  driver.execute(session, { language: "sql", text });
describe("real DuckDB worker", () => {
  it("captures every query row beyond preview limits through the real worker", async () => {
    const session = await driver.connect(profile, profile.configuration);
    try {
      const result = await driver.execute(session, {
        language: "sql",
        captureAll: true,
        text: "SELECT range, repeat('x', 20000) AS text FROM range(12001) WHERE range=0 UNION ALL SELECT range, 'tail' FROM range(1,12001)",
      });
      if (result.kind !== "table") throw new Error("Expected table");
      expect(result.rows).toHaveLength(12001);
      expect(result.truncated).toBe(false);
      expect(result.rows[0]?.[1]).toBe("x".repeat(20000));
      expect(result.rows.at(-1)?.[0]).toEqual({ type: "integer", value: "12000" });
    } finally {
      await driver.disconnect(session);
    }
  });

  it("preserves exact/nested values, multiple result sets and captures bounded results", async () => {
    const session = await driver.connect(profile, profile.configuration);
    try {
      expect(
        await run(
          session,
          "SELECT 9223372036854775807::BIGINT AS n, 12345678901234567890.12::DECIMAL(38,2) AS d, {'n':9223372036854775807::BIGINT} AS obj, [1,2] AS list, '\\x00\\xFF'::BLOB AS b; SELECT 2 AS other",
        ),
      ).toMatchObject({
        kind: "table",
        rows: [
          [
            { type: "integer", value: "9223372036854775807" },
            "12345678901234567890.12",
            '{"n":"9223372036854775807"}',
            "[1,2]",
            { type: "blob", hex: "00ff", bytes: 2 },
          ],
        ],
        additionalResults: [{ rows: [[2]] }],
      });
      const result = await run(session, "SELECT * FROM range(1000000)");
      expect(result).toMatchObject({ truncated: true });
      expect(result.kind === "table" ? result.rows.length : 0).toBe(10000);
      expect(await run(session, "SELECT 3")).toMatchObject({ rows: [[3]] });
      await expect(run(session, "SELECT * FROM missing_table")).rejects.toThrow(/missing_table/);
      expect(await run(session, "SELECT 4")).toMatchObject({ rows: [[4]] });
    } finally {
      await driver.disconnect(session);
    }
  });
  it("browses schema, composite relationships, safe filters, sorting and pagination", async () => {
    const session = await driver.connect(profile, profile.configuration);
    try {
      await run(
        session,
        `CREATE SCHEMA shop; CREATE TABLE shop.parents(a INTEGER,b INTEGER,PRIMARY KEY(a,b)); CREATE TABLE shop.children(id INTEGER PRIMARY KEY,a INTEGER,b INTEGER,note VARCHAR,FOREIGN KEY(a,b) REFERENCES shop.parents(a,b)); INSERT INTO shop.parents VALUES (1,2); INSERT INTO shop.children VALUES (1,1,2,'100%'),(2,1,2,'other'); CREATE VIEW shop.names AS SELECT note FROM shop.children; CREATE INDEX notes_idx ON shop.children(note);`,
      );
      const tables = await driver.schema(session);
      const info = tables.find((item) => item.name === "shop.children")!;
      expect(info).toMatchObject({
        editable: false,
        driverId: "duckdb",
        foreignKeys: [{ target: "shop.parents", columns: ["a", "b"], targetColumns: ["a", "b"] }],
      });
      expect(info.ddl).toContain("CREATE TABLE");
      expect(info.indexes[0]?.name).toBe("notes_idx");
      expect(tables.find((item) => item.name === "shop.names")?.kind).toBe("view");
      expect(
        await driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 1,
          order: { column: "id", direction: "desc" },
        }),
      ).toMatchObject({ hasMore: true, result: { rows: [[2, 1, 2, "other"]] } });
      expect(
        await driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 10,
          filters: [{ column: "note", operator: "contains", value: "%" }],
        }),
      ).toMatchObject({ hasMore: false, result: { rows: [[1, 1, 2, "100%"]] } });
      await expect(
        driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 10,
          order: { column: "id; DROP TABLE shop.children", direction: "asc" },
        }),
      ).rejects.toThrow(/sort/);
      expect(await driver.listResources(session, info.resourceId)).toHaveLength(4);
      await expect(
        driver.changeRows(session, { resourceId: info.resourceId, changes: [] }, true),
      ).rejects.toThrow(/grid editing/);
      const path = join(directory, "export.json");
      expect(
        await driver.exportTable(session, {
          path,
          format: "json",
          request: { resourceId: info.resourceId, offset: 0, limit: 10 },
        }),
      ).toBe(2);
      expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(2);
    } finally {
      await driver.disconnect(session);
    }
  });
  it("creates persistent files, enforces read-only mode, reports transactions and rolls back", async () => {
    const path = join(directory, "saved.duckdb");
    const config = { path, readOnly: false };
    let session = await driver.connect(profile, { ...config, create: true });
    try {
      await run(
        session,
        "CREATE TABLE entries(id INTEGER PRIMARY KEY, value VARCHAR); INSERT INTO entries VALUES (1,'original')",
      );
      expect(await driver.transactionState(session)).toBe("idle");
      await run(session, "BEGIN; INSERT INTO entries VALUES (2,'pending')");
      expect(await driver.transactionState(session)).toBe("open");
      await run(session, "ROLLBACK");
      expect(await driver.transactionState(session)).toBe("idle");
    } finally {
      await driver.disconnect(session);
    }
    session = await driver.connect(profile, { ...config, readOnly: true });
    try {
      expect(await run(session, "SELECT * FROM entries")).toMatchObject({
        rows: [[1, "original"]],
      });
      await expect(run(session, "DELETE FROM entries")).rejects.toThrow(/read.only/i);
    } finally {
      await driver.disconnect(session);
    }
    await expect(driver.connect(profile, { ...config, create: true })).rejects.toThrow(
      /already exists/,
    );
    await expect(
      driver.connect(profile, { path: join(directory, "missing.duckdb"), readOnly: false }),
    ).rejects.toThrow(/ENOENT/);
  });
  it("queries CSV and Parquet files without importing them", async () => {
    const session = await driver.connect(profile, profile.configuration);
    try {
      const csv = join(directory, "input.csv"),
        parquet = join(directory, "input.parquet");
      writeFileSync(csv, "id,name\n1,Alex\n2,Sam\n");
      const literal = (path: string) => "'" + path.replaceAll("'", "''") + "'";
      expect(
        await run(session, `SELECT name FROM read_csv(${literal(csv)}) ORDER BY id`),
      ).toMatchObject({ rows: [["Alex"], ["Sam"]] });
      await run(
        session,
        `COPY (SELECT * FROM read_csv(${literal(csv)})) TO ${literal(parquet)} (FORMAT PARQUET)`,
      );
      expect(
        await run(session, `SELECT name FROM read_parquet(${literal(parquet)}) ORDER BY id DESC`),
      ).toMatchObject({ rows: [["Sam"], ["Alex"]] });
    } finally {
      await driver.disconnect(session);
    }
  });
  it("cancels expensive native queries and reconnects without replay", async () => {
    const config = { path: join(directory, "cancel.duckdb"), readOnly: false };
    const session = await driver.connect(profile, { ...config, create: true });
    await run(session, "CREATE TABLE pending(id INTEGER); BEGIN; INSERT INTO pending VALUES (1)");
    let cancel = () => {};
    const result = driver
      .execute(
        session,
        {
          language: "sql",
          text: "SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)",
        },
        {
          isCancellationRequested: false,
          onCancellationRequested(listener) {
            cancel = listener;
            return { dispose() {} };
          },
        },
      )
      .catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    cancel();
    expect(String(await result)).toMatch(/cancelled/);
    await driver.disconnect(session);
    const next = await driver.connect(profile, config);
    try {
      expect(await run(next, "SELECT COUNT(*)::INTEGER FROM pending")).toMatchObject({
        rows: [[0]],
      });
    } finally {
      await driver.disconnect(next);
    }
  });
  it("rejects nonlocal paths and invalid settings", () => {
    for (const value of [
      { path: "https://example.com/db", readOnly: false },
      { path: ":memory:", readOnly: true },
      { path: "relative.duckdb", readOnly: false },
      { path: "/tmp/a", readOnly: false, password: "bad" },
    ])
      expect(() => parseDuckDbConfiguration(value)).toThrow(/DuckDB|absolute/);
  });
});
