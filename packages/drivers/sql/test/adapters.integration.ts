/* oxlint-disable no-await-in-loop -- Retry server startup serially; simultaneous attempts would obscure readiness failures. */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { clipboardValue, type ConnectionProfile, type DriverCancellation } from "@datsumi/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ServerDriver } from "../src/configuration";
import { qualifiedName } from "../src/dialect";
import { ServerDriverAdapter, type ServerSession } from "../src/index";
const password = process.env.DATSUMI_TEST_PASSWORD;
if (!password) throw new Error("Use bun run test:drivers to start isolated test databases.");
for (const id of ["postgres", "mysql", "mariadb", "mssql"] as const) {
  describe(`${id} real server`, () => {
    const schema = id === "postgres" ? "public" : id === "mssql" ? "dbo" : "datsumi";
    const config = {
      host: "127.0.0.1",
      port: Number(process.env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`]),
      database: id === "mssql" ? "master" : "datsumi",
      username: id === "mssql" ? "sa" : "datsumi",
      password,
      tls: "disable",
      ca: "",
      readOnly: false,
    };
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: "test",
      driverId: id,
      family: "relational",
      configuration: {},
    };
    const driver = new ServerDriverAdapter(id, async () => resolve(`dist/drivers/${id}.cjs`));
    let session: ServerSession;
    const parent = qualifiedName(id, "datsumi_parent", schema),
      child = qualifiedName(id, "datsumi_child", schema);
    const query = (text: string) => driver.execute(session, { language: "sql", text });
    it("retains the entire result beyond 10000 rows when requested for clipboard use", async () => {
      const digits = Array.from({ length: 10 }, (_, n) => `SELECT ${n} AS n`).join(" UNION ALL ");
      const text = `SELECT ${id === "mssql" ? "TOP(12001) " : ""}a.n + b.n*10 + c.n*100 + d.n*1000 + e.n*10000 AS n FROM (${digits}) a CROSS JOIN (${digits}) b CROSS JOIN (${digits}) c CROSS JOIN (${digits}) d CROSS JOIN (${digits}) e ORDER BY n${id === "mssql" ? "" : " LIMIT 12001"}`;
      const result = await driver.execute(session, { language: "sql", text, captureAll: true });
      if (result.kind !== "table") throw new Error("Expected table");
      expect(result.truncated).toBe(false);
      expect(result.rows).toHaveLength(12001);
      expect(clipboardValue(result.rows.at(-1)?.[0] ?? null)).toBe("12000");
    });
    const table = async () => {
      const info = (await driver.schema(session)).find(
        (t) => t.name === `${schema}.datsumi_parent`,
      );
      if (!info) throw new Error("Fixture schema missing.");
      return info;
    };
    beforeAll(async () => {
      const deadline = Date.now() + 150000;
      for (;;) {
        try {
          session = await driver.connect(profile, config);
          break;
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      await query(
        `CREATE TABLE ${parent} (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, amount DECIMAL(30,8), note VARCHAR(100) NULL)`,
      );
      await query(
        `CREATE TABLE ${child} (id INTEGER PRIMARY KEY,parent_id INTEGER,CONSTRAINT datsumi_fk FOREIGN KEY(parent_id) REFERENCES ${parent}(id))`,
      );
      await query(
        `INSERT INTO ${parent} (id,name,amount,note) VALUES (1,'first',25.5,NULL),(2,'second',30.25,'note'),(3,'third',40.0,'note')`,
      );
    });
    afterAll(async () => {
      if (session) await driver.disconnect(session);
    });
    it("preserves duplicate result column names and session state", async () => {
      const result = await query("SELECT 1 AS duplicate, 2 AS duplicate");
      expect(result.kind).toBe("table");
      if (result.kind !== "table") throw new Error("Expected a tabular result");
      {
        expect(result.columns).toEqual(["duplicate", "duplicate"]);
        expect(result.rows.map((row) => row.map(String))).toEqual([["1", "2"]]);
      }
      const temporary = id === "mssql" ? "#datsumi_temp" : "datsumi_temp";
      await query(
        `${id === "mssql" ? "CREATE TABLE" : "CREATE TEMPORARY TABLE"} ${temporary} (value INTEGER)`,
      );
      await query(`INSERT INTO ${temporary} VALUES (42)`);
      const stored = await query(`SELECT value FROM ${temporary}`);
      expect(stored.kind === "table" && stored.rows[0]?.[0]).toBe(42);
    });
    it.skipIf(id === "postgres")(
      "distinguishes idle manual-commit mode from autocommit",
      async () => {
        const manual = id === "mssql" ? "SET IMPLICIT_TRANSACTIONS ON" : "SET autocommit=0";
        const automatic = id === "mssql" ? "SET IMPLICIT_TRANSACTIONS OFF" : "SET autocommit=1";
        try {
          await query(manual);
          expect(await driver.transactionState(session)).toBe("manual");
          expect(await driver.transactionState(session)).toBe("manual");
        } finally {
          if (id === "mssql") await query("IF @@TRANCOUNT > 0 ROLLBACK");
          await query(automatic);
        }
        expect(await driver.transactionState(session)).toBe("idle");
      },
    );
    it.skipIf(id !== "postgres")(
      "reports a failed PostgreSQL transaction without guessing from SQL text",
      async () => {
        await query("BEGIN");
        await expect(query("SELECT 1/0")).rejects.toThrow("division");
        expect(await driver.transactionState(session)).toBe("failed");
        await query("ROLLBACK");
        expect(await driver.transactionState(session)).toBe("idle");
      },
    );
    it("discovers schema-qualified columns, primary keys, indexes and relationships", async () => {
      const info = await table();
      expect(info.resourceId).toBe(JSON.stringify([schema, "datsumi_parent"]));
      expect(info.columns.find((col) => col.name === "id")?.primaryKey).toBe(1);
      expect(info.editable).toBe(true);
      const fk = (await driver.schema(session)).find((t) => t.name === `${schema}.datsumi_child`)
        ?.foreignKeys[0];
      expect(fk).toMatchObject({
        target: `${schema}.datsumi_parent`,
        columns: ["parent_id"],
        targetColumns: ["id"],
      });
      expect(
        (await driver.listResources(session)).some((item) => item.id === info.resourceId),
      ).toBe(true);
    });
    it("paginates, sorts and binds filters without SQL injection", async () => {
      const info = await table();
      const page = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 1,
        order: { column: "id", direction: "desc" },
      });
      expect(page.result.rows[0]?.[0]).toBe(3);
      expect(page.hasMore).toBe(true);
      const empty = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 100,
        filters: [{ column: "name", operator: "=", value: "first' OR 1=1 --" }],
      });
      expect(empty.result.rows).toHaveLength(0);
      await expect(
        driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 1,
          order: { column: "unknown", direction: "asc" },
        }),
      ).rejects.toThrow("sort");
    });
    it("keeps parameters separate from SQL even when MySQL escape rules change", async () => {
      const mysqlFamily = id === "mysql" || id === "mariadb";
      if (mysqlFamily) await query("SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'");
      try {
        const info = await table();
        const page = await driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 100,
          filters: [{ column: "name", operator: "=", value: "x\\' OR 1=1 --" }],
        });
        expect(page.result.rows).toHaveLength(0);
      } finally {
        if (mysqlFamily) await query("SET SESSION sql_mode=DEFAULT");
      }
    });
    it.skipIf(!["mysql", "mariadb"].includes(id))(
      "rejects temporary nontransactional shadows before changing any row",
      async () => {
        const info = await table();
        await query(
          `CREATE TEMPORARY TABLE ${parent} (id INTEGER PRIMARY KEY,name VARCHAR(100),amount DECIMAL(30,8),note VARCHAR(100)) ENGINE=MEMORY`,
        );
        try {
          await query(`INSERT INTO ${parent} VALUES(1,'shadow',1,NULL),(2,'second',2,NULL)`);
          const request = {
            resourceId: info.resourceId,
            changes: [
              {
                kind: "update" as const,
                original: { id: 1, name: "shadow", amount: "1.00000000", note: null },
                values: { name: "must not write" },
              },
              {
                kind: "update" as const,
                original: { id: 2, name: "stale", amount: "2.00000000", note: null },
                values: { name: "conflict" },
              },
            ],
          };
          await expect(driver.changeRows(session, request, false)).rejects.toThrow(
            /permanent InnoDB|writable transactional/,
          );
          await expect(driver.changeRows(session, request, true)).rejects.toThrow(
            /permanent InnoDB|writable transactional/,
          );
          const result = await query(`SELECT name FROM ${parent} WHERE id=1`);
          expect(result.kind === "table" && result.rows[0]?.[0]).toBe("shadow");
        } finally {
          await query(`DROP TEMPORARY TABLE ${parent}`);
        }
      },
    );
    it("stages without executing, commits atomically, and detects stale originals", async () => {
      const info = await table();
      const page = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 10,
      });
      const original = Object.fromEntries(
        page.result.columns.map((col, i) => [col, page.result.rows[0]?.[i] ?? null]),
      );
      const change = { kind: "update" as const, original, values: { name: "edited" } };
      await driver.changeRows(session, { resourceId: info.resourceId, changes: [change] }, false);
      expect(
        (await driver.browseTable(session, { resourceId: info.resourceId, offset: 0, limit: 1 }))
          .result.rows[0]?.[1],
      ).toBe("first");
      await driver.changeRows(session, { resourceId: info.resourceId, changes: [change] }, true);
      await expect(
        driver.changeRows(session, { resourceId: info.resourceId, changes: [change] }, true),
      ).rejects.toThrow("conflict");
      expect(
        (await driver.browseTable(session, { resourceId: info.resourceId, offset: 0, limit: 1 }))
          .result.rows[0]?.[1],
      ).toBe("edited");
    });
    it("rolls back the entire batch after a later constraint error", async () => {
      const info = await table(),
        page = await driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 1,
        });
      const original = Object.fromEntries(
        page.result.columns.map((col, i) => [col, page.result.rows[0]?.[i] ?? null]),
      );
      await expect(
        driver.changeRows(
          session,
          {
            resourceId: info.resourceId,
            changes: [
              { kind: "update", original, values: { name: "must roll back" } },
              { kind: "insert", values: { id: 2, name: "duplicate" } },
            ],
          },
          true,
        ),
      ).rejects.toThrow(/./);
      expect(
        (await driver.browseTable(session, { resourceId: info.resourceId, offset: 0, limit: 1 }))
          .result.rows[0]?.[1],
      ).toBe("edited");
    });
    it("keeps staged commits inside an existing explicit transaction", async () => {
      const info = await table(),
        page = await driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 1,
        });
      const original = Object.fromEntries(
        page.result.columns.map((col, i) => [col, page.result.rows[0]?.[i] ?? null]),
      );
      expect(await driver.transactionState(session)).toBe("idle");
      await query(id === "mssql" ? "BEGIN TRANSACTION" : "BEGIN");
      expect(await driver.transactionState(session)).toBe("open");
      await driver.changeRows(
        session,
        {
          resourceId: info.resourceId,
          changes: [{ kind: "update", original, values: { name: "uncommitted" } }],
        },
        true,
      );
      await query("ROLLBACK");
      expect(await driver.transactionState(session)).toBe("idle");
      expect(
        (await driver.browseTable(session, { resourceId: info.resourceId, offset: 0, limit: 1 }))
          .result.rows[0]?.[1],
      ).toBe("edited");
    });
    it("exports complete filtered rows atomically and marks oversized captured cells", async () => {
      const directory = await mkdtemp(join(tmpdir(), "datsumi-server-export-"));
      try {
        const info = await table(),
          path = join(directory, "rows.json");
        expect(
          await driver.exportTable(session, {
            path,
            format: "json",
            request: {
              resourceId: info.resourceId,
              offset: 0,
              limit: 100,
              filters: [{ column: "id", operator: ">", value: 1 }],
            },
          }),
        ).toBe(2);
        expect(JSON.parse(await readFile(path, "utf8"))).toHaveLength(2);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      const large = await query(
        id === "mssql"
          ? "SELECT REPLICATE(CAST('x' AS VARCHAR(MAX)),20000) AS huge"
          : "SELECT REPEAT('x',20000) AS huge",
      );
      expect(large.kind === "table" && large.rows[0]?.[0]).toMatchObject({
        type: "text",
        length: 20000,
      });
    });
    it("cancels long queries by closing the session and reconnects without replaying writes", async () => {
      await query(id === "mssql" ? "BEGIN TRANSACTION" : "BEGIN");
      await query(`INSERT INTO ${parent} (id,name) VALUES (99,'must roll back on disconnect')`);
      const controller = new AbortController();
      const signal: DriverCancellation = {
        get isCancellationRequested() {
          return controller.signal.aborted;
        },
        onCancellationRequested(listener) {
          controller.signal.addEventListener("abort", listener);
          return { dispose: () => controller.signal.removeEventListener("abort", listener) };
        },
      };
      const timeout = setTimeout(() => controller.abort(), 150);
      try {
        await expect(
          driver.execute(session, { language: "sql", text: sleepSql(id) }, signal),
        ).rejects.toThrow("cancelled");
      } finally {
        clearTimeout(timeout);
      }
      expect(driver.isConnected(session)).toBe(false);
      await driver.disconnect(session);
      session = await driver.connect(profile, config);
      const result = await query(`SELECT id FROM ${parent} WHERE id=99`);
      expect(result.kind === "table" && result.rows).toEqual([]);
    });
    /* oxlint-disable vitest/no-conditional-expect -- SQL Server must reject high-precision numeric tokens; other drivers must return exact strings. Both branches assert their explicit contract. */
    it("inserts and deletes staged rows and reads full values beyond the capture preview", async () => {
      const info = await table();
      await driver.changeRows(
        session,
        {
          resourceId: info.resourceId,
          changes: [{ kind: "insert", values: { id: 10, name: "new row" } }],
        },
        true,
      );
      const inserted = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 100,
        filters: [{ column: "id", operator: "=", value: 10 }],
      });
      const original = Object.fromEntries(
        inserted.result.columns.map((col, i) => [col, inserted.result.rows[0]?.[i] ?? null]),
      );
      await driver.changeRows(
        session,
        { resourceId: info.resourceId, changes: [{ kind: "delete", original, values: {} }] },
        true,
      );
      expect(
        (
          await driver.browseTable(session, {
            resourceId: info.resourceId,
            offset: 0,
            limit: 100,
            filters: [{ column: "id", operator: "=", value: 10 }],
          })
        ).result.rows,
      ).toHaveLength(0);
      const long = qualifiedName(id, "datsumi_long", schema),
        type = id === "mssql" ? "VARCHAR(MAX)" : "TEXT";
      await query(`CREATE TABLE ${long} (id INT PRIMARY KEY, contents ${type})`);
      await query(
        `INSERT INTO ${long} VALUES (1,${id === "mssql" ? "REPLICATE(CAST('x' AS VARCHAR(MAX)),20000)" : "REPEAT('x',20000)"})`,
      );
      const target = (await driver.schema(session)).find(
        (t) => t.name === `${schema}.datsumi_long`,
      )!;
      expect(
        await driver.readCell(session, {
          resourceId: target.resourceId,
          column: "contents",
          key: { id: 1 },
        }),
      ).toBe("x".repeat(20000));
    });
    it("preserves large integers and exact decimals without silently rounding", async () => {
      const big = await query(
        `SELECT CAST('9007199254740993' AS ${id === "mysql" || id === "mariadb" ? "SIGNED" : "BIGINT"}) AS exact_value`,
      );
      if (big.kind !== "table") throw new Error("Expected a table");
      const value = big.rows[0]?.[0];
      expect(
        value && typeof value === "object" && value.type === "integer" ? value.value : value,
      ).toBe("9007199254740993");
      const sql = "SELECT CAST('12345678901234567890.12345678' AS DECIMAL(30,8)) AS exact_value";
      if (id === "mssql") {
        await expect(query(sql)).rejects.toThrow("high-precision decimals");
        const exact = await query(
          "SELECT CONVERT(VARCHAR(100),CAST('12345678901234567890.12345678' AS DECIMAL(30,8))) AS exact_value",
        );
        expect(exact.kind === "table" && exact.rows[0]?.[0]).toBe("12345678901234567890.12345678");
      } else {
        const exact = await query(sql);
        expect(exact.kind === "table" && exact.rows[0]?.[0]).toBe("12345678901234567890.12345678");
      }
    });
    it("connects with verified TLS and a trusted custom CA", async () => {
      const secure = await driver.connect(profile, {
        ...config,
        tls: "verify",
        ca: process.env.DATSUMI_TEST_CA,
      });
      try {
        const result = await driver.execute(secure, {
          language: "sql",
          text: "SELECT 42 AS answer",
        });
        expect(
          result.kind === "table" && JSON.stringify(result.rows[0]?.[0]).replaceAll('"', ""),
        ).toBe("42");
      } finally {
        await driver.disconnect(secure);
      }
    });
    it("fails closed when verified TLS cannot authenticate the fixture server", async () => {
      await expect(
        driver.connect(profile, { ...config, tls: "verify", ca: "not a valid certificate" }),
      ).rejects.toThrow(/./);
    });
    it("does not reveal passwords in connection errors", async () => {
      const wrong = "Sentinel_Invalid_Password!";
      let message = "";
      try {
        const unexpected = await driver.connect(profile, { ...config, password: wrong });
        await driver.disconnect(unexpected);
        throw new Error("Unexpected authentication success");
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toContain(wrong);
      expect(message).not.toContain("Unexpected authentication success");
    });
  });
}
function sleepSql(driver: ServerDriver): string {
  return driver === "postgres"
    ? "SELECT pg_sleep(30)"
    : driver === "mssql"
      ? "WAITFOR DELAY '00:00:30'"
      : "SELECT SLEEP(30)";
}
