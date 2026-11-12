import type { ConnectionProfile, DriverCancellation } from "@datsumi/core";
import { connectionFormRequestSchema, type ConnectionFormValues } from "@datsumi/protocol";
import * as vscode from "vscode";

import { initializeResultsWebview } from "../results/webview";
import { userSetting } from "../settings";
import { abortCancellation } from "./cancellation";
import { connectionHint } from "./connectionHints";

/** Form values and passwords remain ephemeral; only the connection manager persists profiles. */
export function openConnectionForm(
  extensionUri: vscode.Uri,
  submit: (
    values: ConnectionFormValues,
    test: boolean,
    signal?: DriverCancellation,
  ) => Promise<ConnectionProfile | undefined>,
  initial?: Partial<ConnectionFormValues>,
  title = "Add Database Connection",
): Promise<ConnectionProfile | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      "datsumi.connection",
      title,
      vscode.ViewColumn.Active,
      { retainContextWhenHidden: true },
    );
    const cancellation = new AbortController();
    let disposed = false;
    let busy = false,
      finished = false;
    panel.onDidDispose(() => {
      disposed = true;
      if (!finished) {
        cancellation.abort();
        resolve(undefined);
      }
    });
    const send = async (state: Record<string, unknown>) => {
      if (disposed) return false;
      try {
        return await panel.webview.postMessage({ type: "connection/state", ...state });
      } catch {
        return false;
      }
    };
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const parsed = connectionFormRequestSchema.safeParse(raw);
      if (!parsed.success || busy) return;
      const message = parsed.data;
      void (async () => {
        if (message.type === "connection/ready") {
          await send({
            busy: false,
            initial,
            title,
            defaults: {
              credentialMode: userSetting("connections.defaultCredentialMode", "session"),
            },
          });
          return;
        }
        if (message.type === "connection/sshKey") {
          const uri = (
            await vscode.window.showOpenDialog({
              title: "Choose SSH private key",
              canSelectMany: false,
            })
          )?.[0];
          if (uri) {
            if (uri.scheme !== "file" && !(vscode.env.remoteName && uri.scheme === "vscode-remote"))
              throw new Error("Choose a key on the extension host filesystem.");
            await send({ sshKeyPath: uri.fsPath });
          }
          return;
        }
        if (message.type === "connection/browse") {
          const options = {
            title: message.create
              ? `Create ${message.driver === "sqlite" ? "SQLite" : "DuckDB"} Database`
              : "Open Database",
            filters: {
              Databases:
                message.driver === "sqlite" ? ["sqlite", "db", "sqlite3"] : ["duckdb", "db"],
            },
          };
          const uri = message.create
            ? await vscode.window.showSaveDialog(options)
            : (await vscode.window.showOpenDialog({ ...options, canSelectMany: false }))?.[0];
          if (uri) {
            if (uri.scheme !== "file" && !(vscode.env.remoteName && uri.scheme === "vscode-remote"))
              throw new Error("Choose a database on the extension host filesystem.");
            await send({ path: uri.fsPath });
          }
          return;
        }
        busy = true;
        await send({
          busy: true,
          error: null,
          status: message.test ? "Testing connection…" : "Connecting…",
        });
        try {
          const profile = await submit(
            message.values,
            message.test,
            abortCancellation(cancellation.signal),
          );
          if (message.test)
            await send({ busy: false, status: "Connection successful", error: null });
          else {
            finished = true;
            resolve(profile);
            panel.dispose();
          }
        } catch (error) {
          let text = error instanceof Error ? error.message : "Connection failed.";
          if (message.values.password)
            text = text.replaceAll(message.values.password, "[redacted]");
          const hint = connectionHint(text);
          await send({ busy: false, error: hint ? `${text} ${hint}` : text, status: null });
        } finally {
          busy = false;
        }
      })().catch(() => {
        busy = false;
        void send({ busy: false, error: "Could not complete the connection request." });
      });
    });
    initializeResultsWebview(panel.webview, extensionUri, "connection");
  });
}
