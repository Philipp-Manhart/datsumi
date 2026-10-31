/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Interactive SVG paths must remain SVG elements to draw foreign-key connections. */
/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- Native DOM handlers and layout styles carry row-specific values; memoizing them adds no child-render benefit. */
import type { WebviewRequest, WebviewResponse } from "@datsumi/protocol";
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";

import { Icon } from "./Icon";
import {
  layoutSchema,
  cardHeight,
  separatePositions,
  relationshipPath,
  type Point,
} from "./schemaLayout";
type Table = NonNullable<WebviewResponse["schema"]>[number];
export function SchemaGraph({
  state,
  request,
}: {
  state: WebviewResponse;
  request: (message: WebviewRequest) => void;
}) {
  const schema = state.schema ?? [];
  const [focus, setFocus] = useState(state.focusTable ?? "");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [zoomOverride, setZoom] = useState<number | null>(null);
  const [panOverride, setPan] = useState<Point | null>(null);
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: Math.max(240, window.innerHeight - 140),
  }));
  const [positions, setPositions] = useState<Record<string, Point>>(
    state.preferences?.layoutVersion === 2 ? (state.preferences.positions ?? {}) : {},
  );
  useEffect(() => {
    const timer = setTimeout(
      () => request({ type: "view/preferences", preferences: { positions, layoutVersion: 2 } }),
      300,
    );
    return () => clearTimeout(timer);
  }, [positions, request]);
  const [highlight, setHighlight] = useState<string>("");
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box?.width && box.height) setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setZoom((previous) =>
          Math.max(0.1, Math.min(3, (previous ?? 1) * (event.deltaY > 0 ? 0.9 : 1.1))),
        );
      }
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => element?.removeEventListener("wheel", wheel);
  }, []);
  const drag = useRef<{ name?: string; start: Point; origin: Point } | null>(null);
  const neighbors = (names: string[]) =>
    schema.filter(
      (table) =>
        names.includes(table.name) ||
        table.foreignKeys.some((key) => names.includes(key.target)) ||
        schema.some(
          (other) =>
            names.includes(other.name) &&
            other.foreignKeys.some((key) => key.target === table.name),
        ),
    );
  const tables = focus ? neighbors([focus, ...expanded]) : schema;
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const visibleKey = tables.map((table) => `${table.name}:${table.columns.length}`).join("|");
  useLayoutEffect(() => {
    const cards = viewport.current?.querySelectorAll<HTMLElement>(".graph-table") ?? [];
    const update = () => {
      const next = Object.fromEntries(
        [...cards]
          .filter((card) => card.offsetHeight > 0)
          .map((card) => [card.dataset.tableName!, card.offsetHeight]),
      );
      setMeasured((previous) =>
        Object.entries(next).some(([name, height]) => previous[name] !== height)
          ? { ...previous, ...next }
          : previous,
      );
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    cards.forEach((card) => observer?.observe(card));
    return () => observer?.disconnect();
  }, [visibleKey]);
  const layout = useMemo(
    () => layoutSchema(tables, size.width, size.height, measured),
    [tables, size.width, size.height, measured],
  );
  const settled = separatePositions(tables, { ...layout, ...positions }, measured);
  const point = (table: Table): Point => settled[table.name] ?? { x: 0, y: 0 };
  const extent = {
    width: Math.max(300, ...tables.map((table) => point(table).x + 300)),
    height:
      Math.max(
        200,
        ...tables.map((table) => point(table).y + (measured[table.name] ?? cardHeight(table))),
      ) + 110,
  };
  const fitted = Math.min(1, (size.width - 48) / extent.width, (size.height - 48) / extent.height);
  const zoom = zoomOverride ?? fitted;
  const pan = panOverride ?? {
    x: Math.max(24, (size.width - extent.width * zoom) / 2),
    y: Math.max(24, (size.height - extent.height * zoom) / 2),
  };
  function fit() {
    setZoom(null);
    setPan(null);
  }
  return (
    <section className="schema-graph" aria-label="Schema relationships">
      <div className="graph-toolbar">
        <input
          aria-label="Find table in diagram"
          placeholder="Find a table…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Diagram focus"
          value={focus}
          onChange={(event) => {
            setFocus(event.target.value);
            setExpanded([]);
            setPan(null);
            setZoom(null);
            setPositions({});
          }}
        >
          <option value="">Entire schema</option>
          {schema.map((table) => (
            <option key={table.name}>{table.name}</option>
          ))}
        </select>
        <button onClick={fit}>Fit</button>
        <button aria-label="Zoom out" onClick={() => setZoom(Math.max(0.1, zoom / 1.2))}>
          <Icon name="remove" />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => setZoom(Math.min(3, zoom * 1.2))}>
          <Icon name="add" />
        </button>
        <button
          onClick={() => {
            setPositions({});
            setPan(null);
            setZoom(null);
          }}
        >
          Auto-arrange
        </button>
      </div>
      <p className="graph-hint">
        <Icon name="key" /> Primary key · <Icon name="references" /> Foreign key · drag table
        headers to arrange · drag background to pan · select a relationship to highlight columns
        {!schema.some((table) => table.foreignKeys.length)
          ? " · No declared relationships found"
          : ""}
      </p>
      {search && (
        <div className="action-row graph-search">
          {schema
            .filter((table) => table.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
            .map((table) => (
              <button
                key={table.name}
                onClick={() => {
                  setFocus(table.name);
                  setExpanded([]);
                  setSearch("");
                  setPan(null);
                  setZoom(null);
                  setPositions({});
                }}
              >
                {table.name}
              </button>
            ))}
        </div>
      )}
      <div
        ref={viewport}
        className="graph-viewport"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { start: { x: event.clientX, y: event.clientY }, origin: pan };
          }
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const delta = { x: event.clientX - d.start.x, y: event.clientY - d.start.y };
          if (d.name) {
            const name = d.name;
            setPositions((previous) => ({
              ...previous,
              [name]: { x: d.origin.x + delta.x / zoom, y: d.origin.y + delta.y / zoom },
            }));
          } else setPan({ x: d.origin.x + delta.x, y: d.origin.y + delta.y });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="graph-canvas"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <svg
            className="graph-edges"
            width="10000"
            height="10000"
            aria-label="Foreign key connections"
          >
            <defs>
              <marker
                id="fk-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {tables.flatMap((table) =>
              table.foreignKeys.map((key) => {
                const target = tables.find((other) => other.name === key.target);
                if (!target) return null;
                const from = point(table),
                  to = point(target);
                const id = `${table.name}:${key.id}`;
                const y1 =
                  from.y +
                  61 +
                  Math.max(
                    0,
                    table.columns.findIndex((col) => col.name === key.columns[0]),
                  ) *
                    25;
                const y2 =
                  to.y +
                  61 +
                  Math.max(
                    0,
                    target.columns.findIndex((col) => col.name === key.targetColumns[0]),
                  ) *
                    25;
                const path = relationshipPath(
                  from,
                  to,
                  y1,
                  y2,
                  tables.map((node) => ({
                    point: point(node),
                    height: measured[node.name] ?? cardHeight(node),
                  })),
                  key.id,
                );
                return (
                  <g key={id} className={highlight === id ? "highlighted" : ""}>
                    <path
                      tabIndex={0}
                      role="button"
                      aria-label={`${table.name}.${key.columns.join(",")} references ${target.name}.${key.targetColumns.join(",")}`}
                      onClick={() => setHighlight(id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setHighlight(id);
                        }
                      }}
                      d={path}
                      markerEnd="url(#fk-arrow)"
                    />
                    <title>
                      {table.name} ({key.columns.join(", ")}) → {target.name} (
                      {key.targetColumns.join(", ")})
                    </title>
                  </g>
                );
              }),
            )}
          </svg>
          {tables.map((table) => {
            const p = point(table);
            const selected = schema
              .flatMap((source) =>
                source.foreignKeys.map((key) => ({ source, key, id: `${source.name}:${key.id}` })),
              )
              .find((item) => item.id === highlight);
            return (
              <article
                key={table.name}
                data-table-name={table.name}
                className={`graph-table ${focus === table.name ? "focused" : ""}`}
                style={{ left: p.x, top: p.y, width: 300 }}
              >
                <header
                  onPointerDown={(event) => {
                    if (event.target instanceof Element && event.target.closest("button")) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                      name: table.name,
                      start: { x: event.clientX, y: event.clientY },
                      origin: p,
                    };
                  }}
                >
                  <strong>{table.name}</strong>
                  <span>{table.kind}</span>
                </header>
                {table.columns.map((col) => (
                  <div
                    className={`graph-column ${selected && ((selected.source.name === table.name && selected.key.columns.includes(col.name)) || (selected.key.target === table.name && selected.key.targetColumns.includes(col.name))) ? "highlighted" : ""}`}
                    key={col.name}
                  >
                    <span
                      title={
                        col.primaryKey
                          ? "Primary key"
                          : table.foreignKeys.some((key) => key.columns.includes(col.name))
                            ? "Foreign key"
                            : ""
                      }
                    >
                      {col.primaryKey ? (
                        <Icon name="key" />
                      ) : table.foreignKeys.some((key) => key.columns.includes(col.name)) ? (
                        <Icon name="references" />
                      ) : (
                        <span className="graph-column-dot">·</span>
                      )}
                    </span>
                    <code>{col.name}</code>
                    <small>{col.type}</small>
                  </div>
                ))}
                <footer>
                  <button
                    aria-label={`Browse rows in ${table.name}`}
                    onClick={() => request({ type: "schema/browse", table: table.name })}
                  >
                    Browse rows
                  </button>
                  {focus && (
                    <button
                      onClick={() =>
                        setExpanded((previous) => [...new Set([...previous, table.name])])
                      }
                    >
                      Expand neighbors
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
