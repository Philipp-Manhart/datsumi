import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { formatSql } from "./format";

describe("SQLite formatting", () => {
  it("formats SQLite statements using the editor indentation options", () => {
    const output = formatSql("select id,name from customers where id=1;", {
      tabSize: 2,
      insertSpaces: true,
    });
    expect(output).toContain("SELECT\n  id,");
    expect(output).toContain("FROM\n  customers");
    expect(output).toContain("id = 1");
    expect(
      formatSql("select id,name from customers;", { tabSize: 4, insertSpaces: false }),
    ).toContain("\n\tid,");
  });
  it("preserves quoted names, literal values, comments and query results", () => {
    const db = new DatabaseSync(":memory:");
    const source = `-- Keep this comment\nselect 'don''t; SELECT' as "two words", 1+2 as result;`;
    try {
      const output = formatSql(source, { tabSize: 2, insertSpaces: true });
      expect(output).toContain("-- Keep this comment");
      expect(db.prepare(output).all()).toEqual(db.prepare(source).all());
    } finally {
      db.close();
    }
  });
  it("preserves CRLF, trailing newlines and whitespace-only selections", () => {
    const output = formatSql("select 1;\r\n", { tabSize: 2, insertSpaces: true }, "\r\n");
    expect(output.endsWith("\r\n")).toBe(true);
    expect(output.replaceAll("\r\n", "")).not.toContain("\n");
    expect(formatSql("  \n", { tabSize: 2, insertSpaces: true })).toBe("  \n");
  });
});

it("formats each server dialect without applying SQLite syntax rules", () => {
  for (const [driver, text] of [
    ["duckdb", "select * exclude(id) from items qualify row_number() over ()=1;"],
    ["postgres", "select payload::jsonb from public.items limit 10;"],
    ["mysql", "select `name` from `items` limit 10;"],
    ["mariadb", "select `name` from `items` limit 10;"],
    ["mssql", "select top (10) [name] from [dbo].[items];"],
    ["libsql", "select * from items limit 10;"],
    ["turso", "select * from items limit 10;"],
  ]) {
    const formatted = formatSql(text!, { tabSize: 2, insertSpaces: true }, "\n", driver);
    expect(formatted).toContain("SELECT");
  }
});

it("formats Oracle and ClickHouse using their dialects", () => {
  expect(
    formatSql(
      "select nvl(name, 'unknown') from customers fetch first 10 rows only",
      { tabSize: 2, insertSpaces: true },
      "\n",
      "oracle",
    ),
  ).toContain("FETCH FIRST");
  expect(
    formatSql(
      "select count() from events prewhere active = 1 limit 10",
      { tabSize: 2, insertSpaces: true },
      "\n",
      "clickhouse",
    ),
  ).toContain("PREWHERE");
});

it("honors SQL keyword casing preferences without changing string literals", () => {
  const formatted = formatSql(
    "SELECT 'UPPER' AS label FROM customers",
    { tabSize: 2, insertSpaces: true },
    "\n",
    "sqlite",
    { keywordCase: "lower" },
  );
  expect(formatted).toContain("select");
  expect(formatted).toContain("'UPPER'");
});
