import { describe, it, expect } from "vitest";

import { statementAt } from "./statements";
describe("statement at cursor", () => {
  it("ignores semicolons in strings, identifiers and comments", () => {
    const first = `SELECT ';', "semi;colon" /* ; */;`,
      second = `\n-- ;\nSELECT 'it''s; fine';`;
    expect(statementAt(first + second, 4)).toBe(first);
    expect(statementAt(first + second, first.length + 10)).toBe(second.trim());
  });
  it("preserves an entire CREATE TRIGGER body including CASE END expressions", () => {
    const trigger = `CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET c=CASE WHEN 1 THEN 2 END; INSERT INTO b VALUES(1); END;`;
    expect(statementAt(trigger + " SELECT 2;", trigger.indexOf("UPDATE"))).toBe(trigger);
    expect(statementAt(trigger + " SELECT 2;", trigger.length + 4)).toBe("SELECT 2;");
  });
});

it("keeps PostgreSQL dollar-quoted bodies and SQL Server GO batches together", () => {
  const pg = "DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$; SELECT 3;";
  expect(statementAt(pg, 20, "postgres")).toBe("DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$;");
  const sql = "DECLARE @x INT = 1; SELECT @x;\nGO\nSELECT 2;";
  expect(statementAt(sql, 10, "mssql")).toBe("DECLARE @x INT = 1; SELECT @x;");
  expect(statementAt(sql, sql.length, "mssql")).toBe("SELECT 2;");
});

it("keeps DuckDB dollar-quoted values together", () => {
  const sql = "SELECT $$one;two$$ AS value; SELECT 2;";
  expect(statementAt(sql, 15, "duckdb")).toBe("SELECT $$one;two$$ AS value;");
});

it("keeps Oracle PL/SQL slash-delimited blocks and alternative quotes intact", () => {
  const block = "DECLARE v NUMBER := 1; BEGIN IF v=1 THEN v:=2; END IF; END;";
  const script = block + "\n/\nSELECT q'[it's; literal]' FROM dual;";
  expect(statementAt(script, 30, "oracle")).toBe(block);
  expect(statementAt(script, script.length, "oracle")).toBe("SELECT q'[it's; literal]' FROM dual;");
});
