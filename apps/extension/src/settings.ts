import * as vscode from "vscode";

export function resultSettings() {
  const config = vscode.workspace.getConfiguration("datsumi");
  return {
    density: config.get<"compact" | "comfortable">("results.density", "comfortable"),
    showDataTypes: config.get("results.showDataTypes", true),
    nullDisplay: String(config.get("results.nullDisplay", "NULL")).slice(0, 24),
  };
}
export function defaultPageSize(): number {
  return vscode.workspace.getConfiguration("datsumi").get("results.defaultPageSize", 100);
}

/** Sensitive retention/storage opt-ins may only come from the user's settings. */
export function userSetting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("datsumi").inspect<T>(key)?.globalValue ?? fallback;
}
