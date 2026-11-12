/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- Native DOM handlers and layout styles carry row-specific values; memoizing them adds no child-render benefit. */
import { clipboardTsv } from "@datsumi/core";
import type { CellValue, WebviewRequest, WebviewResponse } from "@datsumi/protocol";
/* oxlint-disable react/no-array-index-key -- Query rows and duplicate column names have positional identity. */
import { useEffect, useRef, useState, useCallback } from "react";

import { ActionMenu } from "./ActionMenu";
import { columnSize } from "./columnSize";
import { cellText, objectRow, isJson, pretty } from "./gridValues";
import { Icon } from "./Icon";
import { JsonInspector } from "./JsonInspector";
type Table = Extract<NonNullable<WebviewResponse["result"]>, { kind: "table" }>;
type Change = NonNullable<WebviewResponse["staged"]>[number];
export function DataGrid({
  table,
  state,
  request: postRequest,
  onDirty,
}: {
  table: Table;
  state: WebviewResponse;
  request: (message: WebviewRequest) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const request = (message: WebviewRequest) =>
    postRequest(
      state.activeResultId && (message.type === "table/changes" || message.type === "table/discard")
        ? { ...message, resultId: state.activeResultId }
        : message,
    );
  const [inline, setInline] = useState<{
    row: number;
    column: number;
    text: string;
    kind: "text" | "number" | "integer";
    touched: boolean;
  } | null>(null);
  const inlineInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inlineInput.current?.focus();
    inlineInput.current?.select();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A newly opened cell editor must focus/select the external input once.
  }, [inline?.row, inline?.column]);
  const [allSelection, setAllSelection] = useState<{ headers: boolean } | null>(null);
  const [selection, rawSetSelection] = useState({ row: 0, col: 0, endRow: 0, endCol: 0 });
  const setSelection: typeof rawSetSelection = (value) => {
    setAllSelection(null);
    rawSetSelection(value);
  };
  const [inspector, setInspector] = useState(false);
  const [inspectorMode, setInspectorMode] = useState("fields");
  const [hidden, setHidden] = useState<number[]>(() =>
    (state.preferences?.hidden ?? [])
      .map((name) => table.columns.indexOf(name))
      .filter((i) => i >= 0),
  );
  const [changes, rawSetChanges] = useState<Change[]>(state.staged ?? []);
  const [undo, setUndo] = useState<Change[][]>([]),
    [redo, setRedo] = useState<Change[][]>([]);
  const setChanges = (next: Change[] | ((previous: Change[]) => Change[])) => {
    setUndo((previous) => [...previous.slice(-99), changes]);
    setRedo([]);
    rawSetChanges(typeof next === "function" ? next(changes) : next);
  };
  const restore = (direction: "undo" | "redo") => {
    const source = direction === "undo" ? undo : redo,
      next = source.at(-1);
    if (!next) return;
    if (direction === "undo") {
      setUndo(source.slice(0, -1));
      setRedo((previous) => [...previous, changes]);
    } else {
      setRedo(source.slice(0, -1));
      setUndo((previous) => [...previous, changes]);
    }
    rawSetChanges(next);
  };
  const [compare, setCompare] = useState(false);

  const [edit, setEdit] = useState<{
    kind: "insert" | "update";
    original?: Record<string, CellValue>;
    values: Record<string, CellValue>;
  } | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; row: number; col: number } | null>(
    null,
  );
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => {
    setContext(null);
    setMenuAnchor(null);
  }, []);
  const [widths, setWidths] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      table.columns.map((name, i) => [i, state.preferences?.widths?.[name] ?? 160]),
    ),
  );
  const [frozen, setFrozen] = useState<string[]>(state.preferences?.frozen ?? []);
  const [columnOrder, setColumnOrder] = useState<string[]>(
    state.preferences?.columns ?? table.columns,
  );
  useEffect(() => {
    const timer = setTimeout(
      () =>
        postRequest({
          type: "view/preferences",
          ...(state.activeResultId ? { resultId: state.activeResultId } : {}),
          preferences: {
            widths: Object.fromEntries(table.columns.map((name, i) => [name, widths[i] ?? 160])),
            hidden: hidden.map((i) => table.columns[i]!),
            columns: columnOrder,
            frozen,
          },
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [widths, hidden, columnOrder, frozen, postRequest, table.columns, state.activeResultId]);
  const [formError, setFormError] = useState("");
  const resize = useRef<{ col: number; x: number; width: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (edit && dialog.current && !dialog.current.open) {
      if (typeof dialog.current.showModal === "function") dialog.current.showModal();
      else dialog.current.open = true;
    }
  }, [edit]);
  useEffect(() => {
    if (grid.current) grid.current.scrollTop = 0;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Navigation and ordering changes intentionally reset the external DOM scroll position.
  }, [state.page?.offset, state.sort?.column, state.sort?.direction, state.order, state.filters]);
  const pageKey = `${state.page?.offset}:${state.page?.limit}:${table.rows.length}`;
  const [lastPage, setLastPage] = useState(pageKey);
  if (lastPage !== pageKey) {
    setLastPage(pageKey);
    if (!allSelection) rawSetSelection({ row: 0, col: 0, endRow: 0, endCol: 0 });
  }
  const stagedKey = JSON.stringify(state.staged);
  const [lastStaged, setLastStaged] = useState(stagedKey);
  if (lastStaged !== stagedKey) {
    setLastStaged(stagedKey);
    rawSetChanges(state.staged ?? []);
    if (!state.staged?.length) {
      setUndo([]);
      setRedo([]);
    }
  }
  useEffect(() => {
    onDirty(changes.length > 0 || Boolean(inline));
  }, [changes, inline, onDirty]);
  useEffect(() => {
    postRequest({
      type: "table/stage",
      ...(state.activeResultId ? { resultId: state.activeResultId } : {}),
      changes,
    });
  }, [changes, state.activeResultId, postRequest]);
  const editable = Boolean(state.tableInfo?.editable);
  const orderedCols = table.columns
    .map((name, index) => ({ name, index }))
    .sort((a, b) => {
      const index = (name: string) => {
        const i = columnOrder.indexOf(name);
        return i < 0 ? 10000 : i;
      };
      return (
        Number(frozen.includes(b.name)) - Number(frozen.includes(a.name)) ||
        index(a.name) - index(b.name)
      );
    });
  const cols = orderedCols.filter((col) => !hidden.includes(col.index));
  let frozenOffset = 48;
  const frozenLeft = new Map<number, number>();
  for (const col of cols) {
    if (frozen.includes(col.name)) {
      frozenLeft.set(col.index, frozenOffset);
      frozenOffset += widths[col.index] ?? 160;
    }
  }
  const toggleFrozen = (column: number) => {
    const name = table.columns[column];
    if (name)
      setFrozen((previous) =>
        previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name],
      );
  };
  const autoSize = (column?: number) => {
    const tableElement = grid.current?.querySelector("table");
    const font = tableElement ? getComputedStyle(tableElement) : undefined;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) context.font = `${font?.fontSize ?? "12px"} ${font?.fontFamily ?? "monospace"}`;
    const measure = (text: string) => context?.measureText(text).width ?? text.length * 8;
    const next = Object.fromEntries(
      cols
        .filter((col) => column === undefined || col.index === column)
        .map((col) => [
          col.index,
          columnSize(
            col.name,
            table.columnMetadata?.[col.index]?.dataType ?? "",
            table.rows.map((row) => cellText(row[col.index] ?? null)),
            measure,
          ),
        ]),
    );
    setWidths((previous) => ({ ...previous, ...next }));
  };
  const columnPositions = new Map(cols.map((col, position) => [col.index, position]));
  const anchorColumn = columnPositions.get(selection.col) ?? 0;
  const foundEndColumn = columnPositions.get(selection.endCol) ?? -1;
  const endColumn = foundEndColumn < 0 ? anchorColumn : foundEndColumn;
  const isSelected = (row: number, col: number) => {
    const position = columnPositions.get(col) ?? -1;
    return (
      position >= 0 &&
      (allSelection !== null ||
        (row >= Math.min(selection.row, selection.endRow) &&
          row <= Math.max(selection.row, selection.endRow) &&
          position >= Math.min(anchorColumn, endColumn) &&
          position <= Math.max(anchorColumn, endColumn)))
    );
  };
  const selectAll = (headers = false) => {
    if ((!table.rows.length && !headers) || !cols.length) return;
    setAllSelection({ headers });
    window.getSelection()?.removeAllRanges();
    rawSetSelection({
      row: 0,
      col: cols[0]!.index,
      endRow: Math.max(0, table.rows.length - 1),
      endCol: cols.at(-1)!.index,
    });
    closeMenu();
    grid.current?.focus();
  };
  const selectedRows = table.rows.length ? Math.abs(selection.endRow - selection.row) + 1 : 0;
  const selectedColumns = cols.length ? Math.abs(endColumn - anchorColumn) + 1 : 0;
  const selectedRow = table.rows[selection.endRow];
  const original = selectedRow ? objectRow(table, selectedRow) : undefined;
  const matches = (change: Change, row: Record<string, CellValue>) =>
    change.original && JSON.stringify(change.original) === JSON.stringify(row);
  const pending = (row: Record<string, CellValue>) =>
    changes.find((change) => matches(change, row));
  const valueAt = (row: number, col: number): CellValue => {
    const values = table.rows[row];
    if (!values) return null;
    const change = pending(objectRow(table, values));
    return change?.kind === "update" && (table.columns[col] ?? "") in change.values
      ? change.values[table.columns[col]!]!
      : (values[col] ?? null);
  };
  const editCell = (row: number, column: number) => {
    const value = valueAt(row, column);
    setSelection({ row, col: column, endRow: row, endCol: column });
    const colInfo = state.tableInfo?.columns.find((col) => col.name === table.columns[column]);
    if (editable && !state.busy && !colInfo?.generated) {
      if (typeof value !== "object" || value === null || value.type === "integer")
        setInline({
          row,
          column,
          touched: false,
          text: value === null ? "" : typeof value === "object" ? value.value : String(value),
          kind:
            typeof value === "number"
              ? "number"
              : typeof value === "object" && value?.type === "integer"
                ? "integer"
                : "text",
        });
      else startEdit("update", false, table.rows[row]);
    } else setInspector(true);
  };
  const copy = (format: "tsv" | "json", headers = false, headersOnly = false) => {
    if ((!table.rows.length && !allSelection?.headers && !headersOnly) || !cols.length) return;
    if (headersOnly) {
      const names = allSelection
        ? orderedCols.map((col) => col.name)
        : cols.filter((col) => isSelected(selection.row, col.index)).map((col) => col.name);
      request({ type: "data/copy", text: clipboardTsv(names, [], true) });
      return;
    }
    if (allSelection) {
      // Include every column, including hidden columns, in the configured display order.
      const columns = orderedCols.map((col) => col.index);
      postRequest(
        state.activeResultId
          ? {
              type: "query/copy",
              resultId: state.activeResultId,
              columns,
              headers: headers || allSelection.headers,
              format,
            }
          : { type: "table/copy", columns, headers: headers || allSelection.headers, format },
      );
      return;
    }
    const rows = table.rows.flatMap((_, row) =>
      row >= Math.min(selection.row, selection.endRow) &&
      row <= Math.max(selection.row, selection.endRow)
        ? [cols.filter((col) => isSelected(row, col.index)).map((col) => valueAt(row, col.index))]
        : [],
    );
    const names = cols.filter((col) => isSelected(selection.row, col.index)).map((col) => col.name);
    let text;
    try {
      text =
        format === "json"
          ? JSON.stringify({ columns: names, rows }, null, 2)
          : clipboardTsv(names, rows, headers);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
      return;
    }
    request({ type: "data/copy", text });
  };
  const stageValue = (row: number, column: number, value: CellValue) => {
    const values = table.rows[row];
    if (!values) return;
    const old = objectRow(table, values),
      name = table.columns[column]!;
    const previous = pending(old);
    const changed = { ...(previous?.kind === "update" ? previous.values : {}), [name]: value };
    if (JSON.stringify(value) === JSON.stringify(old[name])) delete changed[name];
    setChanges((items) => [
      ...items.filter((item) => !matches(item, old)),
      ...(Object.keys(changed).length
        ? [{ kind: "update" as const, original: old, values: changed }]
        : []),
    ]);
  };
  const stageInline = () => {
    if (!inline) return;
    if (!inline.touched) {
      setInline(null);
      return;
    }
    let value: CellValue = inline.text;
    if (inline.kind === "integer") {
      if (!/^-?\d+$/.test(inline.text)) {
        setFormError("Enter a valid integer, or press Escape to cancel.");
        return;
      }
      value = { type: "integer", value: inline.text };
    } else if (inline.kind === "number") {
      const number = Number(inline.text);
      if (!inline.text.trim() || !Number.isFinite(number)) {
        setFormError("Enter a number, or use Edit row to change the value type.");
        return;
      }
      value =
        Number.isInteger(number) && !Number.isSafeInteger(number) && /^-?\d+$/.test(inline.text)
          ? { type: "integer", value: inline.text }
          : number;
    }
    stageValue(inline.row, inline.column, value);
    setInline(null);
    setFormError("");
  };
  const startEdit = (kind: "insert" | "update", duplicate = false, row = selectedRow) => {
    setFormError("");
    const old = row ? objectRow(table, row) : {};
    const change = pending(old);
    const values = { ...old, ...(change?.kind === "update" ? change.values : {}) };
    if (kind === "insert" && !duplicate) for (const key of Object.keys(values)) delete values[key];
    if (kind === "insert")
      for (const col of state.tableInfo?.columns ?? [])
        if (col.primaryKey || col.generated) delete values[col.name];
    setEdit({ kind, ...(kind === "update" ? { original: old } : {}), values });
  };
  const stage = () => {
    if (!edit) return;
    for (const value of Object.values(edit.values)) {
      if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        setFormError("Choose Exact integer for integers outside the JavaScript safe range.");
        return;
      }
      if (typeof value === "object" && value?.type === "integer" && !/^-?\d+$/.test(value.value)) {
        setFormError("Enter a valid exact integer.");
        return;
      }
    }
    const writable = new Set(
      state.tableInfo?.columns.filter((col) => !col.generated).map((col) => col.name),
    );
    const values = Object.fromEntries(
      Object.entries(edit.values).filter(
        ([name, value]) =>
          writable.has(name) &&
          (edit.kind === "insert" ||
            JSON.stringify(value) !== JSON.stringify(edit.original?.[name])),
      ),
    );
    const change: Change = {
      kind: edit.kind,
      values,
      ...(edit.original ? { original: edit.original } : {}),
    };
    setChanges((previous) => [
      ...previous.filter((item) => !edit.original || !matches(item, edit.original)),
      ...(Object.keys(values).length || edit.kind === "insert" ? [change] : []),
    ]);
    setEdit(null);
  };
  const deleteRow = () => {
    if (original)
      setChanges((previous) => [
        ...previous.filter((change) => !matches(change, original)),
        { kind: "delete", original, values: {} },
      ]);
  };
  const sort = (column: number) => {
    if (state.busy || changes.length) return;
    if (state.activeResultId) {
      const current = state.sort?.column === column ? state.sort.direction : undefined;
      request({
        type: "query/sort",
        resultId: state.activeResultId,
        sort: current === "desc" ? null : { column, direction: current === "asc" ? "desc" : "asc" },
      });
    } else {
      const name = table.columns[column]!;
      const current = state.order?.column === name ? state.order.direction : undefined;
      request({
        type: "table/filter",
        filters: state.filters ?? [],
        order:
          current === "desc"
            ? null
            : { column: name, direction: current === "asc" ? "desc" : "asc" },
      });
    }
  };
  const filterValue = (row: number, col: number) => {
    const value = valueAt(row, col);
    if (typeof value === "object" && value !== null) return;
    request({
      type: "table/filter",
      order: state.order ?? null,
      filters: [
        ...(state.filters ?? []),
        { column: table.columns[col]!, operator: value === null ? "IS NULL" : "=", value },
      ],
    });
    setContext(null);
  };
  const validReview =
    changes.length > 0 &&
    state.previewSql?.length &&
    JSON.stringify(changes) === JSON.stringify(state.staged);
  const related =
    state.tableInfo && original
      ? [
          ...state.tableInfo.foreignKeys
            .filter((key) =>
              key.columns.every(
                (name) => original[name] !== null && typeof original[name] !== "object",
              ),
            )
            .map((key) => ({
              label: `${key.target} ← ${key.columns.join(", ")}`,
              target: key.target,
              filters: key.targetColumns.map((column, i) => ({
                column,
                operator: "=" as const,
                value: original[key.columns[i]!] ?? null,
              })),
            })),
          ...(state.schema ?? []).flatMap((source) =>
            source.foreignKeys
              .filter(
                (key) =>
                  key.target === state.tableInfo?.name &&
                  key.targetColumns.every(
                    (name) => original[name] !== null && typeof original[name] !== "object",
                  ),
              )
              .map((key) => ({
                label: `${source.name} → this row`,
                target: source.name,
                filters: key.columns.map((column, i) => ({
                  column,
                  operator: "=" as const,
                  value: original[key.targetColumns[i]!] ?? null,
                })),
              })),
          ),
        ]
      : [];
  return (
    <div className={`data-workbench density-${state.display?.density ?? "comfortable"}`}>
      {compare && (
        <details open className="record-comparison">
          <summary>
            Selected rows · {Math.abs(selection.endRow - selection.row) + 1} records (current page ·
            displayed values)
          </summary>
          <table
            style={{
              minWidth: 0,
              width: 48 + cols.reduce((sum, col) => sum + (widths[col.index] ?? 160), 0),
            }}
          >
            <colgroup>
              <col style={{ width: 48 }} />
              {cols.map((col) => (
                <col key={col.index} style={{ width: widths[col.index] ?? 160 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Field</th>
                {table.rows.map((_, i) =>
                  i >= Math.min(selection.row, selection.endRow) &&
                  i <= Math.max(selection.row, selection.endRow) ? (
                    <th key={i}>Row {i + 1}</th>
                  ) : null,
                )}
              </tr>
            </thead>
            <tbody>
              {table.columns.map((name, c) => {
                const rows = table.rows
                  .map((_, i) => i)
                  .filter(
                    (i) =>
                      i >= Math.min(selection.row, selection.endRow) &&
                      i <= Math.max(selection.row, selection.endRow),
                  );
                const different = new Set(rows.map((r) => JSON.stringify(valueAt(r, c)))).size > 1;
                return (
                  <tr key={c} className={different ? "comparison-different" : ""}>
                    <th>{name}</th>
                    {rows.map((r) => (
                      <td key={r}>
                        <pre>{pretty(valueAt(r, c))}</pre>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
      <div className="grid-actions action-row">
        <span className="connection-target" title="Database connection and environment">
          {state.connectionName}
        </span>
        {!state.tableInfo?.editable && state.editingReason && (
          <details className="editing-feedback">
            <summary>Editing unavailable</summary>
            <p>{state.editingReason}</p>
          </details>
        )}
        {state.activeResultId && (
          <input
            type="search"
            className="captured-search"
            aria-label="Search captured results"
            placeholder="Search captured rows…"
            title="Searches captured rows only"
            value={state.search ?? ""}
            disabled={state.busy || changes.length > 0}
            onChange={(event) =>
              request({
                type: "query/search",
                resultId: state.activeResultId!,
                text: event.target.value,
              })
            }
          />
        )}

        <button
          onClick={() => setInspector(!inspector)}
          aria-pressed={inspector}
          title="Inspect selected row"
        >
          <Icon name="inspect" /> Inspect row
        </button>
        {(allSelection || selectedRows * selectedColumns > 1) && (
          <output className="selection-summary">
            {allSelection
              ? `${state.page?.totalRows ?? "All"} rows × ${table.columns.length} columns selected · entire result${allSelection.headers ? " · with headers" : ""}`
              : `${selectedRows} rows × ${selectedColumns} columns selected · current page`}
          </output>
        )}
        <button
          className="icon-button"
          data-grid-menu-trigger
          aria-label="More actions"
          title="More actions · also available on right-click"
          aria-haspopup="menu"
          aria-expanded={Boolean(context || menuAnchor)}
          onClick={(event) => {
            if (context || menuAnchor) closeMenu();
            else {
              const box = event.currentTarget.getBoundingClientRect();
              setMenuAnchor({ x: box.left, y: box.bottom + 4 });
            }
          }}
        >
          <Icon name="ellipsis" />
        </button>
      </div>
      {formError && !edit && (
        <p role="alert" className="error">
          {formError}
        </p>
      )}
      {changes.length > 0 && (
        <div className="pending-bar">
          <strong>{changes.length} pending row changes</strong>
          <button
            disabled={state.busy}
            onClick={() => request({ type: "table/changes", changes, apply: false })}
          >
            Review SQL
          </button>
          <button
            disabled={state.busy || !validReview}
            onClick={() => request({ type: "table/changes", changes, apply: true })}
          >
            Commit changes
          </button>
          <button
            disabled={state.busy}
            onClick={() => {
              setChanges([]);
              request({ type: "table/discard" });
            }}
          >
            Discard
          </button>
          <button
            disabled={state.busy}
            onClick={() =>
              postRequest({
                type: "table/saveDraft",
                ...(state.activeResultId ? { resultId: state.activeResultId } : {}),
                changes,
              })
            }
          >
            Save draft…
          </button>
          <span>Review SQL before applying · navigation is paused</span>
        </div>
      )}
      {changes.length > 0 && validReview && (
        <details className="sql-review" open>
          <summary>SQL preview ({state.previewSql?.length} statements)</summary>
          <pre>{state.previewSql?.join("\n")}</pre>
          <p>
            Applied as one atomic batch. Inside an explicit transaction, changes remain uncommitted
            until COMMIT.
          </p>
        </details>
      )}
      <div className="grid-body">
        <div
          ref={grid}
          className="grid-container selectable-grid"
          onContextMenu={(event) => {
            if (event.defaultPrevented) return;
            event.preventDefault();
            setContext(null);
            setMenuAnchor({ x: event.clientX, y: event.clientY });
          }}
          role="grid"
          aria-label="Query result rows"
          tabIndex={0}
          onCopy={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("input,textarea,[contenteditable='true']")
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            window.getSelection()?.removeAllRanges();
            copy("tsv");
          }}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              (event.target instanceof Element &&
                event.target.closest("input,textarea,select,button,[contenteditable='true']"))
            )
              return;
            const modifier = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();
            if (modifier && key === "a") {
              event.preventDefault();
              event.stopPropagation();
              selectAll(event.shiftKey);
              return;
            }
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              const box = grid.current?.getBoundingClientRect();
              setMenuAnchor({ x: (box?.left ?? 0) + 24, y: (box?.top ?? 0) + 24 });
              return;
            }
            if (modifier && ["z", "y"].includes(key) && !state.busy) {
              event.preventDefault();
              restore(event.shiftKey || key === "y" ? "redo" : "undo");
              return;
            }
            if (modifier && key === "c") {
              event.preventDefault();
              event.stopPropagation();
              window.getSelection()?.removeAllRanges();
              copy("tsv");
              return;
            }
            if (!table.rows.length || !cols.length) return;
            if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              editCell(selection.endRow, cols[endColumn]!.index);
              return;
            }
            if (event.key === " " && (modifier || event.shiftKey)) {
              event.preventDefault();
              setSelection(
                modifier
                  ? {
                      row: 0,
                      endRow: table.rows.length - 1,
                      col: cols[endColumn]!.index,
                      endCol: cols[endColumn]!.index,
                    }
                  : {
                      row: selection.endRow,
                      endRow: selection.endRow,
                      col: cols[0]!.index,
                      endCol: cols.at(-1)!.index,
                    },
              );
              return;
            }
            if (event.key === "Escape") {
              closeMenu();
              setSelection({
                row: selection.endRow,
                col: cols[endColumn]!.index,
                endRow: selection.endRow,
                endCol: cols[endColumn]!.index,
              });
              return;
            }
            if (
              ![
                "ArrowDown",
                "ArrowUp",
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
                "PageUp",
                "PageDown",
                "Tab",
              ].includes(event.key)
            )
              return;
            let row = selection.endRow,
              position = endColumn;
            const pageRows = Math.max(
              1,
              Math.floor(
                ((grid.current?.clientHeight ?? 0) -
                  (grid.current?.querySelector("thead")?.getBoundingClientRect().height ?? 0)) /
                  (grid.current?.querySelector("tbody tr")?.getBoundingClientRect().height || 28),
              ),
            );
            switch (event.key) {
              case "Home":
                position = 0;
                if (modifier) row = 0;
                break;
              case "End":
                position = cols.length - 1;
                if (modifier) row = table.rows.length - 1;
                break;
              case "PageUp":
                row -= pageRows;
                break;
              case "PageDown":
                row += pageRows;
                break;
              case "ArrowUp":
                row = modifier ? 0 : row - 1;
                break;
              case "ArrowDown":
                row = modifier ? table.rows.length - 1 : row + 1;
                break;
              case "ArrowLeft":
                position = modifier ? 0 : position - 1;
                break;
              case "ArrowRight":
                position = modifier ? cols.length - 1 : position + 1;
                break;
              case "Tab": {
                const next = row * cols.length + position + (event.shiftKey ? -1 : 1);
                if (next < 0 || next >= table.rows.length * cols.length) return;
                row = Math.floor(next / cols.length);
                position = next % cols.length;
                break;
              }
            }
            event.preventDefault();
            row = Math.max(0, Math.min(table.rows.length - 1, row));
            position = Math.max(0, Math.min(cols.length - 1, position));
            const col = cols[position]!.index;
            setSelection(
              event.shiftKey && event.key !== "Tab"
                ? { ...selection, endRow: row, endCol: col }
                : { row, col, endRow: row, endCol: col },
            );
            grid.current
              ?.querySelector<HTMLElement>(`td[data-row="${row}"][data-column="${col}"]`)
              ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          }}
          onPointerMove={(event) => {
            const current = resize.current;
            if (current)
              setWidths((previous) => ({
                ...previous,
                [current.col]: Math.min(
                  2000,
                  Math.max(80, current.width + event.clientX - current.x),
                ),
              }));
          }}
          onPointerUp={() => {
            resize.current = null;
          }}
          onPointerCancel={() => {
            resize.current = null;
          }}
        >
          <table>
            <thead>
              <tr>
                <th className="row-number" aria-label="Row number">
                  <button
                    className="select-all-cells"
                    aria-label="Select all cells"
                    title="Select entire result (Ctrl/Cmd+A); add Shift to include headers"
                    onClick={(event) => selectAll(event.shiftKey)}
                  >
                    #
                  </button>
                </th>
                {cols.map(({ name, index }) => {
                  const direction = state.activeResultId
                    ? state.sort?.column === index
                      ? state.sort.direction
                      : undefined
                    : state.order?.column === name
                      ? state.order.direction
                      : undefined;
                  return (
                    <th
                      key={index}
                      scope="col"
                      className={frozenLeft.has(index) ? "frozen-column" : undefined}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelection({
                          row: 0,
                          endRow: Math.max(0, table.rows.length - 1),
                          col: index,
                          endCol: index,
                        });
                        setContext({
                          x: event.clientX,
                          y: event.clientY,
                          row: selection.endRow,
                          col: index,
                        });
                        setMenuAnchor(null);
                      }}
                      style={{
                        left: frozenLeft.get(index),
                        minWidth: widths[index] ?? 160,
                        width: widths[index] ?? 160,
                        maxWidth: widths[index] ?? 160,
                      }}
                      aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                      }
                    >
                      <button
                        className="sort-column"
                        disabled={state.busy || changes.length > 0}
                        onClick={() => sort(index)}
                        aria-label={`Sort by ${name}`}
                        title={`${state.activeResultId ? "Sort captured rows" : "Sort all database rows"} · right-click for column actions`}
                      >
                        <span>
                          {name}{" "}
                          <span className="sort-indicator">
                            <Icon
                              name={
                                direction === "asc"
                                  ? "arrow-small-up"
                                  : direction === "desc"
                                    ? "arrow-small-down"
                                    : "chevron-expand"
                              }
                            />
                          </span>
                        </span>
                        {state.display?.showDataTypes !== false && (
                          <small>{table.columnMetadata?.[index]?.dataType ?? ""}</small>
                        )}
                      </button>
                      <button
                        type="button"
                        className="column-resizer"
                        aria-label={`Resize ${name}`}
                        title="Drag to resize; double-click or press Enter to auto-size to the loaded page"
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            autoSize(index);
                          }
                        }}
                        onDoubleClick={() => {
                          resize.current = null;
                          autoSize(index);
                        }}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          resize.current = {
                            col: index,
                            x: event.clientX,
                            width:
                              event.currentTarget.parentElement?.getBoundingClientRect().width ??
                              widths[index] ??
                              160,
                          };
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => {
                const change = pending(objectRow(table, row));
                return (
                  <tr key={index} className={change ? `staged-${change.kind}` : ""}>
                    <td
                      className="row-number"
                      onClick={() => {
                        setSelection({
                          row: index,
                          endRow: index,
                          col: cols[0]?.index ?? 0,
                          endCol: cols.at(-1)?.index ?? 0,
                        });
                        grid.current?.focus();
                      }}
                    >
                      {(state.page?.offset ?? 0) + index + 1}
                    </td>
                    {cols.map(({ index: column }) => {
                      const value = valueAt(index, column),
                        text = cellText(value);
                      return (
                        <td
                          key={column}
                          data-row={index}
                          data-column={column}
                          className={`cell-${value === null ? "null" : typeof value === "object" ? value.type : typeof value} ${isSelected(index, column) ? "selected-cell" : ""} ${frozenLeft.has(column) ? "frozen-column" : ""}`}
                          aria-selected={isSelected(index, column)}
                          title={
                            typeof value === "object" && value?.type === "blob"
                              ? `Hex preview: ${value.hex}`
                              : text
                          }
                          style={{ maxWidth: widths[column] ?? 160, left: frozenLeft.get(column) }}
                          onClick={(event) => {
                            setSelection(
                              event.shiftKey
                                ? { ...selection, endRow: index, endCol: column }
                                : { row: index, col: column, endRow: index, endCol: column },
                            );
                            setContext(null);
                            grid.current?.focus();
                          }}
                          onDoubleClick={() => editCell(index, column)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            if (!isSelected(index, column))
                              setSelection({
                                row: index,
                                col: column,
                                endRow: index,
                                endCol: column,
                              });
                            setMenuAnchor(null);
                            setContext({
                              x: Math.max(4, Math.min(event.clientX, window.innerWidth - 220)),
                              y: Math.max(4, Math.min(event.clientY, window.innerHeight - 80)),
                              row: index,
                              col: column,
                            });
                          }}
                        >
                          {inline?.row === index && inline.column === column ? (
                            <input
                              ref={inlineInput}
                              className="inline-cell-editor"
                              aria-label={`Edit ${table.columns[column]}, row ${(state.page?.offset ?? 0) + index + 1}`}
                              value={inline.text}
                              onChange={(event) =>
                                setInline({ ...inline, text: event.target.value, touched: true })
                              }
                              onBlur={stageInline}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  stageInline();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  setInline(null);
                                  setFormError("");
                                }
                              }}
                            />
                          ) : typeof value === "object" && value?.type === "blob" ? (
                            `BLOB · ${value.bytes} bytes`
                          ) : value === null ? (
                            (state.display?.nullDisplay ?? "NULL")
                          ) : text === "" ? (
                            <span className="empty-string">empty</span>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!table.rows.length && (
            <div className="empty-state">
              <strong>No rows returned</strong>
              <p>The query completed successfully.</p>
            </div>
          )}
        </div>
        {inspector && (
          <aside className="record-inspector" aria-label="Record inspector">
            <header>
              <strong>Row {(state.page?.offset ?? 0) + selection.endRow + 1}</strong>
              <button aria-label="Close inspector" onClick={() => setInspector(false)}>
                <Icon name="close" />
              </button>
            </header>
            <select
              aria-label="Record view"
              value={inspectorMode}
              onChange={(event) => setInspectorMode(event.target.value)}
            >
              <option value="fields">Fields</option>
              <option value="json">JSON</option>
              <option value="raw">Raw JSON</option>
            </select>
            {selectedRow && inspectorMode !== "fields" ? (
              inspectorMode === "json" ? (
                <JsonInspector
                  text={JSON.stringify({
                    columns: table.columns,
                    values: table.columns.map((_, i) => valueAt(selection.endRow, i)),
                  })}
                  copy={(text) => request({ type: "data/copy", text })}
                />
              ) : (
                <pre>
                  {JSON.stringify({
                    columns: table.columns,
                    values: table.columns.map((_, i) => valueAt(selection.endRow, i)),
                  })}
                </pre>
              )
            ) : selectedRow ? (
              table.columns.map((name, index) => (
                <section key={index}>
                  <header>
                    <code>{name}</code>
                    <small>{table.columnMetadata?.[index]?.dataType}</small>
                    <button
                      aria-label={`Copy ${name} value`}
                      onClick={() =>
                        request({
                          type: "data/copy",
                          text: cellText(valueAt(selection.endRow, index)),
                        })
                      }
                    >
                      Copy
                    </button>
                  </header>
                  {typeof valueAt(selection.endRow, index) === "string" ? (
                    <JsonInspector
                      text={cellText(valueAt(selection.endRow, index))}
                      copy={(text) => request({ type: "data/copy", text })}
                    />
                  ) : (
                    <pre>{pretty(valueAt(selection.endRow, index)) || "(empty text)"}</pre>
                  )}
                  {editable && isJson(valueAt(selection.endRow, index)) && (
                    <button
                      onClick={() =>
                        request({ type: "table/json", row: selection.endRow, column: index })
                      }
                    >
                      Edit JSON
                    </button>
                  )}
                  {state.tableInfo?.columns.some((col) => col.primaryKey > 0) && (
                    <button
                      onClick={() =>
                        request({ type: "table/value", row: selection.endRow, column: index })
                      }
                    >
                      Open complete value
                    </button>
                  )}
                </section>
              ))
            ) : (
              <p>Select a row</p>
            )}
            {related.length > 0 && (
              <section>
                <h3>Related rows</h3>
                {related.map((item, index) => (
                  <button
                    key={index}
                    disabled={changes.length > 0}
                    onClick={() =>
                      request({ type: "table/related", target: item.target, filters: item.filters })
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </section>
            )}
          </aside>
        )}
      </div>
      {(context || menuAnchor) && (
        <ActionMenu
          x={(context ?? menuAnchor)!.x}
          y={(context ?? menuAnchor)!.y}
          onClose={closeMenu}
        >
          <button role="menuitem" disabled={!selectedRow} onClick={() => setInspector(true)}>
            <Icon name="inspect" /> Inspect row
          </button>
          {context && (
            <>
              {state.tableInfo && (
                <button
                  role="menuitem"
                  disabled={
                    changes.length > 0 ||
                    (typeof valueAt(context.row, context.col) === "object" &&
                      valueAt(context.row, context.col) !== null)
                  }
                  onClick={() => filterValue(context.row, context.col)}
                >
                  Filter by this value
                </button>
              )}
              <button role="menuitem" onClick={() => setHidden([...hidden, context.col])}>
                Hide column
              </button>
            </>
          )}
          {state.activeResultId && (
            <button
              role="menuitem"
              onClick={() => request({ type: "query/compare", resultId: state.activeResultId! })}
            >
              <Icon name="git-compare" /> Compare results
            </button>
          )}
          <button
            role="menuitem"
            disabled={selection.row === selection.endRow}
            onClick={() => setCompare(!compare)}
          >
            Compare selected rows
          </button>
          {editable && (
            <>
              <button
                role="menuitem"
                disabled={state.busy || !undo.length}
                onClick={() => restore("undo")}
              >
                <Icon name="discard" /> Undo edit
              </button>
              <button
                role="menuitem"
                disabled={state.busy || !redo.length}
                onClick={() => restore("redo")}
              >
                <Icon name="redo" /> Redo edit
              </button>
              <button
                role="menuitem"
                disabled={state.busy || !original || !pending(original)}
                onClick={() => setChanges(changes.filter((c) => !matches(c, original!)))}
              >
                <Icon name="discard" /> Revert row
              </button>
            </>
          )}
          <button role="menuitem" disabled={!table.rows.length} onClick={() => selectAll(false)}>
            Select all data · Ctrl/Cmd+A
          </button>
          <button role="menuitem" disabled={!table.columns.length} onClick={() => selectAll(true)}>
            Select all with headers · Ctrl/Cmd+Shift+A
          </button>
          <button
            role="menuitem"
            disabled={!selectedRow && !allSelection?.headers}
            onClick={() => copy("tsv")}
          >
            <Icon name="copy" /> Copy selection
          </button>
          <button
            role="menuitem"
            disabled={!selectedRow && !allSelection?.headers}
            onClick={() => copy("tsv", true)}
          >
            <Icon name="copy" /> Copy with headers
          </button>
          <button role="menuitem" disabled={!cols.length} onClick={() => copy("tsv", false, true)}>
            Copy headers
          </button>
          <button role="menuitem" onClick={() => autoSize(context?.col ?? selection.endCol)}>
            Auto-size column · loaded page
          </button>
          <button role="menuitem" onClick={() => autoSize()}>
            Auto-size all columns · loaded page
          </button>
          <button
            role="menuitem"
            data-frozen={frozen.includes(table.columns[context?.col ?? selection.endCol] ?? "")}
            onClick={() => toggleFrozen(context?.col ?? selection.endCol)}
          >
            <Icon name="pin" />{" "}
            {frozen.includes(table.columns[context?.col ?? selection.endCol] ?? "")
              ? "Unfreeze column"
              : "Freeze column"}
          </button>
          {frozen.length > 0 && (
            <button role="menuitem" onClick={() => setFrozen([])}>
              Unfreeze all columns
            </button>
          )}
          <button role="menuitem" disabled={!selectedRow} onClick={() => copy("json")}>
            <Icon name="json" /> Copy JSON
          </button>
          <details className="column-picker">
            <summary>
              Columns ({cols.length}/{table.columns.length})
            </summary>
            <div>
              {table.columns.map((name, index) => (
                <label key={index}>
                  <input
                    type="checkbox"
                    aria-label={`Show ${name}`}
                    checked={!hidden.includes(index)}
                    onChange={() =>
                      setHidden((previous) =>
                        previous.includes(index)
                          ? previous.filter((i) => i !== index)
                          : [...previous, index],
                      )
                    }
                  />
                  {name}
                  <button
                    role="menuitem"
                    aria-label={`${frozen.includes(name) ? "Unfreeze" : "Freeze"} ${name}`}
                    data-frozen={frozen.includes(name)}
                    onClick={() => toggleFrozen(index)}
                  >
                    <Icon name={frozen.includes(name) ? "pinned" : "pin"} />
                  </button>
                  <button
                    role="menuitem"
                    aria-label={`Move ${name} left`}
                    onClick={() => {
                      const next = [...columnOrder];
                      const i = next.indexOf(name);
                      if (i > 0) {
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        setColumnOrder(next);
                      }
                    }}
                  >
                    <Icon name="arrow-left" />
                  </button>
                </label>
              ))}
              <button role="menuitem" onClick={() => setHidden([])}>
                Show all
              </button>
            </div>
          </details>
          {editable && (
            <>
              {!state.activeResultId && (
                <button role="menuitem" disabled={state.busy} onClick={() => startEdit("insert")}>
                  <Icon name="add" /> Add row
                </button>
              )}
              <button
                role="menuitem"
                disabled={state.busy || !selectedRow}
                onClick={() => startEdit("update")}
              >
                <Icon name="edit" /> Edit row
              </button>
              {!state.activeResultId && (
                <>
                  <button
                    role="menuitem"
                    disabled={state.busy || !selectedRow}
                    onClick={() => startEdit("insert", true)}
                  >
                    <Icon name="files" /> Duplicate
                  </button>
                  <button role="menuitem" disabled={state.busy || !selectedRow} onClick={deleteRow}>
                    <Icon name="trash" /> Delete row
                  </button>
                  <button
                    role="menuitem"
                    disabled={state.busy || changes.length > 0}
                    onClick={() => request({ type: "table/import" })}
                  >
                    <Icon name="cloud-upload" /> Import CSV
                  </button>
                </>
              )}
            </>
          )}
          <details className="export-menu">
            <summary>Export</summary>
            <div>
              {(["csv", "json"] as const).map((format) => (
                <span key={format}>
                  <button
                    role="menuitem"
                    onClick={() => request({ type: "data/export", format, scope: "page" })}
                  >
                    Page · {format.toUpperCase()}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() =>
                      request({
                        type: "data/export",
                        format,
                        scope: state.activeResultId ? "snapshot" : "table",
                      })
                    }
                  >
                    {state.activeResultId ? "Captured result" : "Filtered table"} ·{" "}
                    {format.toUpperCase()}
                  </button>
                </span>
              ))}
            </div>
          </details>
        </ActionMenu>
      )}
      {edit && (
        <div className="modal-backdrop">
          <dialog
            ref={dialog}
            onCancel={() => setEdit(null)}
            aria-modal="true"
            aria-label={edit.kind === "insert" ? "Insert row" : "Edit row"}
            className="row-editor"
          >
            <h2>
              {edit.kind === "insert" ? "Insert row" : "Edit row"} · {state.tableInfo?.name}
            </h2>
            <p>
              Stage changes, review SQL, then apply. NULL, empty text, and omitted/default values
              are distinct.
            </p>
            {state.tableInfo?.columns
              .filter((col) => !col.generated)
              .map((col) => {
                const value = edit.values[col.name];
                const type =
                  value === undefined
                    ? "default"
                    : value === null
                      ? "null"
                      : typeof value === "number"
                        ? "number"
                        : typeof value === "object"
                          ? value.type === "integer"
                            ? "integer"
                            : "tagged"
                          : "text";
                return (
                  <label className="edit-field" key={col.name}>
                    <span>
                      {col.name}{" "}
                      <small>
                        {col.type}
                        {col.primaryKey ? " · PK" : ""}
                      </small>
                    </span>
                    <select
                      aria-label={`${col.name} value type`}
                      value={type}
                      onChange={(event) => {
                        setFormError("");
                        const kind = event.target.value;
                        setEdit((previous) => {
                          if (!previous) return previous;
                          const values = { ...previous.values };
                          if (kind === "default") delete values[col.name];
                          else
                            values[col.name] =
                              kind === "null"
                                ? null
                                : kind === "number"
                                  ? 0
                                  : kind === "integer"
                                    ? { type: "integer", value: "0" }
                                    : "";
                          return { ...previous, values };
                        });
                      }}
                    >
                      {edit.kind === "insert" && <option value="default">Default / omitted</option>}
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="integer">Exact integer</option>
                      <option value="null">NULL</option>
                      {type === "tagged" && (
                        <option value="tagged">Exact original / preview</option>
                      )}
                    </select>
                    {type === "text" ? (
                      <textarea
                        aria-label={`${col.name} value`}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) =>
                          setEdit({
                            ...edit,
                            values: { ...edit.values, [col.name]: event.target.value },
                          })
                        }
                      />
                    ) : type === "integer" ? (
                      <input
                        aria-label={`${col.name} exact integer`}
                        value={
                          typeof value === "object" && value?.type === "integer" ? value.value : ""
                        }
                        onChange={(event) =>
                          setEdit({
                            ...edit,
                            values: {
                              ...edit.values,
                              [col.name]: { type: "integer", value: event.target.value },
                            },
                          })
                        }
                      />
                    ) : type === "number" ? (
                      <input
                        aria-label={`${col.name} value`}
                        type="number"
                        step="any"
                        value={Number(value)}
                        onChange={(event) => {
                          const number = Number(event.target.value);
                          if (Number.isFinite(number))
                            setEdit({ ...edit, values: { ...edit.values, [col.name]: number } });
                        }}
                      />
                    ) : (
                      <span className="muted">
                        {type === "default"
                          ? (col.defaultValue ?? "Database default")
                          : value === null
                            ? "NULL"
                            : cellText(value ?? null)}
                      </span>
                    )}
                  </label>
                );
              })}
            {formError && <p role="alert">{formError}</p>}
            <footer>
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button onClick={stage}>Stage row</button>
            </footer>
          </dialog>
        </div>
      )}
    </div>
  );
}
