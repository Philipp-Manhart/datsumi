// SQLite's keyword list: https://www.sqlite.org/lang_keywords.html
export const keywords =
  `ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE BEGIN BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE DESC DETACH DISTINCT DO DROP EACH ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL FILTER FIRST FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP GROUPS HAVING IF IGNORE IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL NULL NULLS OF OFFSET ON OR ORDER OTHERS OUTER OVER PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER UNBOUNDED UNION UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT`.split(
    " ",
  );
export const keywordSet = new Set(keywords);

export const functions = [
  {
    name: "COUNT",
    parameters: ["expression"],
    description: "Counts non-NULL values; COUNT(*) counts rows.",
  },
  { name: "SUM", parameters: ["expression"], description: "Sums non-NULL values." },
  { name: "AVG", parameters: ["expression"], description: "Averages non-NULL values." },
  { name: "MIN", parameters: ["expression"], description: "Returns the smallest value." },
  { name: "MAX", parameters: ["expression"], description: "Returns the largest value." },
  {
    name: "GROUP_CONCAT",
    parameters: ["expression", "separator (optional)"],
    description: "Joins non-NULL values into a string.",
  },
  {
    name: "COALESCE",
    parameters: ["value", "fallback", "..."],
    description: "Returns the first non-NULL argument.",
  },
  {
    name: "IFNULL",
    parameters: ["value", "fallback"],
    description: "Returns fallback when value is NULL.",
  },
  {
    name: "NULLIF",
    parameters: ["value", "other"],
    description: "Returns NULL when the two arguments are equal.",
  },
  { name: "LENGTH", parameters: ["value"], description: "Returns the length of a string or blob." },
  { name: "LOWER", parameters: ["text"], description: "Converts ASCII letters to lowercase." },
  { name: "UPPER", parameters: ["text"], description: "Converts ASCII letters to uppercase." },
  {
    name: "SUBSTR",
    parameters: ["text", "start", "length (optional)"],
    description: "Extracts a substring using a 1-based start position.",
  },
  {
    name: "REPLACE",
    parameters: ["text", "search", "replacement"],
    description: "Replaces occurrences of search in text.",
  },
  {
    name: "TRIM",
    parameters: ["text", "characters (optional)"],
    description: "Removes characters from both ends of text.",
  },
  {
    name: "ROUND",
    parameters: ["number", "digits (optional)"],
    description: "Rounds to the requested number of decimal places.",
  },
  { name: "ABS", parameters: ["number"], description: "Returns an absolute value." },
  {
    name: "DATE",
    parameters: ["time_value", "modifier (optional)", "..."],
    description: "Returns a date as YYYY-MM-DD.",
  },
  {
    name: "DATETIME",
    parameters: ["time_value", "modifier (optional)", "..."],
    description: "Returns a date and time.",
  },
  {
    name: "STRFTIME",
    parameters: ["format", "time_value", "modifier (optional)", "..."],
    description: "Formats a date/time using a format string.",
  },
  {
    name: "JSON_EXTRACT",
    parameters: ["json", "path", "..."],
    description: "Extracts values at JSON paths.",
  },
  {
    name: "JSON_OBJECT",
    parameters: ["key", "value", "..."],
    description: "Builds a JSON object from key/value pairs.",
  },
  { name: "JSON_ARRAY", parameters: ["value", "..."], description: "Builds a JSON array." },
  {
    name: "ROW_NUMBER",
    parameters: [],
    description: "Window function returning the row's sequence number; use with OVER (...).",
  },
  {
    name: "RANK",
    parameters: [],
    description: "Window function returning a rank with gaps; use with OVER (...).",
  },
  {
    name: "LAG",
    parameters: ["expression", "offset (optional)", "default (optional)"],
    description: "Reads a preceding row; use with OVER (...).",
  },
  {
    name: "LEAD",
    parameters: ["expression", "offset (optional)", "default (optional)"],
    description: "Reads a following row; use with OVER (...).",
  },
] as const;
