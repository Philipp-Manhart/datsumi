/* oxlint-disable no-await-in-loop -- SQL mutations and export writes must remain ordered on one session/file. */
import { open, rm } from "node:fs/promises";

import { spreadsheetText } from "@datsumi/core";
import type {
  CellRequest,
  CellValue,
  DatabaseResource,
  ForeignKey,
  QueryRequest,
  QueryResult,
  RowChange,
  TableChanges,
  TableExport,
  TableInfo,
  TablePage,
  TablePageRequest,
} from "@datsumi/core";

import type { Backend, RawResult } from "./backend";
import { catalogQueries } from "./catalog";
import type { ServerConfiguration, ServerDriver } from "./configuration";
import {
  input,
  parameter,
  parseResource,
  qualifiedName,
  quoteName,
  resourceId,
  whereFilters,
} from "./dialect";
type RecordRow = Record<string, string | number | boolean | null>;
function scalar(value: CellValue | undefined): string | number | boolean | null {
  if (value && typeof value === "object") {
    if (value.type === "integer") return value.value;
    throw new Error("Unsupported or shortened schema metadata value.");
  }
  return value ?? null;
}
export class ServerDatabase {
  constructor(
    readonly driver: ServerDriver | "duckdb",
    private readonly backend: Backend,
    private readonly config: Pick<ServerConfiguration, "database" | "readOnly">,
  ) {}
  async transactionState(): Promise<import("@datsumi/core").TransactionState> {
    return this.backend.transactionState
      ? this.backend.transactionState()
      : (await this.backend.inTransaction())
        ? "open"
        : "idle";
  }
  close(): Promise<void> {
    return this.backend.close();
  }
  private async raw(text: string, values: readonly unknown[] = []): Promise<RawResult> {
    const result = (await this.backend.run(text, values))[0];
    if (!result) return { columns: [], rows: [], affected: 0, truncated: false };
    return result;
  }
  private async records(text: string): Promise<RecordRow[]> {
    const result = await this.raw(text);
    if (result.truncated)
      throw new Error(
        "Schema metadata exceeds the supported capture limit. Use a more restricted database account.",
      );
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((col, i) => [col.name.toLowerCase(), scalar(row[i])])),
    );
  }
  async execute(request: QueryRequest): Promise<QueryResult> {
    if (request.language !== "sql" || !request.text.trim())
      throw new Error("Enter a SQL statement.");
    if (Object.keys(request.parameters ?? {}).length)
      throw new Error("Named query parameters are not supported for server editor queries.");
    const start = performance.now();
    const results = await this.backend.run(request.text, [], request.captureAll);
    const tables = results.filter((result) => result.columns.length);
    if (!tables.length)
      return {
        kind: "value",
        value: {
          changes: results.reduce((sum, result) => sum + result.affected, 0),
          durationMs: Math.round(performance.now() - start),
        },
      };
    const result = tables[0]!;
    return {
      kind: "table",
      columns: result.columns.map((col) => col.name),
      columnMetadata: result.columns,
      rows: result.rows,
      truncated: result.truncated,
      durationMs: Math.round(performance.now() - start),
      additionalResults: tables.slice(1).map((item) => ({
        columns: item.columns.map((col) => col.name),
        columnMetadata: item.columns,
        rows: item.rows,
        truncated: item.truncated,
      })),
    };
  }
  async schema(): Promise<TableInfo[]> {
    const queries = catalogQueries(this.driver);
    // A backend connection is sequential, including metadata requests.
    const tables = await this.records(queries.tables),
      columns = await this.records(queries.columns),
      keys = await this.records(queries.keys),
      foreign = await this.records(queries.foreign),
      indexes = await this.records(queries.indexes);
    return tables.map((table) => {
      const schema = String(table.schemaname),
        name = String(table.tablename);
      const match = (row: RecordRow) => row.schemaname === schema && row.tablename === name;
      const cols = columns.filter(match).map((col) => ({
        name: String(col.columnname),
        type: String(col.typename),
        primaryKey: Number(
          keys.find((key) => match(key) && key.columnname === col.columnname)?.position ?? 0,
        ),
        notNull: Boolean(Number(col.notnull)),
        defaultValue: col.defaultvalue === null ? null : String(col.defaultvalue),
        generated: Boolean(Number(col.isgenerated)),
      }));
      const relations = new Map<
        string,
        Omit<ForeignKey, "columns" | "targetColumns"> & {
          columns: string[];
          targetColumns: string[];
        }
      >();
      for (const row of foreign.filter(match)) {
        const key = String(row.constraintname),
          existing = relations.get(key);
        if (existing) {
          existing.columns.push(String(row.columnname));
          existing.targetColumns.push(String(row.targetcolumn));
        } else
          relations.set(key, {
            id: relations.size,
            target: `${row.targetschema}.${row.targettable}`,
            columns: [String(row.columnname)],
            targetColumns: [String(row.targetcolumn)],
            onDelete: String(row.ondelete),
            onUpdate: String(row.onupdate),
          });
      }
      const ix = new Map<
        string,
        { name: string; unique: boolean; columns: string[]; ddl: string }
      >();
      for (const row of indexes.filter(match)) {
        const key = String(row.indexname),
          existing = ix.get(key);
        if (existing) {
          if (row.columnname) existing.columns.push(String(row.columnname));
        } else
          ix.set(key, {
            name: key,
            unique: row.isunique === true || Number(row.isunique) === 1,
            columns: row.columnname ? [String(row.columnname)] : [],
            ddl: row.ddl ? String(row.ddl) : "",
          });
      }
      return {
        resourceId: resourceId(schema, name),
        name: `${schema}.${name}`,
        schema,
        database: this.config.database,
        driverId: this.driver,
        kind: table.kind === "view" ? "view" : "table",
        columns: cols,
        foreignKeys: [...relations.values()],
        indexes: [...ix.values()],
        editable:
          this.driver !== "clickhouse" &&
          !this.config.readOnly &&
          table.kind !== "view" &&
          cols.some((col) => col.primaryKey > 0) &&
          (!table.engine || String(table.engine).toLowerCase() === "innodb"),
        ddl: table.ddl
          ? String(table.ddl)
          : `-- Structure summary; inspect server migrations for authoritative DDL.\n${table.kind === "view" ? "-- VIEW " : "CREATE TABLE "}${qualifiedName(this.driver, name, schema)} (\n${cols.map((col) => `  ${quoteName(this.driver, col.name)} ${col.type}${col.notNull ? " NOT NULL" : ""}${col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ""}`).join(",\n")}\n)`,
      };
    });
  }
  async resources(parent?: string): Promise<DatabaseResource[]> {
    const schema = await this.schema();
    if (!parent)
      return schema.map((table) => ({
        id: table.resourceId,
        schema: table.schema,
        label: table.name,
        kind: table.kind,
        hasChildren: true,
        description: this.config.database,
      }));
    const table = schema.find((item) => item.resourceId === parent);
    return (
      table?.columns.map((col) => ({
        id: `${parent}:${col.name}`,
        parentId: parent,
        label: col.name,
        kind: "column",
        hasChildren: false,
        description: `${col.type}${col.primaryKey ? " · PK" : ""}`,
      })) ?? []
    );
  }
  private async table(id: string): Promise<TableInfo> {
    parseResource(id);
    const info = (await this.schema()).find((table) => table.resourceId === id);
    if (!info) throw new Error("Table is unavailable or permission was denied.");
    return info;
  }
  private target(info: TableInfo): string {
    const { name, schema } = parseResource(info.resourceId);
    return qualifiedName(this.driver, name, schema);
  }
  private columnExpression(column: TableInfo["columns"][number]): string {
    const name = quoteName(this.driver, column.name);
    if (this.driver === "mssql" && /^(?:decimal|numeric|money|smallmoney)$/i.test(column.type))
      return `CONVERT(VARCHAR(100), ${name})`;
    if (this.driver === "oracle" && /^(?:DATE|TIMESTAMP)/i.test(column.type)) {
      const date = /^DATE$/i.test(column.type);
      const zoned = /TIME ZONE/i.test(column.type);
      const expression = zoned ? `CAST(${name} AS TIMESTAMP(9) WITH TIME ZONE)` : name;
      return `TO_CHAR(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS${date ? "" : ".FF9"}${zoned ? "TZH:TZM" : ""}')`;
    }
    return name;
  }
  private selectColumn(column: TableInfo["columns"][number]): string {
    const name = quoteName(this.driver, column.name);
    const expression = this.columnExpression(column);
    return expression === name ? name : `${expression} AS ${name}`;
  }
  async browse(request: TablePageRequest): Promise<TablePage> {
    if (
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 500
    )
      throw new Error("Invalid page bounds.");
    const info = await this.table(request.resourceId),
      values: unknown[] = [];
    const where = whereFilters(this.driver, info, request.filters ?? [], values);
    if (
      request.order &&
      (!info.columns.some((col) => col.name === request.order?.column) ||
        !["asc", "desc"].includes(request.order.direction))
    )
      throw new Error("Invalid sort column or direction.");
    const ordered = request.order
      ? `${quoteName(this.driver, request.order.column)} ${request.order.direction.toUpperCase()}`
      : info.columns
          .filter((col) => col.primaryKey)
          .sort((a, b) => a.primaryKey - b.primaryKey)
          .map((col) => quoteName(this.driver, col.name))
          .join(", ") ||
        (this.driver === "oracle"
          ? "NULL"
          : this.driver === "clickhouse"
            ? info.columns
                .filter((col) => !/blob|clob|json|array|map|struct|binary/i.test(col.type))
                .slice(0, 1)
                .map((col) => quoteName(this.driver, col.name))
                .join(", ") || "NULL"
            : "(SELECT NULL)");
    const paging =
      this.driver === "mssql" || this.driver === "oracle"
        ? `OFFSET ${request.offset} ROWS FETCH NEXT ${request.limit + 1} ROWS ONLY`
        : `LIMIT ${request.limit + 1} OFFSET ${request.offset}`;
    const result = await this.raw(
      `SELECT ${info.columns.map((col) => this.selectColumn(col)).join(", ")} FROM ${this.target(info)}${where ? ` WHERE ${where}` : ""} ORDER BY ${ordered} ${paging}`,
      values,
    );
    const hasMore = result.rows.length > request.limit || result.truncated;
    return {
      result: {
        kind: "table",
        columns: result.columns.map((col) => col.name),
        columnMetadata: result.columns,
        rows: result.rows.slice(0, request.limit),
        truncated: result.truncated,
      },
      offset: request.offset,
      limit: request.limit,
      hasMore,
    };
  }
  private predicate(
    info: TableInfo,
    original: Readonly<Record<string, CellValue>>,
    values: unknown[],
  ): string {
    const keys = info.columns.filter((col) => col.primaryKey > 0);
    if (
      !keys.length ||
      keys.some((col) => original[col.name] === undefined || original[col.name] === null)
    )
      throw new Error("A complete non-null primary key is required.");
    return info.columns
      .filter((col) => original[col.name] !== undefined)
      .map((col) => {
        const value = original[col.name]!;
        if (value === null) return `${quoteName(this.driver, col.name)} IS NULL`;
        const mark = parameter(this.driver, values.length);
        values.push(input(value));
        // JSON/spatial/LOB values may not be comparable. Fail safely rather than weaken checks.
        const identifier = quoteName(this.driver, col.name);
        if (typeof value === "string" && /char|text|enum|set/i.test(col.type)) {
          if (this.driver === "mysql" || this.driver === "mariadb")
            return `BINARY ${identifier} = BINARY ${mark}`;
          if (this.driver === "mssql")
            return `CONVERT(VARBINARY(MAX), CONVERT(NVARCHAR(MAX), ${identifier})) = CONVERT(VARBINARY(MAX), CONVERT(NVARCHAR(MAX), ${mark}))`;
        }
        if (this.driver === "oracle") {
          if (/^(?:N?CLOB)$/i.test(col.type))
            return `DBMS_LOB.COMPARE(${identifier}, ${/^NCLOB$/i.test(col.type) ? "TO_NCLOB" : "TO_CLOB"}(${mark})) = 0`;
          if (/^(?:DATE|TIMESTAMP)/i.test(col.type))
            return `${this.columnExpression(col)} = ${mark}`;
        }
        return `${identifier} = ${mark}`;
      })
      .join(" AND ");
  }
  private writeValue(column: TableInfo["columns"][number], mark: string, value: CellValue): string {
    if (this.driver !== "oracle" || value === null || typeof value !== "string") return mark;
    if (/^DATE$/i.test(column.type)) return `TO_DATE(${mark}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    if (/^TIMESTAMP/i.test(column.type))
      return /TIME ZONE/i.test(column.type)
        ? `TO_TIMESTAMP_TZ(${mark}, 'YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM')`
        : `TO_TIMESTAMP(${mark}, 'YYYY-MM-DD"T"HH24:MI:SS.FF9')`;
    return mark;
  }
  private change(info: TableInfo, change: RowChange): { text: string; values: unknown[] } {
    const entries = Object.entries(change.values),
      values: unknown[] = [];
    if (entries.some(([name]) => !info.columns.some((col) => col.name === name && !col.generated)))
      throw new Error("Unknown or generated columns cannot be changed.");
    if (change.kind === "insert") {
      const names = entries.map(([name]) => quoteName(this.driver, name));
      const marks = entries.map(([name, value]) => {
        const mark = parameter(this.driver, values.length);
        values.push(input(value));
        return this.writeValue(
          info.columns.find((col) => col.name === name)!,
          mark,
          value,
        );
      });
      return {
        text: names.length
          ? `INSERT INTO ${this.target(info)} (${names.join(", ")}) VALUES (${marks.join(", ")})`
          : this.driver === "mysql" || this.driver === "mariadb"
            ? `INSERT INTO ${this.target(info)} () VALUES ()`
            : `INSERT INTO ${this.target(info)} DEFAULT VALUES`,
        values,
      };
    }
    if (!change.original || info.columns.some((col) => change.original?.[col.name] === undefined))
      throw new Error("Original values for every column are required for conflict detection.");
    const set = entries
      .map(([name, value]) => {
        const mark = parameter(this.driver, values.length);
        values.push(input(value));
        const column = info.columns.find((col) => col.name === name)!;
        return `${quoteName(this.driver, name)} = ${this.writeValue(column, mark, value)}`;
      })
      .join(", ");
    const where = this.predicate(info, change.original, values);
    if (change.kind === "update" && !set) throw new Error("No values to update.");
    return {
      text:
        change.kind === "delete"
          ? `DELETE FROM ${this.target(info)} WHERE ${where}`
          : `UPDATE ${this.target(info)} SET ${set} WHERE ${where}`,
      values,
    };
  }
  private async verifyEditTarget(info: TableInfo, lock: boolean): Promise<void> {
    if (!["mysql", "mariadb"].includes(this.driver)) return;
    // A temporary table shadows even schema-qualified names. Lock the resolved target
    // before inspecting it so another session cannot change its engine during a batch.
    if (lock)
      await this.raw(
        `SELECT ${info.columns
          .filter((col) => col.primaryKey)
          .map((col) => quoteName(this.driver, col.name))
          .join(", ")} FROM ${this.target(info)} WHERE 1=0 FOR UPDATE`,
      );
    const ddl = await this.raw(`SHOW CREATE TABLE ${this.target(info)}`);
    const index = ddl.columns.findIndex((col) => /create table/i.test(col.name));
    const text = ddl.rows[0]?.[index];
    const { schema, name } = parseResource(info.resourceId);
    // Read authoritative engine data again after acquiring the metadata lock.
    // Never infer ENGINE from DDL text: comments/default strings are user-controlled.
    const engine = await this.raw(
      "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
      [schema, name],
    );
    const actualEngine = engine.rows[0]?.[0];
    if (
      typeof text !== "string" ||
      !/^CREATE TABLE\s/i.test(text) ||
      engine.rows.length !== 1 ||
      typeof actualEngine !== "string" ||
      actualEngine.toLowerCase() !== "innodb"
    )
      throw new Error(
        "Grid editing requires a verified permanent InnoDB table. A temporary or nontransactional table may shadow this name. No row changes were sent; remove the temporary table or reconnect.",
      );
  }
  async changes(request: TableChanges, apply: boolean): Promise<string[]> {
    const info = await this.table(request.resourceId);
    if (this.driver === "clickhouse")
      throw new Error(
        "ClickHouse grid edits are unavailable: this adapter cannot roll back an edit batch. No changes were sent.",
      );
    if (!info.editable)
      throw new Error("Editing requires a writable transactional table with a primary key.");
    if (!request.changes.length || request.changes.length > 1000)
      throw new Error("Stage between 1 and 1000 row changes.");
    const jobs = request.changes.map((change) => this.change(info, change));
    // Preview contains placeholders; secrets and literal data do not enter SQL logs.
    const preview = jobs.map((job) => `${job.text}; -- ${job.values.length} bound values`);
    if (!apply) {
      await this.verifyEditTarget(info, false);
      return preview;
    }
    const nested = await this.backend.inTransaction();
    if (nested && ["duckdb", "libsql", "turso"].includes(this.driver))
      throw new Error(
        "Commit or roll back the open SQL transaction before applying staged edits. Your draft is retained; this adapter cannot isolate a nested edit batch with savepoints.",
      );
    // Oracle begins a transaction with its first DML statement, not BEGIN (PL/SQL).
    if (!nested) {
      if (this.driver !== "oracle")
        await this.raw(this.driver === "mssql" ? "BEGIN TRANSACTION" : "BEGIN");
    } else
      await this.raw(
        this.driver === "mssql" ? "SAVE TRANSACTION datsumi_batch" : "SAVEPOINT datsumi_batch",
      );
    try {
      await this.verifyEditTarget(info, true);
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!,
          result = await this.raw(job.text, job.values);
        if (result.affected !== 1)
          throw new Error(
            "Edit conflict: the row changed or is no longer uniquely identifiable. The batch was rolled back; your draft is retained.",
          );
      }
      if (!nested) await this.raw("COMMIT");
      else if (!["mssql", "oracle"].includes(this.driver))
        await this.raw("RELEASE SAVEPOINT datsumi_batch");
    } catch (error) {
      try {
        await this.raw(
          nested
            ? this.driver === "mssql"
              ? "ROLLBACK TRANSACTION datsumi_batch"
              : this.driver === "oracle"
                ? "ROLLBACK TO datsumi_batch"
                : "ROLLBACK TO SAVEPOINT datsumi_batch"
            : "ROLLBACK",
        );
      } catch {
        await this.backend.close();
        throw new Error(
          "Batch failed and the session was closed because rollback could not be confirmed. Reconnect and verify database state.",
        );
      }
      throw error;
    }
    return preview;
  }
  async readCell(request: CellRequest): Promise<string> {
    const info = await this.table(request.resourceId);
    if (!info.columns.some((col) => col.name === request.column))
      throw new Error("Unknown column.");
    const values: unknown[] = [],
      where = this.predicate(info, request.key, values);
    if (this.driver === "oracle") {
      const result = (
        await this.backend.run(
          `SELECT ${this.selectColumn(info.columns.find((column) => column.name === request.column)!)} FROM ${this.target(info)} WHERE ${where}`,
          values,
          true,
        )
      )[0];
      if (!result || result.truncated || result.rows.length !== 1)
        throw new Error("The selected row is unavailable or exceeds capture limits.");
      const value = result.rows[0]?.[0];
      const text =
        value === null
          ? "NULL"
          : value && typeof value === "object"
            ? value.type === "blob"
              ? value.hex
              : value.value
            : String(value ?? "");
      if (Buffer.byteLength(text) > 8 * 1024 * 1024)
        throw new Error("Full value exceeds the 8 MiB editor limit.");
      return text;
    }
    const column = info.columns.find((col) => col.name === request.column)!;
    const q = quoteName(this.driver, request.column);
    const binary = /bytea|binary|blob|image/i.test(column.type);
    const expression = binary
      ? this.driver === "postgres"
        ? `encode(${q},'hex')`
        : this.driver === "mssql"
          ? `CONVERT(VARCHAR(MAX),${q},2)`
          : `HEX(${q})`
      : ["postgres", "libsql", "turso"].includes(this.driver)
        ? `CAST(${q} AS TEXT)`
        : this.driver === "mssql"
          ? `CONVERT(NVARCHAR(MAX),${q})`
          : `CAST(${q} AS CHAR)`;
    let text = "";
    for (let offset = 1; ; offset += 4000) {
      const result = await this.raw(
        `SELECT ${["libsql", "turso"].includes(this.driver) ? "SUBSTR" : "SUBSTRING"}(${expression},${offset},4000) AS cell_value FROM ${this.target(info)} WHERE ${where}`,
        values,
      );
      const piece = result.rows[0]?.[0];
      if (piece === null) return "NULL";
      if (piece === undefined) throw new Error("The selected row no longer exists.");
      if (typeof piece !== "string")
        throw new Error("Full value could not be read without shortening.");
      if (!piece) return text;
      text += piece;
      if (Buffer.byteLength(text) > 8 * 1024 * 1024)
        throw new Error("Full value exceeds the 8 MiB editor limit. Use a server-native export.");
    }
  }

  async export(request: TableExport): Promise<number> {
    const handle = await open(request.path, "wx", 0o600);
    let count = 0;
    const csv = (value: string | number | boolean | null | undefined) =>
      '"' +
      (typeof value === "string"
        ? spreadsheetText(value, request.spreadsheetSafe ?? false)
        : String(value ?? "")
      ).replaceAll('"', '""') +
      '"';
    try {
      if (request.format === "json") await handle.write("[\n");
      for (let offset = 0; ; offset += 500) {
        const page = await this.browse({ ...request.request, offset, limit: 500 });
        if (
          page.result.truncated ||
          page.result.rows.some((row) =>
            row.some((value) => value && typeof value === "object" && value.type !== "integer"),
          )
        )
          throw new Error(
            "Export contains shortened/binary/large values; use a server-native export to preserve full values.",
          );
        if (!offset && request.format === "csv")
          await handle.write(page.result.columns.map(csv).join(",") + "\n");
        for (const row of page.result.rows) {
          await handle.write(
            request.format === "csv"
              ? row.map((value) => csv(scalar(value))).join(",") + "\n"
              : (count ? ",\n" : "") +
                  JSON.stringify(
                    Object.fromEntries(page.result.columns.map((col, i) => [col, scalar(row[i])])),
                  ),
          );
          count++;
        }
        if (!page.hasMore) break;
      }
      if (request.format === "json") await handle.write("\n]\n");
      return count;
    } catch (error) {
      await handle.close();
      await rm(request.path, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
  }
}
