import {
  webviewResponseSchema,
  type WebviewRequest,
  type WebviewResponse,
} from "@datsumi/protocol";
/* oxlint-disable react/no-array-index-key -- SQL results may contain duplicate rows and column names; cells have positional identity. */
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type KeyboardEvent,
} from "react";

import { DataBrowser } from "./DataBrowser";
import { DataGrid } from "./DataGrid";
import { Icon } from "./Icon";
import { previewState } from "./preview";
import { QueryPlan } from "./QueryPlan";
import { SchemaGraph } from "./SchemaGraph";
import { TableTools } from "./TableTools";
import { getVsCodeApi } from "./vscode";

const vscode = getVsCodeApi();

const hostPostMessage = vscode
  ? (message: WebviewRequest) => vscode.postMessage(message)
  : undefined;

export function App({
  postMessage = hostPostMessage,
}: {
  postMessage?: (message: WebviewRequest) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<WebviewResponse | null>(() =>
    postMessage ? null : previewState(),
  );
  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      const parsed = webviewResponseSchema.safeParse(event.data);
      if (parsed.success) setState(parsed.data);
    };
    window.addEventListener("message", listener);
    postMessage?.({ type: "ready", protocolVersion: 1 });
    return () => window.removeEventListener("message", listener);
  }, [postMessage]);

  const request = useCallback(
    (message: WebviewRequest) => {
      if (postMessage) postMessage(message);
      else if (message.type === "query/pin") {
        setState((previous) =>
          previous
            ? {
                ...previous,
                tabs: previous.tabs?.map((tab) =>
                  tab.id === message.resultId ? { ...tab, pinned: message.pinned } : tab,
                ),
              }
            : previous,
        );
      } else if (message.type === "query/rename") {
        const title = window.prompt("Rename result tab");
        if (title?.trim() && title.trim().length <= 80)
          setState((previous) =>
            previous
              ? {
                  ...previous,
                  title:
                    previous.activeResultId === message.resultId ? title.trim() : previous.title,
                  tabs: previous.tabs?.map((tab) =>
                    tab.id === message.resultId ? { ...tab, title: title.trim() } : tab,
                  ),
                }
              : previous,
          );
      } else setState((previous) => previewState(previous, message));
    },
    [postMessage],
  );
  const page = useCallback(
    (offset: number, limit: number): void => {
      if (state?.activeResultId)
        request({ type: "query/page", resultId: state.activeResultId, offset, limit });
      else request({ type: "table/page", offset, limit });
    },
    [request, state],
  );
  const result = state?.result;
  const table = result?.kind === "table" ? result : undefined;
  const pagination = state?.page;
  const busy = state?.busy ?? false;
  const navigationDisabled = busy || dirty;
  const activeTab = state?.tabs?.find((tab) => tab.id === state.activeResultId);
  const refresh = useCallback(() => {
    if (pagination) page(pagination.offset, pagination.limit);
  }, [page, pagination]);
  const previous = useCallback(() => {
    if (pagination) page(Math.max(0, pagination.offset - pagination.limit), pagination.limit);
  }, [page, pagination]);
  const next = useCallback(() => {
    if (pagination) page(pagination.offset + pagination.limit, pagination.limit);
  }, [page, pagination]);
  const resize = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => page(0, Number(event.target.value)),
    [page],
  );
  const selectTab = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.resultId;
      if (id) request({ type: "query/select", resultId: id });
    },
    [request],
  );
  const closeTab = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.resultId;
      if (id) request({ type: "query/close", resultId: id });
    },
    [request],
  );
  const renameTab = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.resultId;
      if (id) request({ type: "query/rename", resultId: id });
    },
    [request],
  );
  const pinTab = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.resultId;
      if (id)
        request({
          type: "query/pin",
          resultId: id,
          pinned: event.currentTarget.dataset.pinned !== "true",
        });
    },
    [request],
  );
  const keyboardTab = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const tabs = state?.tabs ?? [];
      const index = tabs.findIndex((tab) => tab.id === event.currentTarget.dataset.resultId);
      let target: number;
      if (event.key === "F2") {
        const id = event.currentTarget.dataset.resultId;
        if (id) {
          event.preventDefault();
          request({ type: "query/rename", resultId: id });
        }
        return;
      }
      switch (event.key) {
        case "ArrowRight":
          target = (index + 1) % tabs.length;
          break;
        case "ArrowLeft":
          target = (index + tabs.length - 1) % tabs.length;
          break;
        case "Home":
          target = 0;
          break;
        case "End":
          target = tabs.length - 1;
          break;
        default:
          return;
      }
      const id = tabs[target]?.id;
      if (id) {
        event.preventDefault();
        request({ type: "query/select", resultId: id });
        const buttons = event.currentTarget
          .closest('[role="tablist"]')
          ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[target]?.focus();
      }
    },
    [request, state?.tabs],
  );
  return (
    <main className="results" aria-busy={busy}>
      {!postMessage && (
        <div className="preview-notice">
          Development preview · sample data. Open Datsumi in VS Code to use your database.
        </div>
      )}
      {state?.tabs && state.tabs.length > 0 && (
        <div className="result-tabs" role="tablist" aria-label="Query results">
          {state.tabs.map((tab) => (
            <div
              className={`result-tab ${tab.id === state.activeResultId ? "active" : ""}`}
              key={tab.id}
              data-vscode-context={JSON.stringify({
                webviewSection: "resultTab",
                resultId: tab.id,
                preventDefaultContextMenuItems: true,
              })}
            >
              <button
                role="tab"
                aria-selected={tab.id === state.activeResultId}
                aria-controls="query-result-content"
                id={`tab-${tab.id}`}
                tabIndex={tab.id === state.activeResultId ? 0 : -1}
                data-result-id={tab.id}
                disabled={dirty}
                onClick={selectTab}
                onDoubleClick={renameTab}
                onKeyDown={keyboardTab}
                title={`${tab.connectionName}\n${tab.query}\nDouble-click or press F2 to rename`}
              >
                <Icon name={tab.error ? "error" : tab.busy ? "loading~spin" : "table"} />
                {tab.title}
              </button>
              <button
                className="pin-tab"
                aria-label={`${tab.pinned ? "Unpin" : "Pin"} ${tab.title}`}
                title={
                  tab.pinned
                    ? "Unpin result · normal runs can replace it"
                    : "Pin result · keep it when running another query"
                }
                aria-pressed={tab.pinned ?? false}
                data-result-id={tab.id}
                data-pinned={tab.pinned ?? false}
                onClick={pinTab}
              >
                <Icon name={tab.pinned ? "pinned" : "pin"} />
              </button>
              <button
                className="close-tab"
                disabled={dirty}
                aria-label={`Close ${tab.title}`}
                title={`Close ${tab.title}`}
                data-result-id={tab.id}
                onClick={closeTab}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="result-content"
        id="query-result-content"
        role={activeTab ? "tabpanel" : undefined}
        aria-labelledby={activeTab ? `tab-${activeTab.id}` : undefined}
      >
        {state?.error && (
          <div role="alert" className="error">
            {state.error}
          </div>
        )}
        {busy && (
          <output className="progress">
            Running query… Cancel from the VS Code progress notification.
          </output>
        )}
        {state?.mode === "data" && state.data ? (
          <DataBrowser
            key={`${state.driverName}:${state.connectionName}:${state.data.resource}`}
            state={state}
            request={request}
          />
        ) : state?.mode === "diagram" ? (
          <SchemaGraph state={state} request={request} />
        ) : table ? (
          <>
            {state && (
              <>
                {!state.activeResultId && (
                  <TableTools state={state} request={request} disabled={navigationDisabled} />
                )}
                {state.mode === "plan" ? (
                  <QueryPlan table={table} />
                ) : (
                  <DataGrid
                    key={state.activeResultId ?? state.tableInfo?.resourceId ?? "table"}
                    table={table}
                    state={state}
                    request={request}
                    onDirty={setDirty}
                  />
                )}
              </>
            )}
            <footer className="footer">
              <div className="result-info">
                <span className="success-dot" />
                <span className="connection-label" title={state?.connectionName}>
                  {state?.connectionName} ·
                </span>
                {table.rows.length
                  ? `${pagination ? pagination.offset + 1 : 1}–${(pagination?.offset ?? 0) + table.rows.length}`
                  : "0"}{" "}
                {pagination?.totalRows !== undefined
                  ? `of ${pagination.totalRows.toLocaleString()} captured rows`
                  : "rows"}{" "}
                <span className="separator">·</span> {table.durationMs ?? 0} ms{" "}
                {table.truncated && (
                  <span className="limit-note">
                    Capture limit reached. Paging and sorting cover captured rows only. Narrow your
                    query to see more.
                  </span>
                )}
              </div>
              {pagination && (
                <nav aria-label="Result pagination">
                  {!state?.activeResultId && (
                    <button
                      className="icon-button"
                      disabled={navigationDisabled}
                      onClick={refresh}
                      aria-label="Refresh rows"
                      title="Refresh rows"
                    >
                      <Icon name="refresh" />
                    </button>
                  )}
                  <label>
                    Rows per page{" "}
                    <select
                      aria-label="Rows per page"
                      value={pagination.limit}
                      disabled={navigationDisabled}
                      onChange={resize}
                    >
                      {[25, 50, 100, 250, 500].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pagination?.totalRows !== undefined && (
                    <span className="page-count">
                      Page {Math.floor(pagination.offset / pagination.limit) + 1} of{" "}
                      {Math.max(1, Math.ceil(pagination.totalRows / pagination.limit))}
                    </span>
                  )}
                  <button
                    disabled={navigationDisabled || pagination.offset === 0}
                    onClick={previous}
                  >
                    Previous
                  </button>
                  <button disabled={navigationDisabled || !pagination.hasMore} onClick={next}>
                    Next
                  </button>
                </nav>
              )}
            </footer>
          </>
        ) : result?.kind === "value" ? (
          <div className="empty-state">
            <span className="completion-mark">✓</span>
            <h2>Statement completed</h2>
            <pre>{JSON.stringify(result.value, null, 2)}</pre>
            <p>Changes are committed automatically unless you opened a transaction.</p>
          </div>
        ) : (
          <div className="empty-state">
            <strong>
              {busy ? "Fetching results" : state?.error ? "Query failed" : "Waiting for results"}
            </strong>
            <p>Run SQL from your editor with Ctrl+Enter / ⌘Enter.</p>
          </div>
        )}
      </div>
    </main>
  );
}
