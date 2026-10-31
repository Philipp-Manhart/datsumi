import type { CellValue, TableFilter, TableInfo } from "@datsumi/core";

import type { ServerDriver } from "./configuration";
export type SqlDialect = ServerDriver | "sqlite";
export function quoteName(driver: string, name: string): string {
  if (driver === "mysql" || driver === "mariadb" || driver === "clickhouse")
    return "`" + name.replaceAll("`", "``") + "`";
  if (driver === "mssql") return "[" + name.replaceAll("]", "]]") + "]";
  return '"' + name.replaceAll('"', '""') + '"';
}
export function qualifiedName(driver: string, name: string, schema?: string): string {
  return [...(schema ? [quoteName(driver, schema)] : []), quoteName(driver, name)].join(".");
}
export function selectSql(driver: string, name: string, schema?: string, limit = 100): string {
  const target = qualifiedName(driver, name, schema);
  return driver === "mssql"
    ? `SELECT TOP (${limit}) * FROM ${target};`
    : driver === "oracle"
      ? `SELECT * FROM ${target} FETCH FIRST ${limit} ROWS ONLY`
      : `SELECT * FROM ${target} LIMIT ${limit};`;
}
export function resourceId(schema: string, name: string): string {
  return JSON.stringify([schema, name]);
}
export function parseResource(id: string): { schema: string; name: string } {
  let value: unknown;
  try {
    value = JSON.parse(id);
  } catch {
    throw new Error("Invalid table identity.");
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((part) => typeof part === "string" && part.length > 0)
  )
    throw new Error("Invalid table identity.");
  return { schema: String(value[0]), name: String(value[1]) };
}
export function parameter(driver: string, index: number): string {
  return driver === "postgres"
    ? `$${index + 1}`
    : driver === "mssql"
      ? `@p${index}`
      : driver === "oracle"
        ? `:${index + 1}`
        : driver === "clickhouse"
          ? `{p${index}:String}`
          : "?";
}
export function input(value: CellValue): unknown {
  if (value && typeof value === "object") {
    if (value.type === "integer") return value.value;
    throw new Error("Binary, non-finite and shortened cells cannot be used in edits or filters.");
  }
  return value;
}
export function whereFilters(
  driver: string,
  info: TableInfo,
  filters: readonly TableFilter[],
  values: unknown[],
): string {
  if (filters.length > 20) throw new Error("At most 20 filters are supported.");
  return filters
    .map((filter) => {
      if (!info.columns.some((column) => column.name === filter.column))
        throw new Error("Unknown filter column.");
      const col = quoteName(driver, filter.column);
      if (filter.operator === "IS NULL" || filter.operator === "IS NOT NULL")
        return `${col} ${filter.operator}`;
      if (!["=", "<>", "<", ">", "<=", ">=", "contains"].includes(filter.operator))
        throw new Error("Unsupported filter operator.");
      if (filter.value === undefined) throw new Error("A filter value is required.");
      if (filter.value === null) {
        if (filter.operator !== "=" && filter.operator !== "<>")
          throw new Error("Use IS NULL to filter nulls.");
        return `${col} IS ${filter.operator === "<>" ? "NOT " : ""}NULL`;
      }
      if (driver === "clickhouse" && filter.operator === "contains") {
        const mark = `{p${values.length}:String}`;
        values.push(String(input(filter.value)));
        return `position(toString(${col}), ${mark}) > 0`;
      }
      const mark =
        driver === "clickhouse"
          ? `{p${values.length}:${filter.operator === "contains" ? "String" : info.columns.find((column) => column.name === filter.column)!.type}}`
          : parameter(driver, values.length);
      values.push(
        filter.operator === "contains"
          ? `%${String(input(filter.value)).replace(/[!%_[]/g, "!$&")}%`
          : input(filter.value),
      );
      return `${col} ${filter.operator === "contains" ? "LIKE" : filter.operator} ${mark}${filter.operator === "contains" ? " ESCAPE '!'" : ""}`;
    })
    .join(" AND ");
}
