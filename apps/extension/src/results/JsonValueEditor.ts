import { formatJson } from "@datsumi/core";
import * as vscode from "vscode";

/** Drafts remain editor documents. Staging never executes a database write. */
export class JsonValueEditor implements vscode.Disposable {
  private readonly drafts = new Map<
    string,
    { original: vscode.Uri; stage(text: string): Promise<void> }
  >();
  private readonly subscriptions: vscode.Disposable[];
  constructor() {
    this.subscriptions = [
      vscode.commands.registerCommand("datsumi.stageJsonValue", async () => {
        const editor = vscode.window.activeTextEditor;
        const draft = editor && this.drafts.get(editor.document.uri.toString());
        if (!editor || !draft) {
          void vscode.window.showInformationMessage("Open a JSON value using Edit JSON first.");
          return;
        }
        try {
          const text = formatJson(editor.document.getText());
          await draft.stage(text);
          void vscode.window.showInformationMessage(
            "JSON change staged. Review and commit in the data tab.",
          );
        } catch (error) {
          void vscode.window.showErrorMessage(String(error));
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.drafts.delete(document.uri.toString());
        void vscode.commands.executeCommand(
          "setContext",
          "datsumi.jsonDraftActive",
          Boolean(
            vscode.window.activeTextEditor &&
            this.drafts.has(vscode.window.activeTextEditor.document.uri.toString()),
          ),
        );
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void vscode.commands.executeCommand(
          "setContext",
          "datsumi.jsonDraftActive",
          Boolean(editor && this.drafts.has(editor.document.uri.toString())),
        );
      }),
    ];
  }
  async open(text: string, stage: (text: string) => Promise<void>): Promise<void> {
    const content = formatJson(text);
    const original = await vscode.workspace.openTextDocument({ language: "json", content });
    const draft = await vscode.workspace.openTextDocument({ language: "json", content });
    this.drafts.set(draft.uri.toString(), { original: original.uri, stage });
    await vscode.commands.executeCommand(
      "vscode.diff",
      original.uri,
      draft.uri,
      "JSON value — edit right side, then Stage JSON Value",
      { preview: false },
    );
  }
  dispose(): void {
    this.drafts.clear();
    this.subscriptions.forEach((item) => item.dispose());
  }
}
