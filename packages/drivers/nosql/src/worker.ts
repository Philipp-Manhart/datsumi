import type {
  DataChange,
  DataPage,
  DataPageRequest,
  DatabaseResource,
  QueryRequest,
  QueryResult,
} from "@datsumi/core";

import {
  parseNoSqlConfiguration,
  type NoSqlDriver,
  type NoSqlConfiguration,
} from "./configuration";
export interface NoSqlDatabase {
  resources(): Promise<DatabaseResource[]>;
  browse(request: DataPageRequest): Promise<DataPage>;
  change(request: DataChange, apply: boolean): Promise<string>;
  execute(request: QueryRequest): Promise<QueryResult>;
  close(): Promise<void>;
}
export function validatePage(request: DataPageRequest): void {
  if (
    !request ||
    typeof request.resource !== "string" ||
    request.resource.length > 1000 ||
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 100 ||
    (request.filter?.length ?? 0) > 65536 ||
    (request.cursor?.length ?? 0) > 200
  )
    throw new Error("Invalid browsing request.");
}
export function validateChange(request: DataChange): void {
  if (
    !request ||
    typeof request.resource !== "string" ||
    typeof request.id !== "string" ||
    typeof request.original !== "string" ||
    typeof request.text !== "string" ||
    request.text.length > 1024 * 1024 ||
    request.original.length > 1024 * 1024
  )
    throw new Error("Invalid or oversized change.");
}
export function serve(
  id: NoSqlDriver,
  connect: (config: NoSqlConfiguration, password: string) => Promise<NoSqlDatabase>,
): void {
  let database: NoSqlDatabase | undefined,
    password = "";
  let queue = Promise.resolve();
  process.on("message", (message: { id: number; method: string; payload: unknown }) => {
    queue = queue.then(async () => {
      try {
        let result: unknown;
        if (message.method === "connect") {
          const raw = message.payload as Record<string, unknown>,
            { password: secret, tunnelPort, ...settings } = raw;
          if (typeof secret !== "string") throw new Error("Invalid credentials.");
          if (
            tunnelPort !== undefined &&
            (typeof tunnelPort !== "number" ||
              !Number.isInteger(tunnelPort) ||
              tunnelPort < 1 ||
              tunnelPort > 65535)
          )
            throw new Error("Invalid tunnel port.");
          password = secret;
          database = await connect(
            {
              ...parseNoSqlConfiguration(id, settings),
              ...(typeof tunnelPort === "number" ? { tunnelPort } : {}),
            },
            password,
          );
        } else {
          if (!database) throw new Error("Connection closed.");
          switch (message.method) {
            case "resources":
              result = message.payload ? [] : await database.resources();
              break;
            case "browseData":
              validatePage(message.payload as DataPageRequest);
              result = await database.browse(message.payload as DataPageRequest);
              break;
            case "changeData": {
              const job = message.payload as { request: DataChange; apply: boolean };
              validateChange(job.request);
              result = await database.change(job.request, job.apply === true);
              break;
            }
            case "execute":
              result = await database.execute(message.payload as QueryRequest);
              break;
            default:
              throw new Error("Unsupported operation.");
          }
        }
        process.send?.({ id: message.id, result });
      } catch (error) {
        let messageText = error instanceof Error ? error.message : "Database operation failed.";
        if (password) messageText = messageText.replaceAll(password, "[redacted]");
        messageText = messageText.replace(
          /(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s]+/gi,
          "[connection redacted]",
        );
        process.send?.({ id: message.id, error: messageText.slice(0, 1500) });
      }
    });
  });
  process.on("disconnect", () => {
    void database?.close().finally(() => process.exit(0));
  });
}
