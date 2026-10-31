import type { CellValue, ColumnMetadata } from "@datsumi/core";
export interface RawResult {
  columns: ColumnMetadata[];
  rows: CellValue[][];
  affected: number;
  truncated: boolean;
  status?: number | undefined;
}
export interface Backend {
  run(text: string, values?: readonly unknown[], captureAll?: boolean): Promise<RawResult[]>;
  inTransaction(): Promise<boolean>;
  transactionState?(): Promise<import("@datsumi/core").TransactionState>;
  close(): Promise<void>;
}
export function cell(value: unknown, complete = false): CellValue {
  if (value == null) return null;
  if (typeof value === "string")
    return !complete && value.length > 16384
      ? { type: "text", value: value.slice(0, 16384), length: value.length }
      : value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : { type: "float", value: String(value) };
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ArrayBuffer) value = new Uint8Array(value);
  if (value instanceof Uint8Array)
    return {
      type: "blob",
      hex: Buffer.from(complete ? value : value.subarray(0, 256)).toString("hex"),
      bytes: value.byteLength,
    };
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}
export class Capture {
  readonly results: RawResult[] = [];
  private current: RawResult | undefined;
  private bytes = 0;
  private count = 0;
  constructor(private readonly complete = false) {}
  fields(columns: ColumnMetadata[]): void {
    if (this.results.length >= 32)
      throw new Error("At most 32 result sets per execution are supported.");
    this.current = { columns, rows: [], affected: 0, truncated: false };
    this.results.push(this.current);
  }
  row(values: unknown[]): void {
    const result = this.current;
    if (!result) return;
    if ((!this.complete && this.count >= 10000) || this.bytes >= this.byteLimit) {
      result.truncated = true;
      return;
    }
    const row = values.map((value) => cell(value, this.complete));
    const size = Buffer.byteLength(JSON.stringify(row));
    if (this.bytes + size > this.byteLimit) {
      result.truncated = true;
      return;
    }
    this.bytes += size;
    this.count++;
    result.rows.push(row);
  }
  private get byteLimit(): number {
    return (this.complete ? 64 : 4) * 1024 * 1024;
  }
  done(affected: number, status?: number): void {
    if (!this.current) this.fields([]);
    this.current!.affected = affected;
    this.current!.status = status;
    this.current = undefined;
  }
}
export function safeError(error: unknown, password: string): Error {
  let message = error instanceof Error ? error.message : "Database operation failed.";
  if (error && typeof error === "object") {
    if ("position" in error && typeof error.position === "string" && /^\d+$/.test(error.position))
      message += ` (SQL position ${error.position})`;
    else if ("lineNumber" in error && typeof error.lineNumber === "number")
      message += ` (SQL line ${error.lineNumber})`;
  }
  if (password) message = message.replaceAll(password, "[redacted]");
  message = message.replace(
    /(?:postgres(?:ql)?|mysql|mariadb|mssql|clickhouse|oracle|libsql|turso|https?):\/\/[^\s]+/gi,
    "[connection redacted]",
  );
  return new Error(message.slice(0, 1500));
}
