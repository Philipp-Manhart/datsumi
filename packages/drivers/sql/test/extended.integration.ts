/* oxlint-disable vitest/no-conditional-expect -- Shared engine tests include Oracle-specific foreign key and full-cell assertions. */
/* oxlint-disable no-await-in-loop -- Wait for disposable servers and use one session at a time. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { clipboardValue, type ConnectionProfile } from "@datsumi/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ServerDriverAdapter, type ServerSession } from "../src/index";

for (const id of ["clickhouse", "oracle"] as const) {
  describe(`${id} real worker`, () => {
    const driver = new ServerDriverAdapter(id, async () => resolve(`dist/drivers/${id}.cjs`));
    const config = {
      host: "127.0.0.1",
      port: Number(process.env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`]),
      database: id === "oracle" ? "FREEPDB1" : "datsumi",
      username: "datsumi",
      password: process.env.DATSUMI_TEST_PASSWORD!,
      tls: "disable",
      ca: "",
      readOnly: false,
    };
    const profile: ConnectionProfile = {
      id,
      name: id,
      driverId: id,
      family: "relational",
      configuration: {},
    };
    let session: ServerSession;
    const table = id === "oracle" ? '"DATSUMI"."fixture"' : "`datsumi`.`fixture`";
    const query = (text: string) => driver.execute(session, { text, language: "sql" });
    beforeAll(async () => {
      const deadline = Date.now() + 180000;
      for (;;) {
        try {
          session = await driver.connect(profile, config);
          break;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
        }
      }
      await query(
        id === "oracle"
          ? `CREATE TABLE ${table} ("id" NUMBER(20) PRIMARY KEY,"name" VARCHAR2(100),"amount" NUMBER(30,8),"note" CLOB)`
          : `CREATE TABLE ${table} (id UInt64,name String,amount Decimal(30,8),note Nullable(String)) ENGINE=MergeTree ORDER BY id`,
      );
      await query(`INSERT INTO ${table} VALUES (1,'first',12345678901234567890.12345678,'note')`);
      await query(`INSERT INTO ${table} VALUES (2,'second',2.5,NULL)`);
      if (id === "oracle") {
        await query(
          `CREATE TABLE "DATSUMI"."child" ("id" NUMBER PRIMARY KEY,"parent_id" NUMBER REFERENCES ${table}("id"))`,
        );
        await query("COMMIT");
      }
    });
    afterAll(async () => {
      if (session) await driver.disconnect(session);
    });
    it("preserves duplicate columns, nulls, exact numbers and empty result metadata", async () => {
      const result = await query(
        id === "oracle"
          ? "SELECT 1 AS duplicate, 2 AS duplicate FROM dual"
          : "SELECT 1 AS first, 2 AS second",
      );
      expect(result.kind === "table" && result.columns).toEqual(
        id === "oracle" ? ["DUPLICATE", "DUPLICATE"] : ["first", "second"],
      );
      const values = await query(
        `SELECT * FROM ${table} ORDER BY ${id === "oracle" ? '"id"' : "id"}`,
      );
      if (values.kind !== "table") throw new Error("Expected table");
      expect(values.rows[0]?.[2]).toBe("12345678901234567890.12345678");
      expect(values.rows[1]?.[3]).toBeNull();
      const empty = await query(`SELECT * FROM ${table} WHERE 1=0`);
      expect(empty.kind === "table" && empty.columns.length).toBe(4);
      expect(empty.kind === "table" && empty.rows).toEqual([]);
    });
    it("discovers metadata, safely filters/sorts/pages and disables staged writes", async () => {
      const info = (await driver.schema(session)).find((item) => item.name.endsWith(".fixture"))!;
      expect(info).toBeDefined();
      expect(info.editable).toBe(false);
      expect(info.columns.map((column) => column.name)).toEqual(["id", "name", "amount", "note"]);
      if (id === "oracle")
        expect(
          (await driver.schema(session)).find((item) => item.name.endsWith(".child"))
            ?.foreignKeys[0]?.columns,
        ).toEqual(["parent_id"]);
      const first = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 1,
        order: { column: "id", direction: "desc" },
      });
      expect(clipboardValue(first.result.rows[0]?.[0] ?? null)).toBe("2");
      expect(first.hasMore).toBe(true);
      const second = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 1,
        limit: 1,
        order: { column: "id", direction: "desc" },
      });
      expect(clipboardValue(second.result.rows[0]?.[0] ?? null)).toBe("1");
      expect(second.hasMore).toBe(false);
      const filtered = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 10,
        filters: [{ column: "id", operator: "=", value: "2" }],
      });
      expect(filtered.result.rows).toHaveLength(1);
      const injection = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 10,
        filters: [{ column: "name", operator: "=", value: "x' OR 1=1 --" }],
      });
      expect(injection.result.rows).toHaveLength(0);
      const contains = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 10,
        filters: [{ column: "name", operator: "contains", value: "irs" }],
      });
      expect(contains.result.rows).toHaveLength(1);
      const literal = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 10,
        filters: [{ column: "name", operator: "contains", value: "%" }],
      });
      expect(literal.result.rows).toHaveLength(0);
      await expect(
        driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 10,
          order: { column: "bad", direction: "asc" },
        }),
      ).rejects.toThrow("sort");
      await expect(
        driver.changeRows(session, { resourceId: info.resourceId, changes: [] }, true),
      ).rejects.toThrow("Editing requires");
      if (id === "oracle")
        expect(
          await driver.readCell(session, {
            resourceId: info.resourceId,
            key: { id: "1" },
            column: "note",
          }),
        ).toBe("note");
    });
    it("exports filtered table contents atomically", async () => {
      const directory = await mkdtemp(join(tmpdir(), "datsumi-extended-"));
      try {
        const info = (await driver.schema(session)).find((item) => item.name.endsWith(".fixture"))!;
        const path = join(directory, "export.json");
        expect(
          await driver.exportTable(session, {
            path,
            format: "json",
            request: {
              resourceId: info.resourceId,
              offset: 0,
              limit: 100,
              filters: [{ column: "name", operator: "=", value: "second" }],
            },
          }),
        ).toBe(1);
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
          { id: "2", name: "second", amount: "2.5", note: null },
        ]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    it("preserves timestamp precision and complete text during query capture", async () => {
      const result = await driver.execute(session, {
        language: "sql",
        captureAll: true,
        text:
          id === "oracle"
            ? `SELECT TO_CHAR(TIMESTAMP '2026-01-01 12:34:56.123456789', 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS moment, TO_CLOB(RPAD('x',4000,'x')) AS contents FROM dual`
            : `SELECT toDateTime64('2026-01-01 12:34:56.123456789',9,'UTC') AS moment, repeat('x',20000) AS contents`,
      });
      if (result.kind !== "table") throw new Error("Expected table");
      expect(result.rows[0]?.[0]).toBe(
        id === "oracle" ? "2026-01-01T12:34:56.123456789" : "2026-01-01 12:34:56.123456789",
      );
      expect(result.rows[0]?.[1]).toBe("x".repeat(id === "oracle" ? 4000 : 20000));
    });
    it("captures results beyond the preview row limit", async () => {
      const result = await driver.execute(session, {
        language: "sql",
        captureAll: true,
        text:
          id === "oracle"
            ? "SELECT level AS n FROM dual CONNECT BY level <= 12001"
            : "SELECT number AS n FROM numbers(12001)",
      });
      expect(result.kind === "table" && result.rows).toHaveLength(12001);
      expect(result.kind === "table" && result.truncated).toBe(false);
    });
    it("closes cancelled queries without replay and reconnects", async () => {
      const callbacks = new Set<() => void>();
      const pending = driver.execute(
        session,
        {
          language: "sql",
          text:
            id === "oracle"
              ? "BEGIN DBMS_SESSION.SLEEP(30); END;"
              : "SELECT sleep(3) FROM numbers(30)",
        },
        {
          isCancellationRequested: false,
          onCancellationRequested(callback) {
            callbacks.add(callback);
            return {
              dispose() {
                callbacks.delete(callback);
              },
            };
          },
        },
      );
      setTimeout(() => {
        for (const callback of callbacks) callback();
      }, 100);
      await expect(pending).rejects.toThrow("cancelled");
      session = await driver.connect(profile, config);
      expect((await query(`SELECT COUNT(*) AS n FROM ${table}`)).kind).toBe("table");
    });
    it.skipIf(id !== "clickhouse")(
      "verifies HTTPS certificates and fails closed without a trusted CA",
      async () => {
        const tlsConfig = {
          ...config,
          port: Number(process.env.DATSUMI_TEST_CLICKHOUSE_TLS_PORT),
          tls: "verify",
          ca: process.env.DATSUMI_TEST_CA,
        };
        const secured = await driver.connect(profile, tlsConfig);
        try {
          expect((await driver.execute(secured, { language: "sql", text: "SELECT 42" })).kind).toBe(
            "table",
          );
        } finally {
          await driver.disconnect(secured);
        }
        await expect(driver.connect(profile, { ...tlsConfig, ca: "" })).rejects.toThrow(
          /certificate|self.signed|verify/i,
        );
      },
    );
    it("redacts failed authentication credentials", async () => {
      await expect(
        driver.connect(profile, { ...config, password: "incorrect-private-password" }),
      ).rejects.not.toThrow("incorrect-private-password");
    });
    it.skipIf(id !== "oracle")(
      "preserves full timestamp precision in browsing, cell viewing and export",
      async () => {
        await query(
          `CREATE TABLE "DATSUMI"."times" ("id" NUMBER PRIMARY KEY,"moment" TIMESTAMP(9),"zoned" TIMESTAMP(9) WITH TIME ZONE,"local" TIMESTAMP(9) WITH LOCAL TIME ZONE,"day" DATE)`,
        );
        await query(
          `INSERT INTO "DATSUMI"."times" VALUES (1,TIMESTAMP '2026-01-01 12:34:56.123456789',TO_TIMESTAMP_TZ('2026-01-01 12:34:56.123456789+05:30','YYYY-MM-DD HH24:MI:SS.FF9TZH:TZM'),TO_TIMESTAMP_TZ('2026-01-01 12:34:56.123456789+05:30','YYYY-MM-DD HH24:MI:SS.FF9TZH:TZM'),DATE '2026-01-01')`,
        );
        await query("COMMIT");
        const info = (await driver.schema(session)).find((item) => item.name.endsWith(".times"))!;
        const page = await driver.browseTable(session, {
          resourceId: info.resourceId,
          offset: 0,
          limit: 10,
        });
        const expected = [
          "1",
          "2026-01-01T12:34:56.123456789",
          "2026-01-01T12:34:56.123456789+05:30",
          "2026-01-01T07:04:56.123456789+00:00",
          "2026-01-01T00:00:00",
        ];
        expect(page.result.rows[0]).toEqual(expected);
        expect(
          await driver.readCell(session, {
            resourceId: info.resourceId,
            key: { id: "1" },
            column: "moment",
          }),
        ).toBe(expected[1]);
        const directory = await mkdtemp(join(tmpdir(), "datsumi-oracle-time-"));
        try {
          const path = join(directory, "times.json");
          await driver.exportTable(session, {
            path,
            format: "json",
            request: { resourceId: info.resourceId, offset: 0, limit: 100 },
          });
          expect(Object.values(JSON.parse(await readFile(path, "utf8"))[0])).toEqual(expected);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
    it.skipIf(id !== "oracle")(
      "reports and rolls back uncommitted writes on disconnect",
      async () => {
        await query(`INSERT INTO ${table} VALUES (3,'pending',1,NULL)`);
        expect(await driver.transactionState(session)).toBe("open");
        await driver.disconnect(session);
        session = await driver.connect(profile, config);
        expect(await driver.transactionState(session)).toBe("idle");
        const result = await query(`SELECT * FROM ${table} WHERE "id"=3`);
        expect(result.kind === "table" && result.rows).toHaveLength(0);
      },
    );
  });
}
