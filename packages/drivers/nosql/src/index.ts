import type {
  DriverCancellation,
  ConnectionProfile,
  DataPage,
  DataPageRequest,
  DataChange,
  DatabaseResource,
  QueryRequest,
  QueryResult,
} from "@datsumi/core";
import type { DatabaseDriver } from "@datsumi/driver-api";
import { ServerSession } from "@datsumi/driver-sql";

import { type NoSqlDriver, nosqlNames } from "./configuration";
export class NoSqlDriverAdapter implements DatabaseDriver<unknown, ServerSession> {
  readonly descriptor;
  constructor(
    readonly id: NoSqlDriver,
    private readonly resolveWorker: () => Promise<string>,
  ) {
    this.descriptor = {
      id,
      displayName: nosqlNames[id],
      family: id === "mongodb" ? ("document" as const) : ("key-value" as const),
      supportedQueryLanguages: ["custom" as const],
      capabilities: ["query" as const, "documents" as const],
    };
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
  listResources(session: ServerSession, parent?: string): Promise<DatabaseResource[]> {
    return session.call("resources", parent);
  }
  browseData(session: ServerSession, request: DataPageRequest): Promise<DataPage> {
    return session.call("browseData", request);
  }
  changeData(session: ServerSession, request: DataChange, apply: boolean): Promise<string> {
    return session.call("changeData", { request, apply });
  }
  async transactionState(): Promise<"unsupported"> {
    return "unsupported";
  }
  isConnected(session: ServerSession): boolean {
    return !session.closed;
  }
  disconnect(session: ServerSession): Promise<void> {
    return session.terminate();
  }
}
