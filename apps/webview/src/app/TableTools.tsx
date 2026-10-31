/* oxlint-disable react/no-array-index-key -- Filter rows are small positional form fields. */
/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- Native DOM handlers and layout styles carry row-specific values; memoizing them adds no child-render benefit. */
import { tableFilterSchema, type WebviewRequest, type WebviewResponse } from "@datsumi/protocol";
import { useState } from "react";

import { Icon } from "./Icon";
type Filter = NonNullable<WebviewResponse["filters"]>[number];
export function TableTools({
  state,
  request,
  disabled,
}: {
  state: WebviewResponse;
  request: (message: WebviewRequest) => void;
  disabled: boolean;
}) {
  const [filters, setFilters] = useState<Filter[]>(state.filters ?? []);
  const [lastFilters, setLastFilters] = useState(state.filters);
  if (lastFilters !== state.filters) {
    setLastFilters(state.filters);
    setFilters(state.filters ?? []);
  }
  const info = state.tableInfo;
  if (!info) return null;
  return (
    <details className="table-tools">
      <summary>
        Filters & structure{state.filters?.length ? ` (${state.filters.length})` : ""}
      </summary>
      <div className="filter-list">
        {filters.map((filter, index) => (
          <div className="filter-row" key={`${index}`}>
            {index > 0 && <span>AND</span>}
            <select
              aria-label={`Filter ${index + 1} column`}
              disabled={disabled}
              value={filter.column}
              onChange={(event) =>
                setFilters(
                  filters.map((item, i) =>
                    i === index ? { ...item, column: event.target.value } : item,
                  ),
                )
              }
            >
              {info.columns.map((col) => (
                <option key={col.name}>{col.name}</option>
              ))}
            </select>
            <select
              aria-label={`Filter ${index + 1} operator`}
              disabled={disabled}
              value={filter.operator}
              onChange={(event) => {
                const operator = tableFilterSchema.shape.operator.parse(event.target.value);
                if (
                  !["=", "<>", "<", ">", "<=", ">=", "contains", "IS NULL", "IS NOT NULL"].includes(
                    operator,
                  )
                )
                  return;
                setFilters(filters.map((item, i) => (i === index ? { ...item, operator } : item)));
              }}
            >
              {["=", "<>", "<", ">", "<=", ">=", "contains", "IS NULL", "IS NOT NULL"].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            {!filter.operator.includes("NULL") && (
              <>
                <input
                  aria-label={`Filter ${index + 1} value`}
                  disabled={disabled}
                  value={
                    typeof filter.value === "object"
                      ? JSON.stringify(filter.value)
                      : String(filter.value ?? "")
                  }
                  onChange={(event) =>
                    setFilters(
                      filters.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              value:
                                typeof item.value === "number"
                                  ? Number(event.target.value)
                                  : event.target.value,
                            }
                          : item,
                      ),
                    )
                  }
                />
                <select
                  aria-label={`Filter ${index + 1} type`}
                  value={typeof filter.value === "number" ? "number" : "text"}
                  disabled={disabled}
                  onChange={(event) =>
                    setFilters(
                      filters.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              value:
                                event.target.value === "number"
                                  ? Number(item.value)
                                  : typeof item.value === "object"
                                    ? JSON.stringify(item.value)
                                    : String(item.value ?? ""),
                            }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                </select>
              </>
            )}
            <button
              aria-label={`Remove filter ${index + 1}`}
              disabled={disabled}
              onClick={() => setFilters(filters.filter((_, i) => i !== index))}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        <div className="action-row">
          <button
            disabled={disabled || filters.length >= 20}
            onClick={() =>
              setFilters([
                ...filters,
                { column: info.columns[0]?.name ?? "", operator: "=", value: "" },
              ])
            }
          >
            <Icon name="add" /> Filter
          </button>
          <button
            disabled={disabled}
            onClick={() => request({ type: "table/filter", filters, order: state.order ?? null })}
          >
            Apply filters
          </button>
          <button
            disabled={disabled}
            onClick={() => {
              setFilters([]);
              request({ type: "table/filter", filters: [], order: state.order ?? null });
            }}
          >
            Clear
          </button>
          <button onClick={() => request({ type: "schema/open", focus: info.name })}>
            Relationships
          </button>
        </div>
      </div>
      <details className="schema-details">
        <summary>Table definition, indexes & constraints</summary>
        <pre>{info.ddl};</pre>
        <button onClick={() => request({ type: "data/copy", text: info.ddl + ";" })}>
          Copy CREATE SQL
        </button>
        <ul>
          {info.columns.map((col) => (
            <li key={col.name}>
              <code>{col.name}</code> {col.type}
              {col.primaryKey ? ` · PK ${col.primaryKey}` : ""}
              {col.notNull ? " · NOT NULL" : ""}
              {col.generated ? " · generated" : ""}
              {col.defaultValue !== null ? ` · DEFAULT ${col.defaultValue}` : ""}
            </li>
          ))}
        </ul>
        <h3>Indexes</h3>
        {info.indexes.length ? (
          info.indexes.map((index) => (
            <p key={index.name}>
              <code>{index.name}</code> {index.unique ? "UNIQUE" : ""} ({index.columns.join(", ")})
            </p>
          ))
        ) : (
          <p>No indexes</p>
        )}
        <h3>Foreign keys</h3>
        {info.foreignKeys.map((key) => (
          <p key={key.id}>
            {key.columns.join(", ")} → {key.target} ({key.targetColumns.join(", ")}) · UPDATE{" "}
            {key.onUpdate} · DELETE {key.onDelete}
          </p>
        ))}
        <div className="action-row">
          {(["ddl", "select", "insert", "update"] as const).map((action) => (
            <button key={action} onClick={() => request({ type: "table/sql", action })}>
              Open {action.toUpperCase()} SQL
            </button>
          ))}
        </div>
      </details>
    </details>
  );
}
