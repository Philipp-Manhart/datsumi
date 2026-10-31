/* oxlint-disable typescript/no-unsafe-type-assertion -- mysql2 event typings describe a single field but the fields event carries an array; rows and packets are guarded before conversion. */
import { connect as tcpConnect } from "node:net";

import mysql, { type FieldPacket } from "mysql2";

import { Capture, type Backend } from "./backend";
import type { ServerConfiguration } from "./configuration";
export async function connect(
  config: ServerConfiguration & { password: string },
): Promise<Backend> {
  const connection = mysql.createConnection({
    ...(config.tunnelPort
      ? { stream: () => tcpConnect({ host: "127.0.0.1", port: config.tunnelPort! }) }
      : {}),
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectTimeout: 15000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    rowsAsArray: true,
    multipleStatements: false,
    enableKeepAlive: true,
    ...(config.tls === "verify"
      ? { ssl: { rejectUnauthorized: true, ...(config.ca ? { ca: config.ca } : {}) } }
      : {}),
  });
  connection.on("error", () => {});
  await new Promise<void>((resolve, reject) =>
    connection.connect((error) => (error ? reject(error) : resolve())),
  );
  const backend: Backend = {
    run(text, values = [], captureAll = false) {
      return new Promise((resolve, reject) => {
        const capture = new Capture(captureAll);
        const query = values.length
          ? connection.execute({ sql: text, values: [...values], timeout: 120000 })
          : connection.query({ sql: text, timeout: 120000 });
        query.on("fields", (fields: unknown) => {
          if (Array.isArray(fields))
            capture.fields(
              (fields as FieldPacket[]).map((field) => ({
                name: field.name,
                dataType: String(field.type),
                sourceColumn: field.orgName,
                table: field.orgTable,
                database: field.db,
              })),
            );
        });
        query.on("result", (row: unknown) => {
          try {
            if (Array.isArray(row)) capture.row(row);
            else {
              const result = row as { affectedRows?: number; serverStatus?: number };
              capture.done(result.affectedRows ?? 0, result.serverStatus);
            }
          } catch (error) {
            reject(error);
            connection.destroy();
          }
        });
        query.on("error", reject);
        query.on("end", () => resolve(capture.results));
      });
    },
    async transactionState() {
      const result = await backend.run("DO 0");
      const status = result[0]?.status ?? 0;
      return status & 1 ? "open" : status & 2 ? "idle" : "manual";
    },
    async inTransaction() {
      // DO yields an OK packet with the public serverStatus field, including IN_TRANS.
      const result = await backend.run("DO 0");
      return Boolean((result[0]?.status ?? 0) & 1);
    },
    async close() {
      connection.destroy();
    },
  };
  return backend;
}
