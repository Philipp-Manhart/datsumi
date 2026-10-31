import type { WebviewRequest, WebviewResponse } from "@datsumi/protocol";
/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Native control handlers carry selected values. */
import { useMemo, useState } from "react";

import { documentFields, displayValue, recordLabel, expiryLabel } from "./documentValues";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";
import { JsonInspector } from "./JsonInspector";
import { RedisValue } from "./RedisValue";
export function DataBrowser({
  state,
  request,
}: {
  state: WebviewResponse;
  request: (message: WebviewRequest) => void;
}) {
  const data = state.data!;
  const mongo = state.driverName === "mongodb";
  const [view, setView] = useState("table"),
    [inspect, setInspect] = useState(false);
  const [keySearch, setKeySearch] = useState(""),
    [keyType, setKeyType] = useState("");
  const documents = useMemo(
    () =>
      mongo ? data.records.map((record) => ({ record, fields: documentFields(record.text) })) : [],
    [data.records, mongo],
  );
  const columns = [
    ...new Set(documents.flatMap((item) => item.fields.map((field) => field.key))),
  ].slice(0, 20);
  const keys = data.records
    .filter(
      (record) =>
        (!keyType || record.type === keyType) &&
        record.id.toLowerCase().includes(keySearch.toLowerCase()),
    )
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const [filter, setFilter] = useState(data.filter),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<string | null>(null),
    [reviewed, setReviewed] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [lastFilter, setLastFilter] = useState(data.filter);
  if (lastFilter !== data.filter) {
    setLastFilter(data.filter);
    setFilter(data.filter);
  }
  if (
    committing &&
    !state.busy &&
    !state.error &&
    draft !== null &&
    data.records.some((r) => r.id === selected && r.text === draft)
  ) {
    setDraft(null);
    setReviewed(null);
    setCommitting(false);
  }
  if (committing && state.error) setCommitting(false);
  const available = mongo ? data.records : keys;
  const record = available.find((r) => r.id === selected) ?? available[0];
  const choose = (id: string) => {
    if (draft !== null && !window.confirm("Discard this local draft?")) return;
    setInspect(true);
    setSelected(id);
    setDraft(null);
    setReviewed(null);
  };
  return (
    <div className={`document-browser ${mongo ? "mongo-browser" : "redis-browser"}`}>
      <div className="action-row document-toolbar">
        <input
          aria-label={state.driverName === "redis" ? "Key pattern" : "MongoDB filter"}
          placeholder={
            mongo
              ? 'Filter documents, e.g. {"status":"paid"}'
              : "Key pattern, e.g. datsumi:sample:*"
          }
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          disabled={state.busy || draft !== null}
          onClick={() => request({ type: "data/browse", filter })}
        >
          Apply filter
        </button>
        <button
          disabled={state.busy || draft !== null || !data.back}
          onClick={() => request({ type: "data/back" })}
        >
          Back
        </button>
        <button
          disabled={state.busy || draft !== null || (!data.cursor && !data.forward)}
          onClick={() =>
            data.forward
              ? request({ type: "data/forward" })
              : request({ type: "data/browse", filter: data.filter, cursor: data.cursor })
          }
        >
          Next batch
        </button>
        <button
          onClick={() => request({ type: "data/browse", filter: data.filter })}
          disabled={state.busy || draft !== null}
        >
          Refresh
        </button>
        {mongo && (
          <select
            aria-label="Collection view"
            value={view}
            disabled={draft !== null}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="table">Table</option>
            <option value="documents">Documents</option>
          </select>
        )}
        <button onClick={() => request({ type: "data/query" })}>Query editor</button>
      </div>
      <div className="document-status">
        <span>
          {data.records.length} {mongo ? "documents" : "keys"} in this batch
        </span>
        <details>
          <summary>About this view</summary>
          <p>{data.note}</p>
          {mongo && (
            <p>
              Columns are sampled from this batch. Exact BSON types are preserved when copying or
              editing.
            </p>
          )}
        </details>
      </div>
      <div
        className={`document-layout ${mongo && view === "table" ? (inspect ? "mongo-with-inspector" : "mongo-table-only") : ""}`}
      >
        {mongo && view === "table" ? (
          <div className="mongo-grid">
            <table aria-label="MongoDB documents">
              <thead>
                <tr>
                  <th>Inspect</th>
                  {columns.map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map(({ record: r, fields }) => (
                  <tr
                    key={r.id}
                    className={record?.id === r.id && inspect ? "active-document" : ""}
                  >
                    <td>
                      <button
                        aria-label={`Inspect document ${recordLabel(r.id)}`}
                        onClick={() => choose(r.id)}
                      >
                        <Icon name="inspect" />
                      </button>
                    </td>
                    {columns.map((name) => (
                      <td
                        key={name}
                        title={fields.find((field) => field.key === name)?.raw}
                        onDoubleClick={() => choose(r.id)}
                      >
                        {displayValue(fields.find((field) => field.key === name))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!documents.length && <p className="empty-state">No documents match this filter.</p>}
          </div>
        ) : (
          <nav aria-label="Documents and keys" className="data-record-list">
            {!mongo && (
              <div className="key-filters">
                <input
                  aria-label="Search loaded keys"
                  disabled={draft !== null}
                  placeholder="Search loaded keys…"
                  value={keySearch}
                  onChange={(event) => setKeySearch(event.target.value)}
                />
                <Dropdown
                  label="Key type"
                  disabled={draft !== null}
                  value={keyType}
                  onChange={setKeyType}
                  options={[
                    { value: "", label: "All types" },
                    ...[...new Set(data.records.map((r) => r.type ?? "unknown"))]
                      .sort()
                      .map((type) => ({ value: type, label: type })),
                  ]}
                />
              </div>
            )}
            {(mongo ? data.records : keys).map((r) => (
              <button
                key={r.id}
                className={`data-record ${record?.id === r.id ? "active-record" : ""}`}
                onClick={() => choose(r.id)}
                title={r.id}
              >
                <span className="record-key">{mongo ? recordLabel(r.id) : r.id}</span>
                <span className="record-summary">
                  {mongo ? (
                    documentFields(r.text)
                      .filter((field) => field.key !== "_id")
                      .slice(0, 3)
                      .map((field) => `${field.key}: ${displayValue(field)}`)
                      .join(" · ")
                  ) : (
                    <>
                      <span className="type-badge">{r.type}</span>
                      <span>{expiryLabel(r.ttl)}</span>
                    </>
                  )}
                </span>
              </button>
            ))}
            {!(mongo ? data.records : keys).length && (
              <p className="empty-state">
                {data.records.length
                  ? "No loaded keys match your search."
                  : "No records in this batch. Continue scanning if Next is available."}
              </p>
            )}
          </nav>
        )}
        {(!mongo || view !== "table" || inspect) && (
          <section aria-label="Document or key value" className="data-value-pane">
            {record && (
              <>
                <header className="action-row">
                  <div className="record-heading">
                    <strong>{mongo ? recordLabel(record.id) : record.id}</strong>
                    <small>
                      {mongo ? "Document" : record.type}
                      {record.ttl !== undefined ? ` · ${expiryLabel(record.ttl)}` : ""}
                      {!record.editable ? " · Read-only" : ""}
                    </small>
                  </div>
                  {mongo && view === "table" && (
                    <button
                      aria-label="Close document inspector"
                      disabled={draft !== null}
                      onClick={() => setInspect(false)}
                    >
                      Close
                    </button>
                  )}
                  <button onClick={() => request({ type: "data/copy", text: record.text })}>
                    Copy value
                  </button>
                  {record.editable && draft === null && (
                    <button
                      onClick={() => {
                        setSelected(record.id);
                        setDraft(record.text);
                        setReviewed(null);
                      }}
                    >
                      Edit value
                    </button>
                  )}
                </header>
                {draft === null ? (
                  mongo ? (
                    <JsonInspector
                      key={record.id}
                      text={record.text}
                      copy={(text) => request({ type: "data/copy", text })}
                    />
                  ) : (
                    <RedisValue
                      key={record.id}
                      record={record}
                      copy={(text) => request({ type: "data/copy", text })}
                    />
                  )
                ) : (
                  <>
                    <p>
                      Changes stay local until reviewed and confirmed. Redis expiry is preserved.
                    </p>
                    <textarea
                      className="document-editor"
                      aria-label="Edit document or key"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setReviewed(null);
                      }}
                    />
                    <div className="action-row">
                      <button
                        disabled={state.busy}
                        onClick={() => {
                          setDraft(null);
                          setReviewed(null);
                        }}
                      >
                        Discard
                      </button>
                      <button
                        disabled={state.busy}
                        onClick={() => {
                          setReviewed(draft);
                          request({ type: "data/edit", id: record.id, text: draft, apply: false });
                        }}
                      >
                        Review change
                      </button>
                      <button
                        disabled={
                          state.busy || reviewed !== draft || !data.preview || Boolean(state.error)
                        }
                        onClick={() => {
                          setCommitting(true);
                          request({ type: "data/edit", id: record.id, text: draft, apply: true });
                        }}
                      >
                        Commit change…
                      </button>
                    </div>
                  </>
                )}
                {data.preview && (
                  <details open>
                    <summary>Change review</summary>
                    <pre>{data.preview}</pre>
                  </details>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
