import { z } from "zod";

export const cellValueSchema = z.union([
  z.null(),
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.object({ type: z.literal("integer"), value: z.string().regex(/^-?\d+$/) }),
  z.object({ type: z.literal("blob"), hex: z.string(), bytes: z.number().int().nonnegative() }),
  z.object({ type: z.literal("text"), value: z.string(), length: z.number().int().nonnegative() }),
  z.object({ type: z.literal("float"), value: z.string() }),
]);

export const queryResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("table"),
    columns: z.array(z.string()),
    rows: z.array(z.array(cellValueSchema)),
    columnMetadata: z
      .array(
        z.object({
          name: z.string(),
          dataType: z.string().nullable(),
          sourceColumn: z.string().nullable().optional(),
          table: z.string().nullable().optional(),
          database: z.string().nullable().optional(),
        }),
      )
      .optional(),
    truncated: z.boolean().optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("graph"),
    nodes: z.array(
      z.object({
        id: z.string(),
        labels: z.array(z.string()),
        properties: z.record(z.string(), z.unknown()),
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        label: z.string(),
        properties: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
  z.object({ kind: z.literal("value"), value: z.unknown() }),
]);

export const resultSortSchema = z.object({
  column: z.number().int().nonnegative(),
  direction: z.enum(["asc", "desc"]),
});
export const tableFilterSchema = z.object({
  column: z.string(),
  operator: z.enum(["=", "<>", "<", ">", "<=", ">=", "contains", "IS NULL", "IS NOT NULL"]),
  value: cellValueSchema.optional(),
});
export const tableOrderSchema = z
  .object({ column: z.string(), direction: z.enum(["asc", "desc"]) })
  .nullable();
export const rowChangeSchema = z.object({
  kind: z.enum(["insert", "update", "delete"]),
  original: z.record(z.string(), cellValueSchema).optional(),
  values: z.record(z.string(), cellValueSchema),
});
export const tableInfoSchema = z.object({
  schema: z.string().optional(),
  database: z.string().optional(),
  driverId: z.string().optional(),
  resourceId: z.string(),
  name: z.string(),
  kind: z.enum(["table", "view"]),
  ddl: z.string(),
  editable: z.boolean(),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      primaryKey: z.number(),
      notNull: z.boolean(),
      defaultValue: z.string().nullable(),
      generated: z.boolean(),
    }),
  ),
  foreignKeys: z.array(
    z.object({
      id: z.number(),
      target: z.string(),
      columns: z.array(z.string()),
      targetColumns: z.array(z.string()),
      onUpdate: z.string(),
      onDelete: z.string(),
    }),
  ),
  indexes: z.array(
    z.object({
      name: z.string(),
      unique: z.boolean(),
      columns: z.array(z.string()),
      ddl: z.string(),
    }),
  ),
});
const pageBounds = {
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(500),
};

export const viewPreferencesSchema = z.object({
  layoutVersion: z.number().int().optional(),
  frozen: z.array(z.string()).max(500).optional(),
  widths: z.record(z.string(), z.number().min(80).max(2000)).optional(),
  hidden: z.array(z.string()).max(500).optional(),
  columns: z.array(z.string()).max(500).optional(),
  positions: z
    .record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite() }))
    .optional(),
  filters: z.array(tableFilterSchema).max(20).optional(),
  order: tableOrderSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
/** Clients manipulate host-owned snapshots; paging and sorting never execute SQL. */
export const webviewRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), protocolVersion: z.literal(1) }),
  z.object({
    type: z.literal("data/browse"),
    filter: z.string().max(65536),
    cursor: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("data/edit"),
    id: z.string().max(10000),
    text: z.string().max(1024 * 1024),
    apply: z.boolean(),
  }),
  z.object({ type: z.literal("data/back") }),
  z.object({ type: z.literal("data/forward") }),
  z.object({ type: z.literal("data/query") }),

  z.object({
    type: z.literal("view/preferences"),
    resultId: z.string().optional(),
    preferences: viewPreferencesSchema,
  }),
  z.object({ type: z.literal("query/compare"), resultId: z.string() }),
  z.object({
    type: z.literal("table/json"),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
  }),

  z.object({ type: z.literal("table/page"), ...pageBounds }),
  z.object({
    type: z.literal("table/filter"),
    filters: z.array(tableFilterSchema).max(20),
    order: tableOrderSchema,
  }),
  z.object({
    type: z.literal("table/changes"),
    resultId: z.string().optional(),
    changes: z.array(rowChangeSchema).max(1000),
    apply: z.boolean(),
  }),
  z.object({
    type: z.literal("table/related"),
    target: z.string(),
    filters: z.array(tableFilterSchema).max(20),
  }),
  z.object({ type: z.literal("table/import") }),
  z.object({
    type: z.literal("table/saveDraft"),
    resultId: z.string().optional(),
    changes: z.array(rowChangeSchema).max(1000),
  }),
  z.object({
    type: z.literal("table/value"),
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("table/discard"), resultId: z.string().optional() }),
  z.object({
    type: z.literal("table/stage"),
    resultId: z.string().optional(),
    changes: z.array(rowChangeSchema).max(1000),
  }),
  z.object({ type: z.literal("table/sql"), action: z.enum(["ddl", "select", "insert", "update"]) }),
  z.object({ type: z.literal("schema/open"), focus: z.string().optional() }),
  z.object({ type: z.literal("schema/browse"), table: z.string() }),
  z.object({
    type: z.literal("data/export"),
    format: z.enum(["csv", "json"]),
    scope: z.enum(["page", "snapshot", "table"]),
  }),
  z.object({
    type: z.literal("table/copy"),
    columns: z.array(z.number().int().nonnegative()).min(1).max(10000),
    headers: z.boolean(),
    format: z.enum(["tsv", "json"]),
  }),
  z.object({
    type: z.literal("query/copy"),
    resultId: z.string().min(1),
    columns: z.array(z.number().int().nonnegative()).min(1).max(10000),
    headers: z.boolean(),
    format: z.enum(["tsv", "json"]),
  }),
  z.object({ type: z.literal("data/copy"), text: z.string().max(64 * 1024 * 1024) }),
  z.object({ type: z.literal("query/pin"), resultId: z.string().min(1), pinned: z.boolean() }),
  z.object({ type: z.literal("query/select"), resultId: z.string().min(1) }),
  z.object({ type: z.literal("query/close"), resultId: z.string().min(1) }),
  z.object({
    type: z.literal("query/search"),
    resultId: z.string().min(1),
    text: z.string().max(1000),
  }),
  z.object({ type: z.literal("query/rename"), resultId: z.string().min(1) }),
  z.object({ type: z.literal("query/page"), resultId: z.string().min(1), ...pageBounds }),
  z.object({
    type: z.literal("query/sort"),
    resultId: z.string().min(1),
    sort: resultSortSchema.nullable(),
  }),
]);

export const webviewResponseSchema = z.object({
  editingReason: z.string().optional(),
  search: z.string().optional(),
  mode: z.enum(["table", "diagram", "plan", "data"]).optional(),
  schema: z.array(tableInfoSchema).optional(),
  tableInfo: tableInfoSchema.optional(),
  focusTable: z.string().optional(),
  filters: z.array(tableFilterSchema).optional(),
  order: tableOrderSchema.optional(),
  previewSql: z.array(z.string()).optional(),
  staged: z.array(rowChangeSchema).optional(),
  type: z.literal("results/state"),
  protocolVersion: z.literal(1),
  title: z.string(),
  connectionName: z.string(),
  driverName: z.string().optional(),
  preferences: viewPreferencesSchema.optional(),
  data: z
    .object({
      resource: z.string(),
      filter: z.string(),
      cursor: z.string().optional(),
      note: z.string().optional(),
      back: z.boolean(),
      forward: z.boolean().optional(),
      preview: z.string().optional(),
      records: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          type: z.string().optional(),
          ttl: z.number().optional(),
          editable: z.boolean(),
        }),
      ),
    })
    .optional(),
  display: z
    .object({
      density: z.enum(["compact", "comfortable"]),
      showDataTypes: z.boolean(),
      nullDisplay: z.string().max(24),
    })
    .optional(),
  busy: z.boolean(),
  result: queryResultSchema.nullable(),
  error: z.string().nullable(),
  page: z
    .object({
      ...pageBounds,
      hasMore: z.boolean(),
      totalRows: z.number().int().nonnegative().optional(),
    })
    .nullable(),
  tabs: z
    .array(
      z.object({
        id: z.string(),
        pinned: z.boolean().optional(),
        title: z.string(),
        connectionName: z.string(),
        query: z.string(),
        busy: z.boolean(),
        error: z.boolean(),
      }),
    )
    .optional(),
  activeResultId: z.string().nullable().optional(),
  sort: resultSortSchema.nullable().optional(),
});

export type WebviewRequest = z.infer<typeof webviewRequestSchema>;
export type WebviewResponse = z.infer<typeof webviewResponseSchema>;
export type CellValue = z.infer<typeof cellValueSchema>;

export const connectionFormSchema = z.object({
  driver: z.enum([
    "sqlite",
    "duckdb",
    "postgres",
    "mysql",
    "mariadb",
    "mssql",
    "clickhouse",
    "oracle",
    "libsql",
    "turso",
    "mongodb",
    "redis",
  ]),
  provider: z.enum(["standard", "neon", "supabase"]).optional(),
  ssh: z
    .object({
      enabled: z.boolean(),
      host: z.string().max(1024),
      port: z.string().max(5),
      username: z.string().max(200),
      keyPath: z.string().max(8192),
    })
    .optional(),
  mode: z.enum(["fields", "url"]),
  name: z.string().max(200),
  url: z.string().max(8192),
  host: z.string().max(1024),
  port: z.string().max(5),
  database: z.string().max(1024),
  username: z.string().max(500),
  password: z.string().max(65536),
  credentialMode: z.enum(["session", "save", "ask"]),
  tls: z.boolean(),
  ca: z.string().max(1024 * 1024),
  readOnly: z.boolean(),
  path: z.string().max(8192),
  create: z.boolean(),
});
export type ConnectionFormValues = z.infer<typeof connectionFormSchema>;
export const connectionFormRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connection/ready") }),
  z.object({ type: z.literal("connection/sshKey") }),
  z.object({
    type: z.literal("connection/browse"),
    driver: z.enum(["sqlite", "duckdb"]),
    create: z.boolean(),
  }),
  z.object({
    type: z.literal("connection/submit"),
    values: connectionFormSchema,
    test: z.boolean(),
  }),
]);
