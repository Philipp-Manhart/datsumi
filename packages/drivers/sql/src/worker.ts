/* oxlint-disable typescript/no-unsafe-type-assertion -- The private host/worker IPC pairs each method with its typed payload; configuration and operations validate their fields before use. */
import type {
  CellRequest,
  QueryRequest,
  TableChanges,
  TableExport,
  TablePageRequest,
} from "@datsumi/core";

import type { Backend } from "./backend";
import { safeError } from "./backend";
import {
  type ServerConfiguration,
  parseSqlConfiguration,
  type ServerDriver,
} from "./configuration";
import { ServerDatabase } from "./database";
export function serve(
  driver: ServerDriver,
  connect: (config: ServerConfiguration & { password: string }) => Promise<Backend>,
): void {
  serveDatabase(async (raw) => {
    const { password, tunnelPort, ...settings } = raw;
    if (typeof password !== "string") throw new Error("A password is required.");
    if (
      tunnelPort !== undefined &&
      (typeof tunnelPort !== "number" ||
        !Number.isInteger(tunnelPort) ||
        tunnelPort < 1 ||
        tunnelPort > 65535)
    )
      throw new Error("Invalid tunnel port.");
    const config = parseSqlConfiguration(driver, settings);
    return new ServerDatabase(
      driver,
      await connect({
        ...config,
        password,
        ...(typeof tunnelPort === "number" ? { tunnelPort } : {}),
      }),
      config,
    );
  });
}
export function serveDatabase(
  open: (raw: Record<string, unknown>) => Promise<ServerDatabase>,
): void {
  let database: ServerDatabase | undefined,
    password = "";
  let queue = Promise.resolve();
  process.on("message", (message: { id: number; method: string; payload: unknown }) => {
    queue = queue.then(async () => {
      try {
        let result: unknown;
        if (message.method === "connect") {
          const raw = message.payload as Record<string, unknown>;
          if (typeof raw.password !== "string") throw new Error("A password is required.");
          password = raw.password;
          database = await open(raw);
        } else {
          if (!database) throw new Error("Database connection is not open.");
          switch (message.method) {
            case "transactionState":
              result = await database.transactionState();
              break;
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
            default:
              throw new Error("Unsupported database operation.");
          }
        }
        process.send?.({ id: message.id, result });
      } catch (error) {
        process.send?.({ id: message.id, error: safeError(error, password).message });
      }
    });
  });
  process.on("disconnect", () => {
    password = "";
    void database?.close().finally(() => process.exit(0));
  });
}
