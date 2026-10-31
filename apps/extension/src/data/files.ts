import { stat, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

import type { QueryResult, RowChange, TableInfo } from "@datsumi/core";
import * as vscode from "vscode";

import { parseCsv, serializeResult } from "./serialization";

type Table = Extract<QueryResult, { kind: "table" }>;
export async function saveResult(
  result: Table,
  format: "csv" | "json",
  title: string,
): Promise<void> {
  if (
    result.truncated ||
    result.rows.some((row) =>
      row.some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          (value.type === "text" || value.type === "blob"),
      ),
    )
  ) {
    const choice = await vscode.window.showWarningMessage(
      "This export contains captured rows and displayed cell previews only. Use Export filtered table for complete database values.",
      { modal: true },
      "Export captured data",
    );
    if (!choice) return;
  }
  const file = await exportPath(title, format);
  if (file) await writeFile(file, serializeResult(result, format), "utf8");
}
export async function exportPath(
  title: string,
  format: "csv" | "json",
): Promise<string | undefined> {
  const file = await vscode.window.showSaveDialog({
    title: `Export ${title}`,
    filters: { [format.toUpperCase()]: [format] },
    saveLabel: "Export",
  });
  return file
    ? extname(file.fsPath).toLowerCase() === `.${format}`
      ? file.fsPath
      : `${file.fsPath}.${format}`
    : undefined;
}
export async function importCsv(info: TableInfo): Promise<readonly RowChange[] | undefined> {
  if (!info.editable) throw new Error("CSV import requires a writable table with a primary key.");
  const file = (
    await vscode.window.showOpenDialog({
      title: "Import CSV — first row must contain column names",
      canSelectMany: false,
      filters: { CSV: ["csv"] },
    })
  )?.[0];
  if (!file) return undefined;
  if ((await stat(file.fsPath)).size > 8 * 1024 * 1024)
    throw new Error("Import files up to 8 MiB.");
  const data = await readFile(file.fsPath);
  if (data.byteLength > 8 * 1024 * 1024)
    throw new Error("Import files up to 8 MiB in batches of 1,000 rows.");
  const [headers, ...rows] = parseCsv(data.toString("utf8"));
  if (!headers?.length || !rows.length || rows.length > 1000)
    throw new Error("CSV must have a header and between 1 and 1,000 data rows.");
  const columns = info.columns.filter((column) => !column.generated);
  const mapping: (string | undefined)[] = [];
  for (const header of headers) {
    const choices = columns
      .filter((column) => !mapping.includes(column.name))
      .map((column) => ({ label: column.name, description: column.type, column: column.name }));
    const exact = choices.findIndex((item) => item.column === header);
    if (exact > 0) choices.unshift(...choices.splice(exact, 1));
    // oxlint-disable-next-line no-await-in-loop -- Each mapping excludes columns chosen in the preceding prompt.
    const selected = await vscode.window.showQuickPick(
      [...choices, { label: "Skip this CSV column", description: "", column: undefined }],
      {
        title: `Map CSV column: ${header}`,
        placeHolder: `First value: ${rows[0]?.[mapping.length] ?? ""}`,
      },
    );
    if (!selected) return undefined;
    mapping.push(selected.column);
  }
  if (!mapping.some(Boolean)) throw new Error("Map at least one column.");
  const nulls = await vscode.window.showQuickPick(
    ["Keep empty fields as empty text", "Convert empty fields to NULL"],
    { title: "CSV empty-field handling" },
  );
  if (!nulls) return undefined;
  const changes: RowChange[] = rows.map((row) => ({
    kind: "insert",
    values: Object.fromEntries(
      mapping.flatMap((column, index) =>
        column
          ? [
              [
                column,
                row[index] === "" && nulls === "Convert empty fields to NULL"
                  ? null
                  : (row[index] ?? ""),
              ],
            ]
          : [],
      ),
    ),
  }));
  const accepted = await vscode.window.showInformationMessage(
    `Stage ${rows.length} rows for ${info.name}?\n${JSON.stringify(
      changes.slice(0, 3).map((change) => change.values),
      null,
      2,
    )}\nValues are imported as text (SQLite applies column affinity). Review SQL before Apply.`,
    { modal: true },
    "Stage rows",
  );
  return accepted ? changes : undefined;
}
