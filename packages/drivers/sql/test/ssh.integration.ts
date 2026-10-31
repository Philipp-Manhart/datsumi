/* oxlint-disable no-await-in-loop -- Wait for disposable servers; database and SSH operations are sequential. */
import { resolve } from "node:path";

import { clipboardValue } from "@datsumi/core";
import { InMemoryDriverRegistry } from "@datsumi/driver-api";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

import { abortCancellation } from "../../../../apps/extension/src/connections/cancellation";
import { ConnectionManager } from "../../../../apps/extension/src/connections/ConnectionManager";
import { CredentialService } from "../../../../apps/extension/src/connections/CredentialService";
import {
  createTunnelFactory,
  sshFingerprint,
} from "../../../../apps/extension/src/connections/SshTunnel";
// @ts-expect-error Shared native Node fixture has no declarations.
import { startSshFixture } from "../../../../apps/extension/test/ssh-fixture.mjs";
import { ServerDriverAdapter } from "../src/index";

for (const id of ["postgres", "mysql", "mariadb", "mssql", "clickhouse", "oracle"] as const) {
  describe.skipIf(!process.env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`])(
    `${id} via real SSH`,
    () => {
      it("preserves database TLS identity, tests without saving, reconnects, and cleans up failed/cancelled sessions", async () => {
        const password = process.env.DATSUMI_TEST_PASSWORD!;
        const driver = new ServerDriverAdapter(id, async () => resolve(`dist/drivers/${id}.cjs`));
        const direct = {
          host: "127.0.0.1",
          port: Number(process.env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`]),
          database: id === "oracle" ? "FREEPDB1" : id === "mssql" ? "master" : "datsumi",
          username: id === "mssql" ? "sa" : "datsumi",
          password,
          tls: "disable",
          ca: "",
          readOnly: false,
        };
        const deadline = Date.now() + 180000;
        for (;;) {
          try {
            const session = await driver.connect(
              { id: "ready", name: "ready", driverId: id, family: "relational", configuration: {} },
              direct,
            );
            await driver.disconnect(session);
            break;
          } catch (error) {
            if (Date.now() > deadline) throw error;
            await new Promise((wait) => setTimeout(wait, 1500));
          }
        }
        const remotePort =
          id === "postgres"
            ? 5432
            : id === "mssql"
              ? 1433
              : id === "clickhouse"
                ? 8443
                : id === "oracle"
                  ? 1521
                  : 3306;
        const actualPort =
          id === "clickhouse" ? Number(process.env.DATSUMI_TEST_CLICKHOUSE_TLS_PORT) : direct.port;
        const ssh = await startSshFixture({ targets: { [remotePort]: actualPort } });
        const values = new Map<string, unknown>(),
          secrets = new Map<string, string>();
        const context = {
          workspaceState: {
            get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
            update: async (key: string, value: unknown) => {
              values.set(key, value);
            },
          },
        } as unknown as ExtensionContext;
        const credentials = new CredentialService(
          {
            get: async (key) => secrets.get(key),
            store: async (key, value) => {
              secrets.set(key, value);
            },
            delete: async (key) => {
              secrets.delete(key);
            },
          },
          async () => {
            throw new Error("Unexpected database credential prompt");
          },
          "test",
        );
        const registry = new InMemoryDriverRegistry();
        registry.register(driver);
        const manager = new ConnectionManager(
          context,
          registry,
          credentials,
          () => {},
          createTunnelFactory({
            verifyHost: async (_settings, fingerprint) =>
              fingerprint === sshFingerprint(ssh.hostKey),
            passphrase: async () => undefined,
          }),
        );
        const config = {
          ...direct,
          host: "localhost",
          port: remotePort,
          tls: id === "oracle" ? "disable" : "verify",
          ca: id === "oracle" ? "" : process.env.DATSUMI_TEST_CA!,
        };
        const { password: _password, ...settings } = config;
        try {
          await manager.testServer(id, settings, password, ssh.settings);
          expect(manager.all()).toHaveLength(0);
          await vi.waitFor(() => expect(ssh.clients).toBe(0));
          const profile = await manager.addServer(
            id,
            "SSH database",
            settings,
            { password, mode: "session" },
            ssh.settings,
          );
          expect(JSON.stringify([...values.values()])).not.toContain(password);
          expect(JSON.stringify(profile.configuration)).not.toContain("tunnelPort");
          const text =
            id === "oracle" ? "SELECT 42 FROM dual; -- trailing SQL comment" : "SELECT 42";
          const result = await manager.execute(profile.id, { language: "sql", text });
          if (result.kind !== "table") throw new Error("Expected table");
          expect(clipboardValue(result.rows[0]?.[0] ?? null)).toBe("42");
          expect(ssh.forwards).toContainEqual({ host: "localhost", port: remotePort });
          await manager.disconnect(profile.id);
          await vi.waitFor(() => expect(ssh.clients).toBe(0));
          const reopened = await manager.execute(profile.id, { language: "sql", text });
          expect(reopened.kind).toBe("table");
          expect(ssh.authentications).toBe(3);
          const controller = new AbortController();
          const slow =
            id === "postgres"
              ? "SELECT pg_sleep(20)"
              : id === "mysql" || id === "mariadb"
                ? "SELECT SLEEP(20)"
                : id === "mssql"
                  ? "WAITFOR DELAY '00:00:20'; SELECT 1"
                  : id === "oracle"
                    ? "BEGIN DBMS_SESSION.SLEEP(20); END;"
                    : "SELECT sleep(3) FROM numbers(30)";
          const pending = manager.execute(
            profile.id,
            { language: "sql", text: slow },
            abortCancellation(controller.signal),
          );
          const timer = setTimeout(() => controller.abort(), 150);
          try {
            await expect(pending).rejects.toThrow(/cancelled/i);
          } finally {
            clearTimeout(timer);
          }
          await vi.waitFor(() => expect(ssh.clients).toBe(0));
          await expect(
            manager.testServer(id, settings, "incorrect-database-password", ssh.settings),
          ).rejects.toThrow(/./);
          await vi.waitFor(() => expect(ssh.clients).toBe(0));
        } finally {
          await manager.dispose();
          await ssh.close();
        }
      }, 240000);
    },
  );
}
