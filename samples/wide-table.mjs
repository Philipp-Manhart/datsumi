/** Shared deterministic fixture for testing wide grids in both local SQL engines. */
export const wideTableRows = 500;
export const wideTableColumns = 80;
const names = ["Alex Morgan", "Amélie Dubois", "José García", "李明", "Nora 🌱"];
const groups = (prefix, count, type, value) =>
  Array.from({ length: count }, (_, n) => ({
    name: `${prefix}_${String(n + 1).padStart(2, "0")}`,
    type,
    value: (id) => (id % 11 === 0 && n % 3 === 0 ? null : value(id, n + 1)),
  }));
const date = (id, offset = 0) =>
  new Date(Date.UTC(2026, 0, 1 + ((id + offset) % 365))).toISOString().slice(0, 10);
const literal = (value) => {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replaceAll("'", "''")}'`;
};
export function wideTableSql(driver) {
  if (driver !== "sqlite" && driver !== "duckdb") throw new Error("Choose SQLite or DuckDB.");
  const text = driver === "sqlite" ? "TEXT" : "VARCHAR";
  const columns = [
    { name: "id", type: "INTEGER PRIMARY KEY", value: (id) => id },
    { name: "customer_id", type: "INTEGER", value: (id) => ((id - 1) % 375) + 1 },
    { name: "display_name", type: text, value: (id) => names[(id - 1) % names.length] },
    { name: "email", type: text, value: (id) => (id % 13 === 0 ? null : `wide${id}@example.com`) },
    { name: "status", type: text, value: (id) => ["active", "pending", "archived"][id % 3] },
    { name: "region", type: text, value: (id) => ["Europe", "Asia", "Americas"][id % 3] },
    { name: "created_at", type: driver === "sqlite" ? "TEXT" : "DATE", value: date },
    {
      name: "balance",
      type: driver === "sqlite" ? "REAL" : "DECIMAL(12,2)",
      value: (id) => (((id * 137) % 100000) - 50000) / 100,
    },
    {
      name: "is_active",
      type: driver === "sqlite" ? "INTEGER" : "BOOLEAN",
      value: (id) => id % 4 !== 0,
    },
    {
      name: "notes",
      type: text,
      value: (id) =>
        id % 9 === 0
          ? null
          : id % 7 === 0
            ? ""
            : `Wide row ${id}: quotes 'like this', Unicode 🌱, and columns all the way to segment_10.`,
    },
    ...groups(
      "metric",
      20,
      driver === "sqlite" ? "REAL" : "DECIMAL(12,2)",
      (id, n) => ((id * n * 37) % 100000) / 100,
    ),
    ...groups("detail", 20, text, (id, n) =>
      id % 17 === 0 && n === 1
        ? "Line one\nLine two\tTabbed value"
        : `Row ${id} · field ${n} · ${names[(id + n) % names.length]}`,
    ),
    ...groups(
      "enabled",
      10,
      driver === "sqlite" ? "INTEGER" : "BOOLEAN",
      (id, n) => (id + n) % 2 === 0,
    ),
    ...groups("event_date", 10, driver === "sqlite" ? "TEXT" : "DATE", date),
    ...groups("segment", 10, text, (id, n) => ["free", "pro", "team", "enterprise"][(id + n) % 4]),
  ];
  if (columns.length !== wideTableColumns) throw new Error("Invalid wide table fixture.");
  const table = driver === "sqlite" ? '"wide_table"' : '"demo"."wide_table"';
  const rows = Array.from(
    { length: wideTableRows },
    (_, n) => `(${columns.map((column) => literal(column.value(n + 1))).join(",")})`,
  );
  return `CREATE TABLE ${table} (${columns.map((column) => `"${column.name}" ${column.type}`).join(",")});\nINSERT INTO ${table} VALUES ${rows.join(",\n")};`;
}
