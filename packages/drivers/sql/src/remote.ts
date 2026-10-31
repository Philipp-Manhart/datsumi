import { statementAt } from "@datsumi/core";

import { Capture, type Backend, type RawResult } from "./backend";

/** Reuse the editor's lexer, including quoted semicolons and trigger bodies. */
export function statements(text: string): string[] {
  const result: string[] = [];
  while (text.trim()) {
    const part = statementAt(text, 0);
    if (!part) break;
    text = text.slice(text.indexOf(part) + part.length);
    if (
      part
        .replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, "")
        .trim()
        .replaceAll(";", "")
        .trim()
    )
      result.push(part);
  }
  if (result.length > 32) throw new Error("At most 32 statements per execution are supported.");
  return result;
}
export interface RemoteResult {
  columns: readonly string[];
  columnTypes: readonly string[];
  rows: readonly { readonly length: number; readonly [index: number]: unknown }[];
  rowsAffected: number;
}
export interface RemoteSession {
  execute(sql: string, args: readonly unknown[]): Promise<RemoteResult>;
  inTransaction(): boolean;
  close(): Promise<void>;
}
export function remoteBackend(session: RemoteSession): Backend {
  return {
    async run(text, values = [], captureAll = false): Promise<RawResult[]> {
      const parts = statements(text);
      if (parts.length > 1 && values.length)
        throw new Error("Parameters require a single statement.");
      const capture = new Capture(captureAll);
      for (const sql of parts) {
        const result = await session.execute(sql, values);
        capture.fields(
          result.columns.map((name, i) => ({ name, dataType: result.columnTypes[i] || "ANY" })),
        );
        for (const row of result.rows)
          capture.row(Array.from({ length: row.length }, (_, i) => row[i]));
        capture.done(result.rowsAffected);
      }
      return capture.results;
    },
    async inTransaction() {
      return session.inTransaction();
    },
    close: () => session.close(),
  };
}
