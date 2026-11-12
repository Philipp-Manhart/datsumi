import { spreadsheetText } from "@datsumi/core";
import type { CellValue, QueryResult } from "@datsumi/core";
import { parse } from "csv-parse/sync";
type Table = Extract<QueryResult, { kind: "table" }>;
export function serializeResult(result: Table, format: "csv" | "json", safe = false): string {
  if (format === "json")
    return (
      JSON.stringify(
        { columns: result.columns, rows: result.rows, truncated: result.truncated ?? false },
        null,
        2,
      ) + "\n"
    );
  const csv = (value: CellValue) =>
    '"' +
    (value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : typeof value === "string"
          ? spreadsheetText(value, safe)
          : String(value)
    ).replaceAll('"', '""') +
    '"';
  return (
    [result.columns.map(csv).join(","), ...result.rows.map((row) => row.map(csv).join(","))].join(
      "\r\n",
    ) + "\r\n"
  );
}
export function parseCsv(text: string): string[][] {
  const rows: unknown = parse(text, {
    bom: true,
    skip_empty_lines: true,
    max_record_size: 1024 * 1024,
  });
  if (
    !Array.isArray(rows) ||
    !rows.every((row) => Array.isArray(row) && row.every((value) => typeof value === "string"))
  )
    throw new Error("Invalid CSV data.");
  return rows;
}
