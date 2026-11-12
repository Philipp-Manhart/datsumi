import { writeFile } from "node:fs/promises";

import type { RowChange } from "@datsumi/core";
import * as vscode from "vscode";
export async function saveEditDraft(
  connection: string,
  table: string,
  changes: readonly RowChange[],
  validateDestination: (path: string) => Promise<void>,
): Promise<void> {
  if (!changes.length) return;
  const file = await vscode.window.showSaveDialog({
    title: "Save Edit Draft — contains unencrypted original and changed values",
    filters: { "Edit draft": ["json"] },
  });
  if (!file) return;
  if (file.scheme !== "file" && !(vscode.env.remoteName && file.scheme === "vscode-remote"))
    throw new Error("Choose a file on the extension host.");
  await validateDestination(file.fsPath);
  await writeFile(
    file.fsPath,
    JSON.stringify(
      {
        format: "datsumi-edit-draft/v1",
        connection,
        table,
        savedAt: new Date().toISOString(),
        changes,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
