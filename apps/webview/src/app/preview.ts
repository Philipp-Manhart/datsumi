import { compareCells } from "@datsumi/core";
import type { WebviewRequest, WebviewResponse } from "@datsumi/protocol";

const tabs = [
  {
    id: "preview-1",
    title: "Query 1",
    connectionName: "sample.sqlite",
    query: "SELECT * FROM customers ORDER BY id;",
    busy: false,
    error: false,
  },
  {
    id: "preview-2",
    title: "Query 2",
    connectionName: "sample.sqlite",
    query: "SELECT plan, COUNT(*) AS customers FROM customers GROUP BY plan;",
    busy: false,
    error: false,
  },
];

export function previewState(
  previous?: WebviewResponse | null,
  message?: WebviewRequest,
): WebviewResponse {
  if (previous && message?.type === "view/preferences")
    return { ...previous, preferences: { ...previous.preferences, ...message.preferences } };
  const available = previous?.tabs ?? tabs;
  const activeId =
    message?.type === "query/select"
      ? message.resultId
      : (previous?.activeResultId ?? available[0]?.id ?? null);
  const remaining =
    message?.type === "query/close"
      ? available.filter((tab) => tab.id !== message.resultId)
      : available;
  const active = remaining.find((tab) => tab.id === activeId) ?? remaining[0];
  const summary = active?.id === "preview-2";
  let rows: (string | number)[][] = summary
    ? [
        ["Free", 79],
        ["Pro", 158],
      ]
    : Array.from({ length: 237 }, (_, i) => {
        const id = i + 1;
        return [
          id,
          ["Alex Morgan", "Sam Rivera", "Jordan Lee", "Casey Chen", "Taylor Kim"][i % 5]!,
          `customer${id}@example.com`,
          id % 3 ? "Pro" : "Free",
          "2026-10-25",
        ];
      });
  const search = message?.type === "query/search" ? message.text : (previous?.search ?? "");
  if (search)
    rows = rows.filter((row) =>
      row.some((value) => String(value).toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    );
  const sort =
    message?.type === "query/sort"
      ? message.sort
      : message?.type === "query/select"
        ? null
        : (previous?.sort ?? null);
  if (sort)
    rows = rows
      .slice()
      .sort(
        (a, b) =>
          compareCells(a[sort.column] ?? null, b[sort.column] ?? null) *
          (sort.direction === "asc" ? 1 : -1),
      );
  const limit = message?.type === "query/page" ? message.limit : (previous?.page?.limit ?? 100);
  const requestedOffset =
    message?.type === "query/page"
      ? message.offset
      : message?.type === "query/select" || message?.type === "query/sort"
        ? 0
        : (previous?.page?.offset ?? 0);
  const offset = Math.min(
    requestedOffset,
    Math.floor(Math.max(0, rows.length - 1) / limit) * limit,
  );
  const columns = summary ? ["plan", "customers"] : ["id", "name", "email", "plan", "created_at"];
  return {
    type: "results/state",
    protocolVersion: 1,
    title: active?.title ?? "Query Results",
    connectionName: active?.connectionName ?? "Run a SQL query to see results here",
    busy: false,
    error: null,
    tabs: remaining,
    activeResultId: active?.id ?? null,
    sort,
    search,
    page: active
      ? { offset, limit, hasMore: offset + limit < rows.length, totalRows: rows.length }
      : null,
    result: active
      ? {
          kind: "table",
          columns,
          columnMetadata: columns.map((name, i) => ({
            name,
            dataType: summary ? (i ? "INTEGER" : "TEXT") : i ? "TEXT" : "INTEGER",
          })),
          rows: rows.slice(offset, offset + limit),
          durationMs: 3,
        }
      : null,
  };
}
