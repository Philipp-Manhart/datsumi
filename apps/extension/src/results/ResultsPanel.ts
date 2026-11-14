import { clipboardTsv, formatJson } from "@datsumi/core";
import type { QueryResult, TableFilter, TableInfo } from "@datsumi/core";
import { quoteName, qualifiedName, parseResource, selectSql } from "@datsumi/driver-sql/dialect";
import {
  viewPreferencesSchema,
  tableInfoSchema,
  webviewRequestSchema,
  webviewResponseSchema,
  type WebviewResponse,
} from "@datsumi/protocol";
import * as vscode from "vscode";

import type { ConnectionManager } from "../connections/ConnectionManager";
import { saveEditDraft } from "../data/editDraft";
import { exportPath, importCsv, saveResult } from "../data/files";
import { resultSettings, defaultPageSize } from "../settings";
import type { DraftStore } from "./DraftStore";
import { editingFeedback } from "./editingFeedback";
import { initializeResultsWebview } from "./webview";

export interface PanelActions {
  browse(connectionId: string, table: TableInfo, filters?: readonly TableFilter[]): Promise<void>;
  diagram(connectionId: string, focus?: string): Promise<void>;
  sql(connectionId: string, text: string): Promise<void>;
  changed(): void;
  drafts?: DraftStore;
  restoreDraft?(
    connectionId: string,
    table: TableInfo,
    changes: readonly import("@datsumi/core").RowChange[],
  ): Promise<void>;
  json?(text: string, stage: (text: string) => Promise<void>): Promise<void>;
}

export class ResultsPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel | vscode.WebviewView;
  private readonly ownedPanel: vscode.WebviewPanel | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private state: WebviewResponse;
  private disposed = false;
  private recoveryChecked = false;
  hasPendingEdits(): boolean {
    return Boolean(this.state.staged?.length);
  }
  refreshSettings(): void {
    this.send();
  }
  async stageDraft(changes: readonly import("@datsumi/core").RowChange[]): Promise<void> {
    this.state = { ...this.state, staged: [...changes], previewSql: [] };
    this.send();
  }
  private async persistDraft(): Promise<void> {
    if (!this.state.tableInfo || !this.actions?.drafts) return;
    try {
      await this.actions.drafts.save(
        this.actions.drafts.key(this.connections.get(this.connectionId), this.state.tableInfo),
        this.state.staged ?? [],
      );
    } catch {
      void vscode.window.showWarningMessage(
        this.state.staged?.length
          ? "The edit draft could not be saved for recovery. Your in-memory edits are retained; use Save draft to keep a copy."
          : "Database edits were committed or discarded, but saved recovery data could not be cleared. Clear saved drafts before reusing a recovered draft.",
      );
    }
  }
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;
  private cancellation: vscode.CancellationTokenSource | undefined;

  constructor(
    extensionUri: vscode.Uri,
    private readonly connections: ConnectionManager,
    readonly connectionId: string,
    title: string,
    private readonly resourceId?: string,
    view?: vscode.WebviewView,
    private readonly actions?: PanelActions,
  ) {
    this.state = {
      type: "results/state",
      protocolVersion: 1,
      title,
      connectionName: connections.displayName?.(connectionId) ?? connections.get(connectionId).name,
      driverName: connections.get(connectionId).driverId,
      busy: false,
      result: null,
      error: null,
      page: resourceId ? { offset: 0, limit: defaultPageSize(), hasMore: false } : null,
    };
    const saved = viewPreferencesSchema.safeParse(
      connections.viewState?.(`${connectionId}:${resourceId ?? "diagram"}`),
    );
    if (saved.success)
      this.state = {
        ...this.state,
        preferences: saved.data,
        filters: saved.data.filters,
        order: saved.data.order,
        page: this.state.page ? { ...this.state.page, limit: saved.data.limit ?? 100 } : null,
      };
    if (view) {
      // The contributed view is owned by VS Code and outlives each query's content.
      this.panel = view;
      this.ownedPanel = undefined;
    } else {
      this.ownedPanel = vscode.window.createWebviewPanel(
        "datsumi.results",
        title,
        vscode.ViewColumn.Active,
        { retainContextWhenHidden: true },
      );
      this.panel = this.ownedPanel;
    }
    this.subscriptions.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        const message = webviewRequestSchema.safeParse(raw);
        if (!message.success) return;
        void this.handle(message.data).catch((error) => {
          this.state = {
            ...this.state,
            error: error instanceof Error ? error.message : String(error),
          };
          this.send();
        });
      }),
    );
    initializeResultsWebview(this.panel.webview, extensionUri);
  }

  async loadPage(offset = 0, limit = this.state.page?.limit ?? 100): Promise<void> {
    if (!this.resourceId || this.disposed || this.state.busy) return;
    await this.run(async (token) => {
      const schema = (await this.connections.schema(this.connectionId, token)).map((table) =>
        tableInfoSchema.parse(table),
      );
      const tableInfo = schema.find((table) => table.resourceId === this.resourceId);
      this.state = {
        ...this.state,
        mode: "table",
        tableInfo,
        schema,
        editingReason: editingFeedback(this.connections.get(this.connectionId), tableInfo),
      };
      const page = await this.connections.browse(
        this.connectionId,
        {
          resourceId: this.resourceId!,
          offset,
          limit,
          filters: this.state.filters,
          order: this.state.order,
        },
        token,
      );
      this.state = {
        ...this.state,
        result: webviewResponseSchema.shape.result.parse(page.result),
        page: { offset: page.offset, limit: page.limit, hasMore: page.hasMore },
      };
      if (!this.recoveryChecked && tableInfo && this.actions?.drafts) {
        this.recoveryChecked = true;
        const key = this.actions.drafts.key(this.connections.get(this.connectionId), tableInfo);
        const saved = this.actions.drafts.load(key);
        if (saved) {
          const choice = await vscode.window.showWarningMessage(
            "A saved local edit draft is available for this table. Restore it for review? Original values are rechecked at commit.",
            "Restore draft",
            "Discard saved draft",
          );
          if (choice === "Restore draft")
            this.state = { ...this.state, staged: [...saved.changes], previewSql: [] };
          else if (choice === "Discard saved draft") await this.actions.drafts.save(key, []);
        }
      }
    });
  }
  async diagram(focus?: string): Promise<void> {
    await this.run(async (token) => {
      this.state = {
        ...this.state,
        mode: "diagram",
        schema: (await this.connections.schema(this.connectionId, token)).map((table) =>
          tableInfoSchema.parse(table),
        ),
        focusTable: focus,
      };
    });
  }
  async filter(filters: readonly TableFilter[]): Promise<void> {
    this.state = { ...this.state, filters: [...filters] };
    await this.loadPage();
  }
  /* oxlint-disable no-await-in-loop -- Fetch table pages sequentially on one database session. */
  private async copyAll(
    message: Extract<import("@datsumi/protocol").WebviewRequest, { type: "table/copy" }>,
  ): Promise<void> {
    const resourceId = this.resourceId;
    if (!resourceId) return;
    const filters = this.state.filters,
      order = this.state.order;
    if (this.state.staged?.length)
      throw new Error("Commit or discard table edits before copying all rows.");
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Datsumi: Copying all rows",
        cancellable: true,
      },
      async (progress, token) => {
        const parts: string[] = [];
        const jsonRows: import("@datsumi/core").CellValue[][] = [];
        let names: string[] = [],
          count = 0,
          bytes = 0;
        for (let offset = 0; ; offset += 500) {
          if (token.isCancellationRequested || this.disposed)
            throw new Error("Copy cancelled. The clipboard was unchanged.");
          const page = await this.connections.browse(
            this.connectionId,
            { resourceId, offset, limit: 500, filters, order },
            token,
          );
          const table = page.result;
          if (table.truncated)
            throw new Error(
              "The result contains shortened data. Nothing was copied. Use a database-native export.",
            );
          if (
            !message.columns.length ||
            new Set(message.columns).size !== message.columns.length ||
            message.columns.some((index) => index >= table.columns.length)
          )
            throw new Error("Invalid clipboard columns.");
          names = message.columns.map((index) => table.columns[index]!);
          const rows = table.rows.map((row) => message.columns.map((index) => row[index] ?? null));
          const text =
            message.format === "tsv"
              ? clipboardTsv(names, rows, offset === 0 && message.headers)
              : JSON.stringify(rows);
          bytes += Buffer.byteLength(text) + 2;
          if (bytes > 64 * 1024 * 1024)
            throw new Error(
              "The selection exceeds the 64 MiB clipboard budget. Nothing was copied. Narrow the query or export the data.",
            );
          if (message.format === "json") jsonRows.push(...rows);
          else if (text) parts.push(text);
          count += rows.length;
          progress.report({ message: `${count.toLocaleString()} rows` });
          if (!page.hasMore) break;
          if (!table.rows.length)
            throw new Error("Could not fetch the remaining rows. Nothing was copied.");
        }
        if (token.isCancellationRequested || this.disposed)
          throw new Error("Copy cancelled. The clipboard was unchanged.");
        await vscode.env.clipboard.writeText(
          message.format === "json"
            ? JSON.stringify({ columns: names, rows: jsonRows }, null, 2)
            : parts.join("\r\n"),
        );
      },
    );
  }

  private async handle(message: import("@datsumi/protocol").WebviewRequest): Promise<void> {
    if (message.type === "ready") {
      this.send();
      return;
    }
    if (message.type === "data/copy") {
      await vscode.env.clipboard.writeText(message.text);
      return;
    }
    if (this.state.busy) return;
    if (message.type === "table/copy") {
      await this.copyAll(message);
      return;
    }
    const info = this.state.tableInfo;
    switch (message.type) {
      case "view/preferences":
        this.state = {
          ...this.state,
          preferences: { ...this.state.preferences, ...message.preferences },
        };
        await this.connections.saveViewState(
          `${this.connectionId}:${this.resourceId ?? "diagram"}`,
          this.state.preferences,
        );
        break;
      case "table/json": {
        const result = this.state.result;
        if (!info?.editable || result?.kind !== "table") return;
        const row = result.rows[message.row],
          column = result.columns[message.column];
        if (
          !row ||
          !column ||
          typeof row[message.column] !== "string" ||
          info.columns.find((c) => c.name === column)?.generated
        )
          return;
        const original = Object.fromEntries(
          result.columns.map((name, i) => [name, row[i] ?? null]),
        );
        await this.actions?.json?.(row[message.column] as string, async (text) => {
          if (this.disposed || this.state.result !== result)
            throw new Error("The source data page changed or closed. Reopen Edit JSON.");
          const staged = [...(this.state.staged ?? [])];
          const existing = staged.find(
            (c) => JSON.stringify(c.original) === JSON.stringify(original),
          );
          if (existing?.kind === "delete") throw new Error("This row is staged for deletion.");
          const changes = [
            ...staged.filter((c) => c !== existing),
            {
              kind: "update" as const,
              original,
              values: { ...existing?.values, [column]: formatJson(text) },
            },
          ];
          await this.handle({ type: "table/changes", changes, apply: false });
          if (this.state.error) throw new Error(this.state.error);
        });
        break;
      }
      case "table/page":
        this.state = {
          ...this.state,
          preferences: { ...this.state.preferences, limit: message.limit },
        };
        await this.connections.saveViewState?.(
          `${this.connectionId}:${this.resourceId}`,
          this.state.preferences,
        );
        await this.loadPage(message.offset, message.limit);
        break;
      case "table/filter":
        this.state = { ...this.state, filters: message.filters, order: message.order };
        this.state = {
          ...this.state,
          preferences: {
            ...this.state.preferences,
            filters: message.filters,
            order: message.order,
          },
        };
        await this.connections.saveViewState?.(
          `${this.connectionId}:${this.resourceId}`,
          this.state.preferences,
        );
        await this.loadPage(0, this.state.page?.limit);
        break;
      case "schema/open":
        await this.actions?.diagram(this.connectionId, message.focus ?? info?.name);
        break;
      case "schema/browse": {
        const table = this.state.schema?.find((candidate) => candidate.name === message.table);
        if (table) await this.actions?.browse(this.connectionId, table);
        break;
      }
      case "table/related": {
        const table = this.state.schema?.find((candidate) => candidate.name === message.target);
        // Only actual schema relationships can open a related table.
        const linked =
          info &&
          (info.foreignKeys.some((key) => key.target === table?.name) ||
            table?.foreignKeys.some((key) => key.target === info.name));
        if (table && linked) await this.actions?.browse(this.connectionId, table, message.filters);
        break;
      }
      case "table/changes":
        if (!this.resourceId) return;
        if (
          message.apply &&
          (!this.state.previewSql?.length ||
            JSON.stringify(message.changes) !== JSON.stringify(this.state.staged))
        )
          throw new Error("Review the current changes before applying them.");
        let applied = false;
        await this.run(async (token) => {
          if (message.apply) {
            const accepted = await vscode.window.showWarningMessage(
              `Commit ${message.changes.length} row changes to ${this.state.connectionName} · ${info?.name}?`,
              {
                modal: true,
                detail:
                  "All staged changes are applied together. Conflicting rows roll back the batch.",
              },
              "Commit changes",
            );
            if (!accepted) return;
          }
          const previewSql = [
            ...(await this.connections.changeRows(
              this.connectionId,
              { resourceId: this.resourceId!, changes: message.changes },
              message.apply,
              token,
            )),
          ];
          this.state = { ...this.state, previewSql, staged: message.apply ? [] : message.changes };
          await this.persistDraft();
          if (message.apply) {
            applied = true;
            this.actions?.changed();
          }
        });
        if (message.apply && this.state.error) {
          this.state = { ...this.state, previewSql: [] };
          this.send();
        }
        if (applied && !this.state.error) {
          this.state = { ...this.state, previewSql: [] };
          await this.loadPage(this.state.page?.offset, this.state.page?.limit);
        }
        break;
      case "table/saveDraft":
        await saveEditDraft(
          this.state.connectionName,
          info?.name ?? this.state.title,
          message.changes,
          (path) => this.connections.validateOutputDestination(path),
        );
        break;
      case "table/stage":
        if (JSON.stringify(this.state.staged ?? []) !== JSON.stringify(message.changes))
          this.state = { ...this.state, staged: message.changes, previewSql: [] };
        await this.persistDraft();
        break;
      case "table/discard":
        this.state = { ...this.state, staged: [], previewSql: [] };
        await this.persistDraft();
        this.send();
        break;
      case "table/value": {
        const result = this.state.result;
        const row = result?.kind === "table" ? result.rows[message.row] : undefined;
        const column = result?.kind === "table" ? result.columns[message.column] : undefined;
        if (result?.kind === "table" && row && column && info) {
          const value = await this.connections.readCell(this.connectionId, {
            resourceId: info.resourceId,
            column,
            key: Object.fromEntries(
              info.columns.flatMap((col) =>
                col.primaryKey ? [[col.name, row[result.columns.indexOf(col.name)] ?? null]] : [],
              ),
            ),
          });
          let content = value,
            language = "plaintext";
          try {
            content = formatJson(value);
            language = "json";
          } catch {
            /* Plain text and hex values keep their original representation. */
          }
          const document = await vscode.workspace.openTextDocument({ language, content });
          await vscode.window.showTextDocument(document, { preview: true });
        }
        break;
      }
      case "table/import":
        if (info) {
          const changes = await importCsv(info);
          if (changes)
            await this.handle({
              type: "table/changes",
              changes: changes.map((change) => ({
                ...change,
                values: { ...change.values },
                ...(change.original ? { original: { ...change.original } } : {}),
              })),
              apply: false,
            });
        }
        break;
      case "table/sql":
        if (info) {
          const driver = this.connections.get(this.connectionId).driverId;
          const target =
            driver === "sqlite"
              ? { name: info.name, schema: undefined }
              : parseResource(info.resourceId);
          const q = (name: string) => quoteName(driver, name);
          const tableName = qualifiedName(driver, target.name, target.schema);
          const cols = info.columns.filter((col) => !col.generated);
          const text =
            message.action === "ddl"
              ? info.ddl + ";"
              : message.action === "select"
                ? selectSql(driver, target.name, target.schema)
                : message.action === "insert"
                  ? `INSERT INTO ${tableName} (${cols.map((col) => q(col.name)).join(", ")})\nVALUES (${cols.map(() => "NULL").join(", ")});`
                  : `UPDATE ${tableName} SET ${cols
                      .filter((col) => !col.primaryKey)
                      .map((col) => `${q(col.name)} = NULL`)
                      .join(", ")}\nWHERE ${
                      cols
                        .filter((col) => col.primaryKey)
                        .map((col) => `${q(col.name)} IS NULL /* replace with a row key */`)
                        .join(" AND ") || "0 /* add a row condition */"
                    };`;
          await this.actions?.sql(this.connectionId, text);
        }
        break;
      case "data/export":
        if (message.scope === "table" && this.resourceId) {
          const path = await exportPath(info?.name ?? "table", message.format);
          if (path)
            await this.run(async (token) => {
              const count = await this.connections.exportTable(
                this.connectionId,
                {
                  path,
                  format: message.format,
                  spreadsheetSafe: vscode.workspace
                    .getConfiguration("datsumi")
                    .get("export.spreadsheetSafe", false),
                  request: {
                    resourceId: this.resourceId!,
                    offset: 0,
                    limit: 500,
                    filters: this.state.filters,
                    order: this.state.order,
                  },
                },
                token,
              );
              void vscode.window.showInformationMessage(`Exported ${count.toLocaleString()} rows.`);
            });
        } else if (this.state.result?.kind === "table")
          await saveResult(this.state.result, message.format, this.state.title, (path) =>
            this.connections.validateOutputDestination(path),
          );
        break;
      default:
        break;
    }
  }
  async execute(text: string): Promise<void> {
    await this.run(async (token) =>
      this.setResult(
        await this.connections.execute(this.connectionId, { language: "sql", text }, token),
      ),
    );
  }
  private setResult(result: QueryResult): void {
    this.state = { ...this.state, result: webviewResponseSchema.shape.result.parse(result) };
  }
  private async run(operation: (token: vscode.CancellationToken) => Promise<void>): Promise<void> {
    if (this.disposed || this.state.busy) return;
    this.state = { ...this.state, busy: true, error: null };
    this.send();
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Datsumi: ${this.state.title}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const listener = token.onCancellationRequested(() => cancellation.cancel());
          try {
            await operation(cancellation.token);
          } finally {
            listener.dispose();
          }
        },
      );
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) };
    } finally {
      cancellation.dispose();
      this.cancellation = undefined;
      this.state = { ...this.state, busy: false };
      this.send();
    }
  }
  private send(): void {
    if (!this.disposed)
      void this.panel.webview.postMessage(
        webviewResponseSchema.parse({ ...this.state, display: resultSettings() }),
      );
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const changes = this.state.staged;
    const info = this.state.tableInfo;
    if (changes?.length && info && this.actions?.restoreDraft) {
      void vscode.window
        .showWarningMessage(
          "Table closed with pending edits. Reopen the draft? Reload recovery is available only when explicitly enabled in Settings.",
          "Reopen draft",
        )
        .then((choice) => {
          if (choice === "Reopen draft")
            return this.actions?.restoreDraft?.(this.connectionId, info, changes);
        });
    }
    this.cancellation?.cancel();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.ownedPanel?.dispose();
    this.disposeEmitter.fire();
    this.disposeEmitter.dispose();
  }
}
