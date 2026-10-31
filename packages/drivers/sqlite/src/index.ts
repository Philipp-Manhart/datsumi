import { fork, type ChildProcess } from "node:child_process";

import type {
  CellRequest,
  TableInfo,
  TableChanges,
  TableExport,
  ConnectionProfile,
  DatabaseResource,
  DriverCancellation,
  QueryRequest,
  QueryResult,
  TablePage,
  TablePageRequest,
} from "@datsumi/core";
import type { DatabaseDriver } from "@datsumi/driver-api";

/** Each connection runs in a child process. SIGKILL can interrupt native SQLite calls. */
export class SqliteSession {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  readonly ready: Promise<unknown>;
  closed = false;
  private readonly worker: ChildProcess;
  private readonly exited: Promise<void>;

  constructor(workerPath: string, configuration: unknown) {
    this.ready = new Promise((resolve, reject) => this.pending.set(0, { resolve, reject }));
    this.worker = fork(workerPath, [], {
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      },
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let diagnostics = "";
    this.worker.stderr?.on("data", (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-4000);
    });
    this.exited = new Promise((resolve) =>
      this.worker.on("close", () => {
        this.fail(
          new Error(
            `SQLite connection closed. ${diagnostics || "Run the command again to reconnect."}`,
          ),
        );
        resolve();
      }),
    );
    this.worker.on("message", (message: { id: number; result?: unknown; error?: string }) => {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) pending?.reject(new Error(message.error));
      else pending?.resolve(message.result);
    });
    this.worker.on("error", (error) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    );
    this.worker.send({ id: 0, method: "connect", payload: configuration }, (error) => {
      if (error) this.fail(error);
    });
  }

  async call<T>(method: string, payload?: unknown, signal?: DriverCancellation): Promise<T> {
    if (this.closed)
      throw new Error("SQLite connection closed. Run the command again to reconnect.");
    if (signal?.isCancellationRequested) throw new Error("Operation cancelled.");
    const id = ++this.nextId;
    const subscription = signal?.onCancellationRequested(() => {
      void this.terminate(
        new Error(
          "Operation cancelled. The connection was closed; uncommitted changes were rolled back.",
        ),
      );
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Private IPC pairs the request with its driver-owned response type.
        this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
        this.worker.send({ id, method, payload }, (error) => {
          if (error) this.fail(error);
        });
      });
    } finally {
      subscription?.dispose();
    }
  }

  async terminate(error = new Error("SQLite connection disconnected.")): Promise<void> {
    this.fail(error);
    this.worker.kill("SIGKILL");
    await this.exited;
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export class SqliteDriver implements DatabaseDriver<unknown, SqliteSession> {
  readonly descriptor = {
    id: "sqlite",
    displayName: "SQLite",
    family: "relational",
    supportedQueryLanguages: ["sql"],
    capabilities: ["query", "transactions", "schema", "tables"],
  } as const;
  constructor(private readonly workerPath: string) {}

  transactionState(session: SqliteSession): Promise<import("@datsumi/core").TransactionState> {
    return session.call("transactionState");
  }
  async connect(
    _profile: ConnectionProfile,
    configuration: unknown,
    signal?: DriverCancellation,
  ): Promise<SqliteSession> {
    if (signal?.isCancellationRequested) throw new Error("Operation cancelled.");
    const session = new SqliteSession(this.workerPath, configuration);
    const subscription = signal?.onCancellationRequested(() => {
      void session.terminate(new Error("Connection cancelled."));
    });
    try {
      await session.ready;
      return session;
    } catch (error) {
      await session.terminate();
      throw error;
    } finally {
      subscription?.dispose();
    }
  }
  execute(
    session: SqliteSession,
    request: QueryRequest,
    signal?: DriverCancellation,
  ): Promise<QueryResult> {
    return session.call("execute", request, signal);
  }
  listResources(
    session: SqliteSession,
    parentId?: string,
    signal?: DriverCancellation,
  ): Promise<readonly DatabaseResource[]> {
    return session.call("resources", parentId, signal);
  }
  browseTable(
    session: SqliteSession,
    request: TablePageRequest,
    signal?: DriverCancellation,
  ): Promise<TablePage> {
    return session.call("browse", request, signal);
  }
  readCell(
    session: SqliteSession,
    request: CellRequest,
    signal?: DriverCancellation,
  ): Promise<string> {
    return session.call("cell", request, signal);
  }
  schema(session: SqliteSession, signal?: DriverCancellation): Promise<readonly TableInfo[]> {
    return session.call("schema", undefined, signal);
  }
  changeRows(
    session: SqliteSession,
    request: TableChanges,
    apply: boolean,
    signal?: DriverCancellation,
  ): Promise<readonly string[]> {
    return session.call("changes", { request, apply }, signal);
  }
  exportTable(
    session: SqliteSession,
    request: TableExport,
    signal?: DriverCancellation,
  ): Promise<number> {
    return session.call("export", request, signal);
  }
  isConnected(session: SqliteSession): boolean {
    return !session.closed;
  }
  async disconnect(session: SqliteSession): Promise<void> {
    await session.terminate();
  }
}
