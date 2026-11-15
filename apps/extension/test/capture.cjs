const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const vscode = require("vscode");
const { connect, delay } = require("./cdp.cjs");

exports.run = async () => {
  assert.equal(
    process.platform,
    "linux",
    "Automatic full-window capture requires Linux/X11 and ImageMagick import",
  );
  const extension = vscode.extensions.getExtension("philipp-manhart.datsumi");
  await extension.activate();
  await vscode.workspace
    .getConfiguration("window")
    .update("title", "Datsumi — Every database. One workspace.", vscode.ConfigurationTarget.Global);
  const path = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "Datsumi demo.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,email TEXT,region TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES customers(id),status TEXT,total REAL);
CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,price REAL);
CREATE TABLE order_items(order_id INTEGER REFERENCES orders(id),product_id INTEGER REFERENCES products(id),quantity INTEGER,PRIMARY KEY(order_id,product_id));
INSERT INTO customers VALUES(1,'Alex Morgan','alex@example.com','Europe'),(2,'Sam Rivera','sam@example.com','Americas'),(3,'Jordan Lee','jordan@example.com','Asia');
INSERT INTO orders VALUES(1,1,'paid',149.50),(2,1,'shipped',79.00),(3,2,'paid',219.90),(4,3,'pending',42.00);
INSERT INTO products VALUES(1,'Keyboard',79.00),(2,'Monitor',219.90);
INSERT INTO order_items VALUES(1,1,1),(2,1,1),(3,2,1);`);
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
      `SELECT c.name, c.region, COUNT(o.id) AS orders, SUM(o.total) AS revenue\nFROM customers AS c\nJOIN orders AS o ON o.customer_id = c.id\nGROUP BY c.id\nORDER BY revenue DESC;`,
    ),
  );
  await vscode.commands.executeCommand("datsumi.runQuery");
  await vscode.commands.executeCommand("datsumi.queryResults.focus");
  const cdp = await connect(Number(process.env.DATSUMI_TEST_DEBUG_PORT));
  const workbench = await cdp.find('Boolean(document.querySelector(".part.panel"))');
  const sash = await cdp.evaluate(
    workbench,
    `(()=>{
    const panel=document.querySelector('.part.panel').getBoundingClientRect();
    return [...document.querySelectorAll('.monaco-sash.horizontal')].map(s=>s.getBoundingClientRect()).filter(r=>r.width>200 && r.height>0).sort((a,b)=>Math.abs(a.top-panel.top)-Math.abs(b.top-panel.top)).map(r=>({x:r.left+r.width/2,y:r.top+r.height/2}))[0];
  })()`,
  );
  assert.ok(sash, "Find the real panel resize handle");
  await cdp.call(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: sash.x, y: sash.y },
    workbench,
  );
  await cdp.call(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: sash.x, y: sash.y, button: "left", clickCount: 1 },
    workbench,
  );
  await cdp.call(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: sash.x, y: 500, button: "left", buttons: 1 },
    workbench,
  );
  await cdp.call(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: sash.x, y: 500, button: "left", clickCount: 1 },
    workbench,
  );
  await vscode.commands.executeCommand("notifications.clearAll");
  await delay(3000);
  const ids =
    execFileSync("xprop", ["-root", "_NET_CLIENT_LIST"], { encoding: "utf8" }).match(
      /0x[0-9a-f]+/g,
    ) || [];
  const matches = ids.filter((id) =>
    execFileSync("xprop", ["-id", id, "_NET_WM_NAME"], { encoding: "utf8" }).includes(
      "Datsumi — Every database. One workspace.",
    ),
  );
  assert.equal(matches.length, 1, "Capture only the isolated synthetic-data window");
  const output = process.env.DATSUMI_TEST_CAPTURE_DIR;
  mkdirSync(output, { recursive: true });
  const capture = (name) => execFileSync("import", ["-window", matches[0], join(output, name)]);
  capture("query-results.png");
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await vscode.commands.executeCommand("datsumi.openTable", {
    connectionId: profile.id,
    resource: { id: JSON.stringify(["table", "customers"]), kind: "table", label: "customers" },
  });
  try {
    const table = await cdp.find(
      'Boolean(document.querySelector("[role=grid]")) && !document.querySelector("[role=tablist]")',
    );
    await cdp.evaluate(
      table,
      `document.querySelector('td[data-row="0"][data-column="1"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    await delay(200);
    await cdp.evaluate(
      table,
      `(()=>{ const input=document.querySelector('.inline-cell-editor');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Alex Morgan — updated');input.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );
    await cdp.press(table, "Enter", "Enter", 13);
    await delay(200);
    await cdp.evaluate(
      table,
      `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Review SQL').click()`,
    );
    await delay(1200);
    capture("review-changes.png");
    await cdp.evaluate(
      table,
      `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Discard').click()`,
    );
  } finally {
    cdp.close();
  }
  await vscode.commands.executeCommand("datsumi.showRelationships", { connectionId: profile.id });
  await vscode.commands.executeCommand("notifications.clearAll");
  await delay(2500);
  capture("relationships.png");
  const original = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    original.prepare("SELECT name FROM customers WHERE id=1").get().name,
    "Alex Morgan",
    "Screenshots never commit the staged sample edit",
  );
  original.close();
  writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "screenshots.passed"), "ok");
};
