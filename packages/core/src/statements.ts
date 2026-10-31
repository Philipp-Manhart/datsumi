/** Split only at SQL semicolons outside quoted identifiers, literals and comments.
 * Trigger bodies retain their internal semicolons until the matching END. */
export function statementAt(text: string, caret: number, driver = "sqlite"): string {
  let start = 0;
  let quote = "";
  let comment = "";
  let trigger = false;
  let block = 0;
  let prefix = "";
  let oracleBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!,
      next = text[i + 1];
    if (comment) {
      if (comment === "--" && c === "\n") comment = "";
      else if (comment === "/*" && c === "*" && next === "/") {
        comment = "";
        i++;
      }
      continue;
    }
    if (quote.startsWith("$")) {
      if (text.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = "";
      }
      continue;
    }
    if (quote) {
      if ((driver === "mysql" || driver === "mariadb") && c === "\\") {
        i++;
        continue;
      }
      if (c === quote) {
        if (next === quote) i++;
        else quote = "";
      }
      continue;
    }
    if (
      driver === "oracle" &&
      c === "/" &&
      (i === 0 || text[i - 1] === "\n") &&
      /^\/\s*(?:\n|$)/.test(text.slice(i))
    ) {
      if (caret <= i) return text.slice(start, i).trim();
      start = i + 1;
      oracleBlock = false;
      prefix = "";
      continue;
    }
    if (driver === "oracle" && (c === "q" || c === "Q") && next === "'" && text[i + 2]) {
      const opening = text[i + 2]!;
      const closing =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[opening] ?? opening;
      const end = text.indexOf(closing + "'", i + 3);
      if (end < 0) return text.slice(start).trim();
      i = end + 1;
      continue;
    }
    if ((driver === "postgres" || driver === "duckdb") && c === "$") {
      const delimiter = text.slice(i).match(/^\$(?:[a-z_][a-z_0-9]*)?\$/i)?.[0];
      if (delimiter) {
        quote = delimiter;
        i += delimiter.length - 1;
        continue;
      }
    }
    if ((driver === "mysql" || driver === "mariadb") && c === "#") {
      comment = "--";
      continue;
    }
    if (driver === "mssql" && (i === 0 || text[i - 1] === "\n")) {
      const separator = text.slice(i).match(/^[ \t]*GO[ \t]*(?:--[^\n]*)?\r?(?:\n|$)/i)?.[0];
      if (separator) {
        if (caret <= i) return text.slice(start, i).trim();
        start = i + separator.length;
        i = start - 1;
        continue;
      }
    }
    if (c === "-" && next === "-") {
      comment = "--";
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      comment = "/*";
      i++;
      continue;
    }
    if (["'", '"', "`", "["].includes(c)) {
      quote = c === "[" ? "]" : c;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      let end = i + 1;
      while (end < text.length && /[a-z_0-9]/i.test(text[end]!)) end++;
      const word = text.slice(i, end).toUpperCase();
      prefix += word + " ";
      if (
        driver === "oracle" &&
        /^(?:BEGIN |DECLARE |CREATE (?:OR REPLACE )?(?:PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE) )/.test(
          prefix,
        )
      )
        oracleBlock = true;
      if (/^CREATE (?:TEMP |TEMPORARY )?TRIGGER /.test(prefix)) trigger = true;
      if (trigger && (word === "BEGIN" || word === "CASE")) block++;
      if (trigger && word === "END") block = Math.max(0, block - 1);
      i = end - 1;
      continue;
    }
    if (driver !== "mssql" && c === ";" && !oracleBlock && (!trigger || block === 0)) {
      if (caret <= i + 1) return text.slice(start, i + 1).trim();
      start = i + 1;
      prefix = "";
      trigger = false;
    }
  }
  return text.slice(start).trim();
}
