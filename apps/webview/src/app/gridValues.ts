import { formatJson } from "@datsumi/core";
import type { CellValue, WebviewResponse } from "@datsumi/protocol";
type Table = Extract<NonNullable<WebviewResponse["result"]>, { kind: "table" }>;
export function cellText(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value !== "object") return String(value);
  if (value.type === "blob")
    return `BLOB · ${value.bytes} bytes · hex ${value.hex}${value.hex.length < value.bytes * 2 ? "… (preview)" : ""}`;
  if (value.type === "text") return `${value.value}… (preview of ${value.length} characters)`;
  return value.value;
}
export const objectRow = (table: Table, row: readonly CellValue[]) =>
  Object.fromEntries(table.columns.map((name, i) => [name, row[i] ?? null]));
export function isJson(value: CellValue): boolean {
  if (typeof value !== "string") return false;
  try {
    formatJson(value);
    return true;
  } catch {
    return false;
  }
}
export function pretty(value: CellValue): string {
  if (typeof value === "string") {
    try {
      return formatJson(value);
    } catch {
      return value;
    }
  }
  return cellText(value);
}
