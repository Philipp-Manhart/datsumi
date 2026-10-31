/* oxlint-disable typescript/no-unsafe-type-assertion -- The private IPC client pairs each method with its driver-owned response type. */
import { fork, type ChildProcess } from "node:child_process";

import type {
  CellRequest,
  ConnectionProfile,
  DriverCancellation,
  QueryRequest,
  QueryResult,
  TableChanges,
  TableExport,
  TableInfo,
  TablePage,
  TablePageRequest,
  DatabaseResource,
} from "@datsumi/core";
import type { DatabaseDriver } from "@datsumi/driver-api";

import { driverNames, type ServerDriver } from "./configuration";
export class ServerSession {
  private readonly worker: ChildProcess;
  private sequence = 0;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  readonly ready: Promise<unknown>;
  closed = false;
  private readonly exited: Promise<void>;
  constructor(path: string, configuration: unknown) {
    this.ready = new Promise((resolve, reject) => this.pending.set(0, { resolve, reject }));
    this.worker = fork(path, [], {
      execArgv: [],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.exited = new Promise((resolve) =>
      this.worker.on("close", () => {
        this.fail(
          new Error(
            "Database session closed. Reconnect to continue; verify any interrupted transaction before retrying writes.",
          ),
        );
        resolve();
      }),
    );
    this.worker.on("error", () => this.fail(new Error("Could not start the database driver.")));
    this.worker.on("message", (message: { id: number; error?: string; result?: unknown }) => {
      const job = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) job?.reject(new Error(message.error));
      else job?.resolve(message.result);
    });
    const startupTimeout = setTimeout(() => {
      void this.terminate(new Error("Database driver startup timed out."));
    }, 30000);
    void this.ready.then(
      () => clearTimeout(startupTimeout),
      () => clearTimeout(startupTimeout),
    );
    this.worker.send({ id: 0, method: "connect", payload: configuration }, (error) => {
      if (error) this.fail(new Error("Driver initialization failed."));
    });
  }
  async call<T>(method: string, payload?: unknown, signal?: DriverCancellation): Promise<T> {
    if (this.closed) throw new Error("Database session closed. Reconnect to continue.");
    if (signal?.isCancellationRequested) throw new Error("Operation cancelled.");
    const deadline = setTimeout(() => {
      void this.terminate(
        new Error(
          "Database operation timed out. Session closed; verify database state before retrying writes.",
        ),
      );
    }, 125000);
    const subscription = signal?.onCancellationRequested(() => {
      void this.terminate(
        new Error(
          "Operation cancelled. Session closed; uncommitted work will roll back when the server detects disconnection. Verify database state before retrying writes.",
        ),
      );
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const id = ++this.sequence;
        this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
        this.worker.send({ id, method, payload }, (error) => {
          if (error) this.fail(new Error("Database driver communication failed."));
        });
      });
    } finally {
      clearTimeout(deadline);
      subscription?.dispose();
    }
  }
  private fail(error: Error): void {
    this.closed = true;
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }
  async terminate(error = new Error("Database disconnected.")): Promise<void> {
    this.fail(error);
    this.worker.kill("SIGKILL");
    await this.exited;
  }
}
export class ServerDriverAdapter implements DatabaseDriver<unknown, ServerSession> {
  readonly descriptor;
  constructor(
    readonly id: ServerDriver | "duckdb",
    private readonly resolveWorker: () => Promise<string>,
  ) {
    this.descriptor = {
      id,
      displayName: id === "duckdb" ? "DuckDB" : driverNames[id],
      family: "relational",
      supportedQueryLanguages: ["sql"],
      capabilities:
        id === "clickhouse"
          ? (["query", "schema", "tables"] as const)
          : (["query", "transactions", "schema", "tables"] as const),
    } as const;
  }
  async connect(
    _profile: ConnectionProfile,
    configuration: unknown,
    signal?: DriverCancellation,
  ): Promise<ServerSession> {
    if (signal?.isCancellationRequested) throw new Error("Connection cancelled.");
    const session = new ServerSession(await this.resolveWorker(), configuration);
    const listener = signal?.onCancellationRequested(() => {
      void session.terminate(new Error("Connection cancelled."));
    });
    try {
      await session.ready;
      return session;
    } catch (error) {
      await session.terminate();
      throw error;
    } finally {
      listener?.dispose();
    }
  }
  execute(
    session: ServerSession,
    request: QueryRequest,
    signal?: DriverCancellation,
  ): Promise<QueryResult> {
    return session.call("execute", request, signal);
  }
  transactionState(session: ServerSession): Promise<import("@datsumi/core").TransactionState> {
    return session.call("transactionState");
  }
  schema(session: ServerSession, signal?: DriverCancellation): Promise<TableInfo[]> {
    return session.call("schema", undefined, signal);
  }
  listResources(
    session: ServerSession,
    parent?: string,
    signal?: DriverCancellation,
  ): Promise<DatabaseResource[]> {
    return session.call("resources", parent, signal);
  }
  browseTable(
    session: ServerSession,
    request: TablePageRequest,
    signal?: DriverCancellation,
  ): Promise<TablePage> {
    return session.call("browse", request, signal);
  }
  readCell(
    session: ServerSession,
    request: CellRequest,
    signal?: DriverCancellation,
  ): Promise<string> {
    return session.call("cell", request, signal);
  }
  changeRows(
    session: ServerSession,
    request: TableChanges,
    apply: boolean,
    signal?: DriverCancellation,
  ): Promise<string[]> {
    return session.call("changes", { request, apply }, signal);
  }
  exportTable(
    session: ServerSession,
    request: TableExport,
    signal?: DriverCancellation,
  ): Promise<number> {
    return session.call("export", request, signal);
  }
  isConnected(session: ServerSession): boolean {
    return !session.closed;
  }
  disconnect(session: ServerSession): Promise<void> {
    return session.terminate();
  }
}
