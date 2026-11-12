import type { CellValue } from "./index";

/** Clipboard values contain data only, never display labels or shortened previews. */
export function clipboardValue(value: CellValue): string {
  if (value === null) return "";
  if (typeof value !== "object") return String(value);
  if (value.type === "blob") {
    if (value.hex.length !== value.bytes * 2)
      throw new Error(
        "The selection contains a shortened binary value. Copy the full value instead.",
      );
    return value.hex;
  }
  if (value.type === "text" && value.value.length !== value.length)
    throw new Error("The selection contains shortened text. Copy the full value instead.");
  return value.value;
}

/** Excel-compatible tab-separated text. Embedded delimiters use doubled-quote escaping. */
export function clipboardTsv(
  columns: readonly string[],
  rows: readonly (readonly CellValue[])[],
  headers = false,
): string {
  const escape = (value: string) =>
    /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [
    ...(headers ? [columns.map(escape).join("\t")] : []),
    ...rows.map((row) => row.map((value) => escape(clipboardValue(value))).join("\t")),
  ].join("\r\n");
}

/** CSV-only opt-in. Exact clipboard transfer never calls this transformation. */
export function spreadsheetText(value: string, safe: boolean): string {
  return safe && /^\s*[=+\-@]/u.test(value) ? "'" + value : value;
}
