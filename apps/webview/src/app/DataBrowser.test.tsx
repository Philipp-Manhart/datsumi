import "@testing-library/jest-dom/vitest";
import type { WebviewRequest, WebviewResponse } from "@datsumi/protocol";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataBrowser } from "./DataBrowser";
import { RedisValue } from "./RedisValue";

afterEach(cleanup);
const record = (id: string, text: string, type?: string) => ({
  id,
  text,
  editable: true,
  ...(type ? { type, ttl: -1 } : {}),
});
function state(
  driverName: string,
  records: NonNullable<WebviewResponse["data"]>["records"],
): WebviewResponse {
  return {
    type: "results/state",
    protocolVersion: 1,
    mode: "data",
    driverName,
    title: "Browse",
    connectionName: "test",
    busy: false,
    error: null,
    result: null,
    page: null,
    data: {
      resource: driverName === "redis" ? "keys" : "orders",
      filter: "",
      back: false,
      records,
    },
  };
}
describe("database browsers", () => {
  it("combines Redis type and name filters without querying the server or changing raw copy values", () => {
    const request = vi.fn<(message: WebviewRequest) => void>();
    render(
      <DataBrowser
        request={request}
        state={state("redis", [
          record("customer:1", '{"name":"Alex"}', "hash"),
          record("customer:2", "raw\tvalue\nnext line", "string"),
          record("session:1", "other", "string"),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Key type" }));
    fireEvent.click(screen.getByRole("option", { name: "string" }));
    fireEvent.change(screen.getByLabelText("Search loaded keys"), {
      target: { value: "CUSTOMER" },
    });
    const list = screen.getByRole("navigation", { name: "Documents and keys" });
    expect(within(list).queryByText("customer:1")).toBeNull();
    expect(within(list).getByText("customer:2")).toBeVisible();
    expect(within(list).queryByText("session:1")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy value" }));
    expect(request).toHaveBeenLastCalledWith({ type: "data/copy", text: "raw\tvalue\nnext line" });
  });
  it("keeps the Redis edit target stable until the draft is committed or discarded", () => {
    const request = vi.fn<(message: WebviewRequest) => void>();
    render(
      <DataBrowser
        request={request}
        state={state("redis", [
          record("one", "original", "string"),
          record("two", "other", "string"),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit value" }));
    expect(screen.getByLabelText("Search loaded keys")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Key type" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Edit document or key"), {
      target: { value: "edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    expect(request).toHaveBeenLastCalledWith({
      type: "data/edit",
      id: "one",
      text: "edited",
      apply: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Search loaded keys")).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Key type" })).toBeEnabled();
  });
  it("shows MongoDB BSON values readably and requires a fresh review after each draft change", () => {
    const request = vi.fn<(message: WebviewRequest) => void>();
    const raw =
      '{"_id":{"$oid":"000000000000000000000001"},"count":{"$numberLong":"9007199254740993"}}';
    const initial = state("mongodb", [record("id1", raw)]);
    const { rerender } = render(<DataBrowser request={request} state={initial} />);
    expect(screen.getByText("9007199254740993")).toBeVisible();
    fireEvent.doubleClick(screen.getByText("9007199254740993"));
    fireEvent.click(screen.getByRole("button", { name: "Edit value" }));
    const editor = screen.getByLabelText("Edit document or key");
    expect(editor).toHaveValue(raw);
    expect(screen.getByRole("button", { name: "Commit change…" })).toBeDisabled();
    const changed = raw.replace("9007199254740993", "9007199254740994");
    fireEvent.change(editor, { target: { value: changed } });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    expect(request).toHaveBeenLastCalledWith({
      type: "data/edit",
      id: "id1",
      text: changed,
      apply: false,
    });
    rerender(
      <DataBrowser
        request={request}
        state={{ ...initial, data: { ...initial.data!, preview: "Reviewed difference" } }}
      />,
    );
    expect(screen.getByRole("button", { name: "Commit change…" })).toBeEnabled();
    fireEvent.change(editor, { target: { value: raw } });
    expect(screen.getByRole("button", { name: "Commit change…" })).toBeDisabled();
  });
});
describe("Redis typed value viewers", () => {
  it.each<[string, string, string[], string]>([
    ["hash", '{"field":"value"}', ["Field", "Value"], "field"],
    ["list", '{"length":200,"first100":["first","second"]}', ["Index", "Value"], "second"],
    ["set", '{"size":2,"scan":{"members":["a","b"],"cursor":"0"}}', ["Member"], "b"],
    ["zset", '{"size":2,"first100":[{"value":"winner","score":1.5}]}', ["Member", "Score"], "1.5"],
  ])("renders %s as a typed table", (type, text, headers, value) => {
    render(
      <RedisValue record={record("key", text, type)} copy={vi.fn<(text: string) => void>()} />,
    );
    expect(screen.getAllByRole("columnheader").map((element) => element.textContent)).toEqual(
      headers,
    );
    expect(screen.getByText(value)).toBeVisible();
  });
  it("renders raw strings and binary previews as text, never HTML", () => {
    const text = '<script>alert("value")</script>\nsecond line';
    const { container, rerender } = render(
      <RedisValue record={record("key", text, "string")} copy={vi.fn<(text: string) => void>()} />,
    );
    expect(container.querySelector("pre")?.textContent).toBe(text);
    expect(container.querySelector("script")).toBeNull();
    rerender(
      <RedisValue
        record={record("key", "Read-only binary/large preview (2 bytes):\n00ff", "string")}
        copy={vi.fn<(text: string) => void>()}
      />,
    );
    expect(container.querySelector("pre")?.textContent).toContain("00ff");
  });
});
