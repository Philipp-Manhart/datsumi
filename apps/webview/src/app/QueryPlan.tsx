/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- Native DOM handlers and layout styles carry row-specific values; memoizing them adds no child-render benefit. */
import type { WebviewResponse } from "@datsumi/protocol";
type Table = Extract<NonNullable<WebviewResponse["result"]>, { kind: "table" }>;
export function QueryPlan({ table }: { table: Table }) {
  const nodes = table.rows.map((row) => ({
    id: Number(row[0]),
    parent: Number(row[1]),
    detail: typeof row[3] === "string" ? row[3] : JSON.stringify(row[3] ?? ""),
  }));
  function depth(id: number, seen = new Set<number>()): number {
    const node = nodes.find((item) => item.id === id);
    if (!node || seen.has(id) || !nodes.some((item) => item.id === node.parent)) return 0;
    seen.add(id);
    return 1 + depth(node.parent, seen);
  }
  return (
    <section className="query-plan" aria-label="SQLite query plan">
      <p>SQLite EXPLAIN QUERY PLAN · describes the chosen strategy without executing the query.</p>
      <ul>
        {nodes.map((node) => (
          <li key={node.id} style={{ marginLeft: depth(node.id) * 24 }}>
            <span className={/\bSCAN\b/.test(node.detail) ? "plan-scan" : "plan-search"}>
              {/\bSCAN\b/.test(node.detail)
                ? "SCAN"
                : /\bSEARCH\b/.test(node.detail)
                  ? "SEARCH"
                  : "STEP"}
            </span>
            <code>{node.detail}</code>
            <small>
              #{node.id} · parent {node.parent}
            </small>
          </li>
        ))}
      </ul>
      <p>A scan is not always a problem; its cost depends on table size and the query.</p>
    </section>
  );
}
