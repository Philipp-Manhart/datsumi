import { readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";

import type { TableInfo, TableFilter } from "@datsumi/core";
import { InMemoryDriverRegistry } from "@datsumi/driver-api";
import { DuckDbDriver } from "@datsumi/driver-duckdb";
import { NoSqlDriverAdapter } from "@datsumi/driver-nosql";
import { nosqlDrivers, nosqlNames, type NoSqlDriver } from "@datsumi/driver-nosql/configuration";
import { ServerDriverAdapter } from "@datsumi/driver-sql";
import {
  driverNames as sqlDriverNames,
  serverDrivers,
  type ServerDriver,
} from "@datsumi/driver-sql/configuration";
import { selectSql, parseResource } from "@datsumi/driver-sql/dialect";
import { SqliteDriver } from "@datsumi/driver-sqlite";
import type { ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { registerConnectionCommands } from "./connections/connectionCommands";
import { connectionHint } from "./connections/connectionHints";
import { ConnectionManager } from "./connections/ConnectionManager";
import { promptCredential } from "./connections/credentialPrompt";
import { CredentialService } from "./connections/CredentialService";
import { SshHostTrust } from "./connections/SshHostTrust";
import { createTunnelFactory } from "./connections/SshTunnel";
import { DriverInstaller, parseCatalog } from "./drivers/DriverInstaller";
import { DuckDbNativeInstaller } from "./drivers/DuckDbNativeInstaller";
import { DataPanel } from "./results/DataPanel";
import { DraftStore } from "./results/DraftStore";
import { JsonValueEditor } from "./results/JsonValueEditor";
import { QueryResultsViewProvider } from "./results/QueryResultsViewProvider";
import { ResultsPanel } from "./results/ResultsPanel";
import { userSetting } from "./settings";
import { QueryHistory, type HistoryEntry } from "./sql/QueryHistory";
import { SqlLanguageFeatures } from "./sql/SqlLanguageFeatures";
import { statementAt } from "./sql/statements";
import {
  ConnectionsTreeProvider,
  type ConnectionsTreeNode,
} from "./views/connections/ConnectionsTreeProvider";
import { QueryHistoryTreeProvider } from "./views/history/QueryHistoryTreeProvider";

const driverNames = { ...sqlDriverNames, ...nosqlNames, duckdb: "DuckDB" };
type InstalledDriver = ServerDriver | NoSqlDriver | "duckdb";
let manager: ConnectionManager | undefined;

export function activate(context: ExtensionContext): void {
  const registry = new InMemoryDriverRegistry();
  registry.register(new SqliteDriver(join(context.extensionPath, "dist", "sqlite-worker.cjs")));
  const ensureTrusted = () => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before connecting to a database.");
  };
  const authority = vscode.workspace.workspaceFolders?.[0]?.uri.authority ?? "";
  const credentials = new CredentialService(
    context.secrets,
    promptCredential,
    `${vscode.env.remoteName ?? "local"}:${authority}`,
  );
  const installer = readFile(
    join(context.extensionPath, "dist", "driver-catalog.json"),
    "utf8",
  ).then(
    (text) =>
      new DriverInstaller(
        join(context.globalStorageUri.fsPath, "drivers"),
        parseCatalog(JSON.parse(text)),
      ),
  );
  const nativeInstallers = new Map<string, DuckDbNativeInstaller>();
  async function installDriver(id: InstalledDriver, force = false): Promise<string> {
    ensureTrusted();
    const store = await installer;
    const existing = force ? undefined : await store.installed(id);
    const native = (worker: string) => {
      let instance = nativeInstallers.get(worker);
      if (!instance) {
        instance = new DuckDbNativeInstaller(join(dirname(worker), "native"));
        nativeInstallers.set(worker, instance);
      }
      return instance;
    };
    if (existing && !force && (id !== "duckdb" || (await native(existing).installed())))
      return existing;
    const base = vscode.workspace
      .getConfiguration("datsumi")
      .inspect<string>("drivers.downloadBaseUrl")?.globalValue;
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Preparing ${driverNames[id]} support`,
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const listener = token.onCancellationRequested(() => controller.abort());
        try {
          const worker = await store.ensure(id, {
            bundledDirectory: join(context.extensionPath, "dist", "drivers"),
            ...(base ? { downloadBaseUrl: base } : {}),
            signal: controller.signal,
            force,
          });
          if (id === "duckdb") await native(worker).ensure(controller.signal, force);
          return worker;
        } finally {
          listener.dispose();
        }
      },
    );
  }
  async function installDriverFile(id: InstalledDriver): Promise<string> {
    ensureTrusted();
    const store = await installer;
    const files = await vscode.window.showOpenDialog({
      title: `Install ${driverNames[id]} driver`,
      canSelectMany: false,
      filters: { "Database driver": ["cjs"] },
    });
    if (!files?.[0]) throw new Error("Driver installation cancelled.");
    // workspace.fs handles files chosen through remote file pickers as well.
    const local = files[0];
    if (local.scheme !== "file" && !(vscode.env.remoteName && local.scheme === "vscode-remote"))
      throw new Error("Choose a driver file on the extension host filesystem.");
    return store.installFile(id, local.fsPath);
  }
  registry.register(new DuckDbDriver(() => installDriver("duckdb")));
  for (const id of serverDrivers)
    registry.register(new ServerDriverAdapter(id, () => installDriver(id)));
  for (const id of nosqlDrivers)
    registry.register(new NoSqlDriverAdapter(id, () => installDriver(id)));
  const hostTrust = new SshHostTrust(context.globalState, async (settings, fingerprint) => {
    const accepted = await vscode.window.showWarningMessage(
      `First SSH connection to ${settings.host}:${settings.port}.\nHost key: ${fingerprint}\nVerify this fingerprint with your server administrator before trusting it.`,
      { modal: true },
      "Trust and Connect",
    );
    return accepted === "Trust and Connect";
  });
  const tunnelFactory = createTunnelFactory({
    verifyHost: (settings, fingerprint) => hostTrust.verify(settings, fingerprint),
    passphrase: async (path) =>
      vscode.window.showInputBox({
        title: "Unlock SSH private key",
        prompt: `Passphrase for ${path}. Kept in memory only for this connection attempt.`,
        password: true,
        ignoreFocusOut: true,
      }),
  });
  const connections = new ConnectionManager(
    context,
    registry,
    credentials,
    ensureTrusted,
    tunnelFactory,
  );
  manager = connections;
  const tree = new ConnectionsTreeProvider(connections);
  const editorConnections = new Map<string, string>(
    Object.entries(
      context.workspaceState.get<Record<string, string>>("datsumi.editorConnections", {}),
    ),
  );
  function bindDocument(uri: vscode.Uri, id: string): void {
    editorConnections.set(uri.toString(), id);
    if (uri.scheme !== "untitled")
      void context.workspaceState.update(
        "datsumi.editorConnections",
        Object.fromEntries([...editorConnections].filter(([key]) => !key.startsWith("untitled:"))),
      );
  }
  const jsonEditor = new JsonValueEditor();
  const dataPanels = new Set<DataPanel>();

  const panels = new Set<ResultsPanel>();
  const drafts = new DraftStore(context.workspaceState, () => ({
    enabled: userSetting("drafts.recoveryEnabled", false),
    days: vscode.workspace.getConfiguration("datsumi").get("drafts.retentionDays", 7),
  }));
  if (!userSetting("drafts.recoveryEnabled", false)) void drafts.clear().catch(() => {});
  const history = new QueryHistory(context, (id) => {
    const profile = connections.all().find((item) => item.id === id);
    if (!profile) return undefined;
    const config = profile.configuration;
    const database =
      typeof config.database === "string"
        ? config.database
        : typeof config.path === "string"
          ? basename(config.path)
          : typeof config.endpoint === "string"
            ? new URL(config.endpoint).pathname.replace(/^\//, "")
            : "";
    return {
      connectionName: connections.displayName(id),
      environment: connections.viewText(`environment:${id}`),
      driverId: profile.driverId,
      ...(database ? { database } : {}),
    };
  });
  const historyTree = new QueryHistoryTreeProvider(history, (id) =>
    connections.all().some((profile) => profile.id === id),
  );
  const queryResults = new QueryResultsViewProvider(context.extensionUri, connections, history, {
    json: (text, stage) => jsonEditor.open(text, stage),
    browse: async (id, table, filters) => {
      const panel = results(id, table.name, table.resourceId);
      if (filters) await panel.filter(filters);
      else await panel.loadPage();
    },
    diagram: openDiagram,
    sql: openSql,
    changed: () => {
      sql.invalidate();
      tree.refresh();
    },
  });
  let activeConnectionId: string | undefined;
  const sql = new SqlLanguageFeatures(connections, (document) => {
    const id = editorConnections.get(document.uri.toString()) ?? activeConnectionId;
    return connections.all().some((profile) => profile.id === id) ? id : undefined;
  });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "datsumi.selectConnection";

  const transactionStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  transactionStatus.command = "datsumi.transaction";
  let statusSequence = 0;
  function updateStatus(): void {
    const sequence = ++statusSequence;
    const editor = vscode.window.activeTextEditor;
    const id = editor
      ? (editorConnections.get(editor.document.uri.toString()) ?? activeConnectionId)
      : activeConnectionId;
    const profile = connections.all().find((item) => item.id === id);
    const queryEditor = Boolean(
      editor &&
      editor.document.languageId === "json" &&
      editorConnections.has(editor.document.uri.toString()) &&
      profile?.family !== "relational",
    );
    void vscode.commands.executeCommand("setContext", "datsumi.queryEditorActive", queryEditor);
    const environment = profile ? connections.viewText(`environment:${profile.id}`) : undefined;
    status.text = `$(database) ${environment ? `[${environment.toUpperCase()}] ` : ""}${profile?.name ?? "Select Database"}`;
    status.backgroundColor =
      environment === "production"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
    if (profile?.family === "relational") {
      transactionStatus.text = "$(question) Transaction unknown";
      void connections.transactionState(profile.id).then((state) => {
        if (sequence !== statusSequence) return;
        transactionStatus.text =
          state === "idle"
            ? "Autocommit"
            : state === "manual"
              ? "Manual commit · idle"
              : state === "open"
                ? "$(git-commit) Transaction open"
                : state === "failed"
                  ? "$(error) Transaction failed"
                  : "$(question) Transaction unknown";
        transactionStatus.tooltip =
          "Shared connection state. Commit / Rollback applies to all editors using this connection.";
      });
      transactionStatus.show();
    } else transactionStatus.hide();
    status.tooltip = "Datsumi: Select the connection for the active SQL editor";
    if (editor?.document.languageId === "sql" || queryEditor) status.show();
    else status.hide();
  }
  function setActive(id: string, bindEditor = false): void {
    activeConnectionId = id;
    const editor = vscode.window.activeTextEditor;
    if (
      bindEditor &&
      editor &&
      (editor.document.languageId === "sql" ||
        (editor.document.languageId === "json" && connections.get(id).family !== "relational"))
    )
      bindDocument(editor.document.uri, id);
    updateStatus();
  }
  async function chooseConnection(
    node?: ConnectionsTreeNode,
    force = false,
  ): Promise<string | undefined> {
    if (node?.connectionId) {
      connections.get(node.connectionId);
      return node.connectionId;
    }
    const editor = vscode.window.activeTextEditor;
    const bound = editor ? editorConnections.get(editor.document.uri.toString()) : undefined;
    const selected = bound ?? activeConnectionId;
    if (!force && selected && connections.all().some((profile) => profile.id === selected))
      return selected;
    if (!connections.all().length) {
      void vscode.window.showInformationMessage(
        "Add a database using Datsumi: Add Database Connection.",
      );
      return undefined;
    }
    const item = await vscode.window.showQuickPick(
      connections.all().map((profile) => ({
        label: profile.name,
        description: `${profile.configuration.path ?? profile.configuration.host}${profile.configuration.readOnly ? (["sqlite", "duckdb", "mongodb", "redis"].includes(profile.driverId) ? " (read-only)" : " (grid editing disabled)") : ""}`,
        id: profile.id,
      })),
      {
        title: "Select Database Connection",
        placeHolder: "Choose the database for this SQL editor",
      },
    );
    return item?.id;
  }
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Preserve each command handler's argument tuple.
  function register<T extends unknown[]>(command: string, callback: (...args: T) => unknown): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (...args: T) => {
        try {
          return await callback(...args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const hint = connectionHint(message);
          void vscode.window.showErrorMessage(`Datsumi: ${message}${hint ? " " + hint : ""}`);
          return undefined;
        }
      }),
    );
  }
  function results(id: string, title: string, resourceId?: string): ResultsPanel {
    const panel = new ResultsPanel(
      context.extensionUri,
      connections,
      id,
      title,
      resourceId,
      undefined,
      {
        drafts,
        restoreDraft: async (connectionId, table, changes) => {
          const browser = results(connectionId, table.name, table.resourceId);
          await browser.loadPage();
          await browser.stageDraft(changes);
        },
        json: (text, stage) => jsonEditor.open(text, stage),
        browse: async (
          connectionId: string,
          table: TableInfo,
          filters?: readonly TableFilter[],
        ) => {
          const browser = results(connectionId, table.name, table.resourceId);
          if (filters) await browser.filter(filters);
          else await browser.loadPage();
        },
        diagram: openDiagram,
        sql: openSql,
        changed: () => {
          sql.invalidate(id);
          tree.refresh();
        },
      },
    );
    panels.add(panel);
    panel.onDidDispose(() => panels.delete(panel));
    return panel;
  }

  async function openSql(id: string, text: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      language: connections.get(id).family === "relational" ? "sql" : "json",
      content: text,
    });
    bindDocument(document.uri, id);
    activeConnectionId = id;
    await vscode.window.showTextDocument(document);
    updateStatus();
  }
  async function openDiagram(id: string, focus?: string): Promise<void> {
    await results(id, focus ? `Relationships: ${focus}` : "Schema Relationships").diagram(focus);
  }
  registerConnectionCommands({
    register,
    context,
    connections,
    chooseConnection,
    installDriver,
    ensureTrusted,
    setActive,
    refresh: () => tree.refresh(),
    hasPendingEdits: (id) =>
      queryResults.hasPendingEdits() ||
      [...panels].some((panel) => panel.connectionId === id && panel.hasPendingEdits()),
    changed: (id) => {
      for (const panel of [...panels]) if (panel.connectionId === id) panel.dispose();
      queryResults.clearConnection(id);
      sql.invalidate(id);
    },
  });
  register("datsumi.clearDrafts", async () => {
    await drafts.clear();
    void vscode.window.showInformationMessage("Saved edit drafts cleared.");
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("datsumi")) {
        for (const panel of panels) panel.refreshSettings();
        queryResults.refreshSettings();
      }
      if (
        event.affectsConfiguration("datsumi.drafts.recoveryEnabled") &&
        !userSetting("drafts.recoveryEnabled", false)
      )
        void drafts.clear();
    }),
  );

  register("datsumi.manageDrivers", async () => {
    ensureTrusted();
    const selected = await vscode.window.showQuickPick(
      [...serverDrivers, ...nosqlDrivers, "duckdb" as const].map((id) => ({
        label: driverNames[id],
        id,
      })),
      { title: "Manage Database Support" },
    );
    if (!selected) return;
    const store = await installer;
    const action = await vscode.window.showQuickPick(
      ["Install or reinstall", "Install from driver file", "Remove"],
      {
        title: driverNames[selected.id],
      },
    );
    if (!action) return;
    for (const profile of connections.all())
      if (profile.driverId === selected.id) await connections.disconnect(profile.id);
    if (action === "Remove") {
      const worker = await store.installed(selected.id);
      if (selected.id === "duckdb" && worker) {
        const { rm } = await import("node:fs/promises");
        await rm(join(dirname(worker), "native"), { recursive: true, force: true });
      }
      await store.remove(selected.id);
    } else if (action === "Install from driver file") await installDriverFile(selected.id);
    else await installDriver(selected.id, true);
  });
  register("datsumi.forgetSshHostKey", async () => {
    ensureTrusted();
    const settings = new Map(
      hostTrust
        .list()
        .map((entry) => [`${entry.host.toLowerCase()}:${entry.port}`, entry] as const),
    );
    for (const profile of connections.all())
      if (profile.ssh && !settings.has(`${profile.ssh.host.toLowerCase()}:${profile.ssh.port}`))
        settings.set(`${profile.ssh.host.toLowerCase()}:${profile.ssh.port}`, {
          ...profile.ssh,
          fingerprint: "",
        });
    const items = [...settings.values()].map((entry) => ({
      label: `${entry.host}:${entry.port}`,
      description: entry.fingerprint,
      settings: entry,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: "Forget SSH Host Key",
      placeHolder: "Choose the server whose fingerprint you have independently verified",
    });
    if (!selected) return;
    const accepted = await vscode.window.showWarningMessage(
      `Forget the trusted SSH fingerprint for ${selected.label}? Verify the new fingerprint before connecting again.`,
      { modal: true },
      "Forget Host Key",
    );
    if (accepted !== "Forget Host Key") return;
    for (const profile of connections.all())
      if (
        profile.ssh?.host.toLowerCase() === selected.settings.host.toLowerCase() &&
        profile.ssh.port === selected.settings.port
      )
        await connections.disconnect(profile.id);
    await hostTrust.forget(selected.settings);
  });
  register("datsumi.forgetCredentials", async (node?: ConnectionsTreeNode) => {
    ensureTrusted();
    const id = await chooseConnection(node);
    if (id) await connections.forgetCredentials(id);
  });
  register("datsumi.changeCredentials", async (node?: ConnectionsTreeNode) => {
    ensureTrusted();
    const id = await chooseConnection(node);
    if (!id) return;
    const profile = connections.get(id);
    if (["sqlite", "duckdb"].includes(profile.driverId)) return;
    const answer = await promptCredential(profile);
    if (answer) await connections.changeCredentials(id, answer);
  });
  register("datsumi.showRelationships", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (id) await openDiagram(id, node?.resource?.label);
  });
  async function openHistory(entry: HistoryEntry): Promise<void> {
    if (connections.all().some((profile) => profile.id === entry.connectionId)) {
      await openSql(entry.connectionId, entry.text);
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      language:
        entry.language ?? (["mongodb", "redis"].includes(entry.driverId ?? "") ? "json" : "sql"),
      content: entry.text,
    });
    // Keep the original, unavailable binding: Run must explicitly choose a replacement,
    // rather than falling back to an unrelated active database.
    bindDocument(document.uri, entry.connectionId);
    await vscode.window.showTextDocument(document);
    updateStatus();
  }
  register("datsumi.showHistory", () => vscode.commands.executeCommand("datsumi.history.focus"));
  register("datsumi.searchHistory", async () => {
    const entry = await history.pickEntry();
    if (entry) await openHistory(entry);
  });
  register("datsumi.openHistory", async (id: string) => {
    const entry = history.get(id);
    if (entry) await openHistory(entry);
  });
  register("datsumi.copyHistory", async (node: HistoryEntry) => {
    const entry = history.get(node.id);
    if (entry) await vscode.env.clipboard.writeText(entry.text);
  });
  register("datsumi.favoriteHistory", (node: HistoryEntry) => history.toggleFavorite(node.id));
  register("datsumi.deleteHistory", (node: HistoryEntry) => history.remove(node.id));
  register("datsumi.clearHistory", () => history.clear());
  register("datsumi.explainQuery", () => runQuery(true));
  register("datsumi.openDuckdb", async (uri?: vscode.Uri) => {
    ensureTrusted();
    const choice = uri
      ? "Open existing database"
      : await vscode.window.showQuickPick(
          ["Open existing database", "Create database", "In-memory database"],
          { title: "DuckDB" },
        );
    if (!choice) return;
    const create = choice === "Create database";
    const file =
      uri ??
      (choice === "In-memory database"
        ? undefined
        : create
          ? await vscode.window.showSaveDialog({
              title: "Create DuckDB Database",
              filters: { "DuckDB databases": ["duckdb"] },
            })
          : (
              await vscode.window.showOpenDialog({
                title: "Open DuckDB Database",
                canSelectMany: false,
                filters: { "DuckDB databases": ["duckdb", "ddb", "db"], "All files": ["*"] },
              })
            )?.[0]);
    if (choice !== "In-memory database" && !file) return;
    if (
      file &&
      file.scheme !== "file" &&
      !(vscode.env.remoteName && file.scheme === "vscode-remote")
    )
      throw new Error("Select a database on the extension host filesystem.");
    const access =
      create || !file
        ? { readOnly: false }
        : await vscode.window.showQuickPick(
            [
              { label: "Read and write", readOnly: false },
              { label: "Read-only", readOnly: true },
            ],
            { title: "DuckDB Connection Access" },
          );
    if (!access) return;
    const profile = await connections.addDuckdb(
      file?.fsPath ?? ":memory:",
      access.readOnly,
      create,
    );
    setActive(profile.id);
    tree.refresh();
    await vscode.commands.executeCommand("datsumi.connections.focus");
    return profile;
  });
  register("datsumi.openSqlite", async (uri?: vscode.Uri) => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before opening a database.");
    const file =
      uri ??
      (
        await vscode.window.showOpenDialog({
          title: "Open SQLite Database",
          canSelectMany: false,
          filters: { "SQLite databases": ["db", "sqlite", "sqlite3", "db3"], "All files": ["*"] },
        })
      )?.[0];
    if (!file) return undefined;
    if (file.scheme !== "file" && !(vscode.env.remoteName && file.scheme === "vscode-remote"))
      throw new Error("Select a database file on the extension host filesystem.");
    const mode = await vscode.window.showQuickPick(
      [
        { label: "Read and write", readOnly: false },
        { label: "Read-only", readOnly: true },
      ],
      { title: "SQLite Connection Access", placeHolder: "Choose how to open this database" },
    );
    if (!mode) return undefined;
    const profile = await connections.addSqlite(file.fsPath, mode.readOnly);
    setActive(profile.id);
    tree.refresh();
    await vscode.commands.executeCommand("datsumi.connections.focus");
    return profile;
  });
  register("datsumi.refreshConnections", () => {
    sql.invalidate();
    tree.refresh();
  });
  register("datsumi.transaction", async () => {
    const id = await chooseConnection();
    if (!id) return;
    const state = await connections.transactionState(id);
    if (!["open", "failed"].includes(state)) {
      void vscode.window.showInformationMessage(`Transaction state: ${state}.`);
      return;
    }
    const action = await vscode.window.showQuickPick(
      state === "failed" ? ["ROLLBACK" as const] : ["COMMIT" as const, "ROLLBACK" as const],
      { title: `${connections.get(id).name} — shared transaction` },
    );
    if (
      !action ||
      !(await vscode.window.showWarningMessage(
        `${action} the shared transaction on ${connections.get(id).name}?`,
        {
          modal: true,
          detail: "This affects all work in this connection, including other editors.",
        },
        action,
      ))
    )
      return;
    if (action !== "COMMIT" && action !== "ROLLBACK") return;
    await connections.transaction(id, action);
    updateStatus();
  });
  register("datsumi.setEnvironment", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    const label = await vscode.window.showQuickPick(
      ["development", "staging", "production", "none"],
      { title: "Connection environment label" },
    );
    if (!label) return;
    await connections.saveViewState(`environment:${id}`, label === "none" ? undefined : label);
    updateStatus();
    tree.refresh();
  });
  register("datsumi.quickOpen", async () => {
    const id = await chooseConnection();
    if (!id) return;
    const favorites = connections.viewStrings(`favorites:${id}`);
    const recent = connections.viewStrings(`recent:${id}`);
    const resources = (await connections.resources(id)).filter((r) =>
      ["table", "view", "collection"].includes(r.kind),
    );
    const item = await vscode.window.showQuickPick(
      resources
        .sort(
          (a, b) =>
            Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) ||
            (recent.includes(a.id) ? recent.indexOf(a.id) : 1000) -
              (recent.includes(b.id) ? recent.indexOf(b.id) : 1000),
        )
        .map((resource) => ({
          label: `${favorites.includes(resource.id) ? "$(star-full) " : ""}${resource.label}`,
          description: resource.kind,
          resource,
        })),
      { title: "Quick Open Database Object", matchOnDescription: true },
    );
    if (!item) return;
    await vscode.commands.executeCommand("datsumi.openTable", {
      connectionId: id,
      resource: item.resource,
    });
    await connections.saveViewState(
      `recent:${id}`,
      [item.resource.id, ...recent.filter((key) => key !== item.resource.id)].slice(0, 20),
    );
  });
  register("datsumi.toggleFavorite", async (node?: ConnectionsTreeNode) => {
    if (!node?.resource) return;
    const id = node.connectionId,
      favorites = connections.viewStrings(`favorites:${id}`);
    await connections.saveViewState(
      `favorites:${id}`,
      favorites.includes(node.resource.id)
        ? favorites.filter((key) => key !== node.resource!.id)
        : [...favorites, node.resource.id],
    );
    tree.refresh();
  });
  register("datsumi.toggleHistory", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    const settings = vscode.workspace.getConfiguration("datsumi"),
      disabled = settings.get<string[]>("history.disabledConnections", []);
    const selection = await vscode.window.showQuickPick(
      [
        {
          label: "Record query history",
          enable: true,
          description: disabled.includes(id) ? "" : "Current setting",
        },
        {
          label: "Do not record query history",
          enable: false,
          description: disabled.includes(id) ? "Current setting" : "",
        },
      ],
      { title: `Query history — ${connections.get(id).name}` },
    );
    if (!selection) return;
    const enable = selection.enable;
    await settings.update(
      "history.disabledConnections",
      enable ? disabled.filter((value) => value !== id) : [...new Set([...disabled, id])],
      vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global,
    );
    void vscode.window.showInformationMessage(
      `Query history ${enable ? "enabled" : "disabled"} for ${connections.get(id).name}. Existing history is retained until cleared.`,
    );
  });
  register("datsumi.filterObjects", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    const filter = await vscode.window.showInputBox({
      title: "Filter database objects",
      prompt: "Case-insensitive name filter; leave empty to show all",
      value: connections.viewText(`filter:${id}`),
    });
    if (filter !== undefined) {
      await connections.saveViewState(`filter:${id}`, filter);
      tree.refresh();
    }
  });
  register("datsumi.formatSql", () => sql.formatEditor());
  register("datsumi.configureSqlEditor", async () => {
    const document = vscode.window.activeTextEditor?.document;
    const scope = document?.languageId === "sql" ? document : { languageId: "sql" };
    const settings = vscode.workspace.getConfiguration("editor", scope);
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await settings.update("defaultFormatter", "philipp-manhart.datsumi", target, true);
    await settings.update(
      "quickSuggestions",
      { other: "on", comments: "off", strings: "off" },
      target,
      true,
    );
    await settings.update("suggestOnTriggerCharacters", true, target, true);
    await settings.update("suggest.showKeywords", true, target, true);
    await settings.update("suggest.showClasses", true, target, true);
    await settings.update("suggest.showFields", true, target, true);
    await settings.update("suggest.showInterfaces", true, target, true);
    await settings.update("tabCompletion", "on", target, true);
    void vscode.window.showInformationMessage(
      "SQL now uses Datsumi formatting and automatic SQL suggestions.",
    );
  });
  register("datsumi.renameResult", (value?: unknown) =>
    queryResults.rename(
      value &&
        typeof value === "object" &&
        "resultId" in value &&
        typeof value.resultId === "string"
        ? value.resultId
        : undefined,
    ),
  );
  register("datsumi.pinResult", (value?: unknown) =>
    queryResults.togglePin(
      value &&
        typeof value === "object" &&
        "resultId" in value &&
        typeof value.resultId === "string"
        ? value.resultId
        : undefined,
    ),
  );
  register("datsumi.closeResult", (value?: unknown) =>
    queryResults.close(
      value &&
        typeof value === "object" &&
        "resultId" in value &&
        typeof value.resultId === "string"
        ? value.resultId
        : undefined,
    ),
  );
  register("datsumi.selectConnection", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node, true);
    if (id) setActive(id, true);
  });
  register("datsumi.newQuery", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    const table = node?.resource;
    const text =
      table && (table.kind === "table" || table.kind === "view")
        ? (() => {
            const driver = connections.get(id).driverId;
            const target =
              driver === "sqlite"
                ? { name: table.label, schema: undefined }
                : parseResource(table.id);
            return selectSql(driver, target.name, target.schema);
          })()
        : connections.get(id).driverId === "mongodb"
          ? '{"collection":"collection_name","filter":{}}'
          : connections.get(id).driverId === "redis"
            ? '{"key":"key_name"}'
            : connections.get(id).driverId === "oracle"
              ? "SELECT 1 FROM dual;"
              : "SELECT 1;";
    const document = await vscode.workspace.openTextDocument({
      language: connections.get(id).family === "relational" ? "sql" : "json",
      content: text,
    });
    bindDocument(document.uri, id);
    activeConnectionId = id;
    const editor = await vscode.window.showTextDocument(document);
    updateStatus();
    return editor;
  });
  register("datsumi.runQuery", () => runQuery(false));
  register("datsumi.runQueryNewResult", () => runQuery(false, true));
  async function runQuery(explain: boolean, newResult = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !["sql", "json"].includes(editor.document.languageId))
      throw new Error("Open a database query editor first.");
    const id = await chooseConnection();
    if (!id) return;
    const text =
      connections.get(id).family !== "relational"
        ? editor.document.getText()
        : editor.selection.isEmpty
          ? statementAt(
              editor.document.getText(),
              editor.document.offsetAt(editor.selection.active),
              connections.get(id).driverId,
            )
          : editor.document.getText(editor.selection);
    if (!text.trim()) throw new Error("Enter or select a SQL statement to run.");
    bindDocument(editor.document.uri, id);
    activeConnectionId = id;
    updateStatus();
    if (explain && !/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(?:SELECT|WITH)\b/i.test(text))
      throw new Error("Explain Query Plan supports SELECT/WITH queries.");
    const driver = connections.get(id).driverId;
    if (explain && (driver === "mssql" || driver === "oracle"))
      throw new Error("Query plans are not available for this engine yet. Run the query normally.");
    if (explain && connections.get(id).family !== "relational")
      throw new Error("Use the database query editor for this engine.");
    await queryResults.execute(
      id,
      explain
        ? `${["sqlite", "libsql", "turso"].includes(driver) ? "EXPLAIN QUERY PLAN" : "EXPLAIN"} ${text}`
        : text,
      newResult ||
        explain ||
        !vscode.workspace.getConfiguration("datsumi").get<boolean>("results.reuseTabs", true),
    );
    if (editor.document.languageId === "sql") sql.diagnose(editor, text, queryResults.lastError);
    sql.invalidate(id);
    tree.refresh();
    updateStatus();
  }
  register("datsumi.openTable", async (node?: ConnectionsTreeNode) => {
    if (node?.resource?.kind === "collection") {
      const panel = new DataPanel(
        context.extensionUri,
        connections,
        node.connectionId,
        node.resource.id,
        () =>
          openSql(
            node.connectionId,
            connections.get(node.connectionId).driverId === "mongodb"
              ? JSON.stringify({ collection: node.resource!.id, filter: {} }, null, 2)
              : '{"key":"key_name"}',
          ),
      );
      dataPanels.add(panel);
      panel.onDidDispose(() => dataPanels.delete(panel));
      await panel.load();
      return;
    }
    if (!node?.resource || !["table", "view"].includes(node.resource.kind)) return;
    setActive(node.connectionId);
    await results(node.connectionId, node.resource.label, node.resource.id).loadPage();
  });
  register("datsumi.disconnect", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    for (const panel of dataPanels)
      if (panel.connectionId === id) {
        panel.dispose();
        dataPanels.delete(panel);
      }
    for (const panel of panels)
      if (panel.connectionId === id) {
        panel.dispose();
        panels.delete(panel);
      }
    queryResults.clearConnection(id);
    await connections.disconnect(id);
    sql.invalidate(id);
    tree.refresh();
    updateStatus();
  });
  register("datsumi.removeConnection", async (node?: ConnectionsTreeNode) => {
    const id = await chooseConnection(node);
    if (!id) return;
    for (const panel of dataPanels)
      if (panel.connectionId === id) {
        panel.dispose();
        dataPanels.delete(panel);
      }
    for (const panel of panels)
      if (panel.connectionId === id) {
        panel.dispose();
        panels.delete(panel);
      }
    queryResults.clearConnection(id);
    await connections.remove(id);
    historyTree.refresh();
    sql.invalidate(id);
    if (activeConnectionId === id) activeConnectionId = undefined;
    for (const [uri, connectionId] of editorConnections)
      if (connectionId === id) editorConnections.delete(uri);
    tree.refresh();
    updateStatus();
  });
  context.subscriptions.push(
    tree,
    history,
    historyTree,
    status,
    transactionStatus,
    jsonEditor,
    sql,
    queryResults,
    vscode.languages.registerDocumentFormattingEditProvider("sql", sql),
    vscode.languages.registerDocumentRangeFormattingEditProvider("sql", sql),
    vscode.languages.registerCompletionItemProvider("sql", sql, ".", '"', "[", "`"),
    vscode.languages.registerHoverProvider("sql", sql),
    vscode.languages.registerDefinitionProvider("sql", sql),
    vscode.workspace.registerTextDocumentContentProvider("datsumi-schema", sql),
    vscode.languages.registerSignatureHelpProvider("sql", sql, "(", ","),
    vscode.window.registerWebviewViewProvider("datsumi.queryResults", queryResults, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider("datsumi.connections", tree),
    vscode.window.registerTreeDataProvider("datsumi.history", historyTree),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === "untitled") editorConnections.delete(document.uri.toString());
    }),
    {
      dispose: () => {
        for (const panel of panels) panel.dispose();
        panels.clear();
        for (const panel of dataPanels) panel.dispose();
        dataPanels.clear();
      },
    },
  );
  updateStatus();
}

export async function deactivate(): Promise<void> {
  await manager?.dispose();
  manager = undefined;
}
