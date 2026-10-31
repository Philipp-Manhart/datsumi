import * as vscode from "vscode";

import type { ConnectionManager } from "../connections/ConnectionManager";
import { sqlContext, sqlSuggestions, functionCall, type SqlTable } from "./completion";
import { completionBudget } from "./completionBudget";
import { dialectFunctions } from "./dialects";
import { formatSql } from "./format";
import { joinSuggestions } from "./joins";
import { SchemaCache } from "./SchemaCache";

export class SqlLanguageFeatures
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider,
    vscode.CompletionItemProvider,
    vscode.SignatureHelpProvider
{
  private readonly schema: SchemaCache;
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("datsumi-sql");
  dispose(): void {
    this.diagnostics.dispose();
  }
  diagnose(editor: vscode.TextEditor, text: string, error?: string): void {
    if (!error) {
      this.diagnostics.delete(editor.document.uri);
      return;
    }
    const full = editor.document.getText();
    const start = Math.max(
      0,
      full.lastIndexOf(text, editor.document.offsetAt(editor.selection.active)),
    );
    const position = /SQL position (\d+)/.exec(error);
    const near = /(?:near|at or near)\s+["']([^"']+)["']/.exec(error);
    const line = /SQL line (\d+)/.exec(error);
    const offset = position
      ? Number(position[1]) - 1
      : near
        ? Math.max(0, text.indexOf(near[1]!))
        : line
          ? text
              .split("\n")
              .slice(0, Number(line[1]) - 1)
              .join("\n").length
          : 0;
    const begin = editor.document.positionAt(start + offset);
    this.diagnostics.set(editor.document.uri, [
      new vscode.Diagnostic(
        new vscode.Range(
          begin,
          editor.document.positionAt(start + offset + Math.max(1, near?.[1]?.length ?? 1)),
        ),
        error,
        vscode.DiagnosticSeverity.Error,
      ),
    ]);
  }
  constructor(
    private readonly connections: ConnectionManager,
    private readonly selectedConnection: (document: vscode.TextDocument) => string | undefined,
  ) {
    this.schema = new SchemaCache((id, parent) => connections.resources(id, parent));
  }
  private connection(document: vscode.TextDocument) {
    const id = this.selectedConnection(document);
    return this.connections.all().find((profile) => profile.id === id);
  }
  invalidate(connectionId?: string): void {
    this.schema.invalidate(connectionId);
  }
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
  ): vscode.TextEdit[] {
    return this.provideDocumentRangeFormattingEdits(
      document,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      options,
    );
  }
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
  ): vscode.TextEdit[] {
    const text = document.getText(range);
    const formatted = formatSql(
      text,
      options,
      document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
      this.connections.all().find((profile) => profile.id === this.selectedConnection(document))
        ?.driverId ?? "sqlite",
    );
    return formatted === text ? [] : [vscode.TextEdit.replace(range, formatted)];
  }
  async formatEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "sql")
      throw new Error("Open a SQL editor to format.");
    const options = {
      tabSize: typeof editor.options.tabSize === "number" ? editor.options.tabSize : 4,
      insertSpaces: editor.options.insertSpaces !== false,
    };
    const edits = editor.selection.isEmpty
      ? this.provideDocumentFormattingEdits(editor.document, options)
      : this.provideDocumentRangeFormattingEdits(editor.document, editor.selection, options);
    if (edits.length)
      if (
        !(await editor.edit((builder) => {
          for (const edit of edits) builder.replace(edit.range, edit.newText);
        }))
      )
        throw new Error(
          "SQL formatting could not be applied because the editor changed. Try formatting again.",
        );
  }
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionList> {
    const text = document.getText();
    const context = sqlContext(text, document.offsetAt(position));
    if (context.suppressed || token.isCancellationRequested) return new vscode.CompletionList([]);
    const connection = this.connection(document);
    const connectionId = connection?.id;
    let tables: readonly SqlTable[] = [];
    let relations: readonly import("@datsumi/core").TableInfo[] = [];
    let incomplete = false;
    if (connectionId && (context.expectsTable || context.qualifier || context.tables.length > 0)) {
      const result = await completionBudget(
        Promise.all([
          this.schema
            .get(connectionId, [
              ...context.tables,
              ...(context.qualifier ? [context.qualifier] : []),
            ])
            .catch(() => []),
          context.expectsTable && context.lastClause === "JOIN"
            ? this.connections.schema(connectionId).catch(() => [])
            : Promise.resolve([]),
        ]),
        [[], []],
        token,
      );
      [tables, relations] = result.value;
      incomplete = result.incomplete;
    }
    if (token.isCancellationRequested) return new vscode.CompletionList([]);
    const start = document.positionAt(context.start);
    if (start.line !== position.line) return new vscode.CompletionList([]);
    const end = document.positionAt(context.end);
    const range = new vscode.Range(
      start,
      end.line === position.line ? end : document.lineAt(position.line).range.end,
    );
    const dialect = connection?.driverId ?? "sqlite";
    const joins =
      connectionId && context.expectsTable && context.lastClause === "JOIN"
        ? joinSuggestions(context, relations, dialect)
        : [];
    const items = [...joins, ...sqlSuggestions(context, tables, dialect)].map((suggestion) => {
      const kind =
        suggestion.kind === "table"
          ? vscode.CompletionItemKind.Class
          : suggestion.kind === "view"
            ? vscode.CompletionItemKind.Interface
            : suggestion.kind === "alias"
              ? vscode.CompletionItemKind.Variable
              : suggestion.kind === "column"
                ? vscode.CompletionItemKind.Field
                : suggestion.kind === "function"
                  ? vscode.CompletionItemKind.Function
                  : vscode.CompletionItemKind.Keyword;
      const item = new vscode.CompletionItem(suggestion.label, kind);
      item.detail = suggestion.detail;
      if (suggestion.documentation) item.documentation = suggestion.documentation;
      item.range = range;
      item.filterText = (context.quoted ? text[context.start] : "") + suggestion.label;
      item.sortText = `${suggestion.priority ?? (suggestion.kind === "column" || suggestion.kind === "table" || suggestion.kind === "view" ? "0" : suggestion.kind === "function" ? "1" : "2")}:${suggestion.label}`;
      const driver = dialect;
      item.insertText = suggestion.insertText;
      if ((driver === "mysql" || driver === "mariadb") && typeof item.insertText === "string")
        item.insertText = item.insertText.replace(
          /"((?:[^"]|"")*)"/g,
          (_match, name: string) => "`" + name.replaceAll('""', '"').replaceAll("`", "``") + "`",
        );
      if (suggestion.kind === "alias")
        item.command = { command: "editor.action.triggerSuggest", title: "Suggest columns" };
      if (suggestion.kind === "function" && !text.slice(context.end).trimStart().startsWith("(")) {
        const snippet = new vscode.SnippetString().appendText(`${suggestion.insertText}(`);
        const required = (suggestion.parameters ?? []).filter(
          (parameter) => !parameter.includes("(optional)") && parameter !== "...",
        );
        required.forEach((parameter, index) => {
          if (index) snippet.appendText(", ");
          snippet.appendPlaceholder(suggestion.label === "COUNT" ? "*" : parameter);
        });
        snippet.appendText(")");
        item.insertText = snippet;
        item.command = {
          command: "editor.action.triggerParameterHints",
          title: "Show SQL function parameters",
        };
      }
      return item;
    });
    return new vscode.CompletionList(items, incomplete);
  }
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position, /[\w$]+/);
    const id = this.selectedConnection(document);
    if (!range || !id) return;
    const name = document.getText(range).toLowerCase();
    const context = sqlContext(document.getText(), document.offsetAt(position));
    const tables = await this.schema.get(id, [...context.tables, name]).catch(() => []);
    const lines = tables.flatMap((table) => {
      if (table.name.toLowerCase() === name || table.baseName?.toLowerCase() === name)
        return [
          `${table.kind} ${table.name}`,
          ...table.columns.map((c) => `${c.name} ${c.detail ?? ""}`),
        ];
      return table.columns
        .filter((c) => c.name.toLowerCase() === name)
        .map((c) => `${table.name}.${c.name} ${c.detail ?? ""}`);
    });
    if (lines.length)
      return new vscode.Hover(
        new vscode.MarkdownString().appendCodeblock(lines.join("\n"), "sql"),
        range,
      );
  }
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Definition | undefined> {
    const id = this.selectedConnection(document),
      range = document.getWordRangeAtPosition(position, /[\w$]+/);
    if (!id || !range) return;
    const name = document.getText(range).toLowerCase();
    const context = sqlContext(document.getText(), document.offsetAt(position));
    const schema = await this.connections.schema(id).catch(() => []);
    const candidates = schema.filter(
      (t) =>
        t.name.toLowerCase() === name ||
        t.name.toLowerCase().endsWith("." + name) ||
        (context.tables.some(
          (n) =>
            t.name.toLowerCase() === n.toLowerCase() ||
            t.name.toLowerCase().endsWith("." + n.toLowerCase()),
        ) &&
          t.columns.some((c) => c.name.toLowerCase() === name)),
    );
    return candidates.map(
      (table) =>
        new vscode.Location(
          vscode.Uri.from({
            scheme: "datsumi-schema",
            path: `/${encodeURIComponent(table.name)}.sql`,
            query: new URLSearchParams({ connection: id, resource: table.resourceId }).toString(),
          }),
          new vscode.Position(0, 0),
        ),
    );
  }
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const schema = await this.connections.schema(params.get("connection") ?? "");
    const table = schema.find((t) => t.resourceId === params.get("resource"));
    return table
      ? `${table.ddl}\n\n-- Columns\n${table.columns.map((c) => `-- ${c.name} ${c.type}${c.primaryKey ? " PRIMARY KEY" : ""}`).join("\n")}`
      : "-- Table no longer exists";
  }
  provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.SignatureHelp | undefined {
    const dialect = this.connection(document)?.driverId ?? "sqlite";
    const call = functionCall(document.getText(), document.offsetAt(position), dialect);
    const fn = dialectFunctions(dialect).find((candidate) => candidate.name === call?.name);
    if (!call || !fn) return undefined;
    const signature = new vscode.SignatureInformation(
      `${fn.name}(${fn.parameters.join(", ")})`,
      fn.description,
    );
    signature.parameters = fn.parameters.map(
      (parameter) => new vscode.ParameterInformation(parameter),
    );
    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;
    help.activeParameter = Math.min(call.parameter, Math.max(0, fn.parameters.length - 1));
    return help;
  }
}
