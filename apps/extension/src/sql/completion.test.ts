import { describe, expect, it } from "vitest";

import {
  functionCall,
  quoteIdentifier,
  sqlContext,
  sqlSuggestions,
  type SqlTable,
} from "./completion";

const schema: SqlTable[] = [
  {
    name: "customers",
    kind: "table",
    columns: [
      { name: "id", detail: "INTEGER · PK" },
      { name: "name", detail: "TEXT" },
      { name: "email", detail: "TEXT" },
    ],
  },
  {
    name: "orders",
    kind: "table",
    columns: [{ name: "id" }, { name: "customer_id" }, { name: "total" }],
  },
  { name: 'order "notes"', kind: "table", columns: [{ name: "select" }, { name: "two words" }] },
  { name: "customer_summary", kind: "view", columns: [{ name: "id" }, { name: "total_spent" }] },
];
function suggestions(sql: string) {
  const offset = sql.indexOf("|");
  return sqlSuggestions(sqlContext(sql.replace("|", ""), offset), schema);
}

describe("SQLite completion context", () => {
  it("completes tables, views, qualified tables and comma joins", () => {
    expect(suggestions("SELECT * FROM cu|").map((item) => item.label)).toEqual([
      "customers",
      "customer_summary",
    ]);
    expect(suggestions("SELECT * FROM main.cu|").map((item) => item.label)).toEqual([
      "customers",
      "customer_summary",
    ]);
    expect(suggestions("SELECT * FROM customers c, ord|").map((item) => item.label)).toEqual([
      "orders",
      'order "notes"',
    ]);
    expect(suggestions("UPDATE cu| SET name='x'").map((item) => item.label)).toContain("customers");
  });
  it("resolves aliases declared after the caret and filters qualified columns", () => {
    expect(suggestions("SELECT c| FROM customers c")).toContainEqual(
      expect.objectContaining({ label: "c", insertText: "c.", kind: "alias" }),
    );
    expect(
      suggestions("SELECT c.na| FROM customers AS c JOIN orders o ON o.customer_id = c.id"),
    ).toMatchObject([{ label: "name", insertText: "name", kind: "column", detail: "c · TEXT" }]);
    expect(
      suggestions("SELECT o.| FROM customers c JOIN orders o ON o.customer_id=c.id").map(
        (item) => item.label,
      ),
    ).toEqual(["id", "customer_id", "total"]);
    expect(
      suggestions("SELECT id| FROM customers c JOIN orders o ON o.customer_id=c.id")
        .filter((item) => item.kind === "column")
        .map((item) => item.insertText),
    ).toEqual(["c.id", "o.id"]);
  });
  it("quotes unusual and reserved names and replaces complete quoted prefixes", () => {
    expect(suggestions('SELECT * FROM "ord|')).toContainEqual(
      expect.objectContaining({ label: 'order "notes"', insertText: '"order ""notes"""' }),
    );
    expect(suggestions('SELECT n.se| FROM "order ""notes""" AS n')).toMatchObject([
      { label: "select", insertText: '"select"' },
    ]);
    expect(suggestions('SELECT c."na|" FROM customers c')).toMatchObject([
      { label: "name", insertText: '"name"' },
    ]);
    expect(quoteIdentifier("two words")).toBe('"two words"');
    expect(quoteIdentifier("customers")).toBe("customers");
  });
  it("suppresses completion in strings/comments without mistaking quoted contents for syntax", () => {
    expect(suggestions("SELECT 'FROM cu|'")).toEqual([]);
    expect(suggestions("SELECT 1 -- FROM cu|\n")).toEqual([]);
    expect(suggestions("SELECT /* FROM cu| */ 1")).toEqual([]);
    expect(
      suggestions("SELECT 'ignore; -- FROM orders' FROM cu|").map((item) => item.label),
    ).toEqual(["customers", "customer_summary"]);
    expect(
      suggestions("SELECT 1; -- comment\nSELECT * FROM cu|").map((item) => item.label),
    ).toEqual(["customers", "customer_summary"]);
  });
  it("isolates statements and nested alias scopes", () => {
    expect(
      suggestions("SELECT o.| FROM orders o; SELECT o.name FROM customers o").map(
        (item) => item.label,
      ),
    ).toEqual(["id", "customer_id", "total"]);
    expect(
      suggestions("SELECT o.| FROM orders o WHERE EXISTS (SELECT 1 FROM customers o)").map(
        (item) => item.label,
      ),
    ).toEqual(["id", "customer_id", "total"]);
    expect(
      suggestions("SELECT 1 FROM customers c WHERE EXISTS (SELECT o.| FROM orders o)").map(
        (item) => item.label,
      ),
    ).toEqual(["id", "customer_id", "total"]);
  });
  it("infers common CTE and derived-table columns", () => {
    expect(
      suggestions(
        "WITH people AS (SELECT id, name AS display_name FROM customers) SELECT p.| FROM people p",
      ).map((item) => item.label),
    ).toEqual(["id", "display_name"]);
    expect(
      suggestions(
        "WITH people (customer, label) AS (SELECT id, name FROM customers) SELECT p.| FROM people p",
      ).map((item) => item.label),
    ).toEqual(["customer", "label"]);
    expect(
      suggestions("SELECT p.| FROM (SELECT c.* FROM customers c) p").map((item) => item.label),
    ).toEqual(["id", "name", "email"]);
    expect(
      suggestions("WITH people AS (SELECT * FROM customers) SELECT * FROM pe|").map(
        (item) => item.label,
      ),
    ).toEqual(["people"]);
  });
  it("offers vocabulary without a connection and tracks nested function arguments", () => {
    expect(sqlSuggestions(sqlContext("SEL", 3), []).map((item) => item.label)).toContain("SELECT");
    expect(
      suggestions("SELECT * FROM customers wh|").map((item) => [item.label, item.kind]),
    ).toContainEqual(["WHERE", "keyword"]);
    expect(suggestions("SELECT * FROM customers wh|").some((item) => item.kind === "alias")).toBe(
      false,
    );
    expect(
      suggestions("SELECT * FROM customers wh|").find((item) => item.label === "WHERE")?.priority,
    ).toBeLessThan(
      suggestions("SELECT * FROM customers wh|").find((item) => item.label === "WHEN")?.priority ??
        9,
    );
    expect(suggestions("se|").map((item) => item.label)).toContain("SELECT");
    expect(suggestions("SELECT COA|").map((item) => item.label)).toContain("COALESCE");
    const text = "SELECT COALESCE(NULLIF(name, 'a,b'), ";
    expect(functionCall(text, text.length)).toEqual({ name: "COALESCE", parameter: 1 });
    expect(functionCall("SELECT ROUND(value, ", 20)).toEqual({ name: "ROUND", parameter: 1 });
  });
});

it("distinguishes duplicate table names across schemas and inserts qualified identifiers", () => {
  const tables = [
    {
      name: "public.items",
      baseName: "items",
      schema: "public",
      insertText: '"public"."items"',
      kind: "table" as const,
      columns: [{ name: "public_value" }],
    },
    {
      name: "audit.items",
      baseName: "items",
      schema: "audit",
      insertText: '"audit"."items"',
      kind: "table" as const,
      columns: [{ name: "audit_value" }],
    },
  ];
  const source = "SELECT i. FROM audit.items i";
  expect(sqlSuggestions(sqlContext(source, 9), tables).map((item) => item.label)).toContain(
    "audit_value",
  );
  expect(
    sqlSuggestions(sqlContext("SELECT * FROM it", 16), tables).map((item) => item.insertText),
  ).toContain('"public"."items"');
  expect(
    sqlSuggestions(sqlContext("SELECT * FROM audit.it", 22), tables).map((item) => item.insertText),
  ).toEqual(["items"]);
});

it("uses engine-specific keywords and functions", () => {
  expect(
    sqlSuggestions(sqlContext("PR", 2), [], "postgres").map((item) => item.label),
  ).not.toContain("PRAGMA");
  expect(sqlSuggestions(sqlContext("TO", 2), [], "mssql").map((item) => item.label)).toContain(
    "TOP",
  );
  expect(sqlSuggestions(sqlContext("IL", 2), [], "postgres").map((item) => item.label)).toContain(
    "ILIKE",
  );
  expect(sqlSuggestions(sqlContext("IFN", 3), [], "mariadb").map((item) => item.label)).toContain(
    "IFNULL",
  );
});
