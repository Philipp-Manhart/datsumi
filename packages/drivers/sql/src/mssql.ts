/* oxlint-disable typescript/no-unsafe-type-assertion -- Tedious row events use any in upstream declarations; useColumnNames=false fixes the array shape. */
import { Connection, Request, TYPES } from "tedious";

import { Capture, type Backend } from "./backend";
import type { ServerConfiguration } from "./configuration";
export async function connect(
  config: ServerConfiguration & { password: string },
): Promise<Backend> {
  const connection = new Connection({
    server: config.tunnelPort ? "127.0.0.1" : config.host,
    authentication: {
      type: "default",
      options: { userName: config.username, password: config.password },
    },
    options: {
      port: config.tunnelPort ?? config.port,
      ...(config.tunnelPort ? { serverName: config.host } : {}),
      database: config.database,
      encrypt: config.tls === "verify",
      trustServerCertificate: false,
      connectTimeout: 15000,
      requestTimeout: 120000,
      ...(config.ca ? { cryptoCredentialsDetails: { ca: config.ca } } : {}),
      useColumnNames: false,
    },
  });
  connection.on("error", () => {});
  await new Promise<void>((resolve, reject) =>
    connection.connect((error) => (error ? reject(error) : resolve())),
  );
  const backend: Backend = {
    run(text, values = [], captureAll = false) {
      return new Promise((resolve, reject) => {
        const capture = new Capture(captureAll);
        let captureError: unknown;
        const request = new Request(text, (error) => {
          if (captureError) reject(captureError);
          else if (error) reject(error);
          else resolve(capture.results);
        });
        request.on("columnMetadata", (columns) =>
          capture.fields(
            (Array.isArray(columns) ? columns : Object.values(columns)).map((column) => ({
              name: column.colName,
              dataType: column.type.name,
            })),
          ),
        );
        request.on("row", (columns) => {
          try {
            if (captureError) return;
            const cells = columns as {
              value: unknown;
              metadata: { type: { name: string }; precision?: number };
            }[];
            if (
              cells.some(
                (column) =>
                  column.value !== null &&
                  /^(?:Decimal|Numeric)N?$/i.test(column.metadata.type.name) &&
                  (column.metadata.precision ?? 0) > 15,
              )
            )
              throw new Error(
                "SQL Server high-precision decimals must be CAST to VARCHAR in raw query results to avoid rounding. Table browsing preserves them automatically.",
              );
            capture.row(cells.map((column) => column.value));
          } catch (error) {
            captureError = error;
          }
        });
        request.on("done", (count) => capture.done(count ?? 0));
        request.on("doneInProc", (count) => capture.done(count ?? 0));
        values.forEach((value, index) =>
          request.addParameter(
            `p${index}`,
            typeof value === "boolean"
              ? TYPES.Bit
              : typeof value === "number"
                ? TYPES.Float
                : Buffer.isBuffer(value)
                  ? TYPES.VarBinary
                  : TYPES.NVarChar,
            value,
          ),
        );
        if (values.length) connection.execSql(request);
        else connection.execSqlBatch(request);
      });
    },
    async transactionState() {
      // ENVCHANGE tokens provide transaction presence without a SELECT that could
      // start an implicit transaction merely to draw the status bar.
      if (!connection.inTransaction) {
        const options = await backend.run("DBCC USEROPTIONS WITH NO_INFOMSGS");
        if (connection.inTransaction) return "open";
        return options.some((result) =>
          result.rows.some((row) => row[0] === "implicit_transactions"),
        )
          ? "manual"
          : "idle";
      }
      const result = await backend.run("SELECT XACT_STATE()");
      const state = Number(result[0]?.rows[0]?.[0] ?? 0);
      return state === -1 ? "failed" : state === 1 ? "open" : "idle";
    },
    async inTransaction() {
      return connection.inTransaction;
    },
    async close() {
      connection.close();
    },
  };
  return backend;
}
