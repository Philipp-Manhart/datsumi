import type {
  CellValue,
  QueryResult,
  RowChange,
  TableInfo,
  TablePage,
  TablePageRequest,
} from "@datsumi/core";

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
  const tokens = tokenize(query).filter((token) => token.kind !== "comment");
  if (
    tokens.some(
      (token, index) =>
        token.kind === "symbol" && token.value === ";" && index !== tokens.length - 1,
    )
  )
    return { reason: "Run one SELECT statement to edit its captured rows." };
  const last = tokens.at(-1);
  const sources = sqlContext(query, last?.value === ";" ? last.start : query.length).tables;
  // Drivers without column-origin metadata may edit only an unambiguous SELECT *.
  // Never infer origins from output labels: computed expressions can reuse real names.
  const star =
    tokens[1]?.kind === "symbol" &&
    tokens[1].value === "*" &&
    tokens[2]?.kind === "word" &&
    tokens[2].value.toUpperCase() === "FROM";
  let afterSource = 3;
  while (tokens[afterSource]?.kind === "word" || tokens[afterSource]?.kind === "identifier") {
    afterSource++;
    if (tokens[afterSource]?.value !== ".") break;
    afterSource++;
  }
  const directSource =
    ["word", "identifier"].includes(tokens[3]?.kind ?? "") && tokens[afterSource]?.value !== "(";
  const qualifiedSource =
    tokens[4]?.value === "." && ["word", "identifier"].includes(tokens[5]?.kind ?? "");
  const serverTables = schema.filter(
    (info) =>
      info.driverId &&
      info.driverId !== "sqlite" &&
      (info.name === sources[0] || info.name.split(".").at(-1) === sources[0]),
  );
  if (serverTables.length && !qualifiedSource)
    return {
      reason:
        "Use a schema-qualified SELECT * (for example SELECT * FROM main.customers) or open the table tab. Unqualified results cannot prove their edit target.",
    };
  if (
    star &&
    directSource &&
    qualifiedSource &&
    sources.length === 1 &&
    serverTables.length === 1
  ) {
    const info = serverTables[0]!;
    if (
      info.editable &&
      info.kind === "table" &&
      result.columns.length === info.columns.length &&
      new Set(result.columns).size === result.columns.length &&
      info.columns.every((column) => result.columns.includes(column.name))
    )
      return {
        info,
        reason: "Double-click a cell to stage an edit. Review and confirm before committing.",
      };
  }
  const table = schema.find(
    (info) =>
      info.kind === "table" &&
      metadata?.every((column) => column.table === info.name && column.database === "main"),
  );
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
  browse?: (request: TablePageRequest) => Promise<TablePage>,
): Promise<(readonly CellValue[] | undefined)[]> {
  if (info.driverId && info.driverId !== "sqlite") {
    if (!browse) throw new Error("A table reader is required to refresh this database.");
    return Promise.all(
      changes.map(async (change) => {
        const values = { ...change.original, ...change.values };
        const page = await browse({
          resourceId: info.resourceId,
          offset: 0,
          limit: 2,
          filters: info.columns
            .filter((column) => column.primaryKey > 0)
            .map((column) => ({ column: column.name, operator: "=", value: values[column.name]! })),
        });
        if (page.hasMore || page.result.truncated || page.result.rows.length > 1)
          throw new Error("Updated row could not be uniquely refreshed.");
        const row = page.result.rows[0];
        return row
          ? info.columns.map((column) => row[page.result.columns.indexOf(column.name)] ?? null)
          : undefined;
      }),
    );
  }
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
