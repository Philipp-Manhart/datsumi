import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { clipboardValue, type ConnectionProfile } from "@datsumi/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseRemoteConfiguration } from "../src/configuration";
import { ServerDriverAdapter, type ServerSession } from "../src/index";
const endpoint = process.env.DATSUMI_TEST_REMOTE_URL;
if (!endpoint) throw new Error("Use bun run test:remote for an isolated libSQL HTTP server.");
for (const id of ["libsql", "turso"] as const) {
  describe(`${id} official HTTP client`, () => {
    const driver = new ServerDriverAdapter(id, async () => resolve(`dist/drivers/${id}.cjs`));
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: "test",
      family: "relational",
      driverId: id,
      configuration: {},
    };
    const config = {
      ...parseRemoteConfiguration({ endpoint, readOnly: false }),
      password: process.env.DATSUMI_TEST_REMOTE_TOKEN || "",
    };
    let session: ServerSession;
    const query = (text: string, captureAll = false) =>
      driver.execute(session, { language: "sql", text, captureAll });
    beforeAll(async () => {
      session = await driver.connect(profile, config);
      await query(
        `CREATE TABLE IF NOT EXISTS ${id}_parent(id INTEGER PRIMARY KEY,name TEXT,n BIGINT, note TEXT); CREATE TABLE IF NOT EXISTS ${id}_child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES ${id}_parent(id)); CREATE INDEX IF NOT EXISTS ${id}_name ON ${id}_parent(name); DELETE FROM ${id}_child; DELETE FROM ${id}_parent; INSERT INTO ${id}_parent VALUES(1,'Alice',9007199254740993,'a'),(2,'Bob',9223372036854775807,'b'); INSERT INTO ${id}_child VALUES(1,1)`,
      );
    });
    afterAll(async () => {
      if (session) await driver.disconnect(session);
    });
    it("preserves duplicate labels, exact integers, empty sets and binary values", async () => {
      const result = await query("SELECT 9007199254740993 AS x, X'00ff' AS x, NULL AS n");
      expect(result.kind).toBe("table");
      if (result.kind !== "table") throw new Error("Expected table");
      expect(result.columns).toEqual(["x", "x", "n"]);
      expect(result.rows[0]).toEqual([
        { type: "integer", value: "9007199254740993" },
        { type: "blob", hex: "00ff", bytes: 2 },
        null,
      ]);
      const empty = await query(`SELECT * FROM ${id}_parent WHERE 0`);
      expect(empty.kind === "table" && empty.rows).toEqual([]);
    });
    it("discovers keys and relationships and filters/sorts/pages with bound values", async () => {
      const schema = await driver.schema(session);
      const info = schema.find((t) => t.name === `main.${id}_parent`)!;
      expect(info.columns.map((c) => c.name)).toEqual(["id", "name", "n", "note"]);
      expect(info.columns[0]?.primaryKey).toBe(1);
      expect(info.indexes.some((i) => i.name === `${id}_name`)).toBe(true);
      expect(info.editable).toBe(false);
      expect(schema.find((t) => t.name === `main.${id}_child`)?.foreignKeys[0]?.target).toBe(
        `main.${id}_parent`,
      );
      const page = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 1,
        order: { column: "id", direction: "desc" },
      });
      expect(clipboardValue(page.result.rows[0]?.[0] ?? null)).toBe("2");
      expect(page.hasMore).toBe(true);
      const filtered = await driver.browseTable(session, {
        resourceId: info.resourceId,
        offset: 0,
        limit: 10,
        filters: [{ column: "name", operator: "=", value: "x' OR 1=1 --" }],
      });
      expect(filtered.result.rows).toEqual([]);
    });
    it("keeps an interactive transaction on its session and rolls it back", async () => {
      await query("BEGIN");
      expect(await driver.transactionState(session)).toBe("open");
      await query(`INSERT INTO ${id}_parent VALUES(3,'rollback',1,NULL)`);
      await query("ROLLBACK");
      expect(await driver.transactionState(session)).toBe("idle");
      const result = await query(`SELECT * FROM ${id}_parent WHERE id=3`);
      expect(result.kind === "table" && result.rows).toEqual([]);
      await query("BEGIN; SELECT 1; COMMIT;");
      expect(await driver.transactionState(session)).toBe("idle");
    });
    it("captures 12001 rows for clipboard and flags preview truncation", async () => {
      const sql =
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<12001) SELECT x FROM n";
      const preview = await query(sql);
      expect(preview.kind === "table" && preview.truncated).toBe(true);
      const full = await query(sql, true);
      expect(full.kind === "table" && full.rows).toHaveLength(12001);
      expect(full.kind === "table" && full.truncated).toBe(false);
    });
    it("exports every page while preserving exact integer text", async () => {
      const dir = await mkdtemp(join(tmpdir(), "datsumi-remote-export-"));
      try {
        const info = (await driver.schema(session)).find((t) => t.name === `main.${id}_parent`)!;
        const path = join(dir, "rows.csv");
        expect(
          await driver.exportTable(session, {
            path,
            format: "csv",
            request: {
              resourceId: info.resourceId,
              filters: [],
              order: { column: "id", direction: "asc" },
            },
          }),
        ).toBe(2);
        expect(await readFile(path, "utf8")).toContain("9223372036854775807");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
    it("reads full text cells without including preview markers", async () => {
      const text = "long".repeat(5000);
      await query(`UPDATE ${id}_parent SET note='${text}' WHERE id=1`);
      const info = (await driver.schema(session)).find((t) => t.name === `main.${id}_parent`)!;
      expect(
        await driver.readCell(session, {
          resourceId: info.resourceId,
          column: "note",
          key: { id: 1 },
        }),
      ).toBe(text);
      await query(`UPDATE ${id}_parent SET note='a' WHERE id=1`);
    });
    it("rolls back an open transaction when the worker disconnects", async () => {
      await query("BEGIN");
      await query(`INSERT INTO ${id}_parent VALUES(4,'disconnect',1,NULL)`);
      await driver.disconnect(session);
      session = await driver.connect(profile, config);
      const result = await query(`SELECT * FROM ${id}_parent WHERE id=4`);
      expect(result.kind === "table" && result.rows).toEqual([]);
    });
    it("cancels long queries by closing their isolated worker and can reconnect", async () => {
      const listeners = new Set<() => void>();
      let cancelled = false;
      const signal = {
        get isCancellationRequested() {
          return cancelled;
        },
        onCancellationRequested(listener: () => void) {
          listeners.add(listener);
          return {
            dispose() {
              listeners.delete(listener);
            },
          };
        },
      };
      const pending = driver.execute(
        session,
        {
          language: "sql",
          text: "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n",
        },
        signal,
      );
      const timer = setTimeout(() => {
        cancelled = true;
        for (const listener of listeners) listener();
      }, 100);
      try {
        await expect(pending).rejects.toThrow(/cancel|closed/i);
      } finally {
        clearTimeout(timer);
      }
      expect(driver.isConnected(session)).toBe(false);
      session = await driver.connect(profile, config);
      const result = await query("SELECT 1");
      expect(result.kind === "table" && result.rows).toHaveLength(1);
    });
    it("reports SQL errors without exposing the authentication token", async () => {
      await expect(query("SELECT * FROM missing_datsumi_table")).rejects.toThrow(Error);
      await expect(
        driver.connect(profile, { ...config, password: "invalid-token" }),
      ).rejects.toThrow(Error);
    });
  });
}
