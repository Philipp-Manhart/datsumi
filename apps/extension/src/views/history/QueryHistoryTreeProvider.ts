import * as vscode from "vscode";

import type { HistoryEntry, QueryHistory } from "../../sql/QueryHistory";

/** One chronological, workspace-wide list. Entries never execute on selection. */
export class QueryHistoryTreeProvider
  implements vscode.TreeDataProvider<HistoryEntry>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;
  constructor(
    private readonly history: QueryHistory,
    private readonly hasConnection: (id: string) => boolean,
  ) {
    this.subscription = history.onDidChange(() => this.changeEmitter.fire());
  }
  refresh(): void {
    this.changeEmitter.fire();
  }
  getChildren(parent?: HistoryEntry): HistoryEntry[] {
    return parent ? [] : [...this.history.all()];
  }
  getTreeItem(entry: HistoryEntry): vscode.TreeItem {
    const connection = this.history.connectionInfo(entry);
    const database =
      connection.database && connection.database !== connection.connectionName
        ? ` / ${connection.database}`
        : "";
    const item = new vscode.TreeItem(
      `${connection.connectionName}${database} · ${entry.text.replace(/\s+/g, " ").trim().slice(0, 160)}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = entry.id;
    item.contextValue = "historyEntry";
    const status = entry.status ?? (entry.error ? "error" : "success");
    item.description = `${connection.driverId} · ${new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${entry.durationMs} ms`;
    item.iconPath = new vscode.ThemeIcon(
      entry.pinned
        ? "star-full"
        : status === "cancelled"
          ? "circle-slash"
          : status === "error"
            ? "error"
            : "history",
    );
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(
      `${connection.connectionName}${database}\n${connection.driverId} · ${new Date(entry.timestamp).toLocaleString()}\n${status} · ${entry.durationMs} ms`,
    );
    if (entry.rows !== undefined)
      tooltip.appendText(
        `\n${entry.rows} captured rows${entry.truncated ? " (capture limit reached)" : ""}`,
      );
    if (entry.affected !== undefined) tooltip.appendText(`\n${entry.affected} affected rows`);
    if (entry.error) tooltip.appendText(`\n${entry.error}`);
    if (!this.hasConnection(entry.connectionId))
      tooltip.appendText(
        "\nOriginal connection removed. Choose a connection before executing this query.",
      );
    tooltip.appendText("\nSelect to open in an editor without running.");
    tooltip.appendCodeblock(entry.text.slice(0, 20000), entry.language ?? "sql");
    tooltip.isTrusted = false;
    item.tooltip = tooltip;
    item.command = {
      command: "datsumi.openHistory",
      title: "Open Query",
      arguments: [entry.id],
    };
    return item;
  }
  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
