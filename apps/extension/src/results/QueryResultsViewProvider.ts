import { formatJson } from "@datsumi/core";
import type { CellValue } from "@datsumi/core";
import { viewPreferencesSchema, webviewRequestSchema } from "@datsumi/protocol";
import * as vscode from "vscode";

import type { ConnectionManager } from "../connections/ConnectionManager";
import { saveEditDraft } from "../data/editDraft";
import { saveResult } from "../data/files";
import { resultSettings, defaultPageSize } from "../settings";
import type { QueryHistory } from "../sql/QueryHistory";
import { compareResults } from "./compareResults";
import { rowIdentity, editableResult, refreshedChanges, updateSnapshot } from "./editableResult";
import { QueryResultsStore, validateResultTitle } from "./QueryResultsStore";
import type { PanelActions } from "./ResultsPanel";
import { initializeResultsWebview } from "./webview";

/** Owns the bottom-panel view and its retained query snapshots. */
export class QueryResultsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly store = new QueryResultsStore();
  private running = false;
  lastError: string | undefined;
  private pending:
    | { id: string; connectionId: string; cancellation: vscode.CancellationTokenSource }
    | undefined;
  private readonly resolvedEmitter = new vscode.EventEmitter<vscode.WebviewView>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connections: ConnectionManager,
    private readonly history?: QueryHistory,
    private readonly actions?: PanelActions,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.title = "Query Results";
    this.subscriptions.push(
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
      view.webview.onDidReceiveMessage((raw: unknown) => {
        const parsed = webviewRequestSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        switch (message.type) {
          case "ready":
            break;
          case "view/preferences": {
            if (message.resultId && message.resultId !== this.store.state().activeResultId) return;
            const entry = this.store.editTarget();
            if (entry)
              void Promise.resolve(
                this.connections.saveViewState(this.preferenceKey(), message.preferences),
              ).catch((error) => vscode.window.showErrorMessage(String(error)));
            return;
          }
          case "query/compare":
            void this.compare(message.resultId).catch((error) =>
              vscode.window.showErrorMessage(String(error)),
            );
            return;
          case "table/json":
            void this.editJson(message.row, message.column).catch((error) =>
              vscode.window.showErrorMessage(String(error)),
            );
            return;
          case "table/saveDraft": {
            const entry = message.resultId ? this.store.editTarget(message.resultId) : undefined;
            if (entry)
              void saveEditDraft(
                entry.connectionName,
                entry.info?.name ?? "query result",
                message.changes,
                (path) => this.connections.validateOutputDestination(path),
              ).catch((error) => vscode.window.showErrorMessage(String(error)));
            return;
          }
          case "table/stage":
            if (
              !this.running &&
              message.resultId &&
              this.store.editTarget(message.resultId)?.info?.editable
            )
              this.store.stage(message.resultId, message.changes);
            return;
          case "table/changes":
          case "table/discard":
            void this.edit(message);
            return;
          case "schema/open":
          case "table/related":
          case "table/value":
            void this.navigate(message).catch((error) =>
              vscode.window.showErrorMessage(String(error)),
            );
            return;
          case "query/pin":
            this.store.pin(message.resultId, message.pinned);
            break;
          case "query/select":
            this.store.select(message.resultId);
            break;
          case "query/rename":
            void this.rename(message.resultId);
            return;
          case "query/close":
            void this.close(message.resultId);
            return;
          case "query/page":
            this.store.page(message.resultId, message.offset, message.limit);
            break;
          case "query/copy":
            void this.copy(message);
            return;
          case "data/copy":
            void vscode.env.clipboard.writeText(message.text);
            return;
          case "data/export": {
            const result =
              message.scope === "page" ? this.store.state().result : this.store.snapshot();
            if (result?.kind === "table")
              void saveResult(result, message.format, "query result", (path) =>
                this.connections.validateOutputDestination(path),
              ).catch((error) => vscode.window.showErrorMessage(String(error)));
            return;
          }
          case "query/search":
            this.store.search(message.resultId, message.text);
            break;
          case "query/sort":
            this.store.sort(message.resultId, message.sort);
            break;
          default:
            return;
        }
        this.send();
      }),
    );
    initializeResultsWebview(view.webview, this.extensionUri);
    this.resolvedEmitter.fire(view);
  }

  private async copy(
    message: Extract<import("@datsumi/protocol").WebviewRequest, { type: "query/copy" }>,
  ): Promise<void> {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Datsumi: Preparing clipboard",
          cancellable: true,
        },
        async (_progress, token) => {
          // Yield before serialization so the progress UI and cancellation can be delivered.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (token.isCancellationRequested)
            throw new Error("Copy cancelled. The clipboard was unchanged.");
          const text = this.store.copy(
            message.resultId,
            message.columns,
            message.headers,
            message.format,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (token.isCancellationRequested)
            throw new Error("Copy cancelled. The clipboard was unchanged.");
          await vscode.env.clipboard.writeText(text);
        },
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async execute(connectionId: string, text: string, newResult = false): Promise<void> {
    if (this.store.hasEdits()) {
      void vscode.window.showInformationMessage(
        "Commit or discard pending result edits before running another query.",
      );
      return;
    }
    if (this.running) {
      void vscode.window.showInformationMessage(
        "A query is already running. Wait for it to finish or cancel it from the progress notification.",
      );
      return;
    }
    this.lastError = undefined;
    this.running = true;
    let id: string | undefined;
    const cancellation = new vscode.CancellationTokenSource();
    try {
      await this.revealView();
      id = this.store.begin(
        connectionId,
        this.connections.displayName?.(connectionId) ?? this.connections.get(connectionId).name,
        text,
        !newResult,
      );
      this.pending = { id, connectionId, cancellation };
      this.send();
      const started = performance.now();
      let result;
      try {
        result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Datsumi: Running query",
            cancellable: true,
          },
          async (_progress, token) => {
            const listener = token.onCancellationRequested(() => cancellation.cancel());
            try {
              return await this.connections.execute(
                connectionId,
                {
                  language:
                    this.connections.get(connectionId).family === "relational" ? "sql" : "custom",
                  text,
                  captureAll: true,
                },
                cancellation.token,
              );
            } finally {
              listener.dispose();
            }
          },
        );
        this.history?.record(
          connectionId,
          text,
          Math.round(performance.now() - started),
          undefined,
          {
            language: this.connections.get(connectionId).family === "relational" ? "sql" : "json",
            ...(result.kind === "table"
              ? { rows: result.rows.length, truncated: result.truncated }
              : {}),
            ...(result.kind === "value" &&
            result.value &&
            typeof result.value === "object" &&
            "changes" in result.value &&
            typeof result.value.changes === "number"
              ? { affected: result.value.changes }
              : {}),
          },
        );
      } catch (error) {
        this.history?.record(
          connectionId,
          text,
          Math.round(performance.now() - started),
          error instanceof Error ? error.message : String(error),
          {
            status: cancellation.token.isCancellationRequested ? "cancelled" : "error",
            language: this.connections.get(connectionId).family === "relational" ? "sql" : "json",
          },
        );
        throw error;
      }
      this.store.complete(id, result);
      this.store.page(id, 0, defaultPageSize());
      if (result.kind === "table" && result.additionalResults?.length) {
        for (const extra of result.additionalResults) {
          try {
            const extraId = this.store.begin(
              connectionId,
              this.connections.displayName?.(connectionId) ??
                this.connections.get(connectionId).name,
              text,
            );
            this.store.complete(extraId, { kind: "table", ...extra });
          } catch {
            void vscode.window.showWarningMessage(
              "Additional result sets could not be retained because the result tab limit was reached. No SQL was rerun.",
            );
            break;
          }
        }
      }
      if (result.kind === "table" && this.connections.get(connectionId).family === "relational") {
        try {
          const schema = await this.connections.schema(connectionId);
          const editing = editableResult(text, result, schema);
          this.store.editingContext(id, schema, editing.info, editing.reason);
        } catch {
          this.store.editingContext(
            id,
            [],
            undefined,
            "Schema is unavailable. Run the query again to enable editing.",
          );
        }
      }
    } catch (error) {
      if (!id) throw error;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.store.fail(id, this.lastError);
    } finally {
      cancellation.dispose();
      this.pending = undefined;
      this.running = false;
      this.send();
    }
  }

  private async editJson(rowIndex: number, columnIndex: number): Promise<void> {
    const entry = this.store.editTarget(),
      table = this.store.state().result;
    if (!entry?.info?.editable || table?.kind !== "table") return;
    const row = table.rows[rowIndex],
      column = table.columns[columnIndex];
    if (
      !row ||
      !column ||
      typeof row[columnIndex] !== "string" ||
      entry.info.columns.find((c) => c.name === column)?.generated
    )
      return;
    const original = Object.fromEntries(table.columns.map((name, i) => [name, row[i] ?? null]));
    await this.actions?.json?.(row[columnIndex], async (text) => {
      if (this.store.editTarget(entry.id) !== entry) throw new Error("Source result closed.");
      const previous = entry.staged?.find(
        (c) => JSON.stringify(c.original) === JSON.stringify(original),
      );
      await this.edit({
        type: "table/changes",
        resultId: entry.id,
        apply: false,
        changes: [
          ...(entry.staged ?? []).filter((c) => c !== previous),
          { kind: "update", original, values: { ...previous?.values, [column]: formatJson(text) } },
        ],
      });
      if (entry.error) throw new Error(entry.error);
    });
  }
  private async compare(id: string): Promise<void> {
    const left = this.store.editTarget(id);
    if (left?.result?.kind !== "table") return;
    const tabs = this.store.state().tabs ?? [];
    const selected = await vscode.window.showQuickPick(
      tabs
        .filter((t) => t.id !== id && this.store.editTarget(t.id)?.result?.kind === "table")
        .map((t) => ({ label: t.title, description: t.connectionName, id: t.id })),
      { title: "Compare with captured result" },
    );
    if (!selected) return;
    const right = this.store.editTarget(selected.id);
    if (right?.result?.kind !== "table") return;
    const keys = await vscode.window.showQuickPick(
      left.result.columns
        .filter(
          (c, i, all) =>
            all.indexOf(c) === i &&
            all.lastIndexOf(c) === i &&
            right.result?.kind === "table" &&
            right.result.columns.filter((name) => name === c).length === 1,
        )
        .map((label) => ({ label })),
      { title: "Choose unique matching key columns", canPickMany: true },
    );
    if (!keys?.length) return;
    const comparison = compareResults(
      left.result,
      right.result,
      keys.map((k) => k.label),
    );
    const a = await vscode.workspace.openTextDocument({
      language: "json",
      content: JSON.stringify(comparison.left, null, 2),
    });
    const b = await vscode.workspace.openTextDocument({
      language: "json",
      content: JSON.stringify(comparison.right, null, 2),
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      a.uri,
      b.uri,
      `${left.title} ↔ ${right.title} · captured snapshots${comparison.truncated ? " (incomplete)" : ""}`,
    );
  }
  private async edit(
    message: Extract<
      import("@datsumi/protocol").WebviewRequest,
      { type: "table/changes" | "table/discard" }
    >,
  ): Promise<void> {
    if (this.running || !message.resultId) return;
    const entry = this.store.editTarget(message.resultId),
      info = entry?.info;
    if (!entry || !info?.editable || entry.result?.kind !== "table") return;
    if (message.type === "table/discard") {
      this.store.editState(entry.id, [], []);
      this.send();
      return;
    }
    this.running = true;
    this.store.editingBusy(entry.id, true);
    this.send();
    try {
      const source = entry.result;
      const originals = new Map(
        source.rows.map((row) => {
          const values = Object.fromEntries(
            source.columns.map((name, index) => [name, row[index] ?? null]),
          );
          return [
            rowIdentity(info, values),
            JSON.stringify(info.columns.map((column) => values[column.name])),
          ];
        }),
      );
      if (
        !message.changes.length ||
        message.changes.some(
          (change) =>
            change.kind !== "update" ||
            originals.get(rowIdentity(info, change.original ?? {})) !==
              JSON.stringify(info.columns.map((column) => change.original?.[column.name])),
        )
      )
        throw new Error("Only updates to original rows in this captured result are allowed.");
      if (
        message.apply &&
        (!entry.previewSql?.length ||
          JSON.stringify(message.changes) !== JSON.stringify(entry.staged))
      )
        throw new Error("Review the current changes before committing.");
      if (message.apply) {
        const accepted = await vscode.window.showWarningMessage(
          `Commit ${message.changes.length} row changes to ${entry.connectionName} · ${info.name}?`,
          {
            modal: true,
            detail:
              "All staged changes are applied together. Conflicting rows roll back the batch.",
          },
          "Commit changes",
        );
        if (!accepted || this.store.editTarget(entry.id) !== entry) return;
      }
      const preview = await this.connections.changeRows(
        entry.connectionId,
        { resourceId: info.resourceId, changes: message.changes },
        message.apply,
      );
      this.store.editState(
        entry.id,
        message.apply ? [] : message.changes,
        message.apply ? [] : preview,
      );
      if (message.apply) {
        this.actions?.changed();
        try {
          const rows = await refreshedChanges(
            info,
            message.changes,
            (text, parameters) =>
              this.connections.execute(entry.connectionId, { language: "sql", text, parameters }),
            (request) => this.connections.browse(entry.connectionId, request),
          );
          this.store.complete(entry.id, updateSnapshot(entry.result, info, message.changes, rows));
          this.store.sort(entry.id, entry.sort);
        } catch {
          throw new Error(
            "Changes were committed, but the captured rows could not be refreshed. Run the SELECT again.",
          );
        }
      }
    } catch (error) {
      if (message.type === "table/changes" && message.apply)
        this.store.editState(entry.id, entry.staged ?? [], []);
      this.store.fail(entry.id, error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
      entry.busy = false;
      this.send();
    }
  }
  private async navigate(
    message: Extract<
      import("@datsumi/protocol").WebviewRequest,
      { type: "schema/open" | "table/related" | "table/value" }
    >,
  ): Promise<void> {
    const entry = this.store.editTarget(),
      info = entry?.info;
    if (!entry || !info) return;
    if (message.type === "schema/open") {
      await this.actions?.diagram(entry.connectionId, info.name);
      return;
    }
    if (message.type === "table/related") {
      const target = entry.schema?.find((table) => table.name === message.target);
      if (
        target &&
        (info.foreignKeys.some((key) => key.target === target.name) ||
          target.foreignKeys.some((key) => key.target === info.name))
      )
        await this.actions?.browse(entry.connectionId, target, message.filters);
      return;
    }
    const table = this.store.state().result;
    const row = table?.kind === "table" ? table.rows[message.row] : undefined;
    if (table?.kind === "table" && row && table.columns[message.column]) {
      const key: Record<string, CellValue> = Object.fromEntries(
        info.columns
          .filter((column) => column.primaryKey)
          .map((column) => [column.name, row[table.columns.indexOf(column.name)] ?? null]),
      );
      const content = await this.connections.readCell(entry.connectionId, {
        resourceId: info.resourceId,
        column: table.columns[message.column]!,
        key,
      });
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument({ language: "plaintext", content }),
        { preview: true },
      );
    }
  }
  private async revealView(): Promise<vscode.WebviewView> {
    if (this.view) {
      this.view.show(true);
      return this.view;
    }
    await vscode.commands.executeCommand("datsumi.queryResults.focus", { preserveFocus: true });
    if (this.view) return this.view;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        listener.dispose();
        reject(new Error("Query Results view did not open. Try running the query again."));
      }, 10000);
      const listener = this.resolvedEmitter.event((view) => {
        clearTimeout(timeout);
        listener.dispose();
        resolve(view);
      });
    });
  }
  togglePin(resultId?: string): void {
    const entry = this.store.editTarget(resultId);
    if (entry) {
      this.store.pin(entry.id, !entry.pinned);
      this.send();
    }
  }
  async rename(resultId?: string): Promise<void> {
    const target = this.store.renameTarget(resultId);
    if (!target) return;
    const title = await vscode.window.showInputBox({
      title: "Rename Result Tab",
      value: target.title,
      prompt: "Choose a name for this query result",
      validateInput: validateResultTitle,
    });
    if (title !== undefined && this.store.rename(target.id, title)) this.send();
  }
  async close(resultId?: string): Promise<void> {
    const target = this.store.renameTarget(resultId);
    if (!target) return;
    if (this.store.editTarget(target.id)?.staged?.length) {
      if (this.running) {
        void vscode.window.showInformationMessage("Wait for the current commit to finish.");
        return;
      }
      const discard = await vscode.window.showWarningMessage(
        "Discard pending edits and close this result?",
        { modal: true },
        "Discard edits",
      );
      if (!discard) return;
    }
    if (this.pending?.id === target.id) this.pending.cancellation.cancel();
    this.store.close(target.id);
    this.send();
  }
  clearConnection(connectionId: string): void {
    if (this.pending?.connectionId === connectionId) this.pending.cancellation.cancel();
    this.store.clearConnection(connectionId);
    this.send();
  }
  private preferenceKey(): string {
    const entry = this.store.editTarget();
    return `result:${entry?.connectionId}:${entry?.info?.resourceId ?? (entry?.result?.kind === "table" ? entry.result.columns.join(":") : "value")}`;
  }
  hasPendingEdits(connectionId?: string): boolean {
    return this.store.hasEdits(connectionId);
  }
  refreshSettings(): void {
    this.send();
  }
  private send(): void {
    const state = this.store.state(),
      entry = this.store.editTarget();
    const preferences = viewPreferencesSchema.safeParse(
      this.connections.viewState?.(this.preferenceKey()),
    );
    if (this.view)
      void this.view.webview.postMessage({
        ...state,
        display: resultSettings(),
        driverName: entry ? this.connections.get(entry.connectionId).driverId : undefined,
        ...(preferences.success ? { preferences: preferences.data } : {}),
      });
  }
  dispose(): void {
    this.pending?.cancellation.cancel();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.view = undefined;
    this.resolvedEmitter.dispose();
  }
}
