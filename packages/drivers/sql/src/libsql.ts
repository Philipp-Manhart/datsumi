import type { InValue, Transaction } from "@libsql/client";
import { createClient } from "@libsql/client/http";

import type { ServerConfiguration } from "./configuration";
import { remoteBackend } from "./remote";

export async function connect(config: ServerConfiguration & { password: string }) {
  if (!config.endpoint || config.tunnelPort)
    throw new Error("Use a remote libSQL URL without an SSH tunnel.");
  const client = createClient({
    url: config.endpoint,
    ...(config.password ? { authToken: config.password } : {}),
    intMode: "bigint",
    fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      fetch(input, { ...init, redirect: "error" }),
  });
  let transaction: Transaction | undefined;
  const backend = remoteBackend({
    async execute(sql, args) {
      const control = sql
        .replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, "")
        .trim()
        .replace(/;\s*$/, "")
        .trim();
      const empty = { columns: [], columnTypes: [], rows: [], rowsAffected: 0 };
      if (/^BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?$/i.test(control)) {
        if (transaction && !transaction.closed) throw new Error("A transaction is already active.");
        if (/EXCLUSIVE/i.test(control))
          throw new Error(
            "EXCLUSIVE transactions are not supported by the remote libSQL client. Use BEGIN IMMEDIATE.",
          );
        transaction = await client.transaction(
          /IMMEDIATE|EXCLUSIVE/i.test(control) ? "write" : "deferred",
        );
        return empty;
      }
      if (/^(COMMIT|END|ROLLBACK)(?:\s+TRANSACTION)?$/i.test(control)) {
        if (!transaction || transaction.closed) throw new Error("No transaction is active.");
        if (/^ROLLBACK/i.test(control)) await transaction.rollback();
        else await transaction.commit();
        transaction.close();
        transaction = undefined;
        return empty;
      }
      if (/^(BEGIN|SAVEPOINT|RELEASE|ROLLBACK|COMMIT|END)\b/i.test(control))
        throw new Error(
          "Use BEGIN, COMMIT or ROLLBACK for remote libSQL transactions; savepoints are not supported.",
        );
      // The SDK pins interactive transactions to a dedicated HTTP stream.
      return (transaction && !transaction.closed ? transaction : client).execute({
        sql,
        args: args as InValue[],
      });
    },
    inTransaction: () => !!transaction && !transaction.closed,
    async close() {
      transaction?.close();
      client.close();
    },
  });
  try {
    await backend.run("SELECT 1");
    return backend;
  } catch (error) {
    await backend.close();
    throw error;
  }
}
