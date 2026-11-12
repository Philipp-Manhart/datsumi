import type { ConnectionProfile, TableInfo } from "@datsumi/core";
export function editingFeedback(profile: ConnectionProfile, table?: TableInfo): string {
  if (!table) return "Table metadata is unavailable. Refresh the database structure.";
  if (profile.driverId === "clickhouse")
    return "ClickHouse cannot provide the transactional rollback required by grid editing. Use explicit SQL for supported mutations.";
  if (profile.configuration.readOnly)
    return ["sqlite", "duckdb", "mongodb", "redis"].includes(profile.driverId)
      ? "This connection is read-only. Edit its connection settings or use a writable database account."
      : "Grid editing is disabled in connection settings. Editor SQL still uses your database account permissions.";
  if (table.kind === "view")
    return "Views cannot be edited through this grid. Open the underlying table.";
  if (!table.columns.some((column) => column.primaryKey > 0))
    return "Editing requires a primary key to identify each row safely. Add a primary key or use explicit SQL.";
  if (!table.editable)
    return "This table cannot guarantee transactional edits. Open a writable transactional table with a primary key.";
  return "Double-click a cell or press F2 to stage an edit. Review and confirm before committing. Generated columns and shortened originals cannot be edited.";
}
