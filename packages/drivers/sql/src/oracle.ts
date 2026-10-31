/* oxlint-disable no-control-regex -- Reject control characters in Oracle Net descriptors. */
/* oxlint-disable no-await-in-loop -- Fetch each result batch on the same Oracle session. */
import oracledb from "oracledb";

import { Capture, type Backend } from "./backend";
import type { ServerConfiguration } from "./configuration";
import { oracleStatement } from "./oracleStatement";

export async function connect(
  config: ServerConfiguration & { password: string },
): Promise<Backend> {
  // Build the descriptor ourselves: host/service must never inject Oracle Net options.
  if (!/^[\w.:%-]+$/.test(config.host) || /[()\x00-\x1f]/.test(config.database))
    throw new Error("Invalid Oracle host or service name.");
  const connection = await oracledb.getConnection({
    user: config.username,
    password: config.password,
    connectString: `(DESCRIPTION=(CONNECT_TIMEOUT=15)(TRANSPORT_CONNECT_TIMEOUT=15)(ADDRESS=(PROTOCOL=${config.tls === "verify" ? "TCPS" : "TCP"})(HOST=${config.tunnelPort && config.tls === "disable" ? "127.0.0.1" : config.host})(PORT=${config.tunnelPort && config.tls === "disable" ? config.tunnelPort : config.port}))(CONNECT_DATA=(SERVICE_NAME=${config.database})))`,
    ...(config.tunnelPort && config.tls === "verify"
      ? { httpsProxy: "127.0.0.1", httpsProxyPort: config.tunnelPort }
      : {}),
    sslServerDNMatch: true,
    sslAllowWeakDNMatch: false,
    ...(config.ca ? { walletContent: config.ca } : {}),
  });
  connection.callTimeout = 120000;
  try {
    await connection.execute(
      `ALTER SESSION SET NLS_NUMERIC_CHARACTERS='.,' NLS_DATE_FORMAT='YYYY-MM-DD"T"HH24:MI:SS' NLS_TIMESTAMP_FORMAT='YYYY-MM-DD"T"HH24:MI:SS.FF9' NLS_TIMESTAMP_TZ_FORMAT='YYYY-MM-DD"T"HH24:MI:SS.FF9TZH:TZM' TIME_ZONE='+00:00'`,
    );
  } catch (error) {
    await connection.close();
    throw error;
  }
  return {
    async run(text, values = [], captureAll = false) {
      const capture = new Capture(captureAll);
      const sql = oracleStatement(text);
      const result = await connection.execute<unknown[]>(
        sql,
        [...values] as oracledb.BindParameters,
        {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          resultSet: true,
          autoCommit: false,
          fetchArraySize: 500,
          fetchTypeHandler: (metadata) => {
            // Oracle NUMBER can exceed JavaScript's precision. Keep every digit.
            if (
              [oracledb.DB_TYPE_NUMBER, oracledb.DB_TYPE_CLOB, oracledb.DB_TYPE_NCLOB].some(
                (type) => type === metadata.dbType,
              )
            )
              return { type: oracledb.STRING };
            if (metadata.dbType === oracledb.DB_TYPE_BLOB) return { type: oracledb.BUFFER };
            return undefined;
          },
        },
      );
      if (result.resultSet) {
        const rows = result.resultSet;
        try {
          capture.fields(
            (result.metaData ?? rows.metaData).map((column) => ({
              name: column.dbColumnName ?? column.name,
              dataType: column.dbTypeName ?? "",
            })),
          );
          for (;;) {
            const batch = await rows.getRows(500);
            if (!batch.length) break;
            for (const row of batch) capture.row(row);
          }
        } finally {
          await rows.close();
        }
      } else capture.done(result.rowsAffected ?? 0);
      return capture.results;
    },
    async inTransaction() {
      return Boolean(connection.transactionInProgress);
    },
    async transactionState() {
      return connection.transactionInProgress ? "open" : "idle";
    },
    async close() {
      await connection.close();
    },
  };
}
