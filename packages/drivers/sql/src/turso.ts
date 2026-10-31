import { Session } from "@tursodatabase/serverless";

import type { ServerConfiguration } from "./configuration";
import { remoteBackend, type RemoteResult } from "./remote";

export async function connect(config: ServerConfiguration & { password: string }) {
  if (!config.endpoint || config.tunnelPort)
    throw new Error("Use a remote Turso URL without an SSH tunnel.");
  const session = new Session({
    url: config.endpoint,
    ...(config.password ? { authToken: config.password } : {}),
    defaultQueryTimeout: 30000,
  });
  const backend = remoteBackend({
    async execute(sql, args) {
      // safeIntegers preserves 64-bit values and numeric-indexed rows preserve duplicate labels.
      return (await session.execute(sql, [...args], true)) as RemoteResult;
    },
    inTransaction: () => session.inTransaction,
    async close() {
      await session.close();
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
