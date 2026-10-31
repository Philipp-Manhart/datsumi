import { openSync, closeSync, writeSync, statSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type {
  CellValue,
  CellRequest,
  TableInfo,
  TableChanges,
  TableExport,
  TableFilter,
  DatabaseResource,
  QueryRequest,
  QueryResult,
  TablePage,
  TablePageRequest,
} from "@datsumi/core";

export interface SqliteConfiguration {
  readonly path: string;
  readonly readOnly: boolean;
}

export function parseConfiguration(value: unknown): SqliteConfiguration {
  if (
    !value ||
    typeof value !== "object" ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    !value.path
  ) {
    throw new Error("A SQLite file path is required.");
  }
  if ("readOnly" in value && typeof value.readOnly !== "boolean")
    throw new Error("readOnly must be a boolean.");
  return { path: value.path, readOnly: "readOnly" in value && value.readOnly === true };
}

function cell(value: unknown, complete = false): CellValue {
  if (value === null) return null;
  if (typeof value === "bigint")
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : { type: "integer", value: value.toString() };
  if (value instanceof Uint8Array)
    return {
      type: "blob",
      hex: Buffer.from(complete ? value : value.subarray(0, 256)).toString("hex"),
      bytes: value.byteLength,
    };
  if (typeof value === "string")
    return !complete && value.length > 16384
      ? { type: "text", value: value.slice(0, 16384), length: value.length }
      : value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : { type: "float", value: String(value) };
  throw new Error("Unsupported SQLite result value.");
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function resourceId(kind: string, name: string): string {
  return JSON.stringify([kind, name]);
}

export class SqliteDatabase {
  transactionState(): import("@datsumi/core").TransactionState {
    return this.db.isTransaction ? "open" : "idle";
  }
  private readonly db: DatabaseSync;
  private readonly readOnly: boolean;
  private readonly path: string;

  constructor(configuration: SqliteConfiguration) {
    this.readOnly = configuration.readOnly;
    this.path = configuration.path;
    // Opening a saved/moved path must never silently create a different database.
    if (!statSync(configuration.path).isFile())
      throw new Error("Select an existing SQLite database file.");
    this.db = new DatabaseSync(configuration.path, {
      readOnly: configuration.readOnly,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      this.db.exec("PRAGMA busy_timeout = 3000");
      this.db.prepare("SELECT name FROM sqlite_schema LIMIT 1").all();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  execute(request: QueryRequest, rowLimit = 10000): QueryResult {
    if (request.language !== "sql") throw new Error("SQLite only supports SQL.");
    if (!request.text.trim()) throw new Error("Enter a SQL statement to run.");
    const start = performance.now();
    const statement = this.db.prepare(request.text);
    const tail = request.text
      .slice(statement.sourceSQL.length)
      .replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (tail)
      throw new Error("Run one SQL statement at a time. Select the statement you want to execute.");
    statement.setReadBigInts(true);
    const parameters = Object.fromEntries(
      Object.entries(request.parameters ?? {}).map(([key, value]): [string, SQLInputValue] => {
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "integer" &&
          "value" in value &&
          typeof value.value === "string" &&
          /^-?\d+$/.test(value.value)
        )
          return [key, BigInt(value.value)];
        if (value !== null && typeof value !== "string" && typeof value !== "number")
          throw new Error(`Unsupported parameter: ${key}`);
        return [key, value];
      }),
    );
    const columns = statement.columns();
    if (!columns.length) {
      const result = statement.run(parameters);
      return {
        kind: "value",
        value: {
          changes: cell(result.changes),
          lastInsertRowid: cell(result.lastInsertRowid),
          durationMs: Math.round(performance.now() - start),
        },
      };
    }
    // Array mode preserves duplicate column names in joins and expressions.
    statement.setReturnArrays(true);
    const rows: CellValue[][] = [];
    let truncated = false;
    let bytes = 0;
    for (const row of statement.iterate(parameters)) {
      if (!request.captureAll && rows.length === rowLimit) {
        truncated = true;
        break;
      }
      if (!Array.isArray(row))
        throw new Error("SQLite array results are unavailable in this runtime.");
      const values = row.map((value) => cell(value, request.captureAll));
      bytes += Buffer.byteLength(JSON.stringify(values), "utf8");
      if (bytes > (request.captureAll ? 64 : 4) * 1024 * 1024) {
        truncated = true;
        break;
      }
      rows.push(values);
    }
    return {
      kind: "table",
      columns: columns.map((c) => c.name),
      columnMetadata: columns.map((c) => ({
        name: c.name,
        sourceColumn: c.column,
        dataType: c.type,
        table: c.table,
        database: c.database,
      })),
      rows,
      truncated,
      durationMs: Math.round(performance.now() - start),
    };
  }

  listResources(parentId?: string): readonly DatabaseResource[] {
    if (parentId === undefined) {
      const rows = this.db
        .prepare(
          "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
        )
        .all();
      return rows.map((row) => ({
        id: resourceId(String(row.type), String(row.name)),
        label: String(row.name),
        kind: row.type === "view" ? "view" : "table",
        hasChildren: true,
      }));
    }
    const table = this.resolveTable(parentId);
    return this.db
      .prepare("SELECT * FROM pragma_table_xinfo(?) ORDER BY cid")
      .all(table)
      .map((row) => ({
        id: JSON.stringify([parentId, row.cid]),
        parentId,
        label: String(row.name),
        kind: "column",
        hasChildren: false,
        description: [String(row.type || "ANY"), row.pk ? "PK" : "", row.notnull ? "NOT NULL" : ""]
          .filter(Boolean)
          .join(" · "),
      }));
  }

  browseTable(request: TablePageRequest): TablePage {
    if (
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 500
    )
      throw new Error("Invalid page bounds.");
    const table = this.resolveTable(request.resourceId);
    const { text, parameters } = this.selectTable(table, request);
    const result = this.execute(
      {
        language: "sql",
        text: `${text} LIMIT $limit OFFSET $offset`,
        parameters: { ...parameters, limit: request.limit + 1, offset: request.offset },
      },
      request.limit + 1,
    );
    if (result.kind !== "table") throw new Error("Expected table rows.");
    return {
      result: {
        ...result,
        rows: result.rows.slice(0, request.limit),
        truncated: result.truncated ?? false,
      },
      offset: request.offset,
      limit: request.limit,
      hasMore: result.rows.length > request.limit || result.truncated === true,
    };
  }

  schema(): readonly TableInfo[] {
    return this.listResources().map((resource) => {
      const name = resource.label;
      const columns = this.db
        .prepare("SELECT * FROM pragma_table_xinfo(?) ORDER BY cid")
        .all(name)
        .filter((row) => row.hidden !== 1)
        .map((row) => ({
          name: String(row.name),
          type: String(row.type || "ANY"),
          primaryKey: Number(row.pk),
          notNull: Boolean(row.notnull),
          defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
          generated: Number(row.hidden) > 1,
        }));
      const keys = this.db
        .prepare("SELECT * FROM pragma_foreign_key_list(?) ORDER BY id, seq")
        .all(name);
      const foreignKeys = [...new Set(keys.map((row) => Number(row.id)))].map((id) => {
        const parts = keys.filter((row) => Number(row.id) === id);
        const first = parts[0]!;
        const target = String(first.table);
        const targetPK = this.db
          .prepare("SELECT name FROM pragma_table_xinfo(?) WHERE pk > 0 ORDER BY pk")
          .all(target);
        return {
          id,
          target,
          columns: parts.map((row) => String(row.from)),
          targetColumns: parts.map((row, i) => String(row.to ?? targetPK[i]?.name ?? "")),
          onUpdate: String(first.on_update),
          onDelete: String(first.on_delete),
        };
      });
      const indexes = this.db
        .prepare("SELECT * FROM pragma_index_list(?)")
        .all(name)
        .map((row) => ({
          name: String(row.name),
          unique: Boolean(row.unique),
          columns: this.db
            .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
            .all(String(row.name))
            .map((col) => String(col.name ?? "(expression)")),
          ddl: String(
            this.db
              .prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?")
              .get(String(row.name))?.sql ?? "",
          ),
        }));
      return {
        resourceId: resource.id,
        name,
        kind: resource.kind === "view" ? ("view" as const) : ("table" as const),
        columns,
        foreignKeys,
        indexes,
        ddl: String(
          this.db
            .prepare("SELECT sql FROM sqlite_schema WHERE name=? AND type IN ('table','view')")
            .get(name)?.sql ?? "",
        ),
        editable:
          !this.readOnly && resource.kind === "table" && columns.some((col) => col.primaryKey > 0),
      };
    });
  }

  private selectTable(
    table: string,
    request: TablePageRequest,
  ): { text: string; parameters: Record<string, string | number | null> } {
    const info = this.db
      .prepare("SELECT name, pk FROM pragma_table_xinfo(?) WHERE hidden != 1 ORDER BY cid")
      .all(table);
    const names = new Set(info.map((row) => String(row.name)));
    const parameters: Record<string, string | number | null> = {};
    const conditions = (request.filters ?? []).map((filter: TableFilter, index) => {
      if (!names.has(filter.column)) throw new Error("Unknown filter column.");
      const column = quote(filter.column);
      if (filter.operator === "IS NULL" || filter.operator === "IS NOT NULL")
        return `${column} ${filter.operator}`;
      if (!["=", "<>", "<", ">", "<=", ">=", "contains"].includes(filter.operator))
        throw new Error("Invalid filter operator.");
      const value = filter.value;
      if (value !== null && typeof value !== "string" && typeof value !== "number")
        throw new Error("Filter values must be text, number, or NULL.");
      parameters[`f${index}`] = value;
      return filter.operator === "contains"
        ? `instr(CAST(${column} AS TEXT), $f${index}) > 0`
        : `${column} ${filter.operator === "=" && value === null ? "IS" : filter.operator === "<>" && value === null ? "IS NOT" : filter.operator} $f${index}`;
    });
    const keys = info
      .filter((row) => Number(row.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((row) => String(row.name));
    const order = keys.length ? keys : [...names];
    if (request.order) {
      if (!names.has(request.order.column) || !["asc", "desc"].includes(request.order.direction))
        throw new Error("Invalid sort column or direction.");
    }
    const ordering = request.order
      ? [
          `${quote(request.order.column)} ${request.order.direction}`,
          ...order.filter((name) => name !== request.order?.column).map(quote),
        ]
      : order.map(quote);
    return {
      text: `SELECT * FROM ${quote(table)}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}${ordering.length ? ` ORDER BY ${ordering.join(", ")}` : ""}`,
      parameters,
    };
  }

  changeRows(request: TableChanges, apply: boolean): readonly string[] {
    const info = this.schema().find((table) => table.resourceId === request.resourceId);
    if (!info?.editable) throw new Error("Editing requires a writable table with a primary key.");
    if (!request.changes.length || request.changes.length > 1000)
      throw new Error("Apply between 1 and 1,000 row changes at a time.");
    const names = new Set(info.columns.map((column) => column.name));
    const writable = new Set(
      info.columns.filter((column) => !column.generated).map((column) => column.name),
    );
    const input = (value: CellValue): SQLInputValue => {
      if (value === null || typeof value === "string" || typeof value === "number") return value;
      if (typeof value === "boolean") return Number(value);
      if (value.type === "integer") return BigInt(value.value);
      if (value.type === "blob" && value.hex.length === value.bytes * 2)
        return Buffer.from(value.hex, "hex");
      throw new Error(
        "Rows containing truncated text/blob values cannot be edited. Use SQL instead.",
      );
    };
    const literal = (value: SQLInputValue): string =>
      value === null
        ? "NULL"
        : typeof value === "string"
          ? `'${value.replaceAll("'", "''")}'`
          : value instanceof Uint8Array
            ? `X'${Buffer.from(value).toString("hex")}'`
            : typeof value === "bigint" || typeof value === "number"
              ? String(value)
              : "NULL";
    const statements = request.changes.map((change) => {
      const entries = Object.entries(change.values);
      if (entries.some(([name]) => !writable.has(name)))
        throw new Error("Unknown or generated column.");
      const args: SQLInputValue[] = entries.map(([, value]) => input(value));
      let text: string;
      if (change.kind === "insert")
        text = entries.length
          ? `INSERT INTO ${quote(info.name)} (${entries.map(([name]) => quote(name)).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`
          : `INSERT INTO ${quote(info.name)} DEFAULT VALUES`;
      else {
        const original = change.original;
        if (
          !original ||
          Object.keys(original).length !== names.size ||
          [...names].some((name) => !(name in original))
        )
          throw new Error("A complete original row is required to detect conflicts.");
        if (info.columns.filter((col) => col.primaryKey).some((col) => original[col.name] === null))
          throw new Error("Rows with NULL primary keys cannot be edited safely.");
        const oldEntries = Object.entries(original);
        if (change.kind === "update" && !entries.length) throw new Error("No changed values.");
        if (change.kind !== "update" && change.kind !== "delete")
          throw new Error("Invalid row change.");
        text =
          change.kind === "delete"
            ? `DELETE FROM ${quote(info.name)}`
            : `UPDATE ${quote(info.name)} SET ${entries.map(([name]) => `${quote(name)} = ?`).join(", ")}`;
        if (change.kind === "delete") args.length = 0;
        text += ` WHERE ${oldEntries.map(([name]) => `${quote(name)} IS ? COLLATE BINARY`).join(" AND ")}`;
        args.push(...oldEntries.map(([, value]) => input(value)));
      }
      let index = 0;
      // Values are substituted only for review, never used to execute the SQL.
      const preview =
        text.replace(/"(?:[^"]|"")*"|\?/g, (token) =>
          token === "?" ? literal(args[index++]!) : token,
        ) + ";";
      return { text, args, preview, kind: change.kind };
    });
    if (apply) {
      this.db.exec("SAVEPOINT datsumi_local_edit");
      try {
        for (const statement of statements) {
          const outcome = this.db.prepare(statement.text).run(...statement.args);
          if (statement.kind !== "insert" && Number(outcome.changes) !== 1)
            throw new Error(
              "Conflict: a row changed or was deleted. Discard changes and refresh; nothing in this batch was applied.",
            );
        }
        this.db.exec("RELEASE datsumi_local_edit");
      } catch (error) {
        this.db.exec("ROLLBACK TO datsumi_local_edit; RELEASE datsumi_local_edit");
        throw error;
      }
    }
    return statements.map((statement) => statement.preview);
  }

  readCell(request: CellRequest): string {
    const info = this.schema().find((table) => table.resourceId === request.resourceId);
    if (!info || !info.columns.some((column) => column.name === request.column))
      throw new Error("Unknown cell.");
    const keys = info.columns.filter((column) => column.primaryKey > 0);
    if (!keys.length)
      throw new Error("Reading a complete value requires a table with a primary key.");
    const values = keys.map((key) => {
      const value = request.key[key.name];
      if (value === undefined || value === null)
        throw new Error("A non-NULL primary key is required.");
      if (typeof value === "string" || typeof value === "number") return value;
      if (typeof value === "object" && value.type === "integer") return BigInt(value.value);
      throw new Error("Unsupported primary key value.");
    });
    const statement = this.db.prepare(
      `SELECT ${quote(request.column)} AS value FROM ${quote(info.name)} WHERE ${keys.map((key) => `${quote(key.name)} IS ?`).join(" AND ")}`,
    );
    statement.setReadBigInts(true);
    const row = statement.get(...values);
    if (!row) throw new Error("The row no longer exists. Refresh the table.");
    const value = row.value;
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > 8 * 1024 * 1024)
        throw new Error("Value exceeds 8 MiB. Use full-table export.");
      return value;
    }
    if (value instanceof Uint8Array) {
      if (value.byteLength > 4 * 1024 * 1024)
        throw new Error("Binary value exceeds 4 MiB. Use full-table export.");
      return Buffer.from(value).toString("hex");
    }
    return value === null ? "NULL" : String(value);
  }

  exportTable(request: TableExport): number {
    const source = statSync(this.path);
    try {
      const destination = statSync(request.path);
      if (source.dev === destination.dev && source.ino === destination.ino)
        throw new Error("Cannot overwrite the connected SQLite database.");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const table = this.resolveTable(request.request.resourceId);
    const query = this.selectTable(table, request.request);
    const statement = this.db.prepare(query.text);
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    const columns = statement.columns().map((column) => column.name);
    const fd = openSync(request.path, "w");
    let count = 0;
    const csv = (value: unknown): string =>
      '"' +
      (value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : typeof value === "string"
            ? value
            : (JSON.stringify(value) ?? "")
      ).replaceAll('"', '""') +
      '"';
    const raw = (value: unknown): unknown =>
      typeof value === "bigint"
        ? value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
          ? Number(value)
          : value.toString()
        : value instanceof Uint8Array
          ? { type: "blob", hex: Buffer.from(value).toString("hex"), bytes: value.byteLength }
          : value;
    try {
      writeSync(fd, request.format === "csv" ? columns.map(csv).join(",") + "\r\n" : "[\n");
      for (const row of statement.iterate(query.parameters)) {
        if (!Array.isArray(row)) throw new Error("Expected array results.");
        const values = row.map(raw);
        writeSync(
          fd,
          request.format === "csv"
            ? values
                .map((value) =>
                  csv(typeof value === "object" && value !== null ? JSON.stringify(value) : value),
                )
                .join(",") + "\r\n"
            : (count ? ",\n" : "") +
                JSON.stringify(
                  Object.fromEntries(columns.map((name, index) => [name, values[index]])),
                ),
        );
        count++;
      }
      if (request.format === "json") writeSync(fd, "\n]\n");
    } finally {
      closeSync(fd);
    }
    return count;
  }

  private resolveTable(id: string): string {
    const match = this.listResources().find((resource) => resource.id === id);
    if (!match) throw new Error("This table or view no longer exists. Refresh the connection.");
    return match.label;
  }

  close(): void {
    this.db.close();
  }
}
