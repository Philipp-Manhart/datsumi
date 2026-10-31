/* oxlint-disable typescript/no-unsafe-type-assertion -- The synthetic webview supplies only APIs exercised by this host. */
import type { ConnectionProfile, DriverCancellation } from "@datsumi/core";
import { connectionFormSchema } from "@datsumi/protocol";
import { it, expect, vi } from "vitest";
import type { Uri } from "vscode";
const mock = vi.hoisted(() => ({
  receive: undefined as undefined | ((message: unknown) => void),
  disposed: undefined as undefined | (() => void),
  states: [] as unknown[],
}));
vi.mock("vscode", () => ({
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: () => ({
      onDidDispose: (callback: () => void) => {
        mock.disposed = callback;
      },
      dispose: () => mock.disposed?.(),
      webview: {
        onDidReceiveMessage: (callback: (message: unknown) => void) => {
          mock.receive = callback;
        },
        postMessage: async (value: unknown) => {
          mock.states.push(value);
          return true;
        },
      },
    }),
  },
}));
vi.mock("../results/webview", () => ({ initializeResultsWebview() {} }));
import { openConnectionForm } from "./ConnectionFormPanel";
it("tests inline, redacts errors, and resolves only after a successful Connect", async () => {
  const values = connectionFormSchema.parse({
    driver: "redis",
    mode: "url",
    name: "local",
    url: "redis://localhost:6379/0",
    host: "localhost",
    port: "6379",
    database: "0",
    username: "default",
    password: "sentinel-password",
    credentialMode: "session",
    tls: false,
    ca: "",
    readOnly: false,
    path: "",
    create: false,
  });
  const profile = {
    id: "id",
    name: "local",
    driverId: "redis",
    family: "key-value",
    configuration: {},
  } as ConnectionProfile;
  const submit = vi
    .fn<(input: typeof values, test: boolean) => Promise<ConnectionProfile | undefined>>()
    .mockRejectedValueOnce(new Error("Wrong sentinel-password"))
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(profile);
  const opened = openConnectionForm({} as Uri, submit);
  mock.receive?.({ type: "connection/submit", values, test: true });
  await vi.waitFor(() =>
    expect(mock.states).toContainEqual(expect.objectContaining({ error: "Wrong [redacted]" })),
  );
  expect(JSON.stringify(mock.states)).not.toContain("sentinel-password");
  mock.receive?.({ type: "connection/submit", values, test: true });
  await vi.waitFor(() =>
    expect(mock.states).toContainEqual(
      expect.objectContaining({ status: "Connection successful" }),
    ),
  );
  mock.receive?.({ type: "connection/submit", values, test: false });
  await expect(opened).resolves.toEqual(profile);
  expect(submit.mock.calls.map((call) => call[1])).toEqual([true, true, false]);
});

it("cancels an in-flight connection when its form closes and never posts to the disposed webview", async () => {
  const values = connectionFormSchema.parse({
    driver: "postgres",
    mode: "fields",
    name: "test",
    url: "",
    host: "localhost",
    port: "5432",
    database: "db",
    username: "db-user",
    password: "",
    credentialMode: "session",
    tls: true,
    ca: "",
    readOnly: false,
    path: "",
    create: false,
  });
  let cancelled = false;
  const submit = vi.fn<
    (
      _values: typeof values,
      test: boolean,
      signal?: DriverCancellation,
    ) => Promise<ConnectionProfile | undefined>
  >(
    async (_values, _test, signal) =>
      new Promise((_resolve, reject) => {
        signal?.onCancellationRequested(() => {
          cancelled = true;
          reject(new Error("Connection cancelled"));
        });
      }),
  );
  const opened = openConnectionForm({} as Uri, submit);
  mock.receive?.({ type: "connection/submit", values, test: true });
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
  mock.disposed?.();
  await expect(opened).resolves.toBeUndefined();
  expect(cancelled).toBe(true);
});
