import { InMemoryDriverRegistry, type DatabaseDriver } from "@datsumi/driver-api";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

import { abortCancellation } from "./cancellation";
import { ConnectionManager } from "./ConnectionManager";
import { CredentialService } from "./CredentialService";
import type { TunnelFactory, ManagedTunnel } from "./SshTunnel";
const configuration = {
  host: "db.example",
  port: 5432,
  database: "demo",
  username: "user",
  tls: "verify" as const,
  ca: "",
  readOnly: false,
};
function fixture(tunnelFactory?: TunnelFactory) {
  let saved: unknown = [];
  const secrets = new Map<string, string>();
  const store = {
    get: async (key: string) => secrets.get(key),
    store: async (key: string, value: string) => {
      secrets.set(key, value);
    },
    delete: async (key: string) => {
      secrets.delete(key);
    },
  };
  const credentials = new CredentialService(
    store,
    async () => ({ password: "sentinel", mode: "session" }),
    "local",
  );
  const update = vi.fn<(key: string, value: unknown) => Promise<void>>(async (_key, value) => {
    saved = structuredClone(value);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal storage test double; no workbench API is used by ConnectionManager.
  const context = { workspaceState: { get: () => saved, update } } as unknown as ExtensionContext;
  const driver = {
    descriptor: {
      id: "postgres",
      displayName: "PostgreSQL",
      family: "relational",
      supportedQueryLanguages: ["sql"],
      capabilities: ["query", "schema"],
    },
    connect: vi.fn<DatabaseDriver["connect"]>(async () => ({})),
    disconnect: vi.fn<DatabaseDriver["disconnect"]>(async () => {}),
    execute: vi.fn<DatabaseDriver["execute"]>(async () => ({ kind: "value", value: 1 })),
    listResources: vi.fn<NonNullable<DatabaseDriver["listResources"]>>(async () => []),
  } satisfies DatabaseDriver;
  const registry = new InMemoryDriverRegistry();
  registry.register(driver);
  const trusted = vi.fn<() => void>(() => {});
  const manager = new ConnectionManager(context, registry, credentials, trusted, tunnelFactory);
  return { manager, context, registry, driver, secrets, credentials, update, trusted };
}
describe("server connection lifecycle", () => {
  it("persists no password and restores saved connections lazily with one credential resolution", async () => {
    const f = fixture();
    const profile = await f.manager.addServer("postgres", "Demo", configuration, {
      password: "sentinel",
      mode: "save",
    });
    expect(JSON.stringify(f.update.mock.calls)).not.toContain("sentinel");
    expect(f.secrets.size).toBe(1);
    await f.manager.disconnect(profile.id);
    const restored = new ConnectionManager(f.context, f.registry, f.credentials);
    expect(restored.all()).toHaveLength(1);
    await Promise.all([restored.resources(profile.id), restored.resources(profile.id)]);
    expect(f.driver.connect).toHaveBeenCalledTimes(2);
    expect(f.driver.connect.mock.calls[1]?.[1]).toMatchObject({
      password: "sentinel",
      host: "db.example",
    });
    await restored.remove(profile.id);
    expect(f.secrets.size).toBe(0);
    expect(restored.all()).toHaveLength(0);
    await f.manager.dispose();
    await restored.dispose();
  });
  it("checks trust before touching secrets or opening a connection", async () => {
    const f = fixture();
    f.trusted.mockImplementation(() => {
      throw new Error("Trust required");
    });
    await expect(
      f.manager.addServer("postgres", "Demo", configuration, {
        password: "sentinel",
        mode: "save",
      }),
    ).rejects.toThrow("Trust required");
    expect(f.driver.connect).not.toHaveBeenCalled();
    expect(f.secrets.size).toBe(0);
  });
  it("prevents background reconnects while forgetting credentials", async () => {
    const f = fixture();
    const profile = await f.manager.addServer("postgres", "Demo", configuration, {
      password: "sentinel",
      mode: "save",
    });
    let finish: () => void = () => {};
    f.driver.disconnect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve();
        }),
    );
    const forgetting = f.manager.forgetCredentials(profile.id);
    expect(await f.manager.resources(profile.id)).toEqual([]);
    await expect(
      f.manager.execute(profile.id, { language: "sql", text: "SELECT 1" }),
    ).rejects.toThrow("being changed");
    expect(f.driver.connect).toHaveBeenCalledOnce();
    finish();
    await forgetting;
    expect(f.secrets.size).toBe(0);
    await f.manager.dispose();
  });
  it("cleans secrets and sessions after failed connection or profile persistence", async () => {
    const f = fixture();
    f.driver.connect.mockRejectedValueOnce(new Error("connection failed"));
    await expect(
      f.manager.addServer("postgres", "Demo", configuration, {
        password: "sentinel",
        mode: "save",
      }),
    ).rejects.toThrow("connection failed");
    expect(f.secrets.size).toBe(0);
    expect(f.manager.all()).toHaveLength(0);
    f.update.mockRejectedValueOnce(new Error("storage failed"));
    await expect(
      f.manager.addServer("postgres", "Demo", configuration, {
        password: "sentinel",
        mode: "save",
      }),
    ).rejects.toThrow("storage failed");
    expect(f.secrets.size).toBe(0);
    expect(f.driver.disconnect).toHaveBeenCalledOnce();
  });
});

const ssh = { host: "vps.example", port: 22, username: "ssh-user", keyPath: "/keys/id_ed25519" };
function fakeTunnel(): ManagedTunnel & { close: ReturnType<typeof vi.fn<() => Promise<void>>> } {
  let closed = false;
  return {
    port: 45000,
    get closed() {
      return closed;
    },
    close: vi.fn<() => Promise<void>>(async () => {
      closed = true;
    }),
    onClose() {
      return { dispose() {} };
    },
  };
}
describe("SSH connection lifecycle", () => {
  it("keeps routing ephemeral and reuses exactly one SSH connection per database session", async () => {
    const first = fakeTunnel(),
      second = fakeTunnel();
    const factory = vi
      .fn<TunnelFactory>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const f = fixture(factory);
    const profile = await f.manager.addServer(
      "postgres",
      "VPS",
      configuration,
      { password: "sentinel", mode: "save" },
      ssh,
    );
    expect(factory).toHaveBeenCalledWith(
      ssh,
      { host: "db.example", port: 5432 },
      expect.anything(),
    );
    expect(f.driver.connect.mock.calls[0]?.[1]).toMatchObject({
      host: "db.example",
      port: 5432,
      tunnelPort: 45000,
      tls: "verify",
    });
    expect(profile.ssh).toEqual(ssh);
    expect(JSON.stringify(f.update.mock.calls)).not.toContain("45000");
    expect(JSON.stringify(f.update.mock.calls)).not.toContain("sentinel");
    await f.manager.disconnect(profile.id);
    expect(first.close).toHaveBeenCalledOnce();
    await Promise.all([f.manager.resources(profile.id), f.manager.resources(profile.id)]);
    expect(factory).toHaveBeenCalledTimes(2);
    await f.manager.remove(profile.id);
    expect(second.close).toHaveBeenCalledOnce();
    await f.manager.dispose();
  });
  it("closes a successfully authenticated SSH session after database authentication fails", async () => {
    const tunnel = fakeTunnel();
    const f = fixture(async () => tunnel);
    f.driver.connect.mockRejectedValueOnce(new Error("Database login failed"));
    await expect(
      f.manager.addServer(
        "postgres",
        "VPS",
        configuration,
        { password: "sentinel", mode: "save" },
        ssh,
      ),
    ).rejects.toThrow("Database login failed");
    expect(tunnel.close).toHaveBeenCalledOnce();
    expect(f.manager.all()).toHaveLength(0);
    expect(f.secrets.size).toBe(0);
    await f.manager.dispose();
  });
  it("closes SSH immediately when query cancellation closes the worker", async () => {
    const tunnel = fakeTunnel(),
      f = fixture(async () => tunnel);
    let alive = true;
    Object.assign(f.driver, { isConnected: () => alive });
    const profile = await f.manager.addServer(
      "postgres",
      "VPS",
      configuration,
      { password: "sentinel", mode: "session" },
      ssh,
    );
    f.driver.execute.mockImplementationOnce(async () => {
      alive = false;
      throw new Error("Operation cancelled");
    });
    await expect(
      f.manager.execute(profile.id, { language: "sql", text: "SELECT 1" }),
    ).rejects.toThrow("cancelled");
    expect(tunnel.close).toHaveBeenCalledOnce();
    await f.manager.dispose();
  });
  it("Test Connection never persists a profile or secret and closes both sessions", async () => {
    const tunnel = fakeTunnel(),
      f = fixture(async () => tunnel);
    await f.manager.testServer("postgres", configuration, "sentinel", ssh);
    expect(f.manager.all()).toHaveLength(0);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.secrets.size).toBe(0);
    expect(f.driver.disconnect).toHaveBeenCalledOnce();
    expect(tunnel.close).toHaveBeenCalledOnce();
    await f.manager.dispose();
  });
  it("cancels connection setup through the form's cancellation signal", async () => {
    const factory = vi.fn<TunnelFactory>(
      async (_settings, _target, signal) =>
        new Promise((_resolve, reject) => {
          signal?.onCancellationRequested(() => reject(new Error("Connection cancelled.")));
        }),
    );
    const f = fixture(factory),
      controller = new AbortController();
    const pending = f.manager.testServer(
      "postgres",
      configuration,
      "sentinel",
      ssh,
      abortCancellation(controller.signal),
    );
    const result = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    controller.abort();
    expect(await result).toMatchObject({ message: "Connection cancelled." });
    expect(f.driver.connect).not.toHaveBeenCalled();
    await f.manager.dispose();
  });
});

it("removes a newly saved profile and tunnel when the form closes during persistence", async () => {
  const tunnel = fakeTunnel(),
    f = fixture(async () => tunnel),
    controller = new AbortController();
  f.update.mockImplementation(async () => {
    controller.abort();
  });
  await expect(
    f.manager.addServer(
      "postgres",
      "Cancelled",
      configuration,
      { password: "sentinel", mode: "save" },
      ssh,
      abortCancellation(controller.signal),
    ),
  ).rejects.toThrow("cancelled");
  expect(f.manager.all()).toHaveLength(0);
  expect(f.secrets.size).toBe(0);
  expect(f.update.mock.calls.at(-1)?.[1]).toEqual([]);
  expect(tunnel.close).toHaveBeenCalledOnce();
  await f.manager.dispose();
});

it("edits a destination with explicitly supplied credentials, preserving identity and revoking the old secret", async () => {
  const f = fixture();
  const original = await f.manager.addServer("postgres", "Before", configuration, {
    password: "old-sentinel",
    mode: "save",
  });
  const updated = await f.manager.updateServer(
    original.id,
    "After",
    { ...configuration, host: "new.example" },
    { password: "new-sentinel", mode: "save" },
  );
  expect(updated.id).toBe(original.id);
  expect(updated.configuration.host).toBe("new.example");
  expect(JSON.stringify(f.update.mock.calls)).not.toContain("new-sentinel");
  expect(JSON.stringify([...f.secrets.values()])).not.toContain("old-sentinel");
  await f.manager.disconnect(updated.id);
  await f.manager.resources(updated.id);
  expect(f.driver.connect).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: original.id }),
    expect.objectContaining({ host: "new.example", password: "new-sentinel" }),
    expect.anything(),
  );
  await f.manager.dispose();
});
