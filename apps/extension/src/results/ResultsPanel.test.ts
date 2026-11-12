/* oxlint-disable typescript/no-unsafe-type-assertion -- Synthetic VS Code fixtures supply only APIs exercised by this host test. */
import type { TableInfo } from "@datsumi/core";
import { InMemoryDriverRegistry, type DatabaseDriver } from "@datsumi/driver-api";
import { describe, it, expect, vi } from "vitest";
import type { ExtensionContext, Uri, WebviewView } from "vscode";
const mock = vi.hoisted(() => ({
  receive: undefined as ((message: unknown) => void) | undefined,
  states: [] as unknown[],
  clipboard: vi.fn<(text: string) => Promise<void>>(async (_text) => {}),
  error: vi.fn<(text: string) => Promise<undefined>>(async (_text) => undefined),
  confirm: vi.fn<() => Promise<string | undefined>>(async () => "Commit changes"),
}));
vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  env: { clipboard: { writeText: mock.clipboard } },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    cancel() {}
    dispose() {}
  },
  ViewColumn: { Active: 1 },
  ProgressLocation: { Notification: 1 },
  window: {
    showWarningMessage: mock.confirm,
    showErrorMessage: mock.error,
    showInformationMessage: async () => undefined,
    createWebviewPanel: () => ({
      onDidDispose: () => ({ dispose() {} }),
      dispose() {},
      webview: {
        onDidReceiveMessage: (fn: (message: unknown) => void) => {
          mock.receive = fn;
          return { dispose() {} };
        },
        postMessage: (state: unknown) => {
          mock.states.push(state);
          return Promise.resolve(true);
        },
      },
    }),
    withProgress: async (_options: unknown, callback: (p: unknown, t: unknown) => Promise<void>) =>
      callback(
        { report() {} },
        { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
      ),
  },
}));
vi.mock("./webview", () => ({ initializeResultsWebview() {} }));
import { webviewResponseSchema } from "@datsumi/protocol";

import { ConnectionManager } from "../connections/ConnectionManager";
import { QueryResultsViewProvider } from "./QueryResultsViewProvider";
import { ResultsPanel } from "./ResultsPanel";
const info: TableInfo = {
  resourceId: "customers",
  name: "customers",
  kind: "table",
  ddl: "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT)",
  editable: true,
  columns: [
    {
      name: "id",
      type: "INTEGER",
      primaryKey: 1,
      notNull: false,
      defaultValue: null,
      generated: false,
    },
    {
      name: "name",
      type: "TEXT",
      primaryKey: 0,
      notNull: false,
      defaultValue: null,
      generated: false,
    },
  ],
  foreignKeys: [],
  indexes: [],
};
describe("table webview host", () => {
  it("fetches every table page before writing clean TSV, preserving the current page", async () => {
    mock.clipboard.mockClear();
    const rows = Array.from({ length: 1201 }, (_, index) => [index + 1, `Row ${index + 1}`]);
    const browse = vi.fn<
      (id: string, request: { offset: number; limit: number }) => Promise<unknown>
    >(async (_id, request) => ({
      result: {
        kind: "table",
        columns: ["id", "name"],
        rows: rows.slice(request.offset, request.offset + request.limit),
        durationMs: 4,
        columnMetadata: [
          { name: "id", dataType: "INTEGER" },
          { name: "name", dataType: "TEXT" },
        ],
      },
      offset: request.offset,
      limit: request.limit,
      hasMore: request.offset + request.limit < rows.length,
    }));
    const connections = {
      get: () => ({ name: "example.sqlite", driverId: "sqlite", configuration: {} }),
      schema: async () => [info],
      browse,
    } as unknown as ConnectionManager;
    const panel = new ResultsPanel({} as Uri, connections, "db", "customers", "customers");
    await panel.loadPage(100, 100);
    mock.receive?.({ type: "table/copy", columns: [1, 0], headers: true, format: "tsv" });
    await vi.waitFor(() => expect(mock.clipboard).toHaveBeenCalledTimes(1));
    const lines = mock.clipboard.mock.calls[0]![0].split("\r\n");
    expect(lines).toHaveLength(1202);
    expect(lines[0]).toBe("name\tid");
    expect(lines[1]).toBe("Row 1\t1");
    expect(lines.at(-1)).toBe("Row 1201\t1201");
    expect(browse.mock.calls.map((call) => call[1].offset)).toEqual([100, 0, 500, 1000]);
    mock.receive?.({ type: "ready", protocolVersion: 1 });
    expect(webviewResponseSchema.parse(mock.states.at(-1)).page?.offset).toBe(100);
    browse.mockResolvedValueOnce({
      result: { kind: "table", columns: ["id", "name"], rows: [[1, "partial"]], truncated: true },
      hasMore: false,
    });
    mock.receive?.({ type: "table/copy", columns: [0, 1], headers: false, format: "tsv" });
    await vi.waitFor(() =>
      expect(webviewResponseSchema.parse(mock.states.at(-1)).error).toContain("Nothing was copied"),
    );
    expect(mock.clipboard).toHaveBeenCalledTimes(1);

    panel.dispose();
  });
  it("owns the table scope, validates messages and requires an exact reviewed edit batch", async () => {
    mock.states = [];
    const driver = {
      descriptor: {
        id: "sqlite",
        displayName: "SQLite",
        family: "relational",
        supportedQueryLanguages: ["sql"],
        capabilities: ["tables"],
      },
      connect: async () => ({}),
      disconnect: async () => {},
      execute: async () => ({ kind: "value", value: null }),
      schema: async () => [info],
      browseTable: vi.fn<NonNullable<DatabaseDriver["browseTable"]>>(async () => ({
        result: { kind: "table" as const, columns: ["id", "name"], rows: [[1, "Alex"]] },
        offset: 0,
        limit: 100,
        hasMore: false,
      })),
      changeRows: vi.fn<NonNullable<DatabaseDriver["changeRows"]>>(async () => [
        "UPDATE customers SET name='New' WHERE id=1;",
      ]),
    } satisfies DatabaseDriver;
    const registry = new InMemoryDriverRegistry();
    registry.register(driver);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture supplies only the storage API used by ConnectionManager.
    const context = {
      workspaceState: { get: () => [], update: async () => {} },
    } as unknown as ExtensionContext;
    const connections = new ConnectionManager(context, registry);
    const profile = await connections.addSqlite("/tmp/test.db", false);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Webview asset initialization is mocked and does not read the URI.
    const panel = new ResultsPanel(
      {} as Uri,
      connections,
      profile.id,
      "customers",
      info.resourceId,
    );
    await panel.loadPage();
    const changes = [
      { kind: "update", original: { id: 1, name: "Alex" }, values: { name: "New" } },
    ];
    mock.receive?.({ type: "table/changes", changes, apply: true });
    await vi.waitFor(() =>
      expect(mock.states.at(-1)).toMatchObject({
        error: "Review the current changes before applying them.",
      }),
    );
    expect(driver.changeRows).not.toHaveBeenCalled();
    mock.receive?.({ type: "table/changes", changes, apply: false });
    await vi.waitFor(() =>
      expect(mock.states.at(-1)).toMatchObject({
        busy: false,
        staged: changes,
        previewSql: [expect.any(String)],
      }),
    );
    expect(driver.changeRows).toHaveBeenLastCalledWith(
      expect.anything(),
      { resourceId: "customers", changes },
      false,
      expect.anything(),
    );
    mock.receive?.({ type: "table/changes", changes, apply: true });
    await vi.waitFor(() =>
      expect(driver.changeRows).toHaveBeenLastCalledWith(
        expect.anything(),
        { resourceId: "customers", changes },
        true,
        expect.anything(),
      ),
    );
    await vi.waitFor(() => expect(driver.browseTable).toHaveBeenCalledTimes(2));
    mock.receive?.({
      type: "table/filter",
      filters: [{ column: "name", operator: "=", value: "Alex" }],
      order: { column: "id", direction: "desc" },
    });
    await vi.waitFor(() => expect(driver.browseTable).toHaveBeenCalledTimes(3));
    expect(driver.browseTable).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceId: "customers",
        filters: [{ column: "name", operator: "=", value: "Alex" }],
      }),
      expect.anything(),
    );
    mock.receive?.({ type: "table/page", offset: -1, limit: 500 });
    expect(driver.browseTable).toHaveBeenCalledTimes(3);
    panel.dispose();
    await connections.dispose();
  });
});

describe("editable query-result host", () => {
  it("reviews a batch, cancels safely, confirms once, and refreshes only committed rows", async () => {
    mock.states = [];
    mock.confirm.mockClear();
    let rows: (string | number)[][] = [
      [1, "Alex"],
      [2, "Sam"],
    ];
    const table = () => ({
      kind: "table" as const,
      columns: ["id", "name"],
      columnMetadata: ["id", "name"].map((name) => ({
        name,
        sourceColumn: name,
        table: "customers",
        database: "main",
        dataType: "TEXT",
      })),
      rows: rows.map((row) => [...row]),
    });
    const execute = vi.fn<DatabaseDriver["execute"]>(async (_session, request) =>
      request.parameters
        ? { ...table(), rows: table().rows.filter((row) => row[0] === request.parameters?.key0) }
        : table(),
    );
    const changeRows = vi.fn<NonNullable<DatabaseDriver["changeRows"]>>(
      async (_session, request, apply) => {
        if (apply)
          rows = rows.map((row) => {
            const change = request.changes.find((item) => item.original?.id === row[0]);
            return change
              ? [change.values.id ?? row[0], change.values.name ?? row[1]].map((value) =>
                  typeof value === "number" || typeof value === "string"
                    ? value
                    : JSON.stringify(value),
                )
              : row;
          });
        return request.changes.map(() => "UPDATE customers SET name='new' WHERE id=?;");
      },
    );
    const driver = {
      descriptor: {
        id: "sqlite",
        displayName: "SQLite",
        family: "relational",
        supportedQueryLanguages: ["sql"],
        capabilities: ["query"],
      },
      connect: async () => ({}),
      disconnect: async () => {},
      execute,
      schema: async () => [info],
      changeRows,
    } satisfies DatabaseDriver;
    const registry = new InMemoryDriverRegistry();
    registry.register(driver);
    const context = {
      workspaceState: { get: () => [], update: async () => {} },
    } as unknown as ExtensionContext;
    const manager = new ConnectionManager(context, registry);
    const profile = await manager.addSqlite("/tmp/capture.db", false);
    const provider = new QueryResultsViewProvider({} as Uri, manager);
    provider.resolveWebviewView({
      title: "",
      show() {},
      onDidDispose: () => ({ dispose() {} }),
      webview: {
        onDidReceiveMessage: (callback: (message: unknown) => void) => {
          mock.receive = callback;
          return { dispose() {} };
        },
        postMessage: (state: unknown) => {
          mock.states.push(state);
          return Promise.resolve(true);
        },
      },
    } as unknown as WebviewView);
    await provider.execute(profile.id, "SELECT * FROM customers");
    const latest = () => webviewResponseSchema.parse(mock.states.at(-1));
    expect(latest().tableInfo?.editable).toBe(true);
    const resultId = latest().activeResultId!;
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ captureAll: true }),
      expect.anything(),
    );
    mock.clipboard.mockClear();
    const executions = execute.mock.calls.length;
    mock.receive?.({ type: "query/copy", resultId, columns: [0, 1], headers: true, format: "tsv" });
    await vi.waitFor(() =>
      expect(mock.clipboard).toHaveBeenCalledWith("id\tname\r\n1\tAlex\r\n2\tSam"),
    );
    expect(execute).toHaveBeenCalledTimes(executions);
    mock.clipboard.mockClear();
    mock.receive?.({
      type: "query/copy",
      resultId: "missing",
      columns: [0],
      headers: false,
      format: "tsv",
    });
    await vi.waitFor(() =>
      expect(mock.error).toHaveBeenCalledWith(expect.stringContaining("unavailable")),
    );
    expect(mock.clipboard).not.toHaveBeenCalled();
    const changes = [
      { kind: "update", original: { id: 1, name: "Alex" }, values: { name: "First" } },
      { kind: "update", original: { id: 2, name: "Sam" }, values: { name: "Second" } },
    ];
    mock.receive?.({ type: "table/changes", resultId, changes, apply: false });
    await vi.waitFor(() =>
      expect(latest()).toMatchObject({
        busy: false,
        staged: changes,
        previewSql: [expect.any(String), expect.any(String)],
      }),
    );
    mock.confirm.mockResolvedValueOnce(undefined);
    mock.receive?.({ type: "table/changes", resultId, changes, apply: true });
    await vi.waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(latest().busy).toBe(false));
    expect(changeRows).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      [1, "Alex"],
      [2, "Sam"],
    ]);
    mock.confirm.mockResolvedValueOnce("Commit changes");
    mock.receive?.({ type: "table/changes", resultId, changes, apply: true });
    await vi.waitFor(() =>
      expect(latest()).toMatchObject({
        busy: false,
        staged: [],
        result: {
          rows: [
            [1, "First"],
            [2, "Second"],
          ],
        },
      }),
    );
    expect(changeRows).toHaveBeenLastCalledWith(
      expect.anything(),
      { resourceId: "customers", changes },
      true,
      undefined,
    );
    expect(
      execute.mock.calls.filter(([, request]) => request.text === "SELECT * FROM customers"),
    ).toHaveLength(1);
    const calls = changeRows.mock.calls.length;
    mock.receive?.({
      type: "table/changes",
      resultId,
      changes: [
        { kind: "update", original: { id: 99, name: "not captured" }, values: { name: "bad" } },
      ],
      apply: false,
    });
    await vi.waitFor(() => expect(latest().error).toContain("original rows"));
    expect(changeRows).toHaveBeenCalledTimes(calls);
    provider.dispose();
    await manager.dispose();
  });
});
