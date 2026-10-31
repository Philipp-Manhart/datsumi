import {
  formatDialect,
  sqlite,
  postgresql,
  mysql,
  mariadb,
  transactsql,
  duckdb,
  plsql,
  clickhouse,
} from "sql-formatter";

export function formatSql(
  text: string,
  options: { tabSize: number; insertSpaces: boolean },
  eol = "\n",
  driver = "sqlite",
): string {
  if (!text.trim()) return text;
  const formatted = formatDialect(text, {
    dialect:
      (
        {
          duckdb,
          postgres: postgresql,
          mysql,
          mariadb,
          mssql: transactsql,
          oracle: plsql,
          clickhouse,
        } as Record<string, typeof sqlite>
      )[driver] ?? sqlite,
    tabWidth: options.tabSize,
    useTabs: !options.insertSpaces,
    keywordCase: "upper",
    linesBetweenQueries: 1,
  });
  return formatted.replace(/\r?\n/g, eol) + (/\r?\n$/.test(text) ? eol : "");
}
