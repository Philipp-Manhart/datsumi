/* oxlint-disable no-await-in-loop -- One DuckDB session executes and consumes statements sequentially. */
import {
  DuckDBInstance,
  DuckDBBlobValue,
  DuckDBDecimalValue,
  JsonDuckDBValueConverter,
  ResultReturnType,
  type DuckDBConnection,
  type DuckDBValue,
} from "@duckdb/node-api";

import type { Backend, RawResult } from "../../sql/src/backend";
import { Capture } from "../../sql/src/backend";
import type { DuckDbConfiguration } from "./configuration";

export class DuckDbBackend implements Backend {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
  ) {}
  static async open(config: DuckDbConfiguration): Promise<DuckDbBackend> {
    const instance = await DuckDBInstance.create(config.path, {
      access_mode: config.readOnly ? "READ_ONLY" : "READ_WRITE",
      // Keep analytical work from claiming the entire extension host's machine.
      memory_limit: "512MB",
      threads: "4",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
    });
    try {
      return new DuckDbBackend(instance, await instance.connect());
    } catch (error) {
      instance.closeSync();
      throw error;
    }
  }
  async run(
    text: string,
    values: readonly unknown[] = [],
    captureAll = false,
  ): Promise<RawResult[]> {
    const extracted = await this.connection.extractStatements(text);
    if (extracted.count > 32) throw new Error("At most 32 statements per execution are supported.");
    if (values.length && extracted.count !== 1)
      throw new Error("Bound values require a single statement.");
    const capture = new Capture(captureAll);
    for (let i = 0; i < extracted.count; i++) {
      const statement = await extracted.prepare(i);
      try {
        values.forEach((value, index) => {
          if (value !== null && !["string", "number", "bigint", "boolean"].includes(typeof value))
            throw new Error("Unsupported bound value.");
          statement.bindValue(index + 1, value as DuckDBValue);
        });
        const result = await statement.stream();
        try {
          const columns = result
            .columnNames()
            .map((name, index) => ({ name, dataType: result.columnType(index).toString() }));
          const returnsRows = result.returnType === ResultReturnType.QUERY_RESULT;
          capture.fields(returnsRows ? columns : []);
          if (returnsRows) {
            let stop = false;
            while (!stop) {
              const chunk = await result.fetchChunk();
              if (!chunk || !chunk.rowCount) break;
              for (let row = 0; row < chunk.rowCount; row++) {
                const converted = chunk.getRowValues(row).map((value, col) => {
                  if (value instanceof DuckDBBlobValue) return value.bytes;
                  if (value instanceof DuckDBDecimalValue) return value.toString();
                  if (value === null || typeof value !== "object") return value;
                  return JsonDuckDBValueConverter(
                    value,
                    result.columnType(col),
                    JsonDuckDBValueConverter,
                  );
                });
                capture.row(converted);
                if (capture.results.at(-1)?.truncated) {
                  stop = true;
                  break;
                }
              }
            }
          }
          capture.done(result.rowsChanged);
        } finally {
          result.closeSync();
        }
      } finally {
        statement.destroySync();
      }
    }
    return capture.results;
  }
  async transactionState(): Promise<import("@datsumi/core").TransactionState> {
    // Each standalone SELECT gets a new transaction; explicit BEGIN keeps the same ID.
    const id = async () => {
      const result = await this.connection.runAndReadAll("SELECT current_transaction_id()");
      try {
        const value = result.getRowsJson()[0]?.[0];
        if (typeof value !== "string") throw new Error("DuckDB transaction state is unavailable.");
        return value;
      } finally {
        result.closeSync();
      }
    };
    try {
      return (await id()) === (await id()) ? "open" : "idle";
    } catch (error) {
      if (error instanceof Error && /transaction.*abort/i.test(error.message)) return "failed";
      throw error;
    }
  }
  async inTransaction(): Promise<boolean> {
    return ["open", "failed"].includes(await this.transactionState());
  }
  async close(): Promise<void> {
    this.connection.closeSync();
    this.instance.closeSync();
  }
}
