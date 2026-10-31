const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const vscode = require("vscode");

async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!(await predicate()) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(await predicate(), "Native clipboard operation completed");
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension("philipp-manhart.datsumi");
  let provider;
  const originalRegister = vscode.window.registerWebviewViewProvider;
  vscode.window.registerWebviewViewProvider = (id, value, options) => {
    if (id === "datsumi.queryResults") provider = value;
    return originalRegister(id, value, options);
  };
  try {
    await extension.activate();
  } finally {
    vscode.window.registerWebviewViewProvider = originalRegister;
  }
  assert.ok(provider, "Native query-result provider registered");
  const path = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "clipboard.sqlite");
  const seed = new DatabaseSync(path);
  seed.exec("CREATE TABLE mutations(n INTEGER); INSERT INTO mutations VALUES(0)");
  seed.close();
  const originalPick = vscode.window.showQuickPick;
  vscode.window.showQuickPick = async (items) => (await items)[0];
  let profile;
  try {
    profile = await vscode.commands.executeCommand("datsumi.openSqlite", vscode.Uri.file(path));
  } finally {
    vscode.window.showQuickPick = originalPick;
  }
  assert.ok(profile?.id);
  let receive, state;
  // Only the webview transport is simulated. SQL, workers, commands and clipboard are native.
  provider.resolveWebviewView({
    show() {},
    onDidDispose: () => ({ dispose() {} }),
    webview: {
      options: {},
      cspSource: "vscode-webview:",
      asWebviewUri: (uri) => uri,
      onDidReceiveMessage: (callback) => {
        receive = callback;
        return { dispose() {} };
      },
      postMessage: (value) => {
        state = value;
        return Promise.resolve(true);
      },
    },
  });
  const previousClipboard = await vscode.env.clipboard.readText();
  try {
    await provider.execute(
      profile.id,
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<12001) SELECT x AS orders, '2026-04-01' AS day, '8705.63' AS revenue FROM n",
    );
    assert.equal(state.page.totalRows, 12001);
    const resultId = state.activeResultId;
    receive({ type: "query/page", resultId, offset: 100, limit: 100 });
    assert.equal(state.result.rows[0][0], 101);
    await vscode.env.clipboard.writeText("sentinel");
    receive({ type: "query/copy", resultId, columns: [1, 0, 2], headers: false, format: "tsv" });
    await until(async () => (await vscode.env.clipboard.readText()).startsWith("2026-04-01\t1\t"));
    const data = await vscode.env.clipboard.readText();
    const lines = data.split("\r\n");
    assert.equal(lines.length, 12001);
    assert.equal(lines.at(-1), "2026-04-01\t12001\t8705.63");
    receive({ type: "query/copy", resultId, columns: [1, 0, 2], headers: true, format: "tsv" });
    await until(async () =>
      (await vscode.env.clipboard.readText()).startsWith("day\torders\trevenue\r\n"),
    );
    assert.equal(await vscode.env.clipboard.readText(), "day\torders\trevenue\r\n" + data);
    await provider.execute(profile.id, "SELECT 3");
    assert.equal(state.tabs.length, 1, "Normal execution reuses the active result");
    assert.notEqual(state.activeResultId, resultId, "Reused results reject stale IDs");
    const pinnedId = state.activeResultId;
    receive({ type: "query/pin", resultId: pinnedId, pinned: true });
    await provider.execute(profile.id, "SELECT 4");
    assert.equal(state.tabs.length, 2, "Pinned results survive subsequent executions");
    assert.ok(state.tabs.find((tab) => tab.id === pinnedId)?.pinned);
    await provider.execute(profile.id, "SELECT 5", true);
    assert.equal(state.tabs.length, 3, "Explicit new-result execution creates a separate result");
    await provider.execute(profile.id, "UPDATE mutations SET n=n+1 RETURNING n");
    const writeId = state.activeResultId;
    receive({ type: "query/copy", resultId: writeId, columns: [0], headers: false, format: "tsv" });
    await until(async () => (await vscode.env.clipboard.readText()) === "1");
    receive({ type: "query/copy", resultId: writeId, columns: [0], headers: true, format: "tsv" });
    await until(async () => (await vscode.env.clipboard.readText()) === "n\r\n1");
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("SELECT n FROM mutations").get().n, 1, "Copy never replays a write");
    } finally {
      db.close();
    }
    writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "clipboard.passed"), "ok");
  } finally {
    await vscode.env.clipboard.writeText(previousClipboard);
  }
};
