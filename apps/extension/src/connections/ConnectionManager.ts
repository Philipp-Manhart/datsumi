import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import type {
  SshConfiguration,
  CellRequest,
  TableChanges,
  TableExport,
  ConnectionProfile,
  DriverCancellation,
  QueryRequest,
  QueryResult,
  TablePage,
  TablePageRequest,
} from "@datsumi/core";
import type { DatabaseDriver, DriverRegistry } from "@datsumi/driver-api";
import { parseDuckDbConfiguration } from "@datsumi/driver-duckdb/configuration";
import {
  isNoSqlDriver,
  parseNoSqlConfiguration,
  type NoSqlDriver,
  type NoSqlConfiguration,
} from "@datsumi/driver-nosql/configuration";
import {
  isServerDriver,
  parseSqlConfiguration,
  type ServerConfiguration,
  type ServerDriver,
} from "@datsumi/driver-sql/configuration";
import type { ExtensionContext } from "vscode";

import { atomicOutput } from "../data/outputFile";
import { abortCancellation } from "./cancellation";
import type { CredentialService, CredentialAnswer } from "./CredentialService";
import { parseSshConfiguration, type ManagedTunnel, type TunnelFactory } from "./SshTunnel";

interface OpenConnection {
  readonly driver: DatabaseDriver;
  readonly session: unknown;
  readonly tunnel?: ManagedTunnel;
}

function isProfile(value: unknown): value is ConnectionProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ConnectionProfile>;
  if (
    typeof profile.id !== "string" ||
    typeof profile.name !== "string" ||
    !["relational", "document", "key-value"].includes(profile.family ?? "")
  )
    return false;
  if (profile.ssh !== undefined) {
    try {
      parseSshConfiguration(profile.ssh);
      if (["sqlite", "duckdb"].includes(profile.driverId ?? "")) return false;
    } catch {
      return false;
    }
  }
  if (profile.driverId === "duckdb") {
    try {
      parseDuckDbConfiguration(profile.configuration);
      return /^[\da-f-]{36}$/i.test(profile.id);
    } catch {
      return false;
    }
  }
  if (profile.driverId === "sqlite")
    return (
      typeof profile.configuration?.path === "string" &&
      typeof profile.configuration.readOnly === "boolean"
    );
  if (isNoSqlDriver(profile.driverId)) {
    try {
      parseNoSqlConfiguration(profile.driverId, profile.configuration);
      return /^[\da-f-]{36}$/i.test(profile.id);
    } catch {
      return false;
    }
  }
  if (!isServerDriver(profile.driverId) || !/^[\da-f-]{36}$/i.test(profile.id)) return false;
  try {
    parseSqlConfiguration(profile.driverId as ServerDriver, profile.configuration);
    return true;
  } catch {
    return false;
  }
}

/** Owns profiles and sessions. VS Code storage stays in the workspace's extension host. */
export class ConnectionManager {
  private readonly uncertainWrites = new Set<string>();
  private profiles: ConnectionProfile[];
  private readonly sessions = new Map<string, Promise<OpenConnection>>();
  private disposed = false;
  private readonly starts = new Map<string, AbortController>();
  private readonly suspended = new Set<string>();

  constructor(
    private readonly context: ExtensionContext,
    private readonly registry: DriverRegistry,
    private readonly credentials?: CredentialService,
    private readonly ensureTrusted: () => void = () => {},
    private readonly tunnelFactory?: TunnelFactory,
  ) {
    const saved = context.workspaceState.get<unknown>("datsumi.connections", []);
    this.profiles = Array.isArray(saved) ? saved.filter(isProfile) : [];
  }
  displayName(id: string): string {
    const profile = this.get(id),
      env = this.viewText(`environment:${id}`);
    return `${env ? `[${env.toUpperCase()}] ` : ""}${profile.name}`;
  }
  viewText(key: string): string {
    const value = this.viewState(key);
    return typeof value === "string" ? value : "";
  }
  viewStrings(key: string): string[] {
    const value = this.viewState(key);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
  viewState(key: string): unknown {
    return this.context.workspaceState.get(`datsumi.view.${key}`);
  }
  saveViewState(key: string, value: unknown): Thenable<void> {
    return this.context.workspaceState.update(`datsumi.view.${key}`, value);
  }
  async transactionState(id: string): Promise<import("@datsumi/core").TransactionState> {
    const pending = this.sessions.get(id);
    if (!pending) return "unknown";
    const connection = await pending.catch(() => undefined);
    if (!connection || connection.driver.isConnected?.(connection.session) === false)
      return "unknown";
    return (
      connection.driver.transactionState?.(connection.session).catch(() => "unknown" as const) ??
      "unsupported"
    );
  }
  async transaction(id: string, action: "COMMIT" | "ROLLBACK"): Promise<void> {
    if (!["open", "failed"].includes(await this.transactionState(id)))
      throw new Error("No known open transaction on this connection.");
    await this.execute(id, { language: "sql", text: action });
  }
  all(): readonly ConnectionProfile[] {
    return this.profiles;
  }
  get(id: string): ConnectionProfile {
    const profile = this.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("Connection no longer exists.");
    return profile;
  }
  addSqlite(path: string, readOnly: boolean): Promise<ConnectionProfile> {
    return this.addLocalDatabase(path, readOnly, "sqlite");
  }
  addDuckdb(path: string, readOnly: boolean, create = false): Promise<ConnectionProfile> {
    return this.addLocalDatabase(path, readOnly, "duckdb", create);
  }
  private async addLocalDatabase(
    path: string,
    readOnly: boolean,
    driverId: "sqlite" | "duckdb",
    create = false,
  ): Promise<ConnectionProfile> {
    this.ensureTrusted();
    if (driverId === "duckdb") parseDuckDbConfiguration({ path, readOnly });
    const existing = this.profiles.find(
      (profile) =>
        profile.driverId === driverId &&
        path !== ":memory:" &&
        profile.configuration.path === path &&
        profile.configuration.readOnly === readOnly,
    );
    if (existing) {
      if (create) throw new Error("A connection already exists for this file. Open it instead.");
      await this.open(existing.id);
      return existing;
    }
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: path === ":memory:" ? "DuckDB (in-memory)" : basename(path),
      driverId,
      family: "relational",
      configuration: { path, readOnly },
    };
    this.profiles.push(profile);
    try {
      if (create && driverId === "duckdb") {
        const driver = this.registry.get(driverId);
        if (!driver) throw new Error("DuckDB support is unavailable.");
        const session = await driver.connect(profile, { ...profile.configuration, create: true });
        this.sessions.set(profile.id, Promise.resolve({ driver, session }));
      } else await this.open(profile.id);
      await this.persist();
      return profile;
    } catch (error) {
      this.profiles = this.profiles.filter((item) => item.id !== profile.id);
      await this.disconnect(profile.id);
      throw error;
    }
  }
  async addServer(
    driverId: ServerDriver | NoSqlDriver,
    name: string,
    configuration: ServerConfiguration | NoSqlConfiguration,
    answer: CredentialAnswer,
    ssh?: SshConfiguration,
    signal?: DriverCancellation,
  ): Promise<ConnectionProfile> {
    this.ensureTrusted();
    if (!this.credentials) throw new Error("Credential service unavailable.");
    const parsed = isNoSqlDriver(driverId)
      ? parseNoSqlConfiguration(driverId, configuration)
      : parseSqlConfiguration(driverId as ServerDriver, configuration);
    if (!name.trim() || name.length > 200 || name.split("").some((char) => char.charCodeAt(0) < 32))
      throw new Error("Enter a valid connection name.");
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: name.trim(),
      driverId,
      family:
        driverId === "mongodb" ? "document" : driverId === "redis" ? "key-value" : "relational",
      configuration: { ...parsed },
      ...(ssh ? { ssh: parseSshConfiguration(ssh) } : {}),
    };
    await this.credentials.set(profile, answer, true);
    this.profiles.push(profile);
    let persisted = false;
    try {
      // Use the supplied password for the initial attempt, including Ask every time.
      const pending = this.createConnection(profile, answer.password, signal);
      this.sessions.set(profile.id, pending);
      await pending;
      if (signal?.isCancellationRequested) throw new Error("Connection cancelled.");
      await this.persist();
      persisted = true;
      if (signal?.isCancellationRequested || this.disposed)
        throw new Error("Connection cancelled.");
      return profile;
    } catch (error) {
      this.profiles = this.profiles.filter((item) => item.id !== profile.id);
      await this.disconnect(profile.id);
      await this.credentials.forget(profile.id);
      if (persisted) await this.persist();
      throw error;
    }
  }
  async duplicateLocal(id: string): Promise<ConnectionProfile> {
    this.ensureTrusted();
    const source = this.get(id);
    if (!["sqlite", "duckdb"].includes(source.driverId))
      throw new Error("Choose a local connection.");
    const copy: ConnectionProfile = {
      id: randomUUID(),
      name: (source.name + " copy").slice(0, 200),
      family: source.family,
      driverId: source.driverId,
      configuration: { ...source.configuration },
    };
    this.profiles.push(copy);
    try {
      await this.persist();
    } catch (error) {
      this.profiles = this.profiles.filter((profile) => profile.id !== copy.id);
      throw error;
    }
    return copy;
  }
  async updateServer(
    id: string,
    name: string,
    configuration: ServerConfiguration | NoSqlConfiguration,
    answer: CredentialAnswer,
    ssh?: SshConfiguration,
  ): Promise<ConnectionProfile> {
    const original = this.get(id);
    if (["sqlite", "duckdb"].includes(original.driverId))
      throw new Error("Use local connection settings for this database.");
    const parsed = isNoSqlDriver(original.driverId)
      ? parseNoSqlConfiguration(original.driverId, configuration)
      : parseSqlConfiguration(original.driverId as ServerDriver, configuration);
    if (!name.trim() || name.length > 200)
      throw new Error("Enter a connection name up to 200 characters.");
    const base = { ...original };
    delete base.ssh;
    const updated: ConnectionProfile = {
      ...base,
      name: name.trim(),
      configuration: { ...parsed },
      ...(ssh ? { ssh: parseSshConfiguration(ssh) } : {}),
    };
    // Test the new destination with explicitly entered credentials, never old secrets.
    await this.testServer(
      original.driverId as ServerDriver | NoSqlDriver,
      parsed,
      answer.password,
      ssh,
    );
    await this.credentialChange(id, async () => {
      await this.disconnect(id);
      if (!this.credentials) throw new Error("Credential service unavailable.");
      await this.credentials.forget(id);
      await this.credentials.set(updated, answer, true);
      this.profiles = this.profiles.map((profile) => (profile.id === id ? updated : profile));
      await this.persist();
      this.sessions.set(id, this.createConnection(updated, answer.password));
      await this.sessions.get(id);
    });
    return updated;
  }
  async updateLocal(
    id: string,
    name: string,
    path: string,
    readOnly: boolean,
  ): Promise<ConnectionProfile> {
    const original = this.get(id);
    if (!["sqlite", "duckdb"].includes(original.driverId))
      throw new Error("Choose a local connection.");
    if (!name.trim() || name.length > 200) throw new Error("Enter a valid connection name.");
    if (original.driverId === "duckdb") parseDuckDbConfiguration({ path, readOnly });
    if (path !== ":memory:" && !(await stat(path)).isFile())
      throw new Error("Choose an existing database file.");
    const updated = { ...original, name: name.trim(), configuration: { path, readOnly } };
    await this.credentialChange(id, async () => {
      await this.disconnect(id);
      this.profiles = this.profiles.map((profile) => (profile.id === id ? updated : profile));
      try {
        this.sessions.set(id, this.createConnection(updated));
        await this.sessions.get(id);
        await this.persist();
      } catch (error) {
        await this.disconnect(id);
        this.profiles = this.profiles.map((profile) => (profile.id === id ? original : profile));
        throw error;
      }
    });
    return updated;
  }
  private async credentialChange(id: string, operation: () => Promise<void>): Promise<void> {
    this.ensureTrusted();
    if (this.suspended.has(id)) throw new Error("Connection settings are already being changed.");
    this.suspended.add(id);
    try {
      await operation();
    } finally {
      this.suspended.delete(id);
    }
  }
  async forgetCredentials(id: string): Promise<void> {
    if (["sqlite", "duckdb"].includes(this.get(id).driverId)) return;
    await this.credentialChange(id, async () => {
      await this.disconnect(id);
      await this.credentials?.forget(id);
    });
  }
  async changeCredentials(id: string, answer: CredentialAnswer): Promise<void> {
    const profile = this.get(id);
    if (["sqlite", "duckdb"].includes(profile.driverId) || !this.credentials)
      throw new Error("This connection does not use server credentials.");
    await this.credentialChange(id, async () => {
      await this.disconnect(id);
      await this.credentials!.set(profile, answer);
    });
  }
  async remove(id: string): Promise<void> {
    await this.credentialChange(id, async () => {
      await this.disconnect(id);
      if (!["sqlite", "duckdb"].includes(this.get(id).driverId)) await this.credentials?.forget(id);
      const profiles = this.profiles.filter((profile) => profile.id !== id);
      await this.context.workspaceState.update("datsumi.connections", profiles);
      this.profiles = profiles;
    });
  }
  async disconnect(id: string): Promise<void> {
    this.uncertainWrites.delete(id);
    const alreadySuspended = this.suspended.has(id);
    this.suspended.add(id);
    try {
      this.starts.get(id)?.abort();
      const pending = this.sessions.get(id);
      this.sessions.delete(id);
      if (pending) {
        const connection = await pending.catch(() => undefined);
        if (connection) await this.closeConnection(connection);
      }
    } finally {
      if (!alreadySuspended) this.suspended.delete(id);
    }
  }
  async resources(id: string, parentId?: string) {
    if (this.suspended.has(id)) return [];
    return this.operation(id, async (driver, session) =>
      driver.listResources ? driver.listResources(session, parentId) : [],
    );
  }
  async execute(
    id: string,
    request: QueryRequest,
    signal?: DriverCancellation,
  ): Promise<QueryResult> {
    return this.operation(
      id,
      (driver, session) => driver.execute(session, request, signal),
      signal,
    );
  }
  async browseData(id: string, request: import("@datsumi/core").DataPageRequest) {
    return this.operation(id, async (driver, session) => {
      if (!driver.browseData) throw new Error("Document/key browsing unavailable.");
      return driver.browseData(session, request);
    });
  }
  async changeData(id: string, request: import("@datsumi/core").DataChange, apply: boolean) {
    return this.mutation(id, apply, async (driver, session) => {
      if (!driver.changeData) throw new Error("Document/key editing unavailable.");
      return driver.changeData(session, request, apply);
    });
  }
  async browse(
    id: string,
    request: TablePageRequest,
    signal?: DriverCancellation,
  ): Promise<TablePage> {
    return this.operation(
      id,
      async (driver, session) => {
        if (!driver.browseTable) throw new Error("Table browsing unavailable.");
        return driver.browseTable(session, request, signal);
      },
      signal,
    );
  }
  async readCell(id: string, request: CellRequest, signal?: DriverCancellation): Promise<string> {
    return this.operation(
      id,
      async (driver, session) => {
        if (!driver.readCell) throw new Error("Full value inspection unavailable.");
        return driver.readCell(session, request, signal);
      },
      signal,
    );
  }
  async schema(id: string, signal?: DriverCancellation) {
    return this.operation(
      id,
      async (driver, session) => {
        if (!driver.schema) throw new Error("Schema inspection unavailable.");
        return driver.schema(session, signal);
      },
      signal,
    );
  }
  async changeRows(id: string, request: TableChanges, apply: boolean, signal?: DriverCancellation) {
    return this.mutation(
      id,
      apply,
      async (driver, session) => {
        if (!driver.changeRows) throw new Error("Row editing unavailable.");
        return driver.changeRows(session, request, apply, signal);
      },
      signal,
    );
  }
  private async mutation<T>(
    id: string,
    apply: boolean,
    action: (driver: DatabaseDriver, session: unknown) => Promise<T>,
    signal?: DriverCancellation,
  ): Promise<T> {
    if (this.uncertainWrites.has(id))
      throw new Error(
        "Write outcome unknown. Disconnect, reconnect and inspect fresh rows before reviewing changes again.",
      );
    return this.operation(
      id,
      async (driver, session) => {
        try {
          return await action(driver, session);
        } catch (error) {
          if (
            apply &&
            (driver.isConnected?.(session) === false ||
              /outcome unknown|rollback could not be confirmed/i.test(String(error)))
          ) {
            this.uncertainWrites.add(id);
            throw new Error(
              "Write outcome unknown. The server may have applied changes. Disconnect, reconnect and inspect fresh rows before reviewing a new batch. Do not retry blindly.",
            );
          }
          throw error;
        }
      },
      signal,
    );
  }
  async validateOutputDestination(path: string): Promise<void> {
    const sources = await Promise.allSettled(
      this.profiles
        .filter(
          (profile) =>
            ["sqlite", "duckdb"].includes(profile.driverId) &&
            profile.configuration.path !== ":memory:",
        )
        .map((profile) => stat(String(profile.configuration.path))),
    );
    try {
      const destination = await stat(path);
      if (
        sources.some(
          (source) =>
            source.status === "fulfilled" &&
            source.value.dev === destination.dev &&
            source.value.ino === destination.ino,
        )
      )
        throw new Error("Cannot overwrite a connected SQLite database or DuckDB database.");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  async exportTable(id: string, request: TableExport, signal?: DriverCancellation) {
    const { driver, session } = await this.open(id);
    if (!driver.exportTable) throw new Error("Table export is unavailable for this driver.");
    try {
      return await atomicOutput(
        request.path,
        (path) => {
          if (signal?.isCancellationRequested) throw new Error("Export cancelled.");
          return this.validateOutputDestination(path);
        },
        (temporary) => driver.exportTable!(session, { ...request, path: temporary }, signal),
      );
    } finally {
      if (driver.isConnected?.(session) === false) {
        const current = await this.sessions.get(id)?.catch(() => undefined);
        await current?.tunnel?.close();
      }
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.starts.values()) controller.abort();
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)));
    this.credentials?.dispose();
  }
  private async open(id: string, signal?: DriverCancellation): Promise<OpenConnection> {
    this.ensureTrusted();
    if (this.suspended.has(id))
      throw new Error(
        "Connection credentials are being changed. Retry when the operation finishes.",
      );
    if (this.disposed) throw new Error("Connection manager disposed.");
    const existing = this.sessions.get(id);
    if (existing) {
      const connection = await existing;
      // Cancellation terminates the database process. Reconnect only on the next operation.
      if (
        !connection.tunnel?.closed &&
        connection.driver.isConnected?.(connection.session) !== false
      )
        return connection;
      await this.closeConnection(connection);
      if (this.sessions.get(id) === existing) this.sessions.delete(id);
      return this.open(id, signal);
    }
    const profile = this.get(id);
    // Reserve before resolving credentials or starting SSH, so concurrent users share one session.
    const pending = Promise.resolve().then(async () =>
      this.createConnection(
        profile,
        ["sqlite", "duckdb"].includes(profile.driverId)
          ? undefined
          : await this.credentials?.resolve(profile),
        signal,
      ),
    );
    this.sessions.set(id, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.sessions.get(id) === pending) this.sessions.delete(id);
      throw error;
    }
  }
  async testServer(
    driverId: ServerDriver | NoSqlDriver,
    configuration: ServerConfiguration | NoSqlConfiguration,
    password: string,
    ssh?: SshConfiguration,
    signal?: DriverCancellation,
  ): Promise<void> {
    this.ensureTrusted();
    const parsed = isNoSqlDriver(driverId)
      ? parseNoSqlConfiguration(driverId, configuration)
      : parseSqlConfiguration(driverId as ServerDriver, configuration);
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: "Test connection",
      driverId,
      family:
        driverId === "mongodb" ? "document" : driverId === "redis" ? "key-value" : "relational",
      configuration: { ...parsed },
      ...(ssh ? { ssh: parseSshConfiguration(ssh) } : {}),
    };
    const connection = await this.createConnection(profile, password, signal);
    await this.closeConnection(connection);
  }
  private async closeConnection(connection: OpenConnection): Promise<void> {
    try {
      await connection.driver.disconnect(connection.session);
    } finally {
      await connection.tunnel?.close();
    }
  }
  private async createConnection(
    profile: ConnectionProfile,
    password?: string,
    signal?: DriverCancellation,
  ): Promise<OpenConnection> {
    const driver = this.registry.get(profile.driverId);
    if (!driver) throw new Error(`Driver unavailable: ${profile.driverId}`);
    const controller = new AbortController();
    this.starts.set(profile.id, controller);
    const external = signal?.onCancellationRequested(() => controller.abort());
    if (signal?.isCancellationRequested) controller.abort();
    const token = abortCancellation(controller.signal);
    let tunnel: ManagedTunnel | undefined, session: unknown;
    let connected = false;
    const cancellation = token.onCancellationRequested(() => {
      void tunnel?.close();
    });
    try {
      if (token.isCancellationRequested || this.disposed) throw new Error("Connection cancelled.");
      const configuration = ["sqlite", "duckdb"].includes(profile.driverId)
        ? { ...profile.configuration }
        : isNoSqlDriver(profile.driverId)
          ? { ...parseNoSqlConfiguration(profile.driverId, profile.configuration), password }
          : {
              ...parseSqlConfiguration(profile.driverId as ServerDriver, profile.configuration),
              password,
            };
      if (profile.ssh) {
        if (!this.tunnelFactory) throw new Error("SSH support is unavailable.");
        const target = databaseTunnelTarget(profile);
        tunnel = await this.tunnelFactory(profile.ssh, target, token);
      }
      session = await driver.connect(
        profile,
        { ...configuration, ...(tunnel ? { tunnelPort: tunnel.port } : {}) },
        token,
      );
      connected = true;
      if (token.isCancellationRequested || this.disposed || tunnel?.closed)
        throw new Error("SSH connection cancelled or closed.");
      tunnel?.onClose(() => {
        void driver.disconnect(session).catch(() => {});
      });
      return { driver, session, ...(tunnel ? { tunnel } : {}) };
    } catch (error) {
      try {
        if (connected) await driver.disconnect(session);
      } finally {
        await tunnel?.close();
      }
      throw error;
    } finally {
      external?.dispose();
      cancellation.dispose();
      if (this.starts.get(profile.id) === controller) this.starts.delete(profile.id);
    }
  }
  private async operation<T>(
    id: string,
    action: (driver: DatabaseDriver, session: unknown) => Promise<T>,
    signal?: DriverCancellation,
  ): Promise<T> {
    const connection = await this.open(id, signal);
    try {
      return await action(connection.driver, connection.session);
    } catch (error) {
      if (connection.tunnel?.closed && !signal?.isCancellationRequested)
        throw new Error(
          "SSH tunnel closed. Reconnect and verify any interrupted writes before retrying.",
        );
      throw error;
    } finally {
      if (connection.driver.isConnected?.(connection.session) === false)
        await connection.tunnel?.close();
    }
  }
  private persist(): Thenable<void> {
    return this.context.workspaceState.update("datsumi.connections", this.profiles);
  }
}

export function databaseTunnelTarget(profile: ConnectionProfile): {
  host: string;
  port: number;
  httpProxy?: boolean;
} {
  if (["libsql", "turso"].includes(profile.driverId))
    throw new Error(
      "Remote libSQL and Turso HTTP connections do not support built-in SSH yet. Use an HTTPS endpoint or VS Code Remote SSH.",
    );
  if (["sqlite", "duckdb"].includes(profile.driverId))
    throw new Error(
      "SSH is for server databases. Open remote database files using VS Code Remote SSH.",
    );
  if (isNoSqlDriver(profile.driverId)) {
    const uri = new URL(String(profile.configuration.endpoint));
    if (
      profile.driverId === "mongodb" &&
      (uri.protocol !== "mongodb:" || uri.searchParams.get("directConnection") === "false")
    )
      throw new Error(
        "SSH MongoDB requires a direct mongodb:// member connection; SRV and topology discovery need a VPN or Remote SSH.",
      );
    return {
      host: uri.hostname.replace(/^\[|\]$/g, ""),
      port: Number(uri.port || (profile.driverId === "mongodb" ? 27017 : 6379)),
    };
  }
  return {
    host: String(profile.configuration.host),
    port: Number(profile.configuration.port),
    ...(profile.driverId === "oracle" && profile.configuration.tls === "verify"
      ? { httpProxy: true }
      : {}),
  };
}
