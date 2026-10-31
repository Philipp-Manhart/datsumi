import { dialectFunctions, dialectKeywords } from "./dialects";
import { keywordSet } from "./vocabulary";

export interface SqlColumn {
  readonly name: string;
  readonly detail?: string;
}
export interface SqlTable {
  readonly insertText?: string | undefined;
  readonly baseName?: string | undefined;
  readonly schema?: string | undefined;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly columns: readonly SqlColumn[];
}
export interface SqlSuggestion {
  readonly priority?: number;
  readonly label: string;
  readonly insertText: string;
  readonly kind: "table" | "view" | "column" | "alias" | "keyword" | "function";
  readonly detail: string;
  readonly documentation?: string;
  readonly parameters?: readonly string[];
}
interface Token {
  value: string;
  kind: "word" | "identifier" | "string" | "comment" | "symbol";
  start: number;
  end: number;
  scope: number;
  opens?: number;
  closed: boolean;
}
interface Reference {
  name: string;
  alias: string;
  scope: number;
  body?: number;
}
export interface SqlContext {
  readonly lastClause: string;
  readonly suppressed: boolean;
  readonly prefix: string;
  readonly start: number;
  readonly end: number;
  readonly quoted: boolean;
  readonly expectsTable: boolean;
  readonly qualifier: string | undefined;
  readonly tables: readonly string[];
  readonly tokens: readonly Token[];
  readonly scopes: readonly number[];
}

/** A tolerant lexer for incomplete SQL; strings and comments never become identifiers. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const scopes = [0];
  let nextScope = 0;
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i++;
      continue;
    }
    const start = i;
    const character = text[i]!;
    let kind: Token["kind"] = "symbol",
      value = "",
      closed = true;
    if (text.startsWith("--", i)) {
      kind = "comment";
      i = text.indexOf("\n", i);
      if (i < 0) i = text.length;
      closed = false;
    } else if (text.startsWith("/*", i)) {
      kind = "comment";
      const end = text.indexOf("*/", i + 2);
      closed = end >= 0;
      i = end >= 0 ? end + 2 : text.length;
    } else if (["'", '"', "`", "["].includes(character)) {
      kind = character === "'" ? "string" : "identifier";
      const endQuote = character === "[" ? "]" : character;
      i++;
      closed = false;
      while (i < text.length) {
        if (text[i] === endQuote) {
          if (character !== "[" && text[i + 1] === endQuote) {
            value += endQuote;
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += text[i++];
      }
    } else if (/[\p{L}\p{N}_$]/u.test(character)) {
      kind = "word";
      while (i < text.length && /[\p{L}\p{N}_$]/u.test(text[i]!)) value += text[i++];
    } else {
      value = character;
      i++;
    }
    if (value === ")" && kind === "symbol" && scopes.length > 1) scopes.pop();
    const token: Token = { value, kind, start, end: i, scope: scopes.at(-1) ?? 0, closed };
    if (value === "(" && kind === "symbol") {
      token.opens = ++nextScope;
      scopes.push(nextScope);
    }
    tokens.push(token);
  }
  return tokens;
}
function identifier(token: Token | undefined): token is Token {
  return token?.kind === "word" || token?.kind === "identifier";
}
function isKeyword(token: Token | undefined, value: string): boolean {
  return token?.kind === "word" && token.value.toUpperCase() === value;
}
function readName(
  tokens: readonly Token[],
  index: number,
): { name: string; next: number } | undefined {
  const first = tokens[index];
  if (!identifier(first)) return undefined;
  let name = first.value;
  let next = index + 1;
  while (tokens[next]?.value === "." && identifier(tokens[next + 1])) {
    name += "." + tokens[next + 1]!.value;
    next += 2;
  }
  return { name, next };
}
function closingIndex(tokens: readonly Token[], open: number): number {
  const token = tokens[open];
  if (!token || token.value !== "(") return -1;
  return tokens.findIndex(
    (candidate, index) =>
      index > open &&
      candidate.kind === "symbol" &&
      candidate.value === ")" &&
      candidate.scope === token.scope,
  );
}
function references(tokens: readonly Token[]): Reference[] {
  const result: Reference[] = [];
  const clauses = new Map<number, string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const word = token.kind === "word" ? token.value.toUpperCase() : "";
    const commaTable = token.value === "," && clauses.get(token.scope) === "FROM";
    if (["FROM", "JOIN", "UPDATE", "INTO"].includes(word) || commaTable) {
      if (word === "FROM" || word === "JOIN") clauses.set(token.scope, "FROM");
      let next = i + 1;
      if (tokens[next]?.scope !== token.scope) continue;
      let name: string;
      let body: number | undefined;
      if (tokens[next]?.value === "(") {
        body = tokens[next]!.opens;
        const end = closingIndex(tokens, next);
        if (end < 0) continue;
        name = "";
        next = end + 1;
      } else {
        const parsed = readName(tokens, next);
        if (!parsed) continue;
        name = parsed.name;
        next = parsed.next;
        // Table-valued functions are not ordinary schema tables.
        if (tokens[next]?.value === "(") {
          const end = closingIndex(tokens, next);
          if (end >= 0) next = end + 1;
        }
      }
      if (isKeyword(tokens[next], "AS")) next++;
      const aliasToken = tokens[next];
      const alias =
        identifier(aliasToken) &&
        aliasToken.scope === token.scope &&
        (aliasToken.kind === "identifier" || !keywordSet.has(aliasToken.value.toUpperCase()))
          ? aliasToken.value
          : (name.split(".").at(-1) ?? name);
      if (name || alias)
        result.push({ name, alias, scope: token.scope, ...(body !== undefined ? { body } : {}) });
    } else if (
      [
        "WHERE",
        "GROUP",
        "ORDER",
        "HAVING",
        "LIMIT",
        "SET",
        "RETURNING",
        "VALUES",
        "UNION",
        "EXCEPT",
        "INTERSECT",
        "ON",
      ].includes(word)
    )
      clauses.set(token.scope, word);
  }
  return result;
}

export function sqlContext(text: string, offset: number): SqlContext {
  const all = tokenize(text);
  let beginning = 0,
    end = text.length;
  for (const token of all)
    if (token.kind === "symbol" && token.value === ";") {
      if (token.end <= offset) beginning = token.end;
      else if (token.start >= offset) {
        end = token.start;
        break;
      }
    }
  const tokens = all.filter(
    (token) => token.start >= beginning && token.end <= end && token.kind !== "comment",
  );
  const inside = all.find(
    (token) =>
      offset > token.start && (offset < token.end || (offset === token.end && !token.closed)),
  );
  const active = tokens.find(
    (token) => identifier(token) && token.start < offset && offset <= token.end,
  );
  const before = tokens.filter((token) => token.end <= (active?.start ?? offset));
  const scopes = [0];
  for (const token of all) {
    if (token.end > offset) break;
    if (token.opens !== undefined) scopes.push(token.opens);
    else if (token.kind === "symbol" && token.value === ")" && scopes.length > 1) scopes.pop();
  }
  const scope = scopes.at(-1) ?? 0;
  const previous = before.at(-1);
  const qualifier =
    previous?.value === "." && identifier(before.at(-2)) ? before.at(-2)!.value : undefined;
  const scopeTokens = before.filter((token) => token.scope === scope);
  let lastClause = "";
  for (const token of scopeTokens)
    if (
      token.kind === "word" &&
      [
        "FROM",
        "JOIN",
        "UPDATE",
        "INTO",
        "WHERE",
        "ON",
        "SELECT",
        "SET",
        "GROUP",
        "ORDER",
        "HAVING",
        "RETURNING",
        "VALUES",
      ].includes(token.value.toUpperCase())
    )
      lastClause = token.value.toUpperCase();
  const expectsTable =
    ["FROM", "JOIN", "UPDATE", "INTO"].some((word) => isKeyword(previous, word)) ||
    (previous?.value === "," && ["FROM", "JOIN"].includes(lastClause)) ||
    (Boolean(qualifier) && ["FROM", "JOIN", "UPDATE", "INTO"].includes(lastClause));
  let prefix = active ? text.slice(active.start, offset) : "";
  if (active?.kind === "identifier") {
    const quote = prefix[0]!;
    prefix = prefix.slice(1);
    if (active.closed && offset === active.end) prefix = prefix.slice(0, -1);
    prefix = quote === "[" ? prefix : prefix.replaceAll(quote + quote, quote);
  }
  return {
    lastClause,
    suppressed: inside?.kind === "string" || inside?.kind === "comment",
    prefix,
    start: active?.start ?? offset,
    end: active?.end ?? offset,
    quoted: active?.kind === "identifier",
    expectsTable,
    qualifier,
    tables: [
      ...new Set(
        references(tokens)
          .map((ref) => ref.name)
          .filter(Boolean),
      ),
    ],
    tokens,
    scopes,
  };
}

export function quoteIdentifier(name: string, force = false): string {
  return !force && /^[a-z_][a-z0-9_]*$/i.test(name) && !keywordSet.has(name.toUpperCase())
    ? name
    : `"${name.replaceAll('"', '""')}"`;
}

export function sqlSuggestions(
  context: SqlContext,
  schema: readonly SqlTable[],
  driver = "sqlite",
): SqlSuggestion[] {
  if (context.suppressed) return [];
  const lookup = (name: string) => {
    const exact = schema.find(
      (table) =>
        table.name.toLowerCase() === name.toLowerCase() ||
        (!table.schema && name.toLowerCase() === "main." + table.name.toLowerCase()),
    );
    const candidates = schema.filter(
      (table) =>
        (table.baseName ?? table.name.split(".").at(-1))?.toLowerCase() === name.toLowerCase(),
    );
    return exact ?? (candidates.length === 1 ? candidates[0] : undefined);
  };
  // The word currently being typed must not become a new table alias (e.g. WH → WHERE).
  const refs = references(
    context.tokens.filter(
      (token) => !context.prefix || token.start !== context.start || token.end !== context.end,
    ),
  );
  const ctes = new Map<string, readonly SqlColumn[]>();
  function columns(ref: Reference, visited = new Set<number>()): readonly SqlColumn[] {
    if (ref.body !== undefined) return projected(ref.body, visited);
    return ctes.get(ref.name.toLowerCase()) ?? lookup(ref.name)?.columns ?? [];
  }
  function projected(scope: number, visited: Set<number>): readonly SqlColumn[] {
    if (visited.has(scope)) return [];
    const nextVisited = new Set(visited).add(scope);
    const tokens = context.tokens.filter((token) => token.scope === scope);
    const start = tokens.findIndex((token) => isKeyword(token, "SELECT"));
    if (start < 0) return [];
    const end = tokens.findIndex((token, index) => index > start && isKeyword(token, "FROM"));
    const list = tokens.slice(start + 1, end < 0 ? undefined : end);
    const groups: Token[][] = [[]];
    for (const token of list) {
      if (token.value === ",") groups.push([]);
      else groups.at(-1)!.push(token);
    }
    return groups.flatMap((group) => {
      if (isKeyword(group[0], "DISTINCT") || isKeyword(group[0], "ALL")) group = group.slice(1);
      const alias = group.findIndex((token) => isKeyword(token, "AS"));
      if (alias >= 0 && identifier(group[alias + 1])) return [{ name: group[alias + 1]!.value }];
      if (group.at(-1)?.value === "*")
        return refs
          .filter(
            (ref) =>
              ref.scope === scope &&
              (group.length === 1 || ref.alias.toLowerCase() === group[0]?.value.toLowerCase()),
          )
          .flatMap((ref) => columns(ref, nextVisited));
      if (group.length === 1 && identifier(group[0])) return [{ name: group[0].value }];
      if (group.length === 3 && group[1]?.value === "." && identifier(group[2]))
        return [{ name: group[2].value }];
      return [];
    });
  }
  // Named CTE columns override inferred SELECT projections.
  for (let i = 0; i < context.tokens.length; i++) {
    const withToken = context.tokens[i];
    if (!isKeyword(withToken, "WITH") || !context.scopes.includes(withToken!.scope)) continue;
    let index = i + 1;
    if (isKeyword(context.tokens[index], "RECURSIVE")) index++;
    while (identifier(context.tokens[index])) {
      const name = context.tokens[index++]!.value;
      let explicit: SqlColumn[] | undefined;
      if (context.tokens[index]?.value === "(") {
        const end = closingIndex(context.tokens, index);
        if (end < 0) break;
        explicit = context.tokens
          .slice(index + 1, end)
          .filter(identifier)
          .map((token) => ({ name: token.value }));
        index = end + 1;
      }
      if (!isKeyword(context.tokens[index], "AS")) break;
      index++;
      if (isKeyword(context.tokens[index], "NOT")) index++;
      if (isKeyword(context.tokens[index], "MATERIALIZED")) index++;
      const open = context.tokens[index];
      const close = closingIndex(context.tokens, index);
      if (open?.opens === undefined || close < 0) break;
      ctes.set(name.toLowerCase(), explicit ?? projected(open.opens, new Set()));
      index = close + 1;
      if (context.tokens[index]?.value !== ",") break;
      index++;
    }
  }
  const suggestions: SqlSuggestion[] = [];
  const matches = (label: string) => label.toLowerCase().startsWith(context.prefix.toLowerCase());
  const addColumn = (column: SqlColumn, table: string, qualify = false) => {
    if (matches(column.name))
      suggestions.push({
        label: column.name,
        insertText:
          (qualify ? `${quoteIdentifier(table)}.` : "") +
          quoteIdentifier(column.name, context.quoted),
        kind: "column",
        detail: `${table}${column.detail ? ` · ${column.detail}` : ""}`,
      });
  };
  const seenAliases = new Set<string>();
  const visibleRefs = refs
    .filter((ref) => context.scopes.includes(ref.scope))
    .sort((a, b) => context.scopes.indexOf(b.scope) - context.scopes.indexOf(a.scope))
    .filter((ref) => {
      const key = ref.alias.toLowerCase();
      if (seenAliases.has(key)) return false;
      seenAliases.add(key);
      return true;
    });
  if (context.qualifier && !context.expectsTable) {
    const scoped = visibleRefs.filter((ref) =>
      [ref.name, ref.alias].some((name) => name.toLowerCase() === context.qualifier!.toLowerCase()),
    );
    const closest = Math.max(-1, ...scoped.map((ref) => context.scopes.indexOf(ref.scope)));
    for (const ref of scoped.filter(
      (candidate) => context.scopes.indexOf(candidate.scope) === closest,
    ))
      for (const column of columns(ref)) addColumn(column, ref.alias);
    if (!scoped.length)
      for (const column of lookup(context.qualifier)?.columns ?? [])
        addColumn(column, context.qualifier);
    return suggestions;
  }
  if (context.expectsTable) {
    for (const table of schema)
      if (
        (matches(table.name) || matches(table.baseName ?? "")) &&
        (!context.qualifier ||
          (!table.schema && context.qualifier.toLowerCase() === "main") ||
          table.schema?.toLowerCase() === context.qualifier.toLowerCase())
      )
        suggestions.push({
          label: table.name,
          insertText: context.qualifier
            ? quoteIdentifier(table.baseName ?? table.name, context.quoted)
            : (table.insertText ?? quoteIdentifier(table.name, context.quoted)),
          kind: table.kind,
          detail: `SQL ${table.kind}`,
        });
    for (const name of ctes.keys())
      if (matches(name))
        suggestions.push({
          label: name,
          insertText: quoteIdentifier(name, context.quoted),
          kind: "view",
          detail: "Common table expression",
        });
    return suggestions;
  }
  for (const ref of visibleRefs) {
    if (matches(ref.alias))
      suggestions.push({
        label: ref.alias,
        insertText: `${quoteIdentifier(ref.alias, context.quoted)}.`,
        kind: "alias",
        detail: `Table reference · ${ref.name || "derived table"}`,
      });
  }
  const availableColumns = visibleRefs.flatMap((ref) =>
    columns(ref).map((column) => ({ column, alias: ref.alias })),
  );
  const counts = new Map<string, number>();
  for (const { column } of availableColumns)
    counts.set(column.name.toLowerCase(), (counts.get(column.name.toLowerCase()) ?? 0) + 1);
  for (const { column, alias } of availableColumns)
    addColumn(column, alias, (counts.get(column.name.toLowerCase()) ?? 0) > 1);
  for (const word of dialectKeywords(driver))
    if (matches(word))
      suggestions.push({
        label: word,
        insertText: word,
        kind: "keyword",
        priority:
          (word === "WHERE" && ["FROM", "JOIN"].includes(context.lastClause)) ||
          (word === "FROM" && context.lastClause === "SELECT") ||
          (word === "SELECT" && !context.lastClause)
            ? 0
            : 2,
        detail: "SQL keyword",
      });
  for (const fn of dialectFunctions(driver))
    if (matches(fn.name))
      suggestions.push({
        label: fn.name,
        insertText: fn.name,
        kind: "function",
        detail: `${fn.name}(${fn.parameters.join(", ")})`,
        documentation: fn.description,
        parameters: fn.parameters,
      });
  return suggestions;
}

export function functionCall(
  text: string,
  offset: number,
  driver = "sqlite",
): { name: string; parameter: number } | undefined {
  const tokens = tokenize(text.slice(0, offset)).filter((token) => token.kind !== "comment");
  const stack: { name: string; parameter: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "symbol") continue;
    if (token.value === "(")
      stack.push({
        name: tokens[i - 1]?.kind === "word" ? tokens[i - 1]!.value.toUpperCase() : "",
        parameter: 0,
      });
    else if (token.value === ")") stack.pop();
    else if (token.value === "," && stack.length) stack.at(-1)!.parameter++;
    else if (token.value === ";") stack.length = 0;
  }
  return stack
    .toReversed()
    .find((call) => dialectFunctions(driver).some((fn) => fn.name === call.name));
}

/** Source bindings in visible scopes, reused for conservative FK JOIN completions. */
export function sourceReferences(context: SqlContext) {
  return references(context.tokens.filter((token) => context.scopes.includes(token.scope)));
}
