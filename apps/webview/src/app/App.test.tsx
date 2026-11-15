import "@testing-library/jest-dom/vitest";
import type { WebviewRequest, WebviewResponse } from "@datsumi/protocol";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(cleanup);
const state: WebviewResponse = {
  type: "results/state",
  protocolVersion: 1,
  title: "customers",
  connectionName: "test.db",
  busy: false,
  error: null,
  page: { offset: 0, limit: 100, hasMore: true },
  result: {
    kind: "table",
    columns: ["id", "name", "blob"],
    rows: [
      [
        { type: "integer", value: "9007199254740993" },
        "<script>alert(1)</script>",
        { type: "blob", hex: "00ff", bytes: 2 },
      ],
      [2, null, null],
    ],
    durationMs: 4,
  },
};
function receive(value: unknown) {
  void act(() => window.dispatchEvent(new MessageEvent("message", { data: value })));
}

function menuAction(name: string) {
  if (!screen.queryByRole("menu"))
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  return screen.getByRole("menuitem", { name });
}

describe("results panel", () => {
  it("renders validated values as text and requests the next page", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "ready", protocolVersion: 1 });
    receive(state);
    expect(screen.getByText("9007199254740993")).toBeVisible();
    expect(screen.getByText("<script>alert(1)</script>")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("BLOB · 2 bytes")).toHaveAttribute("title", "Hex preview: 00ff");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "table/page", offset: 100, limit: 100 });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "25" } });
    expect(postMessage).toHaveBeenLastCalledWith({ type: "table/page", offset: 0, limit: 25 });
    expect(postMessage.mock.calls.filter(([message]) => message.type === "ready")).toHaveLength(1);
  });
  it("ignores malformed messages and displays host errors and busy states", () => {
    render(<App postMessage={vi.fn<(message: WebviewRequest) => void>()} />);
    receive({ ...state, protocolVersion: 99 });
    expect(screen.queryByText("customers")).not.toBeInTheDocument();
    receive({ ...state, busy: true, error: "Database is locked" });
    expect(screen.getByRole("alert")).toHaveTextContent("Database is locked");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it("offers a working standalone preview", () => {
    render(<App />);
    expect(screen.getByText(/Development preview/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("customer101@example.com")).toBeVisible();
  });
});

describe("query result tabs and sorting", () => {
  const snapshots: WebviewResponse = {
    ...state,
    activeResultId: "one",
    sort: null,
    page: { offset: 0, limit: 100, hasMore: true, totalRows: 237 },
    tabs: [
      {
        id: "one",
        title: "Query 1",
        connectionName: "first.db",
        query: "SELECT * FROM customers",
        busy: false,
        error: false,
      },
      {
        id: "two",
        title: "Query 2",
        connectionName: "second.db",
        query: "SELECT 1",
        busy: false,
        error: false,
      },
    ],
  };
  it("selects and closes results, requests snapshot pages, and cycles sort directions", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(snapshots);
    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Query 2" }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "query/select", resultId: "two" });
    fireEvent.click(screen.getByRole("button", { name: "Close Query 2" }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "query/close", resultId: "two" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "query/page",
      resultId: "one",
      offset: 100,
      limit: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "query/sort",
      resultId: "one",
      sort: { column: 0, direction: "asc" },
    });
    receive({ ...snapshots, sort: { column: 0, direction: "asc" } });
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "query/sort",
      resultId: "one",
      sort: { column: 0, direction: "desc" },
    });
    receive({ ...snapshots, sort: { column: 0, direction: "desc" } });
    fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "query/sort",
      resultId: "one",
      sort: null,
    });
  });
  it("supports keyboard tab navigation and page size changes", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(snapshots);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Query 1" }), { key: "ArrowRight" });
    expect(postMessage).toHaveBeenLastCalledWith({ type: "query/select", resultId: "two" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "25" } });
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "query/page",
      resultId: "one",
      offset: 0,
      limit: 25,
    });
    expect(screen.getByText("Page 1 of 3")).toBeVisible();
  });
  it("sorts the whole standalone snapshot before paginating", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("customer237@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("customer137@example.com");
    fireEvent.click(screen.getByRole("tab", { name: "Query 2" }));
    expect(screen.getByRole("tab", { name: "Query 2" })).toHaveAttribute(
      "title",
      expect.stringContaining("SELECT plan, COUNT(*)"),
    );
    expect(document.querySelector(".query-text")).toBeNull();
  });
});

describe("tab rename interactions", () => {
  it("requests native rename on double click/F2 and supplies a native context menu", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive({
      ...state,
      activeResultId: "one",
      tabs: [
        {
          id: "one",
          title: "Query 1",
          connectionName: "one.db",
          query: "SELECT 1",
          busy: false,
          error: false,
        },
      ],
    });
    const tab = screen.getByRole("tab", { name: "Query 1" });
    fireEvent.doubleClick(tab);
    expect(postMessage).toHaveBeenLastCalledWith({ type: "query/rename", resultId: "one" });
    fireEvent.keyDown(tab, { key: "F2" });
    expect(postMessage).toHaveBeenLastCalledWith({ type: "query/rename", resultId: "one" });
    expect(JSON.parse(tab.parentElement!.getAttribute("data-vscode-context")!)).toEqual({
      webviewSection: "resultTab",
      resultId: "one",
      preventDefaultContextMenuItems: true,
    });
    receive({
      ...state,
      title: "Customers",
      activeResultId: "one",
      tabs: [
        {
          id: "one",
          title: "Customers",
          connectionName: "one.db",
          query: "SELECT 1",
          busy: false,
          error: false,
        },
      ],
    });
    expect(screen.getByRole("tab", { name: "Customers" })).toBeVisible();
  });
});

const customersInfo: NonNullable<WebviewResponse["tableInfo"]> = {
  resourceId: '["table","customers"]',
  name: "customers",
  kind: "table",
  editable: true,
  ddl: "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT, blob BLOB)",
  columns: [
    {
      name: "id",
      type: "INTEGER",
      primaryKey: 1,
      notNull: false,
      defaultValue: null,
      generated: false,
    },
    {
      name: "name",
      type: "TEXT",
      primaryKey: 0,
      notNull: false,
      defaultValue: null,
      generated: false,
    },
    {
      name: "blob",
      type: "BLOB",
      primaryKey: 0,
      notNull: false,
      defaultValue: null,
      generated: false,
    },
  ],
  foreignKeys: [],
  indexes: [],
};
const ordersInfo: NonNullable<WebviewResponse["tableInfo"]> = {
  ...customersInfo,
  resourceId: '["table","orders"]',
  name: "orders",
  columns: [
    customersInfo.columns[0]!,
    { ...customersInfo.columns[1]!, name: "customer_id", type: "INTEGER" },
  ],
  foreignKeys: [
    {
      id: 0,
      target: "customers",
      columns: ["customer_id"],
      targetColumns: ["id"],
      onUpdate: "NO ACTION",
      onDelete: "CASCADE",
    },
  ],
};
const browserState: WebviewResponse = {
  ...state,
  mode: "table",
  tableInfo: customersInfo,
  schema: [customersInfo, ordersInfo],
  result: {
    kind: "table",
    columns: ["id", "name", "blob"],
    rows: [
      [1, "Alex", null],
      [2, "Sam", null],
    ],
  },
};
describe("database workbench interactions", () => {
  it("filters the database, sorts tables, and follows incoming foreign keys", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Filter 1 column"), { target: { value: "name" } });
    fireEvent.change(screen.getByLabelText("Filter 1 value"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "table/filter",
      filters: [{ column: "name", operator: "=", value: "Alex" }],
      order: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sort by name" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "table/filter",
      filters: [],
      order: { column: "name", direction: "asc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect row" }));
    fireEvent.click(screen.getByRole("button", { name: "orders → this row" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "table/related",
      target: "orders",
      filters: [{ column: "customer_id", operator: "=", value: 1 }],
    });
  });
  it("stages edits, blocks navigation, requires review, and preserves unreviewed edits across busy updates", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(menuAction("Edit row"));
    fireEvent.change(screen.getByLabelText("name value"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Stage row" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Commit changes" })).toBeDisabled();
    expect(screen.queryByText(/Running query/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review SQL" }));
    const changes = [
      {
        kind: "update" as const,
        original: { id: 1, name: "Alex", blob: null },
        values: { name: "Updated" },
      },
    ];
    expect(postMessage).toHaveBeenLastCalledWith({ type: "table/changes", changes, apply: false });
    receive({
      ...browserState,
      staged: changes,
      previewSql: ["UPDATE customers SET name='Updated' WHERE id=1;"],
    });
    expect(screen.getByRole("button", { name: "Commit changes" })).toBeEnabled();
    fireEvent.click(menuAction("Edit row"));
    fireEvent.change(screen.getByLabelText("name value"), { target: { value: "Second edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Stage row" }));
    receive({ ...browserState, busy: true, staged: changes, previewSql: ["old preview"] });
    receive({ ...browserState, busy: false, staged: changes, previewSql: ["old preview"] });
    expect(screen.getByRole("gridcell", { name: /: Second edit$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Commit changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(postMessage).toHaveBeenCalledWith({ type: "table/discard" });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
  it("copies rectangular selections and opens full values without treating NULL as empty text", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: /: Sam$/ }), { shiftKey: true });
    fireEvent.click(menuAction("Copy selection"));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "data/copy", text: "Alex\r\nSam" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect row" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Open complete value" })[1]!);
    expect(postMessage).toHaveBeenLastCalledWith({ type: "table/value", row: 1, column: 1 });
  });
  it("shows relationship diagrams, highlights linked columns, and opens tables", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive({ ...browserState, mode: "diagram", focusTable: "orders", result: null, page: null });
    fireEvent.click(
      screen.getByRole("button", { name: "orders.customer_id references customers.id" }),
    );
    expect(document.querySelectorAll(".graph-column.highlighted")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Browse rows in orders" }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "schema/browse", table: "orders" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("120%")).toBeVisible();
  });
});

describe("compact editable query captures", () => {
  it("hides duplicate headings and SQL, stages multiple cells, and targets the correct capture", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    const queryState: WebviewResponse = {
      ...browserState,
      activeResultId: "one",
      tabs: [
        {
          id: "one",
          title: "Customers",
          connectionName: "test.db",
          query: "SELECT * FROM customers",
          busy: false,
          error: false,
        },
      ],
    };
    receive(queryState);
    expect(document.querySelector(".toolbar")).toBeNull();
    expect(document.querySelector(".query-text")).toBeNull();
    expect(screen.getByRole("tab", { name: "Customers" })).toHaveAttribute(
      "title",
      expect.stringContaining("SELECT * FROM customers"),
    );
    fireEvent.doubleClick(screen.getAllByRole("gridcell", { name: /: NULL$/ })[0]!);
    fireEvent.blur(screen.getByLabelText("Edit blob, row 1"));
    expect(document.querySelector(".pending-bar")).toBeNull();
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.change(screen.getByLabelText("Edit name, row 1"), {
      target: { value: "First change" },
    });
    fireEvent.keyDown(screen.getByLabelText("Edit name, row 1"), { key: "Enter" });
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: /: Sam$/ }));
    fireEvent.change(screen.getByLabelText("Edit name, row 2"), {
      target: { value: "Second change" },
    });
    fireEvent.keyDown(screen.getByLabelText("Edit name, row 2"), { key: "Enter" });
    expect(
      postMessage.mock.calls.some(([message]) => message.type === "table/changes" && message.apply),
    ).toBe(false);
    expect(screen.getByRole("button", { name: "Commit changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review SQL" }));
    const changes = [
      {
        kind: "update" as const,
        original: { id: 1, name: "Alex", blob: null },
        values: { name: "First change" },
      },
      {
        kind: "update" as const,
        original: { id: 2, name: "Sam", blob: null },
        values: { name: "Second change" },
      },
    ];
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "table/changes",
      resultId: "one",
      changes,
      apply: false,
    });
    receive({ ...queryState, staged: changes, previewSql: ["UPDATE 1", "UPDATE 2"] });
    fireEvent.click(screen.getByRole("button", { name: "Commit changes" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "table/changes",
      resultId: "one",
      changes,
      apply: true,
    });
  });
});

describe("UX refinements", () => {
  it("undoes and redoes staged cell edits without writing", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.change(screen.getByLabelText("Edit name, row 1"), { target: { value: "Changed" } });
    fireEvent.keyDown(screen.getByLabelText("Edit name, row 1"), { key: "Enter" });
    expect(screen.getByRole("gridcell", { name: /: Changed$/ })).toBeVisible();
    fireEvent.click(menuAction("Undo edit"));
    expect(screen.getByRole("gridcell", { name: /: Alex$/ })).toBeVisible();
    fireEvent.click(menuAction("Redo edit"));
    expect(screen.getByRole("gridcell", { name: /: Changed$/ })).toBeVisible();
    expect(postMessage.mock.calls.some(([m]) => m.type === "table/changes" && m.apply)).toBe(false);
  });
  it("restores column preferences and offers a full record JSON view", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive({
      ...browserState,
      preferences: { hidden: ["blob"], columns: ["name", "id", "blob"], widths: { name: 240 } },
    });
    expect(screen.queryByRole("button", { name: "Sort by blob" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect row" }));
    fireEvent.change(screen.getByLabelText("Record view"), { target: { value: "json" } });
    expect(screen.getByLabelText("Search JSON paths and values")).toBeVisible();
  });
  it("compares selected records with highlighted differing fields", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: /: Sam$/ }), { shiftKey: true });
    fireEvent.click(menuAction("Compare selected rows"));
    expect(document.querySelectorAll(".comparison-different").length).toBeGreaterThan(0);
  });
  it("keeps NoSQL drafts after a failed commit and requires review again after edits", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    const dataState: WebviewResponse = {
      ...state,
      mode: "data",
      driverName: "redis",
      result: null,
      page: null,
      data: {
        resource: "keys",
        filter: "*",
        records: [{ id: "key", text: "old", type: "string", ttl: 1000, editable: true }],
        back: false,
      },
    };
    receive(dataState);
    fireEvent.click(screen.getByRole("button", { name: "Edit value" }));
    fireEvent.change(screen.getByLabelText("Edit document or key"), { target: { value: "new" } });
    expect(screen.getByRole("button", { name: "Commit change…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    receive({ ...dataState, data: { ...dataState.data!, preview: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit change…" }));
    receive({ ...dataState, error: "Conflict", data: { ...dataState.data!, preview: "review" } });
    expect(screen.getByLabelText("Edit document or key")).toHaveValue("new");
    fireEvent.change(screen.getByLabelText("Edit document or key"), { target: { value: "retry" } });
    expect(screen.getByRole("button", { name: "Commit change…" })).toBeDisabled();
  });
});

describe("compact actions and context menus", () => {
  it("removes repeated table headings and keeps secondary tools in one keyboard-accessible menu", () => {
    render(<App postMessage={vi.fn<(message: WebviewRequest) => void>()} />);
    receive(browserState);
    expect(document.querySelector(".toolbar")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Copy JSON" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh rows" })).toBeVisible();
    const trigger = screen.getByRole("button", { name: "More actions" });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Result actions" });
    expect(screen.getByRole("menuitem", { name: "Inspect row" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.tagName).toBe("SUMMARY");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("preserves a selected range on right click and copies the whole range", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: /: Sam$/ }), { shiftKey: true });
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: /: Sam$/ }), {
      clientX: 120,
      clientY: 180,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy selection" }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "data/copy", text: "Alex\r\nSam" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("spreadsheet keyboard selection", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "selects the entire table and requests all columns in display order (%o)",
    (modifier) => {
      const postMessage = vi.fn<(message: WebviewRequest) => void>();
      render(<App postMessage={postMessage} />);
      receive({
        ...browserState,
        preferences: { columns: ["name", "id", "blob"], hidden: ["blob"] },
      });
      const grid = screen.getByRole("grid");
      grid.focus();
      fireEvent.keyDown(grid, { key: "a", ...modifier });
      expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
      expect(screen.getByRole("status")).toHaveTextContent(
        "All rows × 3 columns selected · entire result",
      );
      fireEvent.keyDown(grid, { key: "c", ...modifier });
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "table/copy",
        columns: [1, 0, 2],
        headers: false,
        format: "tsv",
      });
      fireEvent.keyDown(grid, { key: "Escape" });
      expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Select all cells" }));
      expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
    },
  );
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "copies whole query results with optional headers across page changes (%o)",
    (modifier) => {
      const postMessage = vi.fn<(message: WebviewRequest) => void>();
      render(<App postMessage={postMessage} />);
      const query = {
        ...state,
        activeResultId: "q1",
        tabs: [
          {
            id: "q1",
            title: "Query 1",
            connectionName: "test.db",
            query: "SELECT *",
            busy: false,
            error: false,
          },
        ],
        page: { offset: 100, limit: 100, hasMore: true, totalRows: 12001 },
      };
      receive(query);
      const grid = screen.getByRole("grid");
      grid.focus();
      fireEvent.keyDown(grid, { key: "a", shiftKey: true, ...modifier });
      expect(screen.getByRole("status")).toHaveTextContent(
        "12001 rows × 3 columns selected · entire result · with headers",
      );
      const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
      fireEvent(grid, copyEvent);
      expect(copyEvent.defaultPrevented).toBe(true);
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "query/copy",
        resultId: "q1",
        columns: [0, 1, 2],
        headers: true,
        format: "tsv",
      });
      receive({
        ...query,
        page: { ...query.page, offset: 200 },
        result: { kind: "table", columns: ["id", "name", "blob"], rows: [[201, "next", null]] },
      });
      fireEvent.keyDown(screen.getByRole("grid"), { key: "c", ...modifier });
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "query/copy",
        resultId: "q1",
        columns: [0, 1, 2],
        headers: true,
        format: "tsv",
      });
      fireEvent.keyDown(screen.getByRole("grid"), { key: "a", ...modifier });
      fireEvent.keyDown(screen.getByRole("grid"), { key: "c", ...modifier });
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "query/copy",
        resultId: "q1",
        columns: [0, 1, 2],
        headers: false,
        format: "tsv",
      });
      fireEvent.click(screen.getByRole("gridcell", { name: /: next$/ }));
      fireEvent.keyDown(screen.getByRole("grid"), { key: "c", ...modifier });
      expect(postMessage).toHaveBeenLastCalledWith({ type: "data/copy", text: "next" });
    },
  );
  it("navigates and extends ranges across reordered visible columns", () => {
    render(<App postMessage={vi.fn<(message: WebviewRequest) => void>()} />);
    receive({
      ...browserState,
      preferences: { columns: ["name", "id", "blob"], hidden: ["blob"] },
    });
    const grid = screen.getByRole("grid");
    fireEvent.click(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(2);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
    fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
    expect(screen.getByRole("gridcell", { name: /: Alex$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
    expect(document.querySelector('td[data-row="1"][data-column="0"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(grid, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("gridcell", { name: /: Sam$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(document.querySelector('td[data-row="0"][data-column="0"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(grid, { key: " ", ctrlKey: true });
    expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(2);
    fireEvent.keyDown(grid, { key: " ", shiftKey: true });
    expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(2);
  });
  it("leaves cell-editor select-all to the input and stages keyboard edits without writing", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.keyDown(screen.getByRole("grid"), { key: "F2" });
    const input = screen.getByLabelText("Edit name, row 1");
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(1);
    fireEvent.change(input, { target: { value: "Keyboard edit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("gridcell", { name: /: Keyboard edit$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Commit changes" })).toBeDisabled();
    expect(postMessage.mock.calls.some(([m]) => m.type === "table/changes" && m.apply)).toBe(false);
  });
  it("handles select-all and copy on an empty result without overwriting the clipboard", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive({ ...state, result: { kind: "table", columns: ["id"], rows: [] } });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "a", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "c", ctrlKey: true });
    expect(document.querySelectorAll('td[aria-selected="true"]')).toHaveLength(0);
    expect(postMessage.mock.calls.some(([m]) => m.type === "data/copy")).toBe(false);
  });
});

describe("grid polish and result pinning", () => {
  it("copies selected headers separately and includes them with selected data", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.click(screen.getByRole("gridcell", { name: /: Alex$/ }));
    fireEvent.click(screen.getByRole("gridcell", { name: /: Sam$/ }), { shiftKey: true });
    fireEvent.click(menuAction("Copy with headers"));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "data/copy",
      text: "name\r\nAlex\r\nSam",
    });
    fireEvent.click(menuAction("Copy headers"));
    expect(postMessage).toHaveBeenLastCalledWith({ type: "data/copy", text: "name" });
  });
  it("freezes the chosen column, preserves copying order, and auto-sizes using the divider", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<App postMessage={postMessage} />);
    receive(browserState);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Sort by name" }).closest("th")!, {
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Freeze column" }));
    expect(document.querySelectorAll("thead th.frozen-column")).toHaveLength(1);
    expect(screen.getByRole("gridcell", { name: /: Alex$/ })).toHaveClass("frozen-column");
    expect(screen.getByRole("gridcell", { name: /: Alex$/ })).toHaveStyle({ left: "48px" });
    expect(screen.getAllByRole("columnheader")[1]).toHaveTextContent("name");
    fireEvent.doubleClick(screen.getByRole("button", { name: "Resize name" }));
    expect(screen.getAllByRole("columnheader")[1]).toHaveStyle({ width: "80px" });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "a", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "c", ctrlKey: true });
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "table/copy",
      columns: [1, 0, 2],
      headers: false,
      format: "tsv",
    });
    fireEvent.click(menuAction("Unfreeze all columns"));
    expect(document.querySelectorAll("thead th.frozen-column")).toHaveLength(0);
    canvas.mockRestore();
  });
  it("shows pin state and sends explicit changes for the chosen result", () => {
    const postMessage = vi.fn<(message: WebviewRequest) => void>();
    render(<App postMessage={postMessage} />);
    const tabs = [
      {
        id: "one",
        title: "Query 1",
        connectionName: "test.db",
        query: "SELECT 1",
        busy: false,
        error: false,
        pinned: false,
      },
    ];
    receive({ ...state, tabs, activeResultId: "one" });
    fireEvent.click(screen.getByRole("button", { name: "Pin Query 1" }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "query/pin",
      resultId: "one",
      pinned: true,
    });
    receive({ ...state, tabs: [{ ...tabs[0], pinned: true }], activeResultId: "one" });
    expect(screen.getByRole("button", { name: "Unpin Query 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

it("exposes grid positions/active cells and returns focus after keyboard editing", () => {
  render(<App postMessage={vi.fn<(message: WebviewRequest) => void>()} />);
  receive({
    ...state,
    tableInfo: {
      resourceId: "customers",
      name: "customers",
      kind: "table",
      editable: true,
      ddl: "",
      foreignKeys: [],
      indexes: [],
      columns: [
        {
          name: "id",
          type: "INTEGER",
          primaryKey: 1,
          notNull: true,
          generated: false,
          defaultValue: null,
        },
        {
          name: "name",
          type: "TEXT",
          primaryKey: 0,
          notNull: false,
          generated: false,
          defaultValue: null,
        },
        {
          name: "blob",
          type: "BLOB",
          primaryKey: 0,
          notNull: false,
          generated: false,
          defaultValue: null,
        },
      ],
    },
    result: {
      kind: "table",
      columns: ["id", "name", "blob"],
      rows: [
        [1, "Alex", null],
        [2, "Sam", null],
      ],
    },
  });
  const grid = screen.getByRole("grid");
  grid.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  const active = document.getElementById(grid.getAttribute("aria-activedescendant")!);
  expect(active).toHaveAccessibleName("name: Alex");
  expect(grid).toHaveAttribute("aria-rowcount", "-1"); // The paged fixture has more rows but no exact total.
  expect(grid).toHaveAttribute("aria-colcount", "4");
  fireEvent.keyDown(grid, { key: "F2" });
  const editor = screen.getByRole("textbox", { name: "Edit name, row 1" });
  expect(editor).toHaveFocus();
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(grid).toHaveFocus();
  fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
  fireEvent.keyDown(grid, { key: "Tab" });
  expect(grid).not.toHaveFocus();
});
