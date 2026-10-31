import type { CellValue, QueryResult, RowChange, TableInfo } from "@datsumi/core";

import { sqlContext, tokenize } from "../sql/completion";
type Table = Extract<QueryResult, { kind: "table" }>;
export function editableResult(
  query: string,
  result: QueryResult,
  schema: readonly TableInfo[],
): { info?: TableInfo; reason: string } {
  if (result.kind !== "table") return { reason: "This result has no editable rows." };
  const words = tokenize(query)
    .filter((token) => token.kind === "word")
    .map((token) => token.value.toUpperCase());
  if (
    words[0] !== "SELECT" ||
    words.filter((word) => word === "SELECT").length !== 1 ||
    words.some((word) =>
      ["JOIN", "DISTINCT", "GROUP", "UNION", "EXCEPT", "INTERSECT"].includes(word),
    )
  )
    return {
      reason:
        "Editing requires a direct SELECT from one table. Joins, aggregates and computed results are read-only.",
    };
  const metadata = result.columnMetadata;
  const table = schema.find(
    (info) =>
      info.kind === "table" &&
      metadata?.every((column) => column.table === info.name && column.database === "main"),
  );
  const sources = sqlContext(query, query.length).tables;
  if (sources.length !== 1 || sources[0]?.toLowerCase() !== table?.name.toLowerCase())
    return { reason: "Editing requires a direct SELECT from one base table." };
  if (!table?.editable) return { reason: "Editing requires a writable table with a primary key." };
  if (
    !metadata ||
    metadata.length !== table.columns.length ||
    new Set(result.columns).size !== metadata.length ||
    metadata.some((column) => column.sourceColumn !== column.name) ||
    table.columns.some((column) => !result.columns.includes(column.name))
  )
    return {
      reason:
        "Include all original table columns without aliases to edit this result safely (SELECT *).",
    };
  return {
    info: table,
    reason: "Double-click a cell to stage an edit. Review and confirm before committing.",
  };
}
export function rowIdentity(info: TableInfo, row: Readonly<Record<string, CellValue>>): string {
  return JSON.stringify(
    info.columns.filter((column) => column.primaryKey > 0).map((column) => row[column.name]),
  );
}
export async function refreshedChanges(
  info: TableInfo,
  changes: readonly RowChange[],
  execute: (text: string, parameters: Record<string, unknown>) => Promise<QueryResult>,
): Promise<(readonly CellValue[] | undefined)[]> {
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const keys = info.columns.filter((column) => column.primaryKey > 0);
  return Promise.all(
    changes.map(async (change) => {
      const values = { ...change.original, ...change.values };
      const parameters = Object.fromEntries(
        keys.map((column, index) => [`key${index}`, values[column.name]]),
      );
      const result = await execute(
        `SELECT ${info.columns.map((column) => quote(column.name)).join(", ")} FROM ${quote(info.name)} WHERE ${keys.map((column, index) => `${quote(column.name)} IS $key${index}`).join(" AND ")} LIMIT 1`,
        parameters,
      );
      return result.kind === "table" ? result.rows[0] : undefined;
    }),
  );
}
export function updateSnapshot(
  table: Table,
  info: TableInfo,
  changes: readonly RowChange[],
  refreshed: readonly (readonly CellValue[] | undefined)[],
): Table {
  const lookup = new Map(
    changes.map((change, index) => [rowIdentity(info, change.original ?? {}), refreshed[index]]),
  );
  return {
    ...table,
    rows: table.rows.flatMap((row) => {
      const original = Object.fromEntries(
        table.columns.map((name, index) => [name, row[index] ?? null]),
      );
      const key = rowIdentity(info, original);
      if (!lookup.has(key)) return [row];
      const replacement = lookup.get(key);
      return replacement
        ? [
            table.columns.map(
              (name) =>
                replacement[info.columns.findIndex((column) => column.name === name)] ?? null,
            ),
          ]
        : [];
    }),
  };
}
