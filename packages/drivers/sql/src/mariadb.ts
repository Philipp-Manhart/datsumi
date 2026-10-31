import { connect as tcpConnect } from "node:net";

import { createConnection } from "mariadb";

import { Capture, type Backend } from "./backend";
import type { ServerConfiguration } from "./configuration";
export async function connect(
  config: ServerConfiguration & { password: string },
): Promise<Backend> {
  const connection = await createConnection({
    ...(config.tunnelPort
      ? {
          stream: (callback: import("mariadb").StreamCallback) => {
            const socket = tcpConnect({ host: "127.0.0.1", port: config.tunnelPort! });
            socket.once("connect", () => callback(undefined, socket));
            socket.once("error", callback);
          },
        }
      : {}),
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectTimeout: 15000,
    socketTimeout: 120000,
    rowsAsArray: true,
    dateStrings: true,
    bigIntAsNumber: false,
    decimalAsNumber: false,
    multipleStatements: false,
    pipelining: false,
    ...(config.tls === "verify"
      ? { ssl: { rejectUnauthorized: true, ...(config.ca ? { ca: config.ca } : {}) } }
      : {}),
  });
  const backend: Backend = {
    async run(text, values = [], captureAll = false) {
      const prepared = values.length ? await connection.prepare(text) : undefined;
      try {
        return await new Promise((resolve, reject) => {
          const capture = new Capture(captureAll);
          const stream = prepared
            ? prepared.executeStream([...values])
            : connection.queryStream(text);
          stream.on("fields", (fields: { name(): string; type: string }[]) =>
            capture.fields(fields.map((field) => ({ name: field.name(), dataType: field.type }))),
          );
          stream.on("data", (row: unknown) => {
            try {
              if (Array.isArray(row)) capture.row(row);
              else
                capture.done(
                  Number(
                    row && typeof row === "object" && "affectedRows" in row ? row.affectedRows : 0,
                  ),
                );
            } catch (error) {
              stream.destroy();
              reject(error);
            }
          });
          stream.on("error", reject);
          stream.on("end", () => resolve(capture.results));
        });
      } finally {
        prepared?.close();
      }
    },
    async transactionState() {
      const result = await backend.run("SELECT @@in_transaction, @@autocommit");
      const number = (value: import("@datsumi/core").CellValue | undefined) =>
        Number(
          value && typeof value === "object" && value.type === "integer" ? value.value : value,
        );
      return number(result[0]?.rows[0]?.[0]) > 0
        ? "open"
        : number(result[0]?.rows[0]?.[1]) > 0
          ? "idle"
          : "manual";
    },
    async inTransaction() {
      const result = await backend.run("SELECT @@in_transaction");
      const value = result[0]?.rows[0]?.[0];
      return (
        Number(
          value && typeof value === "object" && value.type === "integer" ? value.value : value,
        ) > 0
      );
    },
    async close() {
      await connection.end();
    },
  };
  return backend;
}
