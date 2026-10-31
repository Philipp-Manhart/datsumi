import { functions, keywords } from "./vocabulary";
interface SqlFunction {
  name: string;
  parameters: readonly string[];
  description: string;
}
const commonWords =
  "SELECT DISTINCT ALL FROM AS JOIN INNER LEFT RIGHT FULL CROSS ON WHERE AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ESCAPE GROUP BY HAVING ORDER ASC DESC UNION EXCEPT INTERSECT INSERT INTO VALUES UPDATE SET DELETE CREATE ALTER DROP TABLE VIEW INDEX UNIQUE PRIMARY FOREIGN KEY REFERENCES DEFAULT CHECK CONSTRAINT CASE WHEN THEN ELSE END BEGIN COMMIT ROLLBACK TRANSACTION WITH RECURSIVE OVER PARTITION ROWS CURRENT ROW FOLLOWING PRECEDING UNBOUNDED CAST COLLATE".split(
    " ",
  );
export function dialectKeywords(driver: string): readonly string[] {
  if (["sqlite", "libsql", "turso"].includes(driver)) return keywords;
  const extra =
    driver === "oracle"
      ? "FETCH FIRST NEXT ONLY OFFSET MERGE USING MATCHED SEQUENCE NEXTVAL DUAL ROWNUM RETURNING INTO VARCHAR2 NUMBER CLOB PL SQL EXCEPTION LOOP ELSIF"
      : driver === "clickhouse"
        ? "LIMIT OFFSET PREWHERE SETTINGS FORMAT ARRAY FINAL SAMPLE ENGINE PARTITION TTL MATERIALIZED"
        : driver === "duckdb"
          ? "QUALIFY PIVOT UNPIVOT EXCLUDE REPLACE ILIKE LIMIT OFFSET SAMPLE USING RETURNING STRUCT MAP LIST ARRAY NULLS FIRST LAST"
          : driver === "postgres"
            ? "ILIKE RETURNING CONFLICT DO NOTHING LIMIT OFFSET FETCH LATERAL MATERIALIZED NULLS FIRST LAST BOOLEAN JSONB"
            : driver === "mssql"
              ? "TOP OUTPUT APPLY EXEC EXECUTE DECLARE GO USE OFFSET FETCH NEXT ONLY NVARCHAR BIT DATETIME2 TRY CATCH"
              : "LIMIT OFFSET DUPLICATE REPLACE SHOW DESCRIBE EXPLAIN START SAVEPOINT RELEASE DATABASE USE AUTO_INCREMENT XOR REGEXP";
  return [...new Set([...commonWords, ...extra.split(" ")])];
}
export function dialectFunctions(driver: string): readonly SqlFunction[] {
  if (["sqlite", "libsql", "turso"].includes(driver)) return functions;
  const duckFunctions: SqlFunction[] =
    driver === "duckdb"
      ? [
          { name: "READ_CSV", parameters: ["path"], description: "Reads a CSV file as a table." },
          {
            name: "READ_PARQUET",
            parameters: ["path"],
            description: "Reads a Parquet file as a table.",
          },
          {
            name: "READ_JSON",
            parameters: ["path"],
            description: "Reads a JSON file as a table (requires the JSON extension).",
          },
          { name: "RANGE", parameters: ["stop"], description: "Generates a table of numbers." },
          { name: "UNNEST", parameters: ["list"], description: "Expands a list or struct." },
          {
            name: "DATE_TRUNC",
            parameters: ["part", "timestamp"],
            description: "Truncates a timestamp to the given precision.",
          },
        ]
      : [];
  const common = new Set([
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "COALESCE",
    "NULLIF",
    "LOWER",
    "UPPER",
    "REPLACE",
    "TRIM",
    "ROUND",
    "ABS",
    ...(driver === "mssql" ? [] : ["LENGTH", "SUBSTR"]),
    ...(driver === "mysql" || driver === "mariadb" ? ["IFNULL", "GROUP_CONCAT"] : []),
  ]);
  const extra: SqlFunction[] =
    driver === "mssql"
      ? [
          {
            name: "LEN",
            parameters: ["text"],
            description: "Returns the string length, excluding trailing spaces.",
          },
          {
            name: "GETDATE",
            parameters: [],
            description: "Returns the current server date and time.",
          },
          {
            name: "ISNULL",
            parameters: ["value", "fallback"],
            description: "Replaces NULL with the fallback value.",
          },
          {
            name: "SUBSTRING",
            parameters: ["text", "start", "length"],
            description: "Extracts part of a string.",
          },
          {
            name: "STRING_AGG",
            parameters: ["expression", "separator"],
            description: "Concatenates values with a separator.",
          },
        ]
      : [
          { name: "NOW", parameters: [], description: "Returns the current date and time." },
          { name: "CONCAT", parameters: ["text", "..."], description: "Concatenates text values." },
          ...(driver === "postgres"
            ? [
                {
                  name: "STRING_AGG",
                  parameters: ["expression", "separator"],
                  description: "Concatenates values with a separator.",
                },
              ]
            : [
                {
                  name: "JSON_EXTRACT",
                  parameters: ["document", "path"],
                  description: "Extracts a value from a JSON document.",
                },
              ]),
        ];
  return [...functions.filter((fn) => common.has(fn.name)), ...extra, ...duckFunctions];
}
