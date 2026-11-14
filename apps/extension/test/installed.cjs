const assert = require("node:assert/strict");
const { readFileSync, writeFileSync } = require("node:fs");
const { join, relative, isAbsolute } = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const vscode = require("vscode");

exports.run = async () => {
  const directory = process.env.DATSUMI_TEST_DIRECTORY;
  const phase = process.env.DATSUMI_LIFECYCLE_PHASE;
  const ext = vscode.extensions.getExtension("philipp-manhart.datsumi");
  assert.ok(ext);
  const installed = relative(process.env.DATSUMI_TEST_INSTALLED_ROOT, ext.extensionPath);
  assert.ok(!installed.startsWith("..") && !isAbsolute(installed), "Testing the installed package");
  assert.equal(ext.packageJSON.version, process.env.DATSUMI_TEST_EXPECTED_VERSION);
  let tree, history;
  const register = vscode.window.registerTreeDataProvider;
  vscode.window.registerTreeDataProvider = (id, value) => {
    if (id === "datsumi.connections") tree = value;
    if (id === "datsumi.history") history = value;
    return register(id, value);
  };
  try {
    await ext.activate();
  } finally {
    vscode.window.registerTreeDataProvider = register;
  }
  assert.ok(tree && history, "Installed extension registered its providers");
  const manager = tree.connections;
  const fixture = join(directory, "fixture.json");
  if (phase === "seed") {
    const path = join(directory, "workspace", "upgrade.sqlite");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE items(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO items VALUES(1,'before upgrade')",
    );
    db.close();
    const profile = await manager.addSqlite(path, false);
    const secret = randomUUID();
    await manager.credentials.set(profile, { password: secret, mode: "save" });
    await manager.saveViewState(`environment:${profile.id}`, "development");
    await manager.saveViewState(`${profile.id}:items`, { limit: 25, hidden: [], order: [] });
    history.history.record(profile.id, "SELECT note FROM items", 1, undefined, { rows: 1 });
    await history.history.pending;
    writeFileSync(fixture, JSON.stringify({ id: profile.id, secret }), { mode: 0o600 });
    await manager.disconnect(profile.id);
  } else {
    const { id, secret } = JSON.parse(readFileSync(fixture, "utf8"));
    const profile = manager.get(id);
    assert.equal(profile.driverId, "sqlite");
    assert.equal(
      await manager.credentials.resolve(profile),
      secret,
      "Secure credential survives upgrade/reload/reinstall",
    );
    assert.equal(manager.viewText(`environment:${id}`), "development");
    assert.equal(manager.viewState(`${id}:items`).limit, 25, "View preferences survive");
    assert.ok(
      history
        .getChildren()
        .some((entry) => entry.connectionId === id && entry.text === "SELECT note FROM items"),
      "History survives without replay",
    );
    const before = await manager.execute(id, {
      language: "sql",
      text: "SELECT note FROM items WHERE id=1",
    });
    assert.equal(before.rows[0][0], phase === "upgrade" ? "before upgrade" : "after upgrade");
    if (phase === "upgrade") {
      const table = (await manager.schema(id)).find((table) => table.name === "items");
      assert.ok(table?.editable, "Upgraded connection exposes a writable keyed table");
      const changes = {
        resourceId: table.resourceId,
        changes: [
          {
            kind: "update",
            original: { id: 1, note: "before upgrade" },
            values: { note: "after upgrade" },
          },
        ],
      };
      await manager.changeRows(id, changes, false);
      await manager.changeRows(id, changes, true);
      const after = await manager.execute(id, {
        language: "sql",
        text: "SELECT note FROM items WHERE id=1",
      });
      assert.equal(after.rows[0][0], "after upgrade", "Installed worker supports reviewed edits");
    }
    if (phase === "reinstall") await manager.credentials.forget(id);
    await manager.disconnect(id);
  }
  writeFileSync(join(directory, `${phase}.passed`), "ok");
};
