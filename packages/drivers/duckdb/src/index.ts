import type { ConnectionProfile, DriverCancellation } from "@datsumi/core";
import { ServerDriverAdapter, ServerSession } from "@datsumi/driver-sql";

import { parseDuckDbConfiguration } from "./configuration";

/** The shared SQL IPC adapter runs DuckDB exclusively in an isolated child process. */
export class DuckDbDriver extends ServerDriverAdapter {
  constructor(resolveWorker: () => Promise<string>) {
    super("duckdb", resolveWorker);
  }
  override connect(
    profile: ConnectionProfile,
    configuration: unknown,
    signal?: DriverCancellation,
  ): Promise<ServerSession> {
    const raw = configuration as Record<string, unknown>;
    const { create, ...config } = raw;
    if (create !== undefined && create !== true) throw new Error("Invalid DuckDB creation mode.");
    return super.connect(
      profile,
      { ...parseDuckDbConfiguration(config), ...(create ? { create: true } : {}) },
      signal,
    );
  }
}
