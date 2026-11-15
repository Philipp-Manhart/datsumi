const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const vscode = require("vscode");
const { connect, delay } = require("./cdp.cjs");

exports.run = async () => {
  const path = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "keyboard.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE items(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO items VALUES(1,'Alex'),(2,'Sam'),(3,'Jordan')",
  );
  db.close();
  const ext = vscode.extensions.getExtension("philipp-manhart.datsumi");
  await ext.activate();
  vscode.window.showQuickPick = async (items) => (await items)[0];
  await vscode.commands.executeCommand("datsumi.openSqlite", vscode.Uri.file(path));
  await vscode.commands.executeCommand("datsumi.newQuery");
  const editor = vscode.window.activeTextEditor;
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      ),
      "SELECT * FROM items;",
    ),
  );
  await vscode.commands.executeCommand("datsumi.runQuery");
  await vscode.commands.executeCommand("datsumi.queryResults.focus");
  const cdp = await connect(Number(process.env.DATSUMI_TEST_DEBUG_PORT));
  const previousClipboard = await vscode.env.clipboard.readText();
  const readClipboard = async () =>
    (await vscode.env.clipboard.readText()).replaceAll("\r\n", "\n");
  try {
    const ui = await cdp.find('Boolean(document.querySelector("[role=grid]"))');
    const evaluate = (expression) => cdp.evaluate(ui, expression);
    const wait = async (expression) => {
      for (let i = 0; i < 80; i++) {
        if (await evaluate(expression)) return;
        await delay(75);
      }
      throw new Error(`UI condition failed: ${expression}`);
    };
    const key = (name, code, num, mods = 0) => cdp.press(ui, name, code, num, mods);
    await cdp.call("Page.bringToFront", {}, ui).catch(() => {});
    await evaluate(
      'window.__keys=[];window.addEventListener("keydown",e=>window.__keys.push({key:e.key,shift:e.shiftKey,ctrl:e.ctrlKey,target:e.target.tagName}),true);document.querySelector("[role=grid]").focus()',
    );
    await key("ArrowRight", "ArrowRight", 39);
    assert.equal(
      await evaluate(
        'document.getElementById(document.querySelector("[role=grid]").getAttribute("aria-activedescendant")).getAttribute("aria-label")',
      ),
      "name: Alex",
    );
    await key("ArrowDown", "ArrowDown", 40, 8);
    assert.equal(
      await evaluate('document.querySelectorAll("td[aria-selected=true]").length'),
      2,
      JSON.stringify(await evaluate("window.__keys")),
    );
    for (const modifier of [2, 4]) {
      await key("a", "KeyA", 65, modifier);
      await key("c", "KeyC", 67, modifier);
      for (let i = 0; i < 80 && !(await readClipboard()).endsWith("3\tJordan"); i++)
        await delay(75);
      assert.equal(await readClipboard(), "1\tAlex\n2\tSam\n3\tJordan");
      await key("a", "KeyA", 65, modifier | 8);
      await key("c", "KeyC", 67, modifier);
      for (let i = 0; i < 80 && !(await readClipboard()).startsWith("id\tname"); i++)
        await delay(75);
      assert.equal(await readClipboard(), "id\tname\n1\tAlex\n2\tSam\n3\tJordan");
    }
    await evaluate(
      'document.querySelector("input[aria-label=\\"Search captured results\\"]").focus()',
    );
    await cdp.call("Input.insertText", { text: "Sam" }, ui);
    await wait('document.activeElement.value === "Sam"');
    await key("a", "KeyA", 65, 2);
    assert.equal(
      await evaluate("document.activeElement.selectionEnd-document.activeElement.selectionStart"),
      3,
      "Input select-all remains native",
    );
    await cdp.call("Input.insertText", { text: "" }, ui);
    await evaluate(
      '(()=>{ const i=document.activeElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"");i.dispatchEvent(new Event("input",{bubbles:true})); })()',
    );
    await wait('document.querySelectorAll("tbody tr").length === 3');
    await evaluate('document.querySelector("[role=grid]").focus()');
    await key("Home", "Home", 36, 2);
    await key("ArrowRight", "ArrowRight", 39);
    await key("F2", "F2", 113);
    await wait('document.activeElement.classList.contains("inline-cell-editor")');
    await key("Escape", "Escape", 27);
    await wait('document.activeElement.getAttribute("role") === "grid"');
    await key("F2", "F2", 113);
    await wait('document.activeElement.classList.contains("inline-cell-editor")');
    await cdp.call("Input.insertText", { text: "Edited" }, ui);
    await key("Enter", "Enter", 13);
    await wait('document.activeElement.getAttribute("role") === "grid"');
    const check = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      check.prepare("SELECT name FROM items WHERE id=1").get().name,
      "Alex",
      "Keyboard edits are staged, never implicitly written",
    );
    check.close();
    await evaluate(
      '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Discard").click()',
    );
    await key("F10", "F10", 121, 8);
    await wait('Boolean(document.querySelector("[role=menu]"))');
    await key("Escape", "Escape", 27);
    await wait('document.activeElement.getAttribute("role") === "grid"');
    await key("End", "End", 35, 2);
    await key("Tab", "Tab", 9);
    assert.equal(
      await evaluate('document.activeElement.getAttribute("role") === "grid"'),
      false,
      "Tab exits the grid at its boundary",
    );
    await wait('Boolean(document.querySelector("select"))');
    await evaluate('document.querySelector("select").focus()');
    await key("Home", "Home", 36);
    await wait('document.querySelector("select").value === "25"');
    await key("ArrowDown", "ArrowDown", 40);
    await wait('document.querySelector("select").value === "50"');
    await key("Escape", "Escape", 27);
    assert.equal(await evaluate("document.activeElement.tagName"), "SELECT");
    const tree = await cdp.call("Accessibility.getFullAXTree", { frameId: ui.frameId }, ui);
    assert.ok(tree.nodes.some((node) => node.role?.value === "grid"));
    assert.ok(
      tree.nodes.some(
        (node) => node.role?.value === "gridcell" && node.name?.value === "name: Alex",
      ),
    );
    assert.ok(tree.nodes.some((node) => node.role?.value === "columnheader"));
    await vscode.workspace
      .getConfiguration("workbench")
      .update("colorTheme", "Default High Contrast", vscode.ConfigurationTarget.Global);
    await wait('document.body.classList.contains("vscode-high-contrast")');
    await evaluate('document.querySelector("[role=grid]").focus()');
    const colors = await evaluate(
      '(()=>{const c=document.querySelector("td.selected-cell");return c ? {background:getComputedStyle(c).backgroundColor,foreground:getComputedStyle(c).color}:null;})()',
    );
    assert.ok(
      colors && colors.background !== colors.foreground,
      "High contrast retains distinct foreground and background",
    );
    writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "ui.passed"), "ok");
  } finally {
    await vscode.env.clipboard.writeText(previousClipboard);
    cdp.close();
  }
};
