import { Client, Query, types, type QueryArrayConfig } from "pg";

import { Capture, type Backend } from "./backend";
import type { ServerConfiguration } from "./configuration";
export async function connect(
  config: ServerConfiguration & { password: string },
): Promise<Backend> {
  const client = new Client({
    host: config.tunnelPort ? "127.0.0.1" : config.host,
    port: config.tunnelPort ?? config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    enableChannelBinding: config.enableChannelBinding ?? true,
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
    ssl:
      config.tls === "verify"
        ? {
            rejectUnauthorized: true,
            ...(config.tunnelPort ? { servername: config.host } : {}),
            ...(config.ca ? { ca: config.ca } : {}),
          }
        : false,
    types: {
      getTypeParser(oid, format) {
        return [20, 1700, 1114, 1184, 1082, 1083, 1266].includes(oid)
          ? (value: string) => value
          : types.getTypeParser(oid, format);
      },
    },
  });
  let offeredChannelBinding = false;
  client.connection.on("authenticationSASL", (message: { mechanisms: string[] }) => {
    offeredChannelBinding = message.mechanisms.includes("SCRAM-SHA-256-PLUS");
  });
  let transaction = false;
  let failed = false;
  client.connection.on("readyForQuery", (message: { status: string }) => {
    transaction = message.status !== "I";
    failed = message.status === "E";
  });
  client.on("error", () => {
    /* Worker operation/disconnect handles the closed connection. */
  });
  await client.connect();
  if (config.channelBindingRequired && !offeredChannelBinding) {
    await client.end();
    throw new Error("The server did not negotiate required SCRAM channel binding.");
  }
  return {
    run(text, values = [], captureAll = false) {
      return new Promise((resolve, reject) => {
        const capture = new Capture(captureAll);
        const queryConfig: QueryArrayConfig = { text, values: [...values], rowMode: "array" };
        const query = new Query<unknown[]>(queryConfig);
        const collected = new Map<object, import("./backend").RawResult>();
        query.on("row", (row: unknown[], result) => {
          try {
            if (!result) throw new Error("PostgreSQL result metadata unavailable.");
            if (!collected.has(result)) {
              capture.fields(
                result.fields.map((field) => ({
                  name: field.name,
                  dataType: String(field.dataTypeID),
                })),
              );
              collected.set(result, capture.results.at(-1)!);
            }
            capture.row(row);
          } catch (error) {
            reject(error);
            void client.end().catch(() => {});
          }
        });
        query.on("end", (last) => {
          const all = Array.isArray(last) ? last : [last];
          resolve(
            all.map((result) => {
              let item = collected.get(result);
              if (!item) {
                capture.fields(
                  result.fields.map((field: { name: string; dataTypeID: number }) => ({
                    name: field.name,
                    dataType: String(field.dataTypeID),
                  })),
                );
                item = capture.results.at(-1)!;
              }
              item.affected = result.rowCount ?? 0;
              return item;
            }),
          );
        });
        query.on("error", reject);
        client.query(query);
      });
    },
    async transactionState() {
      return failed ? "failed" : transaction ? "open" : "idle";
    },
    async inTransaction() {
      return transaction;
    },
    async close() {
      await client.end();
    },
  };
}
