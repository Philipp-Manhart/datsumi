import { request } from "node:http";
import { createServer, connect } from "node:net";

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Native test fixture is also shared with Node's VS Code test launcher.
import { startSshFixture } from "../../test/ssh-fixture.mjs";
import { abortCancellation } from "./cancellation";
import { createTunnelFactory, parseSshConfiguration, sshFingerprint } from "./SshTunnel";

async function echoServer() {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No echo port");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
async function roundTrip(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.setTimeout(5000, () => socket.destroy(new Error("Echo timeout")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(text));
    socket.once("data", (data) => {
      resolve(data.toString());
      socket.destroy();
    });
  });
}
const passphrase = async () => undefined;
describe("real SSH tunnels", () => {
  it("verifies the host, forwards only on loopback and closes its listener and channels", async () => {
    const fixture = await startSshFixture(),
      echo = await echoServer();
    const verifyHost = vi.fn<() => Promise<boolean>>(async () => true);
    const tunnel = await createTunnelFactory({ verifyHost, passphrase })(fixture.settings, {
      host: "db.internal",
      port: echo.port,
    });
    try {
      expect(verifyHost).toHaveBeenCalledWith(fixture.settings, sshFingerprint(fixture.hostKey));
      expect(await roundTrip(tunnel.port, "query data")).toBe("query data");
      expect(fixture.forwards).toContainEqual({ host: "db.internal", port: echo.port });
      await tunnel.close();
      expect(tunnel.closed).toBe(true);
      await expect(roundTrip(tunnel.port, "closed")).rejects.toThrow(/ECONNREFUSED/);
      await tunnel.close();
    } finally {
      await tunnel.close();
      await fixture.close();
      await echo.close();
    }
  });
  it("rejects an untrusted host before authenticating", async () => {
    const fixture = await startSshFixture();
    try {
      await expect(
        createTunnelFactory({ verifyHost: async () => false, passphrase })(fixture.settings, {
          host: "localhost",
          port: 5432,
        }),
      ).rejects.toThrow("not trusted");
      expect(fixture.authentications).toBe(0);
    } finally {
      await fixture.close();
    }
  });
  it("unlocks encrypted keys ephemerally and detects the wrong passphrase", async () => {
    const fixture = await startSshFixture({ passphrase: "private-phrase" });
    try {
      await expect(
        createTunnelFactory({ verifyHost: async () => true, passphrase: async () => "wrong" })(
          fixture.settings,
          { host: "localhost", port: 5432 },
        ),
      ).rejects.toThrow("unlock");
      const tunnel = await createTunnelFactory({
        verifyHost: async () => true,
        passphrase: async () => "private-phrase",
      })(fixture.settings, { host: "localhost", port: 5432 });
      expect(fixture.authentications).toBe(1);
      await tunnel.close();
    } finally {
      await fixture.close();
    }
  });
  it("reports unexpected tunnel loss and closes the listener", async () => {
    const fixture = await startSshFixture();
    const tunnel = await createTunnelFactory({ verifyHost: async () => true, passphrase })(
      fixture.settings,
      { host: "localhost", port: 5432 },
    );
    const closed = vi.fn<() => void>();
    tunnel.onClose(closed);
    fixture.drop();
    await vi.waitFor(() => expect(tunnel.closed).toBe(true));
    expect(closed).toHaveBeenCalled();
    await expect(roundTrip(tunnel.port, "closed")).rejects.toThrow(/ECONNREFUSED/);
    await tunnel.close();
    await fixture.close();
  });
  it("cancels while host verification is pending without leaking a client", async () => {
    const fixture = await startSshFixture();
    const controller = new AbortController();
    let verify: ((trusted: boolean) => void) | undefined;
    const pending = createTunnelFactory({
      verifyHost: () =>
        new Promise<boolean>((resolve) => {
          verify = resolve;
        }),
      passphrase,
    })(fixture.settings, { host: "localhost", port: 5432 }, abortCancellation(controller.signal));
    const rejection = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(verify).toBeDefined());
    controller.abort();
    expect(await rejection).toMatchObject({ message: "Connection cancelled." });
    verify?.(false);
    await vi.waitFor(() => expect(fixture.clients).toBe(0));
    await fixture.close();
  });
  it("validates settings before reading a key or opening a socket", () => {
    const valid = { host: "vps", port: 22, username: "user", keyPath: "~/.ssh/id_ed25519" };
    expect(parseSshConfiguration(valid)).toEqual(valid);
    expect(() => parseSshConfiguration({ ...valid, port: 0 })).toThrow("port");
    expect(() => parseSshConfiguration({ ...valid, keyPath: "./untrusted-workspace-key" })).toThrow(
      "absolute",
    );
    expect(() => parseSshConfiguration({ ...valid, password: "must-not-persist" })).toThrow("SSH");
  });
});

it("supports an Oracle TCPS CONNECT proxy without changing its target hostname", async () => {
  const fixture = await startSshFixture(),
    echo = await echoServer();
  const tunnel = await createTunnelFactory({ verifyHost: async () => true, passphrase })(
    fixture.settings,
    { host: "db.internal", port: echo.port, httpProxy: true },
  );
  try {
    const value = await new Promise<string>((resolve, reject) => {
      const connectRequest = request({
        host: "127.0.0.1",
        port: tunnel.port,
        method: "CONNECT",
        path: `db.internal:${echo.port}`,
      });
      connectRequest.on("error", reject);
      connectRequest.once("connect", (response, socket) => {
        if (response.statusCode !== 200) {
          socket.destroy();
          reject(new Error("CONNECT rejected"));
          return;
        }
        socket.on("error", reject);
        socket.once("data", (data) => {
          resolve(data.toString());
          socket.destroy();
        });
        socket.write("TLS bytes stay opaque to the tunnel");
      });
      connectRequest.end();
    });
    expect(value).toBe("TLS bytes stay opaque to the tunnel");
    expect(fixture.forwards).toContainEqual({ host: "db.internal", port: echo.port });
  } finally {
    await tunnel.close();
    await fixture.close();
    await echo.close();
  }
});
it("cleans up a rejected SSH login", async () => {
  const fixture = await startSshFixture();
  try {
    await expect(
      createTunnelFactory({ verifyHost: async () => true, passphrase })(
        { ...fixture.settings, username: "wrong-user" },
        { host: "localhost", port: 5432 },
      ),
    ).rejects.toThrow("SSH connection failed");
    await vi.waitFor(() => expect(fixture.clients).toBe(0));
  } finally {
    await fixture.close();
  }
});
