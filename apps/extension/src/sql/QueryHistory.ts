import { randomUUID } from "node:crypto";

import type { ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { userSetting } from "../settings";
export interface HistoryConnectionInfo {
  connectionName: string;
  driverId: string;
  database?: string;
  environment?: string;
}
export interface HistoryEntry {
  connectionName?: string;
  driverId?: string;
  database?: string;
  language?: "sql" | "json";
  id: string;
  connectionId: string;
  text: string;
  timestamp: number;
  durationMs: number;
  error?: string | undefined;
  rows?: number | undefined;
  affected?: number | undefined;
  truncated?: boolean | undefined;
  status?: "success" | "error" | "cancelled" | undefined;
  pinned?: boolean;
}
export class QueryHistory {
  private entries: HistoryEntry[];
  private pending: Promise<void> = Promise.resolve();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  constructor(
    private readonly context: ExtensionContext,
    private readonly resolveConnection?: (id: string) => HistoryConnectionInfo | undefined,
  ) {
    const saved = context.workspaceState.get<unknown>("datsumi.history", []);
    this.entries = Array.isArray(saved)
      ? saved
          .filter(
            (e): e is HistoryEntry =>
              e &&
              typeof e === "object" &&
              typeof e.text === "string" &&
              typeof e.connectionId === "string" &&
              typeof e.timestamp === "number" &&
              Number.isFinite(e.timestamp) &&
              typeof e.durationMs === "number" &&
              Number.isFinite(e.durationMs),
          )
          .slice(0, 2500)
          .map((e) => ({
            ...e,
            ...this.resolveConnection?.(e.connectionId),
            id: typeof e.id === "string" ? e.id : randomUUID(),
          }))
      : [];
    const before = this.entries.length;
    this.prune();
    if (before !== this.entries.length) void this.persist().catch(() => {});
  }
  private prune(): void {
    const config = vscode.workspace.getConfiguration("datsumi");
    const days = Math.max(0, Math.min(3650, config.get("history.retentionDays", 30)));
    const budget = Math.max(1, Math.min(25, config.get("history.maxStorageMiB", 5))) * 1024 * 1024;
    const count = Math.max(10, Math.min(2000, config.get("history.limit", 200)));
    let bytes = 2,
      recent = 0;
    this.entries = this.entries
      .filter((entry) => {
        if (days && entry.timestamp < Date.now() - days * 86400000) return false;
        if (!entry.pinned && recent++ >= count) return false;
        bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
        return bytes <= budget;
      })
      .slice(0, 2500);
  }
  all(): readonly HistoryEntry[] {
    const before = this.entries.length;
    this.prune();
    if (before !== this.entries.length) void this.persist().catch(() => {});
    return this.entries.map((entry) => ({ ...entry }));
  }
  get(id: string): HistoryEntry | undefined {
    const entry = this.entries.find((e) => e.id === id);
    return entry ? { ...entry } : undefined;
  }
  connectionInfo(entry: HistoryEntry): HistoryConnectionInfo {
    return (
      this.resolveConnection?.(entry.connectionId) ?? {
        connectionName: entry.connectionName ?? "Removed connection",
        driverId: entry.driverId ?? "database",
        ...(entry.database ? { database: entry.database } : {}),
      }
    );
  }
  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.persist();
  }
  async toggleFavorite(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.pinned = !entry.pinned;
      await this.persist();
    }
  }
  dispose(): void {
    this.changeEmitter.dispose();
  }
  private persist(): Promise<void> {
    this.changeEmitter.fire();
    this.prune();
    const snapshot = this.entries.map((entry) => ({ ...entry }));
    this.pending = this.pending
      .catch(() => {})
      .then(() => this.context.workspaceState.update("datsumi.history", snapshot));
    return this.pending;
  }
  record(
    connectionId: string,
    text: string,
    durationMs: number,
    error?: string,
    details: Partial<
      Pick<HistoryEntry, "rows" | "affected" | "truncated" | "status" | "language">
    > = {},
  ): void {
    const config = vscode.workspace.getConfiguration("datsumi");
    if (
      this.resolveConnection?.(connectionId)?.environment === "production" &&
      !userSetting("history.recordProduction", false)
    )
      return;
    if (
      !config.get("history.enabled", true) ||
      config.get<string[]>("history.disabledConnections", []).includes(connectionId)
    )
      return;
    if (!this.context.workspaceState.get("datsumi.historyNoticeSeen", false)) {
      void this.context.workspaceState.update("datsumi.historyNoticeSeen", true);
      void vscode.window.showInformationMessage?.(
        "Datsumi saves query history locally as unencrypted text. Configure History & Privacy settings to change retention or disable recording.",
      );
    }
    this.entries.unshift({
      id: randomUUID(),
      connectionId,
      ...this.resolveConnection?.(connectionId),
      text: text.slice(0, 100000),
      timestamp: Date.now(),
      durationMs,
      error: error?.slice(0, 1000),
      status: error ? "error" : "success",
      ...details,
    });
    this.prune();
    void this.persist().catch(() =>
      vscode.window.showWarningMessage("Query history could not be saved."),
    );
  }
  async pick(connectionId: string, manage = false): Promise<string | undefined> {
    return (await this.pickEntry(connectionId, manage))?.text;
  }
  async pickEntry(connectionId?: string, manage = false): Promise<HistoryEntry | undefined> {
    const mode = manage
      ? await vscode.window.showQuickPick(
          ["All queries", "Favorites", "Successful", "Failed / cancelled"],
          { title: "Query History filter" },
        )
      : "All queries";
    if (!mode) return;
    const entry = await vscode.window.showQuickPick(
      [
        ...this.entries
          .filter(
            (e) =>
              (!connectionId || e.connectionId === connectionId) &&
              (mode === "Favorites"
                ? e.pinned
                : mode === "Successful"
                  ? !e.error
                  : mode === "Failed / cancelled"
                    ? Boolean(e.error)
                    : true),
          )
          .map((e) => ({
            label: `${e.pinned ? "$(star-full) " : ""}${e.error ? "$(error)" : "$(check)"} ${e.text.replace(/\s+/g, " ").slice(0, 160)}`,
            description: `${this.connectionInfo(e).connectionName}${this.connectionInfo(e).database ? ` / ${this.connectionInfo(e).database}` : ""} · ${this.connectionInfo(e).driverId} · ${new Date(e.timestamp).toLocaleString()} · ${e.durationMs} ms${e.rows !== undefined ? ` · ${e.rows} captured rows${e.truncated ? "+ (limited)" : ""}` : ""}${e.affected !== undefined ? ` · ${e.affected} affected` : ""}`,
            detail: e.error ?? e.text.slice(0, 2000),
            entry: e as HistoryEntry | undefined,
          })),
        {
          label: "Manage Query History…",
          description: "Favorites, filters, copy, save, and deletion",
          detail: "",
          entry: undefined,
        },
      ],
      {
        title: "Query History",
        placeHolder: "Search SQL, dates, timing, or errors",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!entry) return;
    if (!entry.entry) return this.pickEntry(connectionId, true);
    if (!manage) return entry.entry;
    const selectedEntry = entry.entry;
    const action = await vscode.window.showQuickPick(
      [
        "Open in editor",
        selectedEntry.pinned ? "Unfavorite" : "Favorite",
        "Copy SQL",
        "Save as file",
        "Delete entry",
      ],
      { title: "Query History action" },
    );
    if (action === "Open in editor") return selectedEntry;
    if (action === "Copy SQL") await vscode.env.clipboard.writeText(selectedEntry.text);
    if (action === "Favorite" || action === "Unfavorite")
      selectedEntry.pinned = action === "Favorite";
    if (action === "Delete entry")
      this.entries = this.entries.filter((e) => e.id !== selectedEntry.id);
    if (action === "Save as file") {
      const uri = await vscode.window.showSaveDialog({
        filters: selectedEntry.language === "json" ? { JSON: ["json"] } : { SQL: ["sql"] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(selectedEntry.text));
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      }
    }
    await this.persist();
  }
  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }
}
