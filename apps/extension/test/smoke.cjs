const { writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const vscode = require("vscode");
const { addConnection } = require("./connection-form.cjs");

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline)
    // oxlint-disable-next-line no-await-in-loop -- Wait for the workbench to publish its asynchronous tab update.
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(predicate(), message);
}

function assertRowCount(path, count, message) {
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM customers").get().count, count, message);
  } finally {
    db.close();
  }
}

async function replaceQuery(editor, text) {
  await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
  await waitFor(
    () =>
      vscode.window.activeTextEditor?.document.uri.toString() === editor.document.uri.toString(),
    "Target query editor became active",
  );
  const applied = await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      ),
      text,
    ),
  );
  assert.equal(applied, true, "Query text edit applied");
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
}

exports.run = async function () {
  const headless = process.env.DATSUMI_TEST_HEADLESS === "1";
  if (headless) {
    // Only interaction with native Quick Pick dialogs is stubbed; extension commands and providers remain native.
    vscode.window.showQuickPick = async (items) => (await items)[0];
  }
  const extension = vscode.extensions.getExtension("philipp-manhart.datsumi");
  assert.ok(extension, "Development extension is installed");
  let historyProvider;
  let resultsProvider;
  const registerResults = vscode.window.registerWebviewViewProvider;
  vscode.window.registerWebviewViewProvider = (id, provider, ...options) => {
    if (id === "datsumi.queryResults") resultsProvider = provider;
    return registerResults(id, provider, ...options);
  };
  const originalRegisterTree = vscode.window.registerTreeDataProvider;
  vscode.window.registerTreeDataProvider = (id, provider) => {
    if (id === "datsumi.history") historyProvider = provider;
    return originalRegisterTree(id, provider);
  };
  try {
    await extension.activate();
  } finally {
    vscode.window.registerTreeDataProvider = originalRegisterTree;
    vscode.window.registerWebviewViewProvider = registerResults;
  }
  assert.ok(historyProvider, "Native query history provider registered");
  assert.equal(
    extension.packageJSON.contributes.views.datsumi.find((view) => view.id === "datsumi.history")
      .visibility,
    "collapsed",
    "History starts collapsed",
  );
  const commands = await vscode.commands.getCommands(true);
  for (const name of [
    "openSqlite",
    "openDuckdb",
    "newQuery",
    "runQuery",
    "runQueryNewResult",
    "pinResult",
    "openTable",
    "disconnect",
    "removeConnection",
    "formatSql",
    "configureSqlEditor",
    "renameResult",
    "closeResult",
    "showHistory",
    "clearHistory",
    "explainQuery",
    "showRelationships",
    "addConnection",
    "manageDrivers",
    "changeCredentials",
    "forgetCredentials",
  ])
    assert.ok(commands.includes(`datsumi.${name}`), `Registered ${name}`);
  const contributions = extension.packageJSON.contributes;
  const actions = contributions.menus["view/title"];
  assert.equal(
    actions.filter((item) => item.command === "datsumi.addConnection").length,
    1,
    "One add connection action",
  );
  assert.ok(
    !actions.some((item) => ["datsumi.openSqlite", "datsumi.openDuckdb"].includes(item.command)),
    "No duplicate database-specific add actions",
  );
  assert.ok(
    actions.some((item) => item.command === "datsumi.showHistory"),
    "History is visible in the sidebar toolbar",
  );
  const containers = Object.values(extension.packageJSON.contributes.viewsContainers).flat();
  for (const container of containers) {
    assert.match(
      container.id,
      /^[a-z0-9_-]+$/i,
      "View container IDs must satisfy VS Code's identifier rules",
    );
    assert.ok(
      commands.includes(`workbench.view.extension.${container.id}`),
      `VS Code registered the view container ${container.id}`,
    );
  }
  const path = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "sample.sqlite");
  const phase = "open";
  const dbSeed = new DatabaseSync(path);
  dbSeed.exec(
    "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers VALUES (1, 'Alex');",
  );
  dbSeed.close();
  const selection = setInterval(() => {
    void vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  }, 300);
  let profile;
  try {
    if (headless) {
      const originalOpen = vscode.window.showOpenDialog;
      vscode.window.showOpenDialog = async () => [vscode.Uri.file(path)];
      try {
        profile = await addConnection({ driver: "sqlite", path });
      } finally {
        vscode.window.showOpenDialog = originalOpen;
      }
    } else
      profile = await vscode.commands.executeCommand("datsumi.openSqlite", vscode.Uri.file(path));
  } finally {
    clearInterval(selection);
  }
  assert.ok(profile?.id, "Opened and saved SQLite connection");
  await vscode.commands.executeCommand("datsumi.newQuery");
  const editor = vscode.window.activeTextEditor;
  assert.equal(editor?.document.languageId, "sql", "Uses the native SQL editor");
  assert.ok(editor.document.getText().includes("SELECT 1"));
  const editorSettings = vscode.workspace.getConfiguration("editor", editor.document);
  await vscode.workspace
    .getConfiguration("editor")
    .update("defaultFormatter", "oxc.oxc-vscode", vscode.ConfigurationTarget.Global);
  assert.equal(
    editorSettings.get("defaultFormatter"),
    "philipp-manhart.datsumi",
    "SQL-specific default overrides an inherited non-SQL formatter",
  );
  assert.equal(
    editorSettings.get("quickSuggestions").other,
    "on",
    "SQL automatically shows word suggestions",
  );
  async function acceptTyped(prefix, typed, expected) {
    await replaceQuery(editor, prefix);
    const position = editor.document.positionAt(prefix.length);
    editor.selection = new vscode.Selection(position, position);
    await vscode.window.showTextDocument(editor.document);
    await vscode.commands.executeCommand("workbench.action.focusWindow");
    await waitFor(
      () => vscode.window.state.focused,
      "The isolated VS Code window is focused for automatic suggestion testing",
    );
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    // Type real keystrokes and allow the fresh workbench's suggestion widget to settle.
    /* oxlint-disable no-await-in-loop -- Exercise automatic suggestions without manually triggering the provider. */
    for (const character of typed)
      await vscode.commands.executeCommand("type", { text: character });
    for (
      let attempts = 0;
      attempts < 20 && editor.document.getText() === prefix + typed;
      attempts++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await vscode.commands.executeCommand("acceptSelectedSuggestion");
    }
    /* oxlint-enable no-await-in-loop */
    assert.equal(
      editor.document.getText(),
      prefix + expected,
      `Typing ${typed} automatically offers ${expected} (focused=${vscode.window.state.focused})`,
    );
  }
  if (headless || process.env.DATSUMI_TEST_SKIP_TYPING === "1") {
    writeFileSync(
      join(process.env.DATSUMI_TEST_DIRECTORY, "typing.skipped"),
      "Automatic popup and workbench-focus routing checks skipped explicitly in headless mode. Native completion/format providers, the Format SQL command, and deterministic Quick Pick selections are still checked.",
    );
  } else {
    await acceptTyped("", "se", "SELECT");
    await acceptTyped("SELECT * ", "fr", "FROM");
    await acceptTyped("SELECT * FROM customers ", "wh", "WHERE");
    await acceptTyped("SELECT * FROM ", "cu", "customers");
  }
  await vscode.workspace
    .getConfiguration("editor", editor.document)
    .update("defaultFormatter", "oxc.oxc-vscode", vscode.ConfigurationTarget.Workspace, true);
  await vscode.workspace
    .getConfiguration("editor", editor.document)
    .update("quickSuggestions", false, vscode.ConfigurationTarget.Workspace, true);
  await vscode.commands.executeCommand("datsumi.configureSqlEditor");
  assert.equal(
    vscode.workspace.getConfiguration("editor", editor.document).inspect("defaultFormatter")
      .workspaceLanguageValue,
    "philipp-manhart.datsumi",
    "Repair command configures SQL only",
  );
  assert.equal(
    vscode.workspace.getConfiguration("editor").get("defaultFormatter"),
    "oxc.oxc-vscode",
    "Repair preserves the global formatter for other languages",
  );
  await replaceQuery(editor, "select id,name from customers;");
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.window.showTextDocument(editor.document);
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  await waitFor(
    () =>
      vscode.window.activeTextEditor?.document.uri.toString() === editor.document.uri.toString(),
    "SQL document is active before native formatting",
  );
  if (headless) {
    // Invoke the SQL command directly: the compositor cannot reliably focus a headless workbench editor.
    await vscode.commands.executeCommand("datsumi.formatSql");
    assert.ok(
      editor.document.getText().includes("SELECT\n"),
      "Format SQL works despite the global OXC setting",
    );
  } else {
    // Workbench editor focus and configuration propagation can lag the extension API event.
    const formatDeadline = Date.now() + 5000;
    while (!editor.document.getText().includes("SELECT\n") && Date.now() < formatDeadline) {
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      await vscode.commands.executeCommand("editor.action.formatDocument");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(
      editor.document.getText().includes("SELECT\n"),
      "Native Format Document works despite global OXC setting",
    );
  }
  const labels = (result) =>
    (result?.items ?? []).map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
  async function complete(text, offset = text.length) {
    await replaceQuery(editor, text);
    return vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      editor.document.uri,
      editor.document.positionAt(offset),
    );
  }
  for (const [text, expected] of [
    ["se", "SELECT"],
    ["SELECT * fr", "FROM"],
    ["SELECT * FROM customers wh", "WHERE"],
  ]) {
    assert.ok(
      // oxlint-disable-next-line no-await-in-loop -- Validate each editor context through the native completion API.
      labels(await complete(text)).includes(expected),
      `Native completion offers ${expected}`,
    );
  }
  assert.ok(
    labels(await complete("SELECT * FROM cu")).includes("customers"),
    "SQLite tables appear in native completion",
  );
  const aliasText = "SELECT c. FROM customers AS c";
  const aliasItems = labels(await complete(aliasText, aliasText.indexOf("c.") + 2));
  assert.ok(
    aliasItems.includes("name") && aliasItems.includes("id"),
    "Alias completion uses schema declared after the caret",
  );
  assert.ok(
    !labels(await complete("SELECT 'cu")).includes("customers"),
    "Completion stays out of SQL strings",
  );
  await replaceQuery(editor, "select id,name from customers where id=1;");
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  const formatting = await vscode.commands.executeCommand(
    "vscode.executeFormatDocumentProvider",
    editor.document.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert.ok(
    formatting?.length && formatting[0].newText.includes("SELECT\n"),
    "Native Format Document provider is registered",
  );
  await vscode.commands.executeCommand("datsumi.formatSql");
  assert.ok(
    editor.document.getText().includes("SELECT\n"),
    "Format SQL applies native editor edits",
  );
  const firstStatement = "select 99;\n";
  await replaceQuery(editor, firstStatement + "select id,name from customers;");
  editor.selection = new vscode.Selection(
    editor.document.positionAt(firstStatement.length),
    editor.document.positionAt(editor.document.getText().length),
  );
  await vscode.commands.executeCommand("datsumi.formatSql");
  assert.ok(
    editor.document.getText().startsWith(firstStatement),
    "Formatting a selection leaves other statements untouched",
  );
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await replaceQuery(editor, "SELECT COALESCE(name, ");
  const signature = await vscode.commands.executeCommand(
    "vscode.executeSignatureHelpProvider",
    editor.document.uri,
    editor.document.positionAt(editor.document.getText().length),
  );
  assert.ok(
    signature?.signatures[0]?.label.startsWith("COALESCE("),
    "Native SQL parameter hints are registered",
  );
  assert.equal(signature.activeParameter, 1, "Parameter hints track the current function argument");
  await replaceQuery(editor, "CREATE TABLE late_schema(new_column TEXT);");
  await vscode.commands.executeCommand("datsumi.runQuery");
  assert.ok(
    labels(await complete("SELECT * FROM late_")).includes("late_schema"),
    "Executed DDL refreshes completion metadata",
  );
  const otherPath = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "other.sqlite");
  const otherDatabase = new DatabaseSync(otherPath);
  otherDatabase.exec("CREATE TABLE other_only(secret_column TEXT)");
  otherDatabase.close();
  const chooseOtherMode = setInterval(() => {
    void vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  }, 300);
  let other;
  try {
    other = await vscode.commands.executeCommand("datsumi.openSqlite", vscode.Uri.file(otherPath));
  } finally {
    clearInterval(chooseOtherMode);
  }
  assert.ok(other?.id, "Second SQLite connection opened");
  await vscode.window.showTextDocument(editor.document);
  // A previously bound editor continues using its own database when another is opened.
  assert.ok(
    labels(await complete("SELECT * FROM cu")).includes("customers"),
    "Existing editor retains its selected connection",
  );
  await vscode.commands.executeCommand("datsumi.selectConnection", { connectionId: other.id });
  assert.ok(
    labels(await complete("SELECT * FROM other_")).includes("other_only"),
    "Switching connections switches schema completion",
  );
  assert.ok(
    !labels(await complete("SELECT * FROM cu")).includes("customers"),
    "Completion does not leak tables from another connection",
  );
  await vscode.commands.executeCommand("datsumi.selectConnection", {
    connectionId: profile.id,
  });
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  const id = 2;
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      ),
      `INSERT INTO customers VALUES (${id}, 'Smoke test');`,
    ),
  );
  await vscode.commands.executeCommand("datsumi.runQuery");
  const db = new DatabaseSync(path);
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM customers").get().count,
      id,
      "SQL executed through the extension's database process",
    );
  } finally {
    db.close();
  }
  assert.ok(
    extension.packageJSON.contributes.viewsContainers.panel.some(
      (container) => container.id === "datsumi-resultsPanel",
    ),
    "Query Results is contributed to the native bottom panel",
  );
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    editor.document.uri.toString(),
    "Running SQL keeps focus in the SQL editor",
  );
  assert.ok(
    !vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label === "Query Results"),
    ),
    "Query execution does not create an editor tab",
  );
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      ),
      "INSERT INTO customers VALUES (3, 'Second run after hiding the panel');",
    ),
  );
  await vscode.commands.executeCommand("datsumi.runQuery");
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    editor.document.uri.toString(),
    "Rerunning reveals the reusable results panel while keeping editor focus",
  );
  assertRowCount(path, 3, "The second query executes after hiding and revealing the panel");
  await replaceQuery(editor, "INSERT INTO customers VALUES (4, 'Third run in the same panel');");
  await vscode.commands.executeCommand("datsumi.runQuery");
  assertRowCount(path, 4, "Repeated queries execute in the same results view");
  // Execute only the statement containing the caret, even when a script has other writes.
  await replaceQuery(
    editor,
    "INSERT INTO customers VALUES (90, 'must not run');\nSELECT * FROM customers;\nINSERT INTO customers VALUES (91, 'must not run');",
  );
  editor.selection = new vscode.Selection(1, 3, 1, 3);
  await vscode.commands.executeCommand("datsumi.runQuery");
  assertRowCount(path, 4, "Run at cursor executes only the current statement");
  await vscode.commands.executeCommand("datsumi.explainQuery");
  assertRowCount(path, 4, "Explain does not execute surrounding writes");
  const acceptHistory = setInterval(() => {
    void vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  }, 300);
  try {
    await vscode.commands.executeCommand("datsumi.searchHistory");
  } finally {
    clearInterval(acceptHistory);
  }
  assert.ok(
    vscode.window.activeTextEditor.document.getText().startsWith("EXPLAIN QUERY PLAN"),
    "History opens the most recent statement in an editor",
  );
  assertRowCount(path, 4, "Opening query history never executes it");
  const recorded = await historyProvider.getChildren();
  assert.ok(recorded.length > 0, "Queries appear in the native sidebar");
  const historyItem = historyProvider.getTreeItem(recorded[0]);
  assert.match(historyItem.label, /sample.sqlite/, "Sidebar identifies the source database");
  await vscode.commands.executeCommand("datsumi.showHistory");
  await vscode.commands.executeCommand(
    historyItem.command.command,
    ...historyItem.command.arguments,
  );
  assert.equal(
    vscode.window.activeTextEditor.document.getText(),
    recorded[0].text,
    "Sidebar selection opens exact SQL",
  );
  assertRowCount(path, 4, "Selecting a sidebar history item never executes SQL");
  await vscode.commands.executeCommand("datsumi.clearHistory");
  assert.deepEqual(
    await historyProvider.getChildren(),
    [],
    "Clearing history refreshes the sidebar",
  );
  await vscode.window.showTextDocument(editor.document);
  await vscode.commands.executeCommand("datsumi.showRelationships", {
    connectionId: profile.id,
    resource: { label: "customers" },
  });
  await waitFor(
    () =>
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => tab.label === "Relationships: customers"),
      ),
    "Relationships opens a native diagram tab",
  );
  if (profile) {
    await vscode.commands.executeCommand("datsumi.openTable", {
      connectionId: profile.id,
      resource: {
        id: JSON.stringify(["table", "customers"]),
        label: "customers",
        kind: "table",
        hasChildren: true,
      },
    });
    await waitFor(
      () =>
        vscode.window.tabGroups.all.some((group) =>
          group.tabs.some((tab) => tab.label === "customers"),
        ),
      "Native table command opened results",
    );
    await vscode.commands.executeCommand("datsumi.disconnect", { connectionId: profile.id });
    const reopenedEditor = await vscode.window.showTextDocument(editor.document);
    await replaceQuery(
      reopenedEditor,
      "INSERT INTO customers VALUES (5, 'Reconnected after disconnect');",
    );
    await vscode.commands.executeCommand("datsumi.runQuery");
    assertRowCount(path, 5, "Disconnect clears results without destroying the reusable view");
  }
  for (const driver of ["postgres", "mysql", "mariadb", "mssql", "clickhouse", "oracle"]) {
    const port = process.env[`DATSUMI_TEST_${driver.toUpperCase()}_PORT`];
    if (!port) continue;
    const originalPick = vscode.window.showQuickPick;
    const originalInput = vscode.window.showInputBox;
    const originalOpen = vscode.window.showOpenDialog;
    const originalError = vscode.window.showErrorMessage;
    const serverErrors = [];
    const serverInfo = [];
    const originalInfo = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = async (message) => {
      serverInfo.push(message);
      return undefined;
    };

    vscode.window.showErrorMessage = async (message) => {
      serverErrors.push(message);
      return undefined;
    };
    let passwordPrompts = 0;
    vscode.window.showInputBox = async (options) => {
      if (options.password) {
        passwordPrompts++;
        return process.env.DATSUMI_TEST_PASSWORD;
      }
      throw new Error(`Unexpected input prompt: ${options.title}`);
    };
    vscode.window.showQuickPick = async (items, options) => {
      const choices = await items;
      if (options?.title === "Server certificate verification") return choices[1];
      if (options?.title === "Store database credentials")
        return choices.find((item) => item.mode === "save");
      return choices[0];
    };
    vscode.window.showOpenDialog = async (options) => {
      assert.ok(
        options?.title?.startsWith("CA certificate"),
        "Driver setup must not open a file picker",
      );
      return [vscode.Uri.file(join(process.env.DATSUMI_TEST_TLS_DIR, "server.crt"))];
    };
    try {
      const server = await addConnection({
        driver,
        host: "127.0.0.1",
        port: driver === "clickhouse" ? process.env.DATSUMI_TEST_CLICKHOUSE_TLS_PORT : port,
        database: driver === "mssql" ? "master" : driver === "oracle" ? "FREEPDB1" : "datsumi",
        username: driver === "mssql" ? "sa" : "datsumi",
        name: `${driver} native test`,
        password: process.env.DATSUMI_TEST_PASSWORD,
        credentialMode: "save",
        tls: driver !== "oracle",
        ca: process.env.DATSUMI_TEST_CA,
      });
      assert.ok(server?.id, "Native form created a verified TLS server connection");
      assert.ok(
        !JSON.stringify(server).includes(process.env.DATSUMI_TEST_PASSWORD),
        "Profile contains no password",
      );
      assert.equal(
        passwordPrompts,
        0,
        "Password supplied by the connection form without an extra prompt",
      );
      const sqlEditor = await vscode.commands.executeCommand("datsumi.newQuery", {
        connectionId: server.id,
      });
      assert.ok(sqlEditor, "SQL editor opened for server connection");
      await replaceQuery(
        sqlEditor,
        driver === "clickhouse"
          ? "CREATE TABLE datsumi_native_credential_check (id Int32) ENGINE=MergeTree ORDER BY id"
          : "CREATE TABLE datsumi_native_credential_check (id INT PRIMARY KEY);",
      );
      await vscode.commands.executeCommand("datsumi.runQuery");
      await vscode.commands.executeCommand("datsumi.disconnect", { connectionId: server.id });
      await vscode.window.showTextDocument(sqlEditor.document);
      await replaceQuery(sqlEditor, "INSERT INTO datsumi_native_credential_check VALUES (1);");
      await vscode.commands.executeCommand("datsumi.runQuery");
      assert.equal(
        passwordPrompts,
        0,
        "Reconnect retrieved saved credential without another prompt",
      );
      await vscode.commands.executeCommand("datsumi.forgetCredentials", {
        connectionId: server.id,
      });
      const reconnectEditor = await vscode.commands.executeCommand("datsumi.newQuery", {
        connectionId: server.id,
      });
      await replaceQuery(reconnectEditor, "SELECT id FROM datsumi_native_credential_check;");
      await vscode.commands.executeCommand("datsumi.runQuery");
      assert.equal(
        passwordPrompts,
        1,
        `Forget removed saved credential and reconnect requested it again: ${JSON.stringify({ driver, serverErrors, serverInfo, lastError: resultsProvider?.lastError, result: resultsProvider?.store.state(), uri: vscode.window.activeTextEditor?.document.uri.toString(), text: vscode.window.activeTextEditor?.document.getText() })}`,
      );
      await vscode.commands.executeCommand("datsumi.removeConnection", {
        connectionId: server.id,
      });
      if (driver === "postgres") {
        for (const provider of ["neon", "supabase"]) {
          const cloud = await addConnection({
            driver: "postgres",
            provider,
            mode: "url",
            url: `postgresql://127.0.0.1:${port}/datsumi?sslmode=require${provider === "neon" ? "&channel_binding=require" : ""}`,
            username: "datsumi",
            password: process.env.DATSUMI_TEST_PASSWORD,
            ca: process.env.DATSUMI_TEST_CA,
            name: `${provider} preset protocol test`,
            credentialMode: "session",
          });
          assert.ok(cloud?.id, `${provider} preset connects through PostgreSQL with verified TLS`);
          assert.equal(cloud.driverId, "postgres", "Cloud presets reuse the existing worker");
          assert.ok(
            !JSON.stringify(cloud.configuration).includes(process.env.DATSUMI_TEST_PASSWORD),
          );
          await vscode.commands.executeCommand("datsumi.removeConnection", {
            connectionId: cloud.id,
          });
        }
      }
      if (driver === "postgres" && process.env.DATSUMI_TEST_SSH_PORT) {
        const originalWarning = vscode.window.showWarningMessage;
        let trustedHosts = 0;
        vscode.window.showWarningMessage = async (message, ...args) => {
          if (message.startsWith("First SSH connection")) {
            assert.ok(
              message.includes(process.env.DATSUMI_TEST_SSH_FINGERPRINT),
              "Host fingerprint is shown before trust",
            );
            trustedHosts++;
            return "Trust and Connect";
          }
          if (args.includes("Forget Host Key")) return "Forget Host Key";
          return originalWarning(message, ...args);
        };
        try {
          const tunneled = await addConnection({
            driver: "postgres",
            host: "localhost",
            port: "5432",
            database: "datsumi",
            username: "datsumi",
            password: process.env.DATSUMI_TEST_PASSWORD,
            tls: true,
            ca: process.env.DATSUMI_TEST_CA,
            credentialMode: "session",
            name: "Native SSH fixture",
            ssh: {
              enabled: true,
              host: "127.0.0.1",
              port: process.env.DATSUMI_TEST_SSH_PORT,
              username: "fixture",
              keyPath: process.env.DATSUMI_TEST_SSH_KEY,
            },
          });
          assert.ok(tunneled?.ssh, "SSH settings are saved separately from database settings");
          assert.equal(
            tunneled.configuration.host,
            "localhost",
            "Database TLS identity remains original",
          );
          assert.equal(
            tunneled.configuration.tunnelPort,
            undefined,
            "Forwarding ports are ephemeral",
          );
          const sshEditor = await vscode.commands.executeCommand("datsumi.newQuery", {
            connectionId: tunneled.id,
          });
          await replaceQuery(sshEditor, "SELECT 42 AS ssh_connection_check;");
          await vscode.commands.executeCommand("datsumi.runQuery");
          assert.ok(
            historyProvider
              .getChildren()
              .some(
                (entry) =>
                  entry.connectionId === tunneled.id &&
                  entry.text.includes("ssh_connection_check") &&
                  entry.status === "success",
              ),
            "Query executed through the real bundled SSH client and PostgreSQL worker",
          );
          await vscode.commands.executeCommand("datsumi.disconnect", {
            connectionId: tunneled.id,
          });
          await replaceQuery(sshEditor, "SELECT 43 AS ssh_reconnect_check;");
          await vscode.commands.executeCommand("datsumi.runQuery");
          assert.equal(trustedHosts, 1, "SSH reconnect reuses the pinned host key");
          await vscode.commands.executeCommand("datsumi.forgetSshHostKey");
          await replaceQuery(sshEditor, "SELECT 44 AS ssh_retrust_check;");
          await vscode.commands.executeCommand("datsumi.runQuery");
          assert.equal(
            trustedHosts,
            2,
            "Forgetting host trust requires a new explicit confirmation",
          );
          await vscode.commands.executeCommand("datsumi.removeConnection", {
            connectionId: tunneled.id,
          });
          writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "ssh.passed"), "ok");
          console.log(
            "Native SSH form, host-key trust, verified database TLS, reconnect and Forget SSH Host Key passed.",
          );
        } finally {
          vscode.window.showWarningMessage = originalWarning;
        }
      }
      assert.deepEqual(serverErrors, [], "Native server commands complete without errors");
      writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, `server-${driver}.passed`), "ok");
      console.log(
        `Native ${driver} form, optional driver installation, SecretStorage reuse and Forget passed.`,
      );
    } finally {
      vscode.window.showQuickPick = originalPick;
      vscode.window.showInputBox = originalInput;
      vscode.window.showOpenDialog = originalOpen;
      vscode.window.showErrorMessage = originalError;
      vscode.window.showInformationMessage = originalInfo;
    }
  }
  if (process.env.DATSUMI_TEST_MONGODB_PORT && process.env.DATSUMI_TEST_REDIS_PORT) {
    const originalPick = vscode.window.showQuickPick,
      originalInput = vscode.window.showInputBox,
      originalOpen = vscode.window.showOpenDialog,
      originalError = vscode.window.showErrorMessage;
    const errors = [];
    try {
      vscode.window.showErrorMessage = async (message) => {
        errors.push(message);
      };
      vscode.window.showOpenDialog = async () => {
        throw new Error("Automatic NoSQL setup must not request driver files");
      };
      for (const engine of ["mongodb", "redis"]) {
        vscode.window.showQuickPick = async (items, options) => {
          const choices = await items;
          if (options?.title === "Add Database Connection")
            return choices.find((item) => item.id === engine);
          if (options?.title === "Connection access") return choices[1];
          if (options?.title === "Store database credentials")
            return choices.find((item) => item.mode === "session");
          return choices[0];
        };
        vscode.window.showInputBox = async (options) =>
          options?.title === "Database connection URL"
            ? engine === "mongodb"
              ? `mongodb://datsumi:Datsumi_Test_Only_2026@127.0.0.1:${process.env.DATSUMI_TEST_MONGODB_PORT}/datsumi?tls=false&authSource=admin`
              : `redis://:Datsumi_Test_Only_2026@127.0.0.1:${process.env.DATSUMI_TEST_REDIS_PORT}/0`
            : "Datsumi_Test_Only_2026";
        const connection = await addConnection({
          driver: engine,
          mode: "url",
          url:
            engine === "mongodb"
              ? `mongodb://127.0.0.1:${process.env.DATSUMI_TEST_MONGODB_PORT}/datsumi?tls=false&authSource=admin`
              : `redis://127.0.0.1:${process.env.DATSUMI_TEST_REDIS_PORT}/0`,
          username: engine === "mongodb" ? "datsumi" : "",
          password: "Datsumi_Test_Only_2026",
          tls: false,
        });
        assert.equal(connection?.driverId, engine, "Native wizard created the selected engine");
        assert.ok(
          !JSON.stringify(connection).includes("Datsumi_Test_Only_2026"),
          "Credentials stay out of the profile",
        );
        const resource = engine === "mongodb" ? "records" : "keys";
        await vscode.commands.executeCommand("datsumi.openTable", {
          connectionId: connection.id,
          resource: { id: resource, label: resource, kind: "collection", hasChildren: false },
        });
        await waitFor(
          () =>
            vscode.window.tabGroups.all.some((group) =>
              group.tabs.some((tab) => tab.label.includes(resource)),
            ),
          "Native data browser opened",
        );
        const queryEditor = await vscode.commands.executeCommand("datsumi.newQuery", {
          connectionId: connection.id,
        });
        assert.equal(queryEditor.document.languageId, "json", "Non-SQL query editor uses JSON");
        await replaceQuery(
          queryEditor,
          engine === "mongodb" ? '{"collection":"records","filter":{}}' : '{"key":"fixture:hash"}',
        );
        await vscode.commands.executeCommand("datsumi.runQuery");
        await vscode.commands.executeCommand("datsumi.removeConnection", {
          connectionId: connection.id,
        });
      }
      assert.deepEqual(errors, [], "Native NoSQL commands succeeded");
      writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "nosql.passed"), "ok");
    } finally {
      vscode.window.showQuickPick = originalPick;
      vscode.window.showInputBox = originalInput;
      vscode.window.showOpenDialog = originalOpen;
      vscode.window.showErrorMessage = originalError;
    }
  }
  if (headless) {
    const originalPick = vscode.window.showQuickPick;
    const originalSave = vscode.window.showSaveDialog;
    const originalError = vscode.window.showErrorMessage;
    const originalOpen = vscode.window.showOpenDialog;
    const reportDescriptor = Object.getOwnPropertyDescriptor(process, "report");
    let duckMode = "Create database";
    const errors = [];
    try {
      Object.defineProperty(process, "report", {
        configurable: true,
        value: { getReport: () => undefined },
      });
      vscode.window.showQuickPick = async (items, options) => {
        const choices = await items;
        if (options?.title === "Add Database Connection")
          return choices.find((item) => item.id === "duckdb");
        return options?.title === "DuckDB" ? duckMode : choices[0];
      };
      const duckPath = join(process.env.DATSUMI_TEST_DIRECTORY, "workspace", "native.duckdb");
      vscode.window.showSaveDialog = async () => vscode.Uri.file(duckPath);
      vscode.window.showErrorMessage = async (message) => {
        errors.push(message);
      };
      const duck = await addConnection({ driver: "duckdb", path: duckPath, create: true });
      assert.equal(duck?.driverId, "duckdb", `Native DuckDB connection: ${errors.join("; ")}`);
      assert.deepEqual(
        duck.configuration,
        { path: duckPath, readOnly: false },
        "No installation paths or creation flags persisted",
      );
      const query = await vscode.commands.executeCommand("datsumi.newQuery", {
        connectionId: duck.id,
      });
      assert.equal(query.document.languageId, "sql");
      await replaceQuery(
        query,
        "CREATE TABLE metrics(id INTEGER PRIMARY KEY, value DECIMAL(20,2)); INSERT INTO metrics VALUES(1,123.45); SELECT * FROM metrics;",
      );
      query.selection = new vscode.Selection(
        query.document.positionAt(0),
        query.document.positionAt(query.document.getText().length),
      );
      await vscode.commands.executeCommand("datsumi.runQuery");
      await replaceQuery(query, "select * from metrics qualify row_number() over ()=1");
      await vscode.commands.executeCommand("datsumi.formatSql");
      assert.match(query.document.getText(), /QUALIFY/, "DuckDB dialect formatter applied");
      const suggestions = await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        query.document.uri,
        new vscode.Position(0, 2),
      );
      assert.ok(
        suggestions.items.some(
          (item) => (typeof item.label === "string" ? item.label : item.label.label) === "SELECT",
        ),
        "DuckDB SQL completion works",
      );
      await vscode.commands.executeCommand("datsumi.openTable", {
        connectionId: duck.id,
        resource: {
          id: JSON.stringify(["main", "metrics"]),
          label: "main.metrics",
          kind: "table",
          hasChildren: true,
        },
      });
      await waitFor(
        () =>
          vscode.window.tabGroups.all.some((group) =>
            group.tabs.some((tab) => tab.label.includes("metrics")),
          ),
        "Native DuckDB table browser opened",
      );
      const manager = resultsProvider.connections;
      const metricsInfo = (await manager.schema(duck.id)).find(
        (item) => item.name === "main.metrics",
      );
      assert.equal(metricsInfo.editable, true, "DuckDB writable keyed tables enable editing");
      const metricsPage = await manager.browse(duck.id, {
        resourceId: metricsInfo.resourceId,
        offset: 0,
        limit: 10,
      });
      const metricsOriginal = Object.fromEntries(
        metricsPage.result.columns.map((name, i) => [name, metricsPage.result.rows[0][i]]),
      );
      const metricsChanges = {
        resourceId: metricsInfo.resourceId,
        changes: [{ kind: "update", original: metricsOriginal, values: { value: "456.78" } }],
      };
      await manager.changeRows(duck.id, metricsChanges, false);
      assert.deepEqual(
        (
          await manager.browse(duck.id, {
            resourceId: metricsInfo.resourceId,
            offset: 0,
            limit: 10,
          })
        ).result.rows,
        metricsPage.result.rows,
        "DuckDB preview does not write",
      );
      await manager.changeRows(duck.id, metricsChanges, true);
      assert.equal(
        (
          await manager.browse(duck.id, {
            resourceId: metricsInfo.resourceId,
            offset: 0,
            limit: 10,
          })
        ).result.rows[0][1],
        "456.78",
        "DuckDB commits reviewed edit",
      );
      await assert.rejects(
        manager.changeRows(
          duck.id,
          {
            resourceId: metricsInfo.resourceId,
            changes: [
              {
                kind: "update",
                original: { ...metricsOriginal, value: "456.78" },
                values: { value: "999" },
              },
              metricsChanges.changes[0],
            ],
          },
          true,
        ),
        /Edit conflict/,
      );
      assert.equal(
        (
          await manager.browse(duck.id, {
            resourceId: metricsInfo.resourceId,
            offset: 0,
            limit: 10,
          })
        ).result.rows[0][1],
        "456.78",
        "DuckDB conflict rolls back every edit in the batch",
      );
      await manager.execute(duck.id, { language: "sql", text: "BEGIN" });
      await assert.rejects(
        manager.changeRows(duck.id, metricsChanges, true),
        /open SQL transaction/,
      );
      await manager.execute(duck.id, { language: "sql", text: "ROLLBACK" });
      await vscode.commands.executeCommand("datsumi.disconnect", { connectionId: duck.id });
      duckMode = "Open existing database";
      vscode.window.showOpenDialog = async () => [vscode.Uri.file(duckPath)];
      const existing = await addConnection({ driver: "duckdb", path: duckPath, create: false });
      assert.equal(
        existing?.id,
        duck.id,
        `Existing DuckDB file opens with no report header: ${errors.join("; ")}`,
      );
      const reopened = await vscode.commands.executeCommand("datsumi.newQuery", {
        connectionId: duck.id,
      });
      await replaceQuery(reopened, "SELECT * FROM metrics");
      await vscode.commands.executeCommand("datsumi.runQuery");
      const duckEntry = (await historyProvider.getChildren()).find(
        (entry) => entry.connectionId === duck.id,
      );
      assert.ok(duckEntry, "DuckDB queries appear in shared sidebar history");
      const duckHistoryItem = historyProvider.getTreeItem(duckEntry);
      assert.match(duckHistoryItem.description, /duckdb/, "History identifies the database engine");
      await vscode.commands.executeCommand(
        duckHistoryItem.command.command,
        ...duckHistoryItem.command.arguments,
      );
      assert.equal(
        vscode.window.activeTextEditor.document.getText(),
        duckEntry.text,
        "DuckDB history opens on its original connection",
      );
      await vscode.commands.executeCommand("datsumi.removeConnection", {
        connectionId: duck.id,
      });
      await vscode.commands.executeCommand("datsumi.openHistory", duckEntry.id);
      assert.equal(
        vscode.window.activeTextEditor.document.getText(),
        duckEntry.text,
        "Removed-connection history remains readable",
      );
      assert.match(
        historyProvider.getTreeItem(duckEntry).label,
        /native.duckdb/,
        "Removed connection keeps its database label",
      );
      let replacementPrompts = 0;
      const previousPick = vscode.window.showQuickPick;
      vscode.window.showQuickPick = async (items, options) => {
        if (options?.title === "Select Database Connection") {
          replacementPrompts++;
          return undefined;
        }
        return previousPick(items, options);
      };
      try {
        await vscode.commands.executeCommand("datsumi.runQuery");
      } finally {
        vscode.window.showQuickPick = previousPick;
      }
      assert.equal(
        replacementPrompts,
        1,
        "Removed-connection history requires an explicit replacement instead of reusing another database",
      );
      assert.deepEqual(errors, [], "DuckDB native commands completed without errors");
      writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "duckdb.passed"), "ok");
      console.log(
        "Native DuckDB automatic download, creation/existing-file opening without a report header, SQL tools, queries, browsing and reconnect passed.",
      );
    } finally {
      vscode.window.showQuickPick = originalPick;
      vscode.window.showSaveDialog = originalSave;
      vscode.window.showErrorMessage = originalError;
      vscode.window.showOpenDialog = originalOpen;
      if (reportDescriptor) Object.defineProperty(process, "report", reportDescriptor);
    }
  }
  if (process.env.DATSUMI_TEST_REMOTE_URL) {
    const previousError = vscode.window.showErrorMessage;
    const previousInput = vscode.window.showInputBox;
    const errors = [];
    let prompts = 0;
    vscode.window.showErrorMessage = async (message) => {
      errors.push(message);
      return undefined;
    };
    vscode.window.showInputBox = async (options) => {
      assert.match(options.title, /Authentication token/);
      prompts++;
      return process.env.DATSUMI_TEST_REMOTE_TOKEN;
    };
    try {
      for (const driver of ["libsql", "turso"]) {
        const connection = await addConnection({
          driver,
          mode: "url",
          name: `${driver} native`,
          url: process.env.DATSUMI_TEST_REMOTE_URL,
          password: process.env.DATSUMI_TEST_REMOTE_TOKEN,
          credentialMode: "save",
        });
        assert.ok(connection?.id, "Native remote SQL form connected");
        assert.ok(
          !JSON.stringify(connection).includes(process.env.DATSUMI_TEST_REMOTE_TOKEN),
          "No token in persisted profile",
        );
        const editor = await vscode.commands.executeCommand("datsumi.newQuery", {
          connectionId: connection.id,
        });
        await replaceQuery(editor, "SELECT 9007199254740993 AS exact_integer;");
        await vscode.commands.executeCommand("datsumi.runQuery");
        await vscode.commands.executeCommand("datsumi.disconnect", {
          connectionId: connection.id,
        });
        await vscode.commands.executeCommand("datsumi.runQuery");
        assert.equal(
          prompts,
          driver === "libsql" ? 0 : 1,
          "Saved token reconnects without another prompt",
        );
        await vscode.commands.executeCommand("datsumi.forgetCredentials", {
          connectionId: connection.id,
        });
        await vscode.commands.executeCommand("datsumi.runQuery");
        assert.equal(prompts, driver === "libsql" ? 1 : 2, "Forget requests a token again");
        const entry = (await historyProvider.getChildren()).find(
          (entry) => entry.connectionId === connection.id,
        );
        assert.ok(entry, "Remote SQL queries appear in connection-aware history");
        await vscode.commands.executeCommand("datsumi.removeConnection", {
          connectionId: connection.id,
        });
      }
      assert.deepEqual(errors, [], "Remote SQL native commands completed without errors");
      writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, "remote.passed"), "ok");
    } finally {
      vscode.window.showErrorMessage = previousError;
      vscode.window.showInputBox = previousInput;
    }
  }
  writeFileSync(join(process.env.DATSUMI_TEST_DIRECTORY, `${phase}.passed`), "ok");
  console.log(`Datsumi native smoke test passed: ${phase}`);
};
