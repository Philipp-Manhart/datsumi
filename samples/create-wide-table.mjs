import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { wideTableSql, wideTableRows, wideTableColumns } from "./wide-table.mjs";

const sqliteOnly = process.argv.includes("--sqlite");
const duckdbOnly = process.argv.includes("--duckdb");
if (sqliteOnly && duckdbOnly)
  throw new Error("Choose one engine, or omit both flags to update both.");
if (!duckdbOnly) {
  const path = fileURLToPath(new URL("./playground.sqlite", import.meta.url));
  if (!existsSync(path))
    console.log("SQLite sample not found. Run bun run sample:db to create it.");
  else {
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout=3000; BEGIN IMMEDIATE;");
      const exists = db
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='wide_table' AND type IN ('table','view')")
        .get();
      if (!exists) db.exec(wideTableSql("sqlite"));
      db.exec("COMMIT;");
      const columns = db.prepare("PRAGMA table_info(wide_table)").all().length;
      const rows = Number(db.prepare("SELECT COUNT(*) AS n FROM wide_table").get().n);
      if (!exists && (columns !== wideTableColumns || rows !== wideTableRows))
        throw new Error("SQLite wide table validation failed.");
      console.log(
        `${exists ? "Kept existing" : "Created"} wide_table: ${columns} columns, ${rows} rows in ${path}`,
      );
    } finally {
      db.close();
    }
  }
}
if (!sqliteOnly) {
  const path = fileURLToPath(new URL("./playground.duckdb", import.meta.url));
  if (!existsSync(path))
    console.log("DuckDB sample not found. Run bun run sample:duckdb to create it.");
  else {
    const require = createRequire(
      new URL("../packages/drivers/duckdb/package.json", import.meta.url),
    );
    const { DuckDBInstance } = require("@duckdb/node-api");
    const instance = await DuckDBInstance.create(path);
    const connection = await instance.connect();
    const run = async (sql) => {
      const result = await connection.run(sql);
      result.closeSync();
    };
    try {
      await run("BEGIN;");
      const check = await connection.runAndReadAll(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='demo' AND table_name='wide_table'",
      );
      const exists = Number(check.getRowsJson()[0][0]) > 0;
      check.closeSync();
      if (!exists) await run(`CREATE SCHEMA IF NOT EXISTS demo; ${wideTableSql("duckdb")}`);
      await run("COMMIT; CHECKPOINT;");
      const checkRows = await connection.runAndReadAll(
        "SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='demo' AND table_name='wide_table'), COUNT(*) FROM demo.wide_table",
      );
      const [[columns, rows]] = checkRows.getRowsJson().map((row) => row.map(Number));
      checkRows.closeSync();
      if (!exists && (columns !== wideTableColumns || rows !== wideTableRows))
        throw new Error("DuckDB wide table validation failed.");
      console.log(
        `${exists ? "Kept existing" : "Created"} demo.wide_table: ${columns} columns, ${rows} rows in ${path}`,
      );
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  }
}
