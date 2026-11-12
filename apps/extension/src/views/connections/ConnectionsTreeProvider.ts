import type { DatabaseResource } from "@datsumi/core";
import * as vscode from "vscode";

import type { ConnectionManager } from "../../connections/ConnectionManager";

export interface ConnectionsTreeNode {
  readonly connectionId: string;
  readonly resource?: DatabaseResource;
}

export class ConnectionsTreeProvider
  implements vscode.TreeDataProvider<ConnectionsTreeNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<ConnectionsTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  constructor(private readonly connections: ConnectionManager) {}

  getTreeItem(node: ConnectionsTreeNode): vscode.TreeItem {
    const profile = this.connections.get(node.connectionId);
    const resource = node.resource;
    const item = new vscode.TreeItem(
      resource?.label ?? profile.name,
      !resource || resource.hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `${node.connectionId}:${resource?.id ?? "connection"}`;
    item.contextValue =
      resource?.kind ?? (profile.driverId === "sqlite" ? "connection.sqlite" : "connection");
    if (!resource) {
      const environment = this.connections.viewText(`environment:${node.connectionId}`);
      if (environment) item.description = `${environment.toUpperCase()} · ${profile.driverId}`;
    }
    const description =
      resource?.description ??
      (!resource
        ? profile.configuration.readOnly
          ? `${profile.driverId} · ${["sqlite", "duckdb", "mongodb", "redis"].includes(profile.driverId) ? "read-only" : "grid editing disabled"}`
          : profile.driverId
        : undefined);
    if (description !== undefined && !item.description) item.description = description;
    item.tooltip = resource
      ? `${resource.label}${resource.description ? ` · ${resource.description}` : ""}`
      : String(
          profile.configuration.path ??
            `${profile.configuration.host}:${profile.configuration.port}/${profile.configuration.database}`,
        );
    item.iconPath = new vscode.ThemeIcon(
      !resource
        ? "database"
        : resource.kind === "column"
          ? "symbol-field"
          : resource.kind === "view"
            ? "preview"
            : "table",
    );
    if (resource?.kind === "table" || resource?.kind === "view" || resource?.kind === "collection")
      item.command = { command: "datsumi.openTable", title: "Open Table", arguments: [node] };
    return item;
  }
  async getChildren(node?: ConnectionsTreeNode): Promise<ConnectionsTreeNode[]> {
    if (!node) return this.connections.all().map((profile) => ({ connectionId: profile.id }));
    if (node.resource && !node.resource.hasChildren) return [];
    try {
      return (await this.connections.resources(node.connectionId, node.resource?.id))
        .filter(
          (resource) =>
            node.resource ||
            resource.label
              .toLowerCase()
              .includes(this.connections.viewText(`filter:${node.connectionId}`).toLowerCase()),
        )
        .map((resource) => ({ connectionId: node.connectionId, resource }));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Datsumi: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
  refresh(node?: ConnectionsTreeNode): void {
    this.changeEmitter.fire(node);
  }
  dispose(): void {
    this.changeEmitter.dispose();
  }
}
