import { resolve } from "node:path";

import { InMemoryDriverRegistry } from "@datsumi/driver-api";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

import { ConnectionManager } from "../../../../apps/extension/src/connections/ConnectionManager";
import { CredentialService } from "../../../../apps/extension/src/connections/CredentialService";
import {
  createTunnelFactory,
  sshFingerprint,
} from "../../../../apps/extension/src/connections/SshTunnel";
// @ts-expect-error Shared native Node fixture has no declarations.
import { startSshFixture } from "../../../../apps/extension/test/ssh-fixture.mjs";
import { NoSqlDriverAdapter } from "../src/index";

for (const id of ["mongodb", "redis"] as const) {
  describe(`${id} via real SSH`, () => {
    it("connects with a private target, reconnects lazily and releases test/failure resources", async () => {
      const remotePort = id === "mongodb" ? 27017 : 6379;
      const ssh = await startSshFixture({
        targets: { [remotePort]: Number(process.env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`]) },
      });
      const driver = new NoSqlDriverAdapter(id, async () => resolve(`dist/drivers/${id}.cjs`));
      const registry = new InMemoryDriverRegistry();
      registry.register(driver);
      const records = new Map<string, unknown>();
      const context = {
        workspaceState: {
          get: (key: string, fallback: unknown) => records.get(key) ?? fallback,
          update: async (key: string, value: unknown) => {
            records.set(key, value);
          },
        },
      } as unknown as ExtensionContext;
      const credentials = new CredentialService(
        { get: async () => undefined, store: async () => {}, delete: async () => {} },
        async () => {
          throw new Error("Unexpected credential prompt");
        },
        "test",
      );
      const manager = new ConnectionManager(
        context,
        registry,
        credentials,
        () => {},
        createTunnelFactory({
          verifyHost: async (_settings, fingerprint) => fingerprint === sshFingerprint(ssh.hostKey),
          passphrase: async () => undefined,
        }),
      );
      const config = {
        endpoint:
          id === "mongodb"
            ? "mongodb://localhost:27017/datsumi?authSource=admin&tls=false"
            : "redis://localhost:6379/0",
        username: id === "mongodb" ? "datsumi" : "",
        readOnly: true,
      };
      try {
        await manager.testServer(id, config, "Datsumi_Test_Only_2026", ssh.settings);
        expect(manager.all()).toHaveLength(0);
        await vi.waitFor(() => expect(ssh.clients).toBe(0));
        const profile = await manager.addServer(
          id,
          "SSH fixture",
          config,
          { password: "Datsumi_Test_Only_2026", mode: "session" },
          ssh.settings,
        );
        expect(await manager.resources(profile.id)).toBeInstanceOf(Array);
        await manager.disconnect(profile.id);
        await vi.waitFor(() => expect(ssh.clients).toBe(0));
        expect(await manager.resources(profile.id)).toBeInstanceOf(Array);
        expect(ssh.authentications).toBe(3);
        await manager.remove(profile.id);
        await vi.waitFor(() => expect(ssh.clients).toBe(0));
        await expect(
          manager.testServer(id, config, "incorrect-password", ssh.settings),
        ).rejects.toThrow(/./);
        await vi.waitFor(() => expect(ssh.clients).toBe(0));
      } finally {
        await manager.dispose();
        await ssh.close();
      }
    });
  });
}
