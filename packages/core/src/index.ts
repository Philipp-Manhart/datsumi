/** Database families describe the model; drivers expose capabilities independently. */
export type DatabaseFamily = "relational" | "graph" | "document" | "key-value";

export type QueryLanguage = "sql" | "cypher" | "gremlin" | "graphql" | "custom";

export interface SshConfiguration {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  /** Path only, never private key contents or passphrases. Empty uses the SSH agent. */
  readonly keyPath: string;
}
export interface ConnectionProfile {
  readonly ssh?: SshConfiguration;
  readonly id: string;
  readonly name: string;
  readonly driverId: string;
  readonly family: DatabaseFamily;
  /** Non-secret driver settings only; credentials belong in SecretStorage. */
  readonly configuration: Readonly<Record<string, string | number | boolean>>;
  /** Reference into VS Code SecretStorage; credential values never belong here. */
  readonly secretStorageKey?: string;
}

export type DriverCapability =
  | "query"
  | "transactions"
  | "schema"
  | "tables"
  | "graph"
  | "documents";

export interface DriverDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly family: DatabaseFamily;
  readonly supportedQueryLanguages: readonly QueryLanguage[];
  readonly capabilities: readonly DriverCapability[];
}

export interface DriverCancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export type DatabaseResourceKind =
  | "catalog"
  | "schema"
  | "table"
  | "column"
  | "view"
  | "collection"
  | "graph"
  | "node-label"
  | "relationship-type"
  | "index"
  | "other";

/** A driver-neutral node for the native Connections tree. */
export interface DatabaseResource {
  readonly schema?: string | undefined;
  readonly id: string;
  readonly parentId?: string;
  readonly label: string;
  readonly kind: DatabaseResourceKind;
  readonly hasChildren: boolean;
  readonly description?: string;
}

export interface QueryRequest {
  /** Retain complete SQL results for clipboard use, within the 64 MiB session budget. */
  readonly captureAll?: boolean;
  readonly language: QueryLanguage;
  readonly text: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface GraphNode {
  readonly id: string;
  readonly labels: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export type QueryResult =
  | {
      readonly kind: "table";
      readonly additionalResults?:
        | readonly {
            columns: readonly string[];
            rows: readonly (readonly CellValue[])[];
            columnMetadata?: readonly ColumnMetadata[] | undefined;
            truncated?: boolean | undefined;
          }[]
        | undefined;
      readonly columns: readonly string[];
      readonly rows: readonly (readonly CellValue[])[];
      readonly columnMetadata?: readonly ColumnMetadata[] | undefined;
      readonly truncated?: boolean | undefined;
      readonly durationMs?: number | undefined;
    }
  | {
      readonly kind: "graph";
      readonly nodes: readonly GraphNode[];
      readonly edges: readonly GraphEdge[];
    }
  | { readonly kind: "value"; readonly value: unknown };

/** JSON-safe values preserve SQLite integers and identify binary/truncated cells. */
export type CellValue =
  | null
  | string
  | number
  | boolean
  | { readonly type: "integer"; readonly value: string }
  | { readonly type: "blob"; readonly hex: string; readonly bytes: number }
  | { readonly type: "text"; readonly value: string; readonly length: number }
  | { readonly type: "float"; readonly value: string };

export interface ColumnMetadata {
  readonly sourceColumn?: string | null | undefined;
  readonly name: string;
  readonly dataType: string | null;
  readonly table?: string | null | undefined;
  readonly database?: string | null | undefined;
}

export interface TablePageRequest {
  readonly filters?: readonly TableFilter[] | undefined;
  readonly order?:
    | { readonly column: string; readonly direction: "asc" | "desc" }
    | null
    | undefined;
  readonly resourceId: string;
  readonly offset: number;
  readonly limit: number;
}

export interface TablePage {
  readonly result: Extract<QueryResult, { kind: "table" }>;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

/** SQLite-style ordering over the captured, JSON-safe display values. */
export function compareCells(left: CellValue, right: CellValue): number {
  function comparable(value: CellValue): { rank: number; value: string | number | bigint } {
    if (value === null) return { rank: 0, value: 0 };
    if (typeof value === "number") return { rank: 1, value };
    if (typeof value === "boolean") return { rank: 1, value: Number(value) };
    if (typeof value === "string") return { rank: 2, value };
    if (value.type === "integer") return { rank: 1, value: BigInt(value.value) };
    if (value.type === "float") return { rank: 1, value: Number(value.value) };
    if (value.type === "blob") return { rank: 3, value: value.hex };
    return { rank: 2, value: value.value };
  }
  const a = comparable(left),
    b = comparable(right);
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

export interface TableFilter {
  readonly column: string;
  readonly operator: "=" | "<>" | "<" | ">" | "<=" | ">=" | "contains" | "IS NULL" | "IS NOT NULL";
  readonly value?: CellValue | undefined;
}
export interface TableColumn {
  readonly name: string;
  readonly type: string;
  readonly primaryKey: number;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
  readonly generated: boolean;
}
export interface ForeignKey {
  readonly id: number;
  readonly target: string;
  readonly columns: readonly string[];
  readonly targetColumns: readonly string[];
  readonly onUpdate: string;
  readonly onDelete: string;
}
export interface TableInfo {
  readonly schema?: string | undefined;
  readonly database?: string | undefined;
  readonly driverId?: string | undefined;
  readonly resourceId: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly ddl: string;
  readonly columns: readonly TableColumn[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly indexes: readonly {
    readonly name: string;
    readonly unique: boolean;
    readonly columns: readonly string[];
    readonly ddl: string;
  }[];
  readonly editable: boolean;
}
export interface RowChange {
  readonly kind: "insert" | "update" | "delete";
  readonly original?: Readonly<Record<string, CellValue>> | undefined;
  readonly values: Readonly<Record<string, CellValue>>;
}
export interface TableChanges {
  readonly resourceId: string;
  readonly changes: readonly RowChange[];
}
export interface TableExport {
  readonly request: TablePageRequest;
  readonly path: string;
  readonly format: "csv" | "json";
  readonly spreadsheetSafe?: boolean;
}

export interface CellRequest {
  readonly resourceId: string;
  readonly column: string;
  readonly key: Readonly<Record<string, CellValue>>;
}

export { formatJson, jsonEntries, type JsonEntry } from "./json";
export type TransactionState = "idle" | "manual" | "open" | "failed" | "unknown" | "unsupported";
export interface DataPageRequest {
  resource: string;
  cursor?: string;
  filter?: string;
  limit: number;
}
export interface DataRecord {
  id: string;
  text: string;
  type?: string;
  ttl?: number;
  editable: boolean;
}
export interface DataPage {
  records: readonly DataRecord[];
  cursor?: string;
  note?: string;
}
export interface DataChange {
  resource: string;
  id: string;
  original: string;
  text: string;
  ttl?: number;
}

export { clipboardTsv, clipboardValue, spreadsheetText } from "./clipboard";

export { statementAt } from "./statements";
