import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

/** Shared assets and CSP for editor-based table browsing and the results view. */
export function initializeResultsWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  app = "results",
): void {
  const root = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  webview.options = { enableScripts: true, localResourceRoots: [root] };
  const script = webview.asWebviewUri(vscode.Uri.joinPath(root, "assets", "index.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(root, "assets", "index.css"));
  const nonce = randomBytes(24).toString("hex");
  webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link rel="stylesheet" href="${style.toString()}"><title>Datsumi Results</title></head><body data-app="${app}"><div id="root"></div><script nonce="${nonce}" type="module" src="${script.toString()}"></script></body></html>`;
}
