import type { ConnectionProfile } from "@datsumi/core";
import type { NoSqlDriver } from "@datsumi/driver-nosql/configuration";
import type { ServerDriver } from "@datsumi/driver-sql/configuration";
import type { ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { createSqlite, backupSqlite } from "../data/sqliteFiles";
import type { ConnectionsTreeNode } from "../views/connections/ConnectionsTreeProvider";
import { serverFormSetup, profileFormValues } from "./connectionForm";
import { openConnectionForm } from "./ConnectionFormPanel";
import type { ConnectionManager } from "./ConnectionManager";

interface Options {
  register<T extends unknown[]>(this: void, name: string, handler: (...args: T) => unknown): void;
  context: ExtensionContext;
  connections: ConnectionManager;
  chooseConnection(this: void, node?: ConnectionsTreeNode): Promise<string | undefined>;
  installDriver(this: void, id: ServerDriver | NoSqlDriver | "duckdb"): Promise<string>;
  ensureTrusted(this: void): void;
  setActive(this: void, id: string): void;
  refresh(this: void): void;
  hasPendingEdits(this: void, id: string): boolean;
  changed(this: void, id: string): void;
}
export function registerConnectionCommands({
  register,
  context,
  connections,
  chooseConnection,
  installDriver,
  ensureTrusted,
  setActive,
  refresh,
  hasPendingEdits,
  changed,
}: Options): void {
  async function connectionForm(original?: ConnectionProfile, edit = false) {
    ensureTrusted();
    const profile = await openConnectionForm(
      context.extensionUri,
      async (values, test, signal) => {
        ensureTrusted();
        if (values.driver === "sqlite" || values.driver === "duckdb") {
          if (!values.path.trim()) throw new Error("Choose a database file.");
          if (values.create && values.readOnly)
            throw new Error("A new database cannot be read-only.");
          if (test) throw new Error("Use Connect to open the selected file.");
          if (values.driver === "duckdb") await installDriver("duckdb");
          if (original && edit)
            return connections.updateLocal(original.id, values.name, values.path, values.readOnly);
          if (values.driver === "sqlite" && values.create) await createSqlite(values.path);
          return values.driver === "sqlite"
            ? connections.addSqlite(values.path, values.readOnly)
            : connections.addDuckdb(values.path, values.readOnly, values.create);
        }
        const setup = serverFormSetup(values);
        await installDriver(setup.driver);
        const answer = { password: setup.password ?? "", mode: values.credentialMode };
        if (test) {
          await connections.testServer(
            setup.driver,
            setup.configuration,
            answer.password,
            setup.ssh,
            signal,
          );
          return undefined;
        }
        if (original && edit)
          return connections.updateServer(
            original.id,
            setup.name,
            setup.configuration,
            answer,
            setup.ssh,
          );
        return connections.addServer(
          setup.driver,
          setup.name,
          setup.configuration,
          answer,
          setup.ssh,
          signal,
        );
      },
      original
        ? { ...profileFormValues(original), name: edit ? original.name : original.name + " copy" }
        : undefined,
      edit ? "Edit Database Connection" : "Add Database Connection",
    );
    if (!profile) return undefined;
    setActive(profile.id);
    refresh();
    await vscode.commands.executeCommand("datsumi.connections.focus");
    return profile;
  }
  register("datsumi.addConnection", () => connectionForm());
  register("datsumi.editConnection", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    if (hasPendingEdits(id))
      throw new Error("Commit or discard pending edits before changing a connection.");
    const profile = await connectionForm(connections.get(id), true);
    if (profile) {
      changed(id);
    }
  });
  register("datsumi.duplicateConnection", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    const original = connections.get(id);
    if (["sqlite", "duckdb"].includes(original.driverId)) {
      const copy = await connections.duplicateLocal(id);
      refresh();
      void vscode.window.showInformationMessage(
        `${copy.name} saved disconnected. Select it to connect; DuckDB may require disconnecting the original file first.`,
      );
    } else await connectionForm(original);
  });
  register("datsumi.copyDiagnostics", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    const profile = connections.get(id);
    await vscode.env.clipboard.writeText(
      JSON.stringify(
        {
          product: "Datsumi",
          version: context.extension.packageJSON.version,
          driver: profile.driverId,
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
          remote: vscode.env.remoteName ?? "local",
          tls:
            profile.configuration.tls ??
            (String(profile.configuration.endpoint).startsWith("https:") ||
            String(profile.configuration.endpoint).startsWith("rediss:")
              ? "enabled"
              : "see connection"),
          note: "No credentials, hostnames, query text, database values or raw errors included.",
        },
        null,
        2,
      ),
    );
    void vscode.window.showInformationMessage("Redacted connection diagnostics copied.");
  });
  register("datsumi.backupSqlite", async (node?: ConnectionsTreeNode) => {
    ensureTrusted();
    const id = await chooseConnection(node);
    if (!id) return;
    const profile = connections.get(id);
    if (profile.driverId !== "sqlite")
      throw new Error("Online backup is available for SQLite connections.");
    const destination = await vscode.window.showSaveDialog({
      title: "Back Up SQLite Database",
      filters: { SQLite: ["sqlite", "db"] },
    });
    if (!destination) return;
    if (
      destination.scheme !== "file" &&
      !(vscode.env.remoteName && destination.scheme === "vscode-remote")
    )
      throw new Error("Choose a file on the extension host.");
    if (hasPendingEdits(id) || ["open", "failed"].includes(await connections.transactionState(id)))
      throw new Error(
        "Commit or discard pending edits and finish the SQL transaction before backing up.",
      );
    await connections.validateOutputDestination(destination.fsPath);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Backing up SQLite" },
      async () => backupSqlite(String(profile.configuration.path), destination.fsPath),
    );
    void vscode.window.showInformationMessage("SQLite backup completed.");
  });
}
