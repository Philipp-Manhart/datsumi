import {
  applyEdits,
  format,
  parseTree,
  type ParseError,
  type Node,
} from "jsonc-parser/lib/esm/main.js";

/** Validate and format tokens without converting numeric literals to JS numbers. */
export function formatJson(text: string): string {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length)
    throw new Error(`Invalid JSON near character ${errors[0]?.offset ?? 0}.`);
  return applyEdits(text, format(text, undefined, { tabSize: 2, insertSpaces: true, eol: "\n" }));
}
export interface JsonEntry {
  path: string;
  key: string;
  raw: string;
  children: JsonEntry[];
  truncated?: boolean;
}
export function jsonEntries(text: string): JsonEntry {
  formatJson(text);
  let visited = 0;
  const walk = (node: Node, path: string, key: string, depth = 0): JsonEntry => ({
    path,
    key,
    raw: text.slice(node.offset, node.offset + node.length),
    truncated: (node.children?.length ?? 0) > 200 || depth >= 30 || visited >= 2000,
    children:
      ++visited > 2000 || depth >= 30
        ? []
        : node.type === "object"
          ? (node.children ?? []).slice(0, 200).map((property) => {
              const name = String(property.children?.[0]?.value);
              return walk(
                property.children![1]!,
                `${path}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
                name,
                depth + 1,
              );
            })
          : node.type === "array"
            ? (node.children ?? [])
                .slice(0, 200)
                .map((child, i) => walk(child, `${path}/${i}`, String(i), depth + 1))
            : [],
  });
  return walk(parseTree(text)!, "", "$ ");
}
