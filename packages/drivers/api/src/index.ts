import type {
  DataPage,
  DataPageRequest,
  DataChange,
  TransactionState,
  CellRequest,
  TableInfo,
  TableChanges,
  TableExport,
  ConnectionProfile,
  DriverDescriptor,
  DatabaseResource,
  DriverCancellation,
  QueryRequest,
  QueryResult,
  TablePageRequest,
  TablePage,
} from "@datsumi/core";

/** Implemented by a database package and called only from the extension host. */
export interface DatabaseDriver<TConfiguration = unknown, TSession = unknown> {
  readonly descriptor: DriverDescriptor;

  connect(
    profile: ConnectionProfile,
    configuration: TConfiguration,
    signal?: DriverCancellation,
  ): Promise<TSession>;

  execute(
    session: TSession,
    request: QueryRequest,
    signal?: DriverCancellation,
  ): Promise<QueryResult>;

  disconnect(session: TSession): Promise<void>;
  transactionState?(session: TSession): Promise<TransactionState>;
  browseData?(session: TSession, request: DataPageRequest): Promise<DataPage>;
  changeData?(session: TSession, request: DataChange, apply: boolean): Promise<string>;

  /** Lets the host reconnect sessions invalidated by cancellation or transport failure. */
  isConnected?(session: TSession): boolean;

  browseTable?(
    session: TSession,
    request: TablePageRequest,
    signal?: DriverCancellation,
  ): Promise<TablePage>;

  readCell?(session: TSession, request: CellRequest, signal?: DriverCancellation): Promise<string>;
  schema?(session: TSession, signal?: DriverCancellation): Promise<readonly TableInfo[]>;
  changeRows?(
    session: TSession,
    request: TableChanges,
    apply: boolean,
    signal?: DriverCancellation,
  ): Promise<readonly string[]>;
  exportTable?(
    session: TSession,
    request: TableExport,
    signal?: DriverCancellation,
  ): Promise<number>;

  /** Optional tree metadata support, such as schemas or graph labels. */
  listResources?(
    session: TSession,
    parentId?: string,
    signal?: DriverCancellation,
  ): Promise<readonly DatabaseResource[]>;
}

export interface DriverRegistry {
  register(driver: DatabaseDriver): void;
  get(driverId: string): DatabaseDriver | undefined;
  all(): readonly DatabaseDriver[];
}

/** Reject duplicate IDs at startup instead of silently replacing a driver. */
export class InMemoryDriverRegistry implements DriverRegistry {
  private readonly drivers = new Map<string, DatabaseDriver>();

  register(driver: DatabaseDriver): void {
    const { id } = driver.descriptor;
    if (this.drivers.has(id)) {
      throw new Error(`A database driver with id "${id}" is already registered.`);
    }
    this.drivers.set(id, driver);
  }

  get(driverId: string): DatabaseDriver | undefined {
    return this.drivers.get(driverId);
  }

  all(): readonly DatabaseDriver[] {
    return [...this.drivers.values()];
  }
}
