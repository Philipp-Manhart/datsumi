import type { CellValue, QueryResult } from "@datsumi/core";
type Table = Extract<QueryResult, { kind: "table" }>;
export function compareResults(left: Table, right: Table, keys: readonly string[]) {
  if (!keys.length) throw new Error("Choose matching key columns.");
  const map = (table: Table) => {
    const indexes = keys.map((key) => {
      const i = table.columns.indexOf(key);
      if (i < 0 || table.columns.lastIndexOf(key) !== i)
        throw new Error("Key columns must exist and be unambiguous.");
      return i;
    });
    const rows = new Map<string, readonly CellValue[]>();
    for (const row of table.rows) {
      const key = JSON.stringify(indexes.map((i) => row[i]));
      if (rows.has(key))
        throw new Error("Matching keys are not unique. Choose additional columns.");
      rows.set(key, row);
    }
    return rows;
  };
  const a = map(left),
    b = map(right),
    order = [...new Set([...a.keys(), ...b.keys()])].sort();
  // Arrays preserve duplicate result-column names; absent rows are explicit.
  const render = (table: Table, rows: Map<string, readonly CellValue[]>) => ({
    columns: table.columns,
    rows: order.map((key) => ({
      key: JSON.parse(key),
      present: rows.has(key),
      values: rows.get(key) ?? null,
    })),
  });
  return {
    left: render(left, a),
    right: render(right, b),
    truncated: Boolean(
      left.truncated ||
      right.truncated ||
      [left, right].some((table) =>
        table.rows.some((row) =>
          row.some(
            (value) =>
              value &&
              typeof value === "object" &&
              (value.type === "text" ||
                (value.type === "blob" && value.hex.length < value.bytes * 2)),
          ),
        ),
      ),
    ),
  };
}
