import { stat } from "node:fs/promises";

/* oxlint-disable typescript/no-unsafe-type-assertion -- Private IPC request payloads are validated by each operation. */
import type {
  QueryRequest,
  TablePageRequest,
  CellRequest,
  TableExport,
  TableChanges,
} from "@datsumi/core";

import { ServerDatabase } from "../../sql/src/database";
import { DuckDbBackend } from "./backend";
import { parseDuckDbConfiguration } from "./configuration";
let database: ServerDatabase | undefined;
let queue = Promise.resolve();
process.on("message", (message: { id: number; method: string; payload: unknown }) => {
  queue = queue.then(async () => {
    try {
      let result: unknown;
      if (message.method === "connect") {
        const { create, ...settings } = message.payload as Record<string, unknown>;
        const config = parseDuckDbConfiguration(settings);
        if (create && (create !== true || config.readOnly || config.path === ":memory:"))
          throw new Error("Invalid DuckDB creation mode.");
        if (create) {
          try {
            await stat(config.path);
            throw new Error("A file already exists at this path. Open it instead.");
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
              throw error;
          }
        }
        // Opening an existing file must never silently create a misspelled database.
        if (!create && config.path !== ":memory:" && !(await stat(config.path)).isFile())
          throw new Error("Choose a regular DuckDB database file.");
        const backend = await DuckDbBackend.open(config);
        database = new ServerDatabase("duckdb", backend, {
          database: config.path,
          readOnly: config.readOnly,
        });
      } else {
        if (!database) throw new Error("DuckDB connection is not open.");
        switch (message.method) {
          case "execute":
            result = await database.execute(message.payload as QueryRequest);
            break;
          case "schema":
            result = await database.schema();
            break;
          case "resources":
            result = await database.resources(message.payload as string | undefined);
            break;
          case "browse":
            result = await database.browse(message.payload as TablePageRequest);
            break;
          case "cell":
            result = await database.readCell(message.payload as CellRequest);
            break;
          case "changes": {
            const job = message.payload as { request: TableChanges; apply: boolean };
            result = await database.changes(job.request, job.apply);
            break;
          }
          case "export":
            result = await database.export(message.payload as TableExport);
            break;
          case "transactionState":
            result = await database.transactionState();
            break;
          default:
            throw new Error("Unsupported DuckDB operation.");
        }
      }
      process.send?.({ id: message.id, result });
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message.slice(0, 1500) : "DuckDB operation failed.",
      });
    }
  });
});
process.on("disconnect", () => {
  void database?.close().finally(() => process.exit(0));
});
