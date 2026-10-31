import type {
  QueryRequest,
  TablePageRequest,
  CellRequest,
  TableChanges,
  TableExport,
} from "@datsumi/core";

import { SqliteDatabase, parseConfiguration } from "./database";

type Message = { id: number } & (
  | { method: "connect"; payload: unknown }
  | { method: "execute"; payload: QueryRequest }
  | { method: "resources"; payload?: string }
  | { method: "cell"; payload: CellRequest }
  | { method: "transactionState" }
  | { method: "schema" }
  | { method: "changes"; payload: { request: TableChanges; apply: boolean } }
  | { method: "export"; payload: TableExport }
  | { method: "browse"; payload: TablePageRequest }
);
let database: SqliteDatabase | undefined;
process.on("message", (message: Message) => {
  try {
    let result: unknown;
    if (message.method === "connect")
      database = new SqliteDatabase(parseConfiguration(message.payload));
    else {
      if (!database) throw new Error("SQLite connection is not open.");
      switch (message.method) {
        case "cell":
          result = database.readCell(message.payload);
          break;
        case "schema":
          result = database.schema();
          break;
        case "changes":
          result = database.changeRows(message.payload.request, message.payload.apply);
          break;
        case "export":
          result = database.exportTable(message.payload);
          break;
        case "transactionState":
          result = database.transactionState();
          break;
        case "execute":
          result = database.execute(message.payload);
          break;
        case "resources":
          result = database.listResources(message.payload);
          break;
        case "browse":
          result = database.browseTable(message.payload);
          break;
        default:
          throw new Error("Unknown SQLite operation.");
      }
    }
    process.send?.({ id: message.id, result });
  } catch (error) {
    process.send?.({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
process.on("disconnect", () => {
  database?.close();
  process.exit(0);
});
