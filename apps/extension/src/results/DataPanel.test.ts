import type { DataPage, DataPageRequest, DataChange } from "@datsumi/core";
import type { WebviewResponse } from "@datsumi/protocol";
/* oxlint-disable typescript/no-unsafe-type-assertion -- The synthetic host supplies only the VS Code and connection APIs used by DataPanel. */
import { beforeEach, expect, it, vi } from "vitest";
import type { Uri } from "vscode";
const mock = vi.hoisted(() => ({
  receive: undefined as ((message: unknown) => void) | undefined,
  states: [] as WebviewResponse[],
  confirm: vi.fn<() => Promise<string | undefined>>(async () => "Commit change"),
}));
vi.mock("vscode", () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  ViewColumn: { Active: 1 },
  window: {
    showWarningMessage: mock.confirm,
    createWebviewPanel: () => ({
      onDidDispose: () => ({ dispose() {} }),
      dispose() {},
      webview: {
        onDidReceiveMessage: (receive: (message: unknown) => void) => {
          mock.receive = receive;
        },
        postMessage: (state: WebviewResponse) => {
          mock.states.push(state);
          return Promise.resolve(true);
        },
      },
    }),
  },
}));
vi.mock("./webview", () => ({ initializeResultsWebview() {} }));
import type { ConnectionManager } from "../connections/ConnectionManager";
import { DataPanel } from "./DataPanel";
const latest = () => mock.states.at(-1)!;
function fixture() {
  const browseData = vi.fn<(id: string, request: DataPageRequest) => Promise<DataPage>>(
    async (_id, request) => ({
      records: [
        {
          id: request.cursor ? "second" : "first",
          text: "original",
          editable: true,
          type: "string",
        },
      ],
      cursor: request.cursor ? "next-token" : "issued-token",
    }),
  );
  const changeData = vi.fn<(id: string, request: DataChange, apply: boolean) => Promise<string>>(
    async (_id, _request, apply) => (apply ? "Updated" : "Preview"),
  );
  const connections = {
    get: () => ({ name: "Redis", driverId: "redis" }),
    displayName: () => "[PRODUCTION] Redis",
    browseData,
    changeData,
  } as unknown as ConnectionManager;
  const panel = new DataPanel({} as Uri, connections, "connection", "keys", async () => {});
  return { panel, browseData, changeData };
}
beforeEach(() => {
  mock.states = [];
  mock.receive = undefined;
  mock.confirm.mockClear();
});
it("navigates cached pages backwards and forwards without replaying consumed cursors", async () => {
  const { panel, browseData } = fixture();
  await panel.load();
  mock.receive!({ type: "data/browse", filter: "*", cursor: "issued-token" });
  await vi.waitFor(() => expect(latest().data?.records[0]?.id).toBe("second"));
  mock.receive!({ type: "data/back" });
  expect(latest().data?.records[0]?.id).toBe("first");
  expect(latest().data?.forward).toBe(true);
  mock.receive!({ type: "data/forward" });
  expect(latest().data?.records[0]?.id).toBe("second");
  expect(latest().data?.cursor).toBe("next-token");
  expect(latest().data?.forward).toBe(false);
  expect(browseData).toHaveBeenCalledTimes(2);
  panel.dispose();
});
it("requires matching review and confirmation before applying a host-owned record change", async () => {
  const { panel, changeData } = fixture();
  await panel.load();
  mock.receive!({ type: "data/edit", id: "first", text: "changed", apply: true });
  await vi.waitFor(() => expect(latest().error).toContain("Review"));
  expect(changeData).not.toHaveBeenCalled();
  mock.receive!({ type: "data/edit", id: "first", text: "changed", apply: false });
  await vi.waitFor(() => expect(latest().data?.preview).toBe("Preview"));
  expect(changeData).toHaveBeenLastCalledWith(
    "connection",
    { resource: "keys", id: "first", original: "original", text: "changed" },
    false,
  );
  mock.receive!({ type: "data/edit", id: "first", text: "changed", apply: true });
  await vi.waitFor(() => expect(latest().data?.records[0]?.text).toBe("changed"));
  expect(mock.confirm).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("[PRODUCTION] Redis"),
    expect.objectContaining({ modal: true }),
    "Commit change",
  );
  expect(changeData).toHaveBeenLastCalledWith(
    "connection",
    expect.objectContaining({ resource: "keys", original: "original" }),
    true,
  );
  panel.dispose();
});
it("reserves the edit while native confirmation is open so a double click cannot commit twice", async () => {
  const { panel, changeData } = fixture();
  await panel.load();
  mock.receive!({ type: "data/edit", id: "first", text: "changed", apply: false });
  await vi.waitFor(() => expect(latest().data?.preview).toBe("Preview"));
  let accept: ((value: string) => void) | undefined;
  mock.confirm.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  mock.receive!({ type: "data/edit", id: "first", text: "changed", apply: true });
  mock.receive!({ type: "data/edit", id: "first", text: "changed", apply: true });
  expect(mock.confirm).toHaveBeenCalledTimes(1);
  expect(latest().busy).toBe(true);
  accept!("Commit change");
  await vi.waitFor(() => expect(latest().data?.records[0]?.text).toBe("changed"));
  expect(changeData).toHaveBeenCalledTimes(2);
  panel.dispose();
});
