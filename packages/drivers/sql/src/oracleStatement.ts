/** Oracle SQL omits its terminator; PL/SQL keeps END; and accepts a final SQL*Plus slash. */
export function oracleStatement(text: string): string {
  const sql = text.trim().replace(/\r?\n\s*\/\s*$/, "");
  const head = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
  if (
    /^(?:BEGIN\b|DECLARE\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE)\b)/i.test(
      head,
    )
  )
    return sql;
  let last = -1;
  for (let i = 0; i < sql.length; i++) {
    const character = sql[i]!;
    if (character === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i + 2);
      if (end < 0) break;
      i = end;
    } else if (character === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) return sql;
      i = end + 1;
    } else if ((character === "q" || character === "Q") && sql[i + 1] === "'" && sql[i + 2]) {
      const opening = sql[i + 2]!;
      const closing =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[opening] ?? opening;
      const end = sql.indexOf(closing + "'", i + 3);
      if (end < 0) return sql;
      i = last = end + 1;
    } else if (character === "'" || character === '"') {
      for (i++; i < sql.length; i++) {
        if (sql[i] === character) {
          if (sql[i + 1] === character) i++;
          else break;
        }
      }
      last = i;
    } else if (!/\s/.test(character)) last = i;
  }
  return sql[last] === ";" ? sql.slice(0, last) + sql.slice(last + 1) : sql;
}
