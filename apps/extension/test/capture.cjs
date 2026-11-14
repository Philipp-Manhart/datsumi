const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const vscode = require("vscode");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async () => {
  assert.equal(
    process.platform,
    "linux",
    "Automatic screenshots currently require Linux/X11 and ImageMagick import",
  );
  const extension = vscode.extensions.getExtension("philipp-manhart.datsumi");
  await extension.activate();
  const path = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "Datsumi demo.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,plan TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES customers(id),total REAL);
INSERT INTO customers VALUES(1,'Alex Morgan','Pro'),(2,'Sam Rivera','Team'),(3,'Jordan Lee','Free');
INSERT INTO orders VALUES(1,1,149.50),(2,1,79.00),(3,2,219.90),(4,3,42.00);`);
  db.close();
  vscode.window.showQuickPick = async (items) => (await items)[0];
  const profile = await vscode.commands.executeCommand("datsumi.openSqlite", vscode.Uri.file(path));
  await vscode.commands.executeCommand("datsumi.connections.focus");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  await vscode.commands.executeCommand("datsumi.newQuery");
  const editor = vscode.window.activeTextEditor;
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      ),
      `SELECT c.name, c.plan, COUNT(o.id) AS orders, SUM(o.total) AS revenue\nFROM customers AS c\nJOIN orders AS o ON o.customer_id = c.id\nGROUP BY c.id\nORDER BY revenue DESC;`,
    ),
  );
  await vscode.commands.executeCommand("datsumi.runQuery");
  await vscode.commands.executeCommand("datsumi.queryResults.focus");
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes("workbench.action.increaseViewHeight")) {
    await vscode.commands.executeCommand("workbench.action.increaseViewHeight");
    await vscode.commands.executeCommand("workbench.action.increaseViewHeight");
  }
  await vscode.commands.executeCommand("workbench.action.focusWindow");
  await vscode.commands.executeCommand("notifications.clearAll");
  await delay(5000);
  const ids =
    execFileSync("xprop", ["-root", "_NET_CLIENT_LIST"], { encoding: "utf8" }).match(
      /0x[0-9a-f]+/g,
    ) || [];
  const matching = ids.filter((id) => {
    const title = execFileSync("xprop", ["-id", id, "_NET_WM_NAME"], { encoding: "utf8" });
    return title.includes("workspace") && title.includes("Visual Studio Code");
  });
  assert.equal(matching.length, 1, "Only capture the isolated synthetic-data test window");
  const output = process.env.DATSUMI_TEST_CAPTURE_DIR;
  mkdirSync(output, { recursive: true });
  execFileSync("import", ["-window", matching[0], join(output, "query-results.png")]);
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await vscode.commands.executeCommand("datsumi.showRelationships", { connectionId: profile.id });
  await vscode.commands.executeCommand("notifications.clearAll");
  await delay(5000);
  execFileSync("import", ["-window", matching[0], join(output, "relationships.png")]);
  writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "screenshots.passed"), "ok");
};
