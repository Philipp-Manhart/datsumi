import { clipboardTsv, compareCells, type QueryResult } from "@datsumi/core";
import {
  tableInfoSchema,
  rowChangeSchema,
  queryResultSchema,
  type WebviewResponse,
} from "@datsumi/protocol";

type Sort = NonNullable<WebviewResponse["sort"]>;
type Table = Extract<NonNullable<WebviewResponse["result"]>, { kind: "table" }>;
interface Entry {
  readonly id: string;
  title: string;
  pinned: boolean;
  readonly connectionId: string;
  readonly connectionName: string;
  readonly query: string;
  search: string;
  busy: boolean;
  error: string | null;
  result: WebviewResponse["result"];
  resultBytes: number;
  info?: WebviewResponse["tableInfo"];
  schema?: WebviewResponse["schema"];
  editingReason?: string;
  staged?: WebviewResponse["staged"];
  previewSql?: string[];
  offset: number;
  limit: number;
  sort: Sort | null;
  sortedRows: Table["rows"] | undefined;
}

export function validateResultTitle(title: string): string | undefined {
  if (!title.trim()) return "Enter a name.";
  if (title.trim().length > 80) return "Use 80 characters or fewer.";
  for (let i = 0; i < title.length; i++) {
    if (title.charCodeAt(i) < 32 || title.charCodeAt(i) === 127)
      return "Use a single line without control characters.";
  }
  return undefined;
}

/** Retains bounded snapshots. Navigating them cannot re-execute the original SQL. */
export class QueryResultsStore {
  private readonly entries: Entry[] = [];
  private activeId: string | null = null;
  private sequence = 0;

  constructor(private readonly retainedByteBudget = 128 * 1024 * 1024) {}

  begin(connectionId: string, connectionName: string, query: string, reuse = false): string {
    const current = reuse ? this.find(this.activeId ?? "") : undefined;
    const replace =
      current &&
      current.connectionId === connectionId &&
      !current.pinned &&
      !current.busy &&
      !current.staged?.length
        ? current
        : undefined;
    if (!replace && this.entries.length >= 10)
      throw new Error("Close a result tab before running another query (10 tabs maximum).");
    const number = ++this.sequence;
    const id = `result-${number}`;
    const entry: Entry = {
      id,
      pinned: false,
      title: replace?.title ?? `Query ${number}`,
      connectionId,
      connectionName,
      query: query.trim().slice(0, 2000),
      search: "",
      busy: true,
      error: null,
      result: null,
      resultBytes: 0,
      offset: 0,
      limit: 100,
      sort: null,
      sortedRows: undefined,
    };
    if (replace) this.entries.splice(this.entries.indexOf(replace), 1, entry);
    else this.entries.push(entry);
    this.activeId = id;
    return id;
  }
  complete(id: string, result: QueryResult): void {
    const entry = this.find(id);
    if (!entry) return;
    const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    const retained = this.entries.reduce(
      (total, item) => total + (item === entry ? 0 : item.resultBytes),
      0,
    );
    if (retained + bytes > this.retainedByteBudget) {
      entry.busy = false;
      throw new Error(
        "Retained results exceed the 128 MiB serialized-data budget. Close result tabs or narrow the query. Other result tabs and drafts were kept; the query was not replayed.",
      );
    }
    entry.result = queryResultSchema.parse(result);
    entry.resultBytes = bytes;
    entry.busy = false;
    entry.sortedRows = undefined;
  }
  fail(id: string, message: string): void {
    const entry = this.find(id);
    if (entry) {
      entry.busy = false;
      entry.error = message;
    }
  }
  select(id: string): void {
    if (this.find(id)) this.activeId = id;
  }
  pin(id: string, pinned: boolean): void {
    const entry = this.find(id);
    if (entry) entry.pinned = pinned;
  }
  renameTarget(id = this.activeId ?? ""): { id: string; title: string } | undefined {
    const entry = this.find(id);
    return entry ? { id: entry.id, title: entry.title } : undefined;
  }
  rename(id: string, title: string): boolean {
    const entry = this.find(id);
    const name = title.trim();
    if (!entry || validateResultTitle(title)) return false;
    entry.title = name;
    return true;
  }
  close(id: string): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    this.entries.splice(index, 1);
    if (this.activeId === id)
      this.activeId = this.entries[Math.min(index, this.entries.length - 1)]?.id ?? null;
  }
  clearConnection(connectionId: string): void {
    for (const entry of [...this.entries])
      if (entry.connectionId === connectionId) this.close(entry.id);
  }
  page(id: string, offset: number, limit: number): void {
    const entry = this.find(id);
    if (
      !entry ||
      entry.result?.kind !== "table" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      return;
    const lastOffset = Math.floor(Math.max(0, entry.result.rows.length - 1) / limit) * limit;
    entry.offset = Math.min(offset, lastOffset);
    entry.limit = limit;
  }
  sort(id: string, sort: Sort | null): void {
    const entry = this.find(id);
    if (!entry || entry.result?.kind !== "table") return;
    if (
      sort &&
      (!Number.isInteger(sort.column) ||
        sort.column < 0 ||
        sort.column >= entry.result.columns.length)
    )
      return;
    entry.sort = sort;
    entry.offset = 0;
    entry.sortedRows = sort
      ? entry.result.rows
          .map((row, index) => ({ row, index }))
          .sort(
            (a, b) =>
              compareCells(a.row[sort.column] ?? null, b.row[sort.column] ?? null) *
                (sort.direction === "asc" ? 1 : -1) || a.index - b.index,
          )
          .map((item) => item.row)
      : undefined;
  }
  search(id: string, text: string): void {
    const entry = this.find(id);
    if (entry) {
      entry.search = text;
      entry.offset = 0;
    }
  }
  snapshot(id = this.activeId ?? ""): Table | undefined {
    const entry = this.find(id);
    if (entry?.result?.kind !== "table") return undefined;
    const rows = entry.sortedRows ?? entry.result.rows;
    const search = entry.search.toLocaleLowerCase();
    return {
      ...entry.result,
      rows: search
        ? rows.filter((row) =>
            row.some((value) =>
              (typeof value === "object" ? JSON.stringify(value) : String(value))
                .toLocaleLowerCase()
                .includes(search),
            ),
          )
        : rows,
    };
  }
  /** Copy from the host snapshot, independent of the webview's current page. */
  copy(id: string, columns: readonly number[], headers: boolean, format: "tsv" | "json"): string {
    const entry = this.find(id);
    const table = this.snapshot(id);
    if (!entry || !table || entry.busy)
      throw new Error("The selected result is unavailable or still running.");
    if (table.truncated)
      throw new Error(
        "The complete result exceeds the capture budget (64 MiB for SQL queries). Nothing was copied. Narrow the query or use a database-native export.",
      );
    if (
      !columns.length ||
      new Set(columns).size !== columns.length ||
      columns.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= table.columns.length,
      )
    )
      throw new Error("Invalid clipboard columns.");
    const names = columns.map((index) => table.columns[index]!);
    const rows = table.rows.map((row) => {
      const original = Object.fromEntries(
        table.columns.map((name, index) => [name, row[index] ?? null]),
      );
      const change = entry.staged?.find(
        (item) =>
          item.kind === "update" && JSON.stringify(item.original) === JSON.stringify(original),
      );
      return columns.map((index) =>
        change && table.columns[index]! in change.values
          ? change.values[table.columns[index]!]!
          : (row[index] ?? null),
      );
    });
    const text =
      format === "json"
        ? JSON.stringify({ columns: names, rows }, null, 2)
        : clipboardTsv(names, rows, headers);
    if (new TextEncoder().encode(text).length > 64 * 1024 * 1024)
      throw new Error(
        "The selection exceeds the 64 MiB clipboard budget. Nothing was copied. Narrow the query or export the data.",
      );
    return text;
  }
  hasEdits(connectionId?: string): boolean {
    return this.entries.some(
      (entry) => (!connectionId || entry.connectionId === connectionId) && entry.staged?.length,
    );
  }
  stage(id: string, changes: readonly import("@datsumi/core").RowChange[]): void {
    const entry = this.find(id);
    if (!entry) return;
    if (JSON.stringify(entry.staged ?? []) !== JSON.stringify(changes))
      this.editState(id, changes, []);
  }
  editingContext(
    id: string,
    schema: readonly import("@datsumi/core").TableInfo[],
    info: import("@datsumi/core").TableInfo | undefined,
    reason: string,
  ): void {
    const entry = this.find(id);
    if (!entry) return;
    entry.info = info ? tableInfoSchema.parse(info) : undefined;
    entry.schema = schema.map((table) => tableInfoSchema.parse(table));
    entry.editingReason = reason;
  }
  editTarget(id = this.activeId ?? "") {
    return this.find(id);
  }
  editState(
    id: string,
    changes: readonly import("@datsumi/core").RowChange[],
    previewSql: readonly string[],
  ): void {
    const entry = this.find(id);
    if (entry) {
      entry.staged = changes.map((change) => rowChangeSchema.parse(change));
      entry.previewSql = [...previewSql];
    }
  }
  editingBusy(id: string, busy: boolean): void {
    const entry = this.find(id);
    if (entry) {
      entry.busy = busy;
      entry.error = null;
    }
  }
  state(): WebviewResponse {
    const entry = this.find(this.activeId ?? "");
    const result = entry?.result ?? null;
    const table = result?.kind === "table" ? result : undefined;
    const rows = this.snapshot()?.rows ?? [];
    return {
      type: "results/state",
      protocolVersion: 1,
      title: entry?.title ?? "Query Results",
      connectionName: entry?.connectionName ?? "Run a SQL query to see results here",
      busy: entry?.busy ?? false,
      error: entry?.error ?? null,
      result:
        table && entry
          ? { ...table, rows: rows.slice(entry.offset, entry.offset + entry.limit) }
          : result,
      page:
        table && entry
          ? {
              offset: entry.offset,
              limit: entry.limit,
              hasMore: entry.offset + entry.limit < rows.length,
              totalRows: rows.length,
            }
          : null,
      tableInfo: entry?.info,
      schema: entry?.schema,
      editingReason: entry?.editingReason,
      staged: entry?.staged,
      previewSql: entry?.previewSql,
      search: entry?.search,
      mode: entry?.query.trimStart().toUpperCase().startsWith("EXPLAIN QUERY PLAN")
        ? "plan"
        : undefined,
      activeResultId: entry?.id ?? null,
      sort: entry?.sort ?? null,
      tabs: this.entries.map((item) => ({
        id: item.id,
        title: item.title,
        pinned: item.pinned,
        connectionName: item.connectionName,
        query: item.query,
        busy: item.busy,
        error: item.error !== null,
      })),
    };
  }
  private find(id: string): Entry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }
}
