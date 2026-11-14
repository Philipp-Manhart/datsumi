import { beforeEach, expect, it, vi } from "vitest";
const { pick, copy, save, config } = vi.hoisted(() => ({
  pick: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  save: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  copy: vi.fn<(text: string) => Promise<void>>(),
  config: { enabled: true, disabled: [] as string[], overrides: {} as Record<string, unknown> },
}));
vi.mock("vscode", () => ({
  EventEmitter: class {
    listeners = new Set<() => void>();
    event = (listener: () => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire() {
      for (const listener of this.listeners) listener();
    }
    dispose() {
      this.listeners.clear();
    }
  },
  TreeItemCollapsibleState: { None: 0 },
  TreeItem: class {
    constructor(
      public label: string,
      public collapsibleState: number,
    ) {}
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  MarkdownString: class {
    value = "";
    isTrusted = false;
    appendText(text: string) {
      this.value += text;
      return this;
    }
    appendCodeblock(text: string) {
      this.value += "\n" + text;
      return this;
    }
  },
  workspace: {
    getConfiguration: () => ({
      inspect: (key: string) => ({ globalValue: config.overrides[key] }),
      get: (key: string, fallback: unknown) =>
        key in config.overrides
          ? config.overrides[key]
          : key === "history.enabled"
            ? config.enabled
            : key === "history.disabledConnections"
              ? config.disabled
              : fallback,
    }),
  },
  window: {
    showSaveDialog: save,
    showQuickPick: pick,
    showWarningMessage: vi.fn<(text: string) => void>(),
  },
  env: { clipboard: { writeText: copy } },
}));
import type { ExtensionContext } from "vscode";

import { QueryHistoryTreeProvider } from "../views/history/QueryHistoryTreeProvider";
import { QueryHistory } from "./QueryHistory";
function fixture() {
  const values = new Map<string, unknown>();
  const update = vi.fn<(key: string, value: unknown) => Promise<void>>(
    async (key: string, value: unknown) => {
      values.set(key, value);
    },
  );
  const context = {
    workspaceState: {
      get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
      update,
    },
  } as unknown as ExtensionContext;
  return { history: new QueryHistory(context), update, context };
}
beforeEach(() => {
  pick.mockReset();
  copy.mockReset();
  config.enabled = true;
  config.disabled = [];
  config.overrides = {};
});
it("records counts/status, favorites entries, and restores without executing", async () => {
  const { history, update, context } = fixture();
  history.record("db", "select 1", 12, undefined, { rows: 1 });
  pick
    .mockResolvedValueOnce("All queries")
    .mockImplementationOnce(async (items) => (items as { entry: unknown }[])[0])
    .mockResolvedValueOnce("Favorite");
  await history.pick("db", true);
  expect(update).toHaveBeenLastCalledWith(
    "datsumi.history",
    expect.arrayContaining([
      expect.objectContaining({ text: "select 1", pinned: true, rows: 1, status: "success" }),
    ]),
  );
  const restored = new QueryHistory(context);
  pick
    .mockResolvedValueOnce("Favorites")
    .mockImplementationOnce(async (items) => (items as unknown[])[0])
    .mockResolvedValueOnce("Open in editor");
  expect(await restored.pick("db", true)).toBe("select 1");
});
it("honors per-connection opt-out and serializes clear after pending records", async () => {
  const { history, update } = fixture();
  config.disabled = ["private"];
  history.record("private", "secret query", 1);
  expect(update).not.toHaveBeenCalled();
  history.record("db", "select 1", 1);
  await history.clear();
  expect(update).toHaveBeenLastCalledWith("datsumi.history", []);
});

it("shows a live chronological sidebar across databases and preserves metadata after removal", async () => {
  const { context } = fixture();
  const profiles = new Map([
    ["sqlite", { connectionName: "Local app", driverId: "sqlite", database: "app.sqlite" }],
    ["duck", { connectionName: "Analytics", driverId: "duckdb", database: "playground.duckdb" }],
  ]);
  const history = new QueryHistory(context, (id) => profiles.get(id));
  const provider = new QueryHistoryTreeProvider(history, (id) => profiles.has(id));
  const changed = vi.fn<() => void>();
  provider.onDidChangeTreeData(changed);
  history.record("sqlite", "SELECT 1", 2, undefined, { rows: 1 });
  history.record("duck", "SELECT * FROM missing", 7, "Not found", { status: "error" });
  const entries = provider.getChildren();
  expect(entries.map((entry) => entry.connectionId)).toEqual(["duck", "sqlite"]);
  const item = provider.getTreeItem(entries[0]!);
  expect(item.label).toContain("Analytics / playground.duckdb");
  expect(item.description).toContain("duckdb");
  expect(item.command).toEqual({
    command: "datsumi.openHistory",
    title: "Open Query",
    arguments: [entries[0]!.id],
  });
  expect(item.tooltip).toMatchObject({
    isTrusted: false,
    value: expect.stringContaining("Not found"),
  });
  expect(changed).toHaveBeenCalledTimes(2);
  await history.toggleFavorite(entries[0]!.id);
  profiles.delete("duck");
  const restored = new QueryHistory(context, (id) => profiles.get(id));
  expect(restored.connectionInfo(restored.all()[0]!)).toEqual({
    connectionName: "Analytics",
    driverId: "duckdb",
    database: "playground.duckdb",
  });
  expect(provider.getTreeItem(history.all()[0]!).tooltip).toMatchObject({
    value: expect.stringContaining("Original connection removed"),
  });
  expect(provider.getChildren(entries[0])).toEqual([]);
  await history.remove(entries[0]!.id);
  expect(provider.getChildren()).toHaveLength(1);
  await history.clear();
  expect(provider.getChildren()).toEqual([]);
  provider.dispose();
  history.dispose();
  restored.dispose();
});
it("searches history across databases and returns its original connection", async () => {
  const { history } = fixture();
  history.record("first", "SELECT 1", 1);
  history.record("second", "SELECT 2", 2);
  pick.mockImplementationOnce(async (items) => (items as { entry: unknown }[])[0]);
  expect(await history.pickEntry()).toMatchObject({ connectionId: "second", text: "SELECT 2" });
});

it("adds database labels to retained entries from earlier releases", async () => {
  const { history, context } = fixture();
  history.record("legacy", "SELECT 1", 1);
  await history.toggleFavorite(history.all()[0]!.id);
  const info = { connectionName: "Legacy analytics", driverId: "duckdb", database: "old.duckdb" };
  const profiles = new Map([["legacy", info]]);
  const restored = new QueryHistory(context, (id) => profiles.get(id));
  profiles.delete("legacy");
  expect(restored.connectionInfo(restored.all()[0]!)).toEqual(info);
  history.dispose();
  restored.dispose();
});

it("expires persisted history and enforces a byte budget, including favorites", async () => {
  config.overrides = { "history.retentionDays": 1, "history.maxStorageMiB": 1 };
  const { context } = fixture();
  await context.workspaceState.update("datsumi.history", [
    {
      id: "old",
      connectionId: "db",
      text: "old secret",
      timestamp: Date.now() - 2 * 86400000,
      durationMs: 1,
      pinned: true,
    },
  ]);
  const history = new QueryHistory(context);
  expect(history.all()).toEqual([]);
  for (let i = 0; i < 20; i++) history.record("db", "x".repeat(100000), 1);
  expect(Buffer.byteLength(JSON.stringify(history.all()))).toBeLessThanOrEqual(1024 * 1024);
});
it("does not retain production query text unless explicitly enabled", () => {
  const { context } = fixture();
  const history = new QueryHistory(context, () => ({
    connectionName: "Production",
    driverId: "postgres",
    environment: "production",
  }));
  history.record("db", "sensitive query", 1);
  expect(history.all()).toEqual([]);
  config.overrides["history.recordProduction"] = true;
  history.record("db", "explicitly opted in", 1);
  expect(history.all()).toHaveLength(1);
});

it("history Save as file validates database destinations instead of writing through workspace.fs", async () => {
  const { context } = fixture();
  const guard = vi.fn<(path: string) => Promise<void>>(async (_path) => {
    throw new Error("Protected database");
  });
  const history = new QueryHistory(context, undefined, guard);
  history.record("db", "SELECT 1", 1);
  pick
    .mockResolvedValueOnce("All queries")
    .mockImplementationOnce(async (items) => (items as { entry: unknown }[])[0])
    .mockResolvedValueOnce("Save as file");
  save.mockResolvedValueOnce({ scheme: "file", fsPath: "/tmp/datsumi-protected-history.sql" });
  await expect(history.pick("db", true)).rejects.toThrow("Protected database");
  expect(guard).toHaveBeenCalledOnce();
});
