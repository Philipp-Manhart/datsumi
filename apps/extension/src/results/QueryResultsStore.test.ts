import type { QueryResult } from "@datsumi/core";
import { webviewResponseSchema } from "@datsumi/protocol";
import { describe, expect, it } from "vitest";

import { QueryResultsStore } from "./QueryResultsStore";

function table(count: number): QueryResult {
  return {
    kind: "table",
    columns: ["id", "name"],
    rows: Array.from({ length: count }, (_, i) => [i + 1, `Row ${i + 1}`]),
  };
}

describe("retained query results", () => {
  it("reuses only the active unpinned result for the same connection and ignores stale tab messages", () => {
    const store = new QueryResultsStore();
    const first = store.begin("db", "one.sqlite", "SELECT 1", true);
    store.complete(first, table(2));
    store.rename(first, "Daily report");
    const reused = store.begin("db", "one.sqlite", "SELECT 2", true);
    expect(reused).not.toBe(first);
    expect(store.state().tabs).toHaveLength(1);
    expect(store.state().title).toBe("Daily report");
    store.close(first);
    store.pin(first, true);
    store.complete(first, table(50));
    expect(store.state().activeResultId).toBe(reused);
    store.complete(reused, table(3));
    store.pin(reused, true);
    const next = store.begin("db", "one.sqlite", "SELECT 3", true);
    expect(store.state().tabs).toHaveLength(2);
    expect(store.state().tabs?.[0]).toMatchObject({ pinned: true, id: reused });
    store.complete(next, table(1));
    const other = store.begin("other", "other.sqlite", "SELECT 4", true);
    expect(store.state().tabs).toHaveLength(3);
    store.complete(other, table(1));
    const explicit = store.begin("other", "other.sqlite", "SELECT 5");
    expect(store.state().tabs).toHaveLength(4);
    store.complete(explicit, table(1));
    store.select(reused);
    store.pin(reused, false);
    store.begin("db", "one.sqlite", "SELECT 6", true);
    expect(store.state().tabs).toHaveLength(4);
  });
  it("never reuses a busy result or a result with staged changes", () => {
    const store = new QueryResultsStore();
    const one = store.begin("db", "one.sqlite", "SELECT 1", true);
    const two = store.begin("db", "one.sqlite", "SELECT 2", true);
    expect(store.state().tabs).toHaveLength(2);
    store.complete(one, table(1));
    store.complete(two, table(1));
    store.stage(two, [
      { kind: "update", original: { id: 1, name: "Row 1" }, values: { name: "draft" } },
    ]);
    store.begin("db", "one.sqlite", "SELECT 3", true);
    expect(store.state().tabs).toHaveLength(3);
  });

  it("copies all 12001 rows across pages, with exact column names and no metadata", () => {
    const store = new QueryResultsStore();
    const id = store.begin("db", "analytics.duckdb", "SELECT id, name FROM data");
    store.complete(id, table(12001));
    store.sort(id, { column: 0, direction: "desc" });
    store.page(id, 100, 100);
    const data = store.copy(id, [1, 0], false, "tsv").split("\r\n");
    expect(data).toHaveLength(12001);
    expect(data[0]).toBe("Row 12001\t12001");
    expect(data.at(-1)).toBe("Row 1\t1");
    const headers = store.copy(id, [1, 0], true, "tsv").split("\r\n");
    expect(headers[0]).toBe("name\tid");
    expect(headers).toHaveLength(12002);
    expect(headers.slice(1)).toEqual(data);
    expect(() => store.copy(id, [2], false, "tsv")).toThrow("Invalid");
    store.complete(id, { kind: "table", columns: ["id"], rows: [[1]], truncated: true });
    expect(() => store.copy(id, [0], false, "tsv")).toThrow("Nothing was copied");
    store.close(id);
    expect(() => store.copy(id, [0], false, "tsv")).toThrow("unavailable");
  });

  it("preserves separate tabs and independent sort/page state over more than 500 rows", () => {
    const store = new QueryResultsStore();
    const first = store.begin("one", "first.sqlite", "SELECT * FROM customers");
    store.complete(first, table(1200));
    store.sort(first, { column: 0, direction: "desc" });
    store.page(first, 100, 100);
    expect(store.state()).toMatchObject({
      result: { rows: expect.arrayContaining([[1100, "Row 1100"]]) },
      page: { offset: 100, totalRows: 1200, hasMore: true },
    });
    const second = store.begin("two", "second.sqlite", "SELECT 1");
    store.complete(second, table(1));
    expect(store.state().tabs).toHaveLength(2);
    store.select(first);
    expect(store.state()).toMatchObject({
      activeResultId: first,
      sort: { column: 0, direction: "desc" },
      page: { offset: 100, limit: 100, totalRows: 1200 },
    });
    store.page(first, 1100, 100);
    expect(store.state()).toMatchObject({
      result: { rows: expect.arrayContaining([[1, "Row 1"]]) },
      page: { hasMore: false },
    });
    expect(webviewResponseSchema.safeParse(store.state()).success).toBe(true);
  });
  it("sorts exact integers, NULLs, numbers and text, and restores original order", () => {
    const store = new QueryResultsStore();
    const id = store.begin("one", "one.sqlite", "SELECT id, id FROM example");
    const rows = [
      [{ type: "integer" as const, value: "9007199254740993" }, "a"],
      [10, "b"],
      [2, "c"],
      [null, "d"],
      [{ type: "integer" as const, value: "9007199254740992" }, "e"],
      [2, "f"],
    ];
    store.complete(id, { kind: "table", columns: ["id", "id"], rows });
    store.sort(id, { column: 0, direction: "asc" });
    expect(store.state().result).toMatchObject({
      rows: [rows[3], rows[2], rows[5], rows[1], rows[4], rows[0]],
    });
    store.sort(id, { column: 1, direction: "desc" });
    expect(store.state().result).toMatchObject({
      rows: [rows[5], rows[4], rows[3], rows[2], rows[1], rows[0]],
    });
    store.sort(id, null);
    expect(store.state().result).toMatchObject({ rows });
  });
  it("does not change the selected tab when a background result finishes", () => {
    const store = new QueryResultsStore();
    const one = store.begin("one", "one.sqlite", "SELECT 1");
    store.complete(one, table(1));
    const two = store.begin("one", "one.sqlite", "SELECT 2");
    store.select(one);
    store.complete(two, table(2));
    expect(store.state().activeResultId).toBe(one);
    store.close(two);
    store.complete(two, table(3));
    expect(store.state().tabs).toHaveLength(1);
  });
  it("preserves failures and write results and removes only the disconnected connection", () => {
    const store = new QueryResultsStore();
    const first = store.begin("one", "one.sqlite", "UPDATE t SET x=1");
    store.complete(first, { kind: "value", value: { changes: 1 } });
    const second = store.begin("two", "two.sqlite", "invalid SQL");
    store.fail(second, "Syntax error");
    store.select(first);
    store.page(first, 100, 25);
    store.sort(first, { column: 0, direction: "asc" });
    expect(store.state()).toMatchObject({
      result: { kind: "value", value: { changes: 1 } },
      page: null,
    });
    store.clearConnection("one");
    expect(store.state()).toMatchObject({
      activeResultId: second,
      error: "Syntax error",
      busy: false,
    });
    store.close(second);
    expect(store.state()).toMatchObject({ activeResultId: null, tabs: [], result: null });
  });
  it("clamps page bounds and ignores invalid or stale requests", () => {
    const store = new QueryResultsStore();
    const id = store.begin("one", "one.sqlite", "SELECT * FROM t");
    store.complete(id, table(237));
    store.page(id, 10000, 100);
    expect(store.state().page).toMatchObject({ offset: 200, limit: 100, hasMore: false });
    store.page(id, -1, 25);
    store.page(id, 0, 10000);
    store.sort(id, { column: 99, direction: "asc" });
    store.select("missing");
    store.close("missing");
    expect(store.state()).toMatchObject({
      activeResultId: id,
      sort: null,
      page: { offset: 200, limit: 100 },
    });
    store.page(id, 0, 25);
    expect(store.state().result).toMatchObject({ rows: expect.any(Array) });
    expect(store.state().page).toMatchObject({ offset: 0, limit: 25, totalRows: 237 });
  });
  it("bounds retained results without silently discarding existing tabs", () => {
    const store = new QueryResultsStore();
    for (let i = 0; i < 10; i++) {
      const id = store.begin("one", "one.sqlite", "SELECT 1");
      store.complete(id, table(1));
    }
    expect(() => store.begin("one", "one.sqlite", "SELECT 2")).toThrow("Close a result tab");
    expect(store.state().tabs).toHaveLength(10);
    store.close("result-1");
    expect(store.begin("one", "one.sqlite", "SELECT 2")).toBe("result-11");
  });
});

describe("result tab names", () => {
  it("renames a tab without changing captured data, paging, sorting, or other tabs", () => {
    const store = new QueryResultsStore();
    const first = store.begin("one", "one.db", "SELECT * FROM customers");
    store.complete(first, table(200));
    store.sort(first, { column: 0, direction: "desc" });
    store.page(first, 100, 100);
    const second = store.begin("one", "one.db", "SELECT 1");
    store.complete(second, table(1));
    expect(store.rename(first, "  Customer overview  ")).toBe(true);
    store.select(first);
    expect(store.state()).toMatchObject({
      title: "Customer overview",
      sort: { column: 0, direction: "desc" },
      page: { offset: 100 },
      tabs: [{ title: "Customer overview" }, { title: "Query 2" }],
    });
    expect(store.rename(first, "   ")).toBe(false);
    expect(store.rename(first, "x".repeat(81))).toBe(false);
    expect(store.rename(first, "a\nb")).toBe(false);
    expect(store.rename("missing", "test")).toBe(false);
    expect(store.state().title).toBe("Customer overview");
  });
});
