/* oxlint-disable typescript/no-unsafe-type-assertion -- These fixtures implement only the native APIs exercised by completion and formatting. */
import type { ConnectionProfile } from "@datsumi/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import type { ConnectionManager } from "../connections/ConnectionManager";
const native = vi.hoisted(() => ({ editor: undefined as vscode.TextEditor | undefined }));
vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  languages: { createDiagnosticCollection: () => ({ dispose() {} }) },
  window: {
    get activeTextEditor() {
      return native.editor;
    },
  },
  EndOfLine: { CRLF: 2 },
  Range: class {
    constructor(
      readonly start: unknown,
      readonly end: unknown,
    ) {}
  },
  TextEdit: { replace: (range: unknown, newText: string) => ({ range, newText }) },
  CompletionList: class {
    constructor(
      readonly items: unknown[],
      readonly isIncomplete = false,
    ) {}
  },
  CompletionItem: class {
    constructor(
      readonly label: string,
      readonly kind: number,
    ) {}
  },
  CompletionItemKind: { Class: 1, Interface: 2, Variable: 3, Field: 4, Function: 5, Keyword: 6 },
}));
import { SqlLanguageFeatures } from "./SqlLanguageFeatures";

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;
const profile: ConnectionProfile = {
  id: "db",
  name: "test",
  driverId: "sqlite",
  family: "relational",
  configuration: {},
};
const document = (text: string) =>
  ({
    languageId: "sql",
    eol: 1,
    getText: () => text,
    offsetAt: (position: vscode.Position) => position.character,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
    lineAt: () => ({ range: { end: { line: 0, character: text.length } } }),
  }) as unknown as vscode.TextDocument;
afterEach(() => {
  vi.useRealTimers();
  native.editor = undefined;
});
describe("native SQL editor providers", () => {
  it("keeps keyword suggestions working when an editor refers to a removed connection", async () => {
    const connections = {
      all: () => [],
      resources: async () => [],
    } as unknown as ConnectionManager;
    const provider = new SqlLanguageFeatures(connections, () => "removed");
    const result = await provider.provideCompletionItems(
      document("se"),
      { line: 0, character: 2 } as vscode.Position,
      token,
    );
    expect(result.items.map((item) => item.label)).toContain("SELECT");
    expect(result.isIncomplete).toBe(false);
    provider.dispose();
  });
  it("returns WHERE while schema is slow, then offers tables once metadata is ready", async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => {
      complete = resolve;
    });
    const connections = {
      all: () => [profile],
      resources: () => pending,
    } as unknown as ConnectionManager;
    const provider = new SqlLanguageFeatures(connections, () => "db");
    const sql = "SELECT * FROM customers wh";
    const request = provider.provideCompletionItems(
      document(sql),
      { line: 0, character: sql.length } as vscode.Position,
      token,
    );
    await vi.advanceTimersByTimeAsync(600);
    const result = await request;
    expect(result.items.map((item) => item.label)).toContain("WHERE");
    expect(result.isIncomplete).toBe(true);
    complete([{ id: "customers", label: "customers", kind: "table", hasChildren: true }]);
    const next = "SELECT * FROM cu";
    const refreshed = await provider.provideCompletionItems(
      document(next),
      { line: 0, character: next.length } as vscode.Position,
      token,
    );
    expect(refreshed.items.map((item) => item.label)).toContain("customers");
    expect(refreshed.isIncomplete).toBe(false);
    provider.dispose();
  });
  it("escapes MySQL column names once, preserving embedded quote characters", async () => {
    const connections = {
      all: () => [{ ...profile, driverId: "mysql" }],
      resources: async (_id: string, parent?: string) =>
        parent
          ? [{ id: "column", label: 'weird"column', kind: "column", hasChildren: false }]
          : [{ id: "customers", label: "customers", kind: "table", hasChildren: true }],
    } as unknown as ConnectionManager;
    const provider = new SqlLanguageFeatures(connections, () => "db");
    const text = "SELECT c.we FROM customers c";
    const result = await provider.provideCompletionItems(
      document(text),
      { line: 0, character: "SELECT c.we".length } as vscode.Position,
      token,
    );
    expect(result.items.find((item) => item.label === 'weird"column')?.insertText).toBe(
      '`weird"column`',
    );
    provider.dispose();
  });
  it("formats through our command without depending on another default formatter and reports rejected edits", async () => {
    const provider = new SqlLanguageFeatures(
      { all: () => [] } as unknown as ConnectionManager,
      () => undefined,
    );
    const applied: { range: unknown; text: string }[] = [];
    const edit = vi.fn<vscode.TextEditor["edit"]>(async (callback) => {
      callback({
        replace: (range: unknown, text: string) => applied.push({ range, text }),
      } as unknown as vscode.TextEditorEdit);
      return true;
    });
    native.editor = {
      document: document("select id,name from customers;"),
      options: { tabSize: 2, insertSpaces: true },
      selection: { isEmpty: true },
      edit,
    } as unknown as vscode.TextEditor;
    await provider.formatEditor();
    expect(applied[0]?.text).toContain("SELECT\n  id,");
    edit.mockResolvedValueOnce(false);
    await expect(provider.formatEditor()).rejects.toThrow("editor changed");
    provider.dispose();
  });
});
