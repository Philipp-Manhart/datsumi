import type { TableInfo } from "@datsumi/core";
import { parseResource, qualifiedName, quoteName } from "@datsumi/driver-sql/dialect";

import { sourceReferences, type SqlContext, type SqlSuggestion } from "./completion";
export function joinSuggestions(
  context: SqlContext,
  schema: readonly TableInfo[],
  driver: string,
): SqlSuggestion[] {
  if (!context.expectsTable || context.lastClause !== "JOIN") return [];
  const quote = (table: TableInfo) => {
    if (driver === "sqlite") return quoteName(driver, table.name);
    const target = parseResource(table.resourceId);
    return qualifiedName(driver, target.name, target.schema);
  };
  const suggestions: SqlSuggestion[] = [];
  for (const ref of sourceReferences(context)) {
    const candidates = schema.filter(
      (t) =>
        t.name.toLowerCase() === ref.name.toLowerCase() ||
        t.name.toLowerCase().endsWith("." + ref.name.toLowerCase()),
    );
    if (candidates.length !== 1) continue;
    const source = candidates[0]!;
    const alias = ref.alias !== ref.name ? quoteName(driver, ref.alias) : quote(source);
    for (const target of schema) {
      if (target === source) continue;
      const conditions = [
        ...source.foreignKeys
          .filter((k) => k.target === target.name)
          .map((k) =>
            k.columns
              .map(
                (column, i) =>
                  `${alias}.${quoteName(driver, column)} = ${quote(target)}.${quoteName(driver, k.targetColumns[i]!)}`,
              )
              .join(" AND "),
          ),
        ...target.foreignKeys
          .filter((k) => k.target === source.name)
          .map((k) =>
            k.columns
              .map(
                (column, i) =>
                  `${quote(target)}.${quoteName(driver, column)} = ${alias}.${quoteName(driver, k.targetColumns[i]!)}`,
              )
              .join(" AND "),
          ),
      ];
      const label = driver === "sqlite" ? target.name : parseResource(target.resourceId).name;
      if (!label.toLowerCase().startsWith(context.prefix.toLowerCase())) continue;
      for (const condition of conditions)
        suggestions.push({
          label,
          kind: "table",
          insertText: `${quote(target)} ON ${condition}`,
          detail: `JOIN via foreign key · ${source.name}`,
          priority: 0,
        });
    }
  }
  return suggestions;
}
