/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Tree actions carry a JSON pointer. */
import { formatJson, jsonEntries, type JsonEntry } from "@datsumi/core";
import { useState } from "react";

import { displayValue } from "./documentValues";
export function JsonInspector({ text, copy }: { text: string; copy: (value: string) => void }) {
  const [mode, setMode] = useState("tree");
  const [search, setSearch] = useState("");
  let root: JsonEntry;
  try {
    root = jsonEntries(text);
  } catch {
    return <pre>{text || "(empty text)"}</pre>;
  }
  const render = (entry: JsonEntry, depth: number): React.ReactNode => {
    if (
      search &&
      !entry.raw.toLowerCase().includes(search.toLowerCase()) &&
      !entry.path.toLowerCase().includes(search.toLowerCase())
    )
      return null;
    const scalar =
      entry.children.length === 1 &&
      [
        "$oid",
        "$numberInt",
        "$numberLong",
        "$numberDecimal",
        "$numberDouble",
        "$date",
        "$binary",
      ].includes(entry.children[0]!.key);
    return entry.children.length && !scalar ? (
      <details key={entry.path} open={Boolean(search) || depth < 1}>
        <summary>
          {entry.key} · {entry.children.length}{" "}
          <button
            onClick={(event) => {
              event.preventDefault();
              copy(entry.path);
            }}
          >
            Copy path
          </button>
        </summary>
        {entry.truncated && (
          <small>Tree preview limited. Open Raw or the JSON editor for all fields.</small>
        )}
        <div className="json-children">
          {depth < 30 ? (
            entry.children.map((child) => render(child, depth + 1))
          ) : (
            <pre>{entry.raw}</pre>
          )}
        </div>
      </details>
    ) : (
      <div key={entry.path} className="json-leaf">
        <code>
          {entry.key}: {scalar ? displayValue(entry) : entry.raw}
        </code>
        <button title={entry.path} onClick={() => copy(entry.path)}>
          Path
        </button>
        <button onClick={() => copy(entry.raw)}>Copy</button>
      </div>
    );
  };
  return (
    <div className="json-inspector">
      <div className="action-row">
        <select
          aria-label="JSON view"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="tree">JSON tree</option>
          <option value="formatted">Formatted</option>
          <option value="raw">Raw</option>
        </select>
        <button onClick={() => copy(text)}>Copy document</button>
      </div>
      <input
        aria-label="Search JSON paths and values"
        type="search"
        placeholder="Search paths and values…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {mode === "tree" ? render(root, 0) : <pre>{mode === "raw" ? text : formatJson(text)}</pre>}
    </div>
  );
}
