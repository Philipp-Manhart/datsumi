import type { DataPage } from "@datsumi/core";
import {
  webviewRequestSchema,
  webviewResponseSchema,
  type WebviewResponse,
} from "@datsumi/protocol";
import * as vscode from "vscode";

import type { ConnectionManager } from "../connections/ConnectionManager";
import { initializeResultsWebview } from "./webview";
export class DataPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private state: WebviewResponse;
  private readonly previous: NonNullable<WebviewResponse["data"]>[] = [];
  private readonly forward: NonNullable<WebviewResponse["data"]>[] = [];
  private pending: { id: string; text: string; original: string } | undefined;
  private disposed = false;
  private readonly disposedEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposedEmitter.event;
  constructor(
    extensionUri: vscode.Uri,
    private readonly connections: ConnectionManager,
    readonly connectionId: string,
    resource: string,
    private readonly query: () => Promise<void>,
  ) {
    const profile = connections.get(connectionId);
    this.state = {
      type: "results/state",
      protocolVersion: 1,
      mode: "data",
      title: resource,
      connectionName: connections.displayName(connectionId),
      driverName: profile.driverId,
      busy: false,
      error: null,
      result: null,
      page: null,
      data: {
        resource,
        filter: profile.driverId === "mongodb" ? "{}" : "*",
        records: [],
        back: false,
      },
    };
    this.panel = vscode.window.createWebviewPanel(
      "datsumi.data",
      `${profile.name} · ${resource}`,
      vscode.ViewColumn.Active,
      { retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      this.disposed = true;
      this.disposedEmitter.fire();
      this.disposedEmitter.dispose();
    });
    this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      const parsed = webviewRequestSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      void (async () => {
        if (message.type === "ready") {
          this.send();
          return;
        }
        if (message.type === "data/copy") {
          await vscode.env.clipboard.writeText(message.text);
          return;
        }
        if (message.type === "data/query") {
          await this.query();
          return;
        }
        if (this.state.busy) return;
        if (message.type === "data/back") {
          const data = this.previous.pop();
          if (data) {
            this.forward.push(this.state.data!);
            this.state = {
              ...this.state,
              data: { ...data, back: this.previous.length > 0, forward: true },
            };
            this.pending = undefined;
            this.send();
          }
          return;
        }
        if (message.type === "data/forward") {
          const data = this.forward.pop();
          if (data) {
            this.previous.push(this.state.data!);
            this.state = {
              ...this.state,
              data: { ...data, back: true, forward: this.forward.length > 0 },
            };
            this.pending = undefined;
            this.send();
          }
          return;
        }
        if (message.type === "data/browse") {
          await this.load(message.filter, message.cursor);
          return;
        }
        if (message.type === "data/edit") {
          const record = this.state.data!.records.find((r) => r.id === message.id);
          if (!record?.editable) throw new Error("Record is read-only or no longer on this page.");
          if (
            message.apply &&
            (!this.pending ||
              this.pending.id !== message.id ||
              this.pending.text !== message.text ||
              this.pending.original !== record.text)
          )
            throw new Error("Review the current value before committing.");
          this.state = { ...this.state, busy: true, error: null };
          this.send();
          try {
            if (
              message.apply &&
              !(await vscode.window.showWarningMessage(
                `Update ${connections.displayName(connectionId)} · ${resource} · ${message.id}?`,
                {
                  modal: true,
                  detail:
                    "The original value must still match. This applies one record/key change.",
                },
                "Commit change",
              ))
            )
              return;
            const preview = await connections.changeData(
              connectionId,
              { resource, id: record.id, original: record.text, text: message.text },
              message.apply,
            );
            this.pending = message.apply
              ? undefined
              : { id: record.id, text: message.text, original: record.text };
            this.state = {
              ...this.state,
              data: {
                ...this.state.data!,
                preview,
                records: message.apply
                  ? this.state.data!.records.map((r) =>
                      r.id === record.id ? { ...r, text: message.text } : r,
                    )
                  : this.state.data!.records,
              },
            };
          } finally {
            this.state = { ...this.state, busy: false };
            this.send();
          }
        }
      })().catch((error) => {
        this.state = {
          ...this.state,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        };
        this.send();
      });
    });
    initializeResultsWebview(this.panel.webview, extensionUri);
  }
  async load(filter = this.state.data!.filter, cursor?: string): Promise<void> {
    if (this.state.busy || this.disposed) return;
    this.state = { ...this.state, busy: true, error: null };
    this.send();
    try {
      const page: DataPage = await this.connections.browseData(this.connectionId, {
        resource: this.state.data!.resource,
        filter,
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      if (cursor) {
        this.previous.push(this.state.data!);
        if (this.previous.length > 10) this.previous.shift();
      } else this.previous.length = 0;
      this.forward.length = 0;
      this.pending = undefined;
      this.state = {
        ...this.state,
        data: {
          resource: this.state.data!.resource,
          filter,
          records: [...page.records],
          ...(page.cursor ? { cursor: page.cursor } : {}),
          ...(page.note ? { note: page.note } : {}),
          back: this.previous.length > 0,
        },
      };
    } catch (error) {
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.state = { ...this.state, busy: false };
      this.send();
    }
  }
  private send(): void {
    if (!this.disposed)
      void this.panel.webview.postMessage(webviewResponseSchema.parse(this.state));
  }
  dispose(): void {
    this.panel.dispose();
  }
}
