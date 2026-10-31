/* oxlint-disable no-control-regex -- Reject control characters in SSH settings. */
/* oxlint-disable typescript/no-unsafe-type-assertion -- Parse SSH settings field by field before use. */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Socket, type Server } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { DriverCancellation, SshConfiguration } from "@datsumi/core";
import { Client, utils } from "ssh2";

export interface ManagedTunnel {
  readonly port: number;
  readonly closed: boolean;
  close(): Promise<void>;
  onClose(callback: () => void): { dispose(): void };
}
export type TunnelFactory = (
  settings: SshConfiguration,
  target: { host: string; port: number; httpProxy?: boolean },
  signal?: DriverCancellation,
) => Promise<ManagedTunnel>;
export function parseSshConfiguration(value: unknown): SshConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid SSH settings.");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some((key) => !["host", "port", "username", "keyPath"].includes(key)) ||
    typeof data.host !== "string" ||
    !data.host.trim() ||
    data.host.length > 1024 ||
    typeof data.username !== "string" ||
    !data.username.trim() ||
    data.username.length > 200 ||
    typeof data.keyPath !== "string" ||
    data.keyPath.length > 8192 ||
    [data.host, data.username, data.keyPath].some((text) => /[\x00-\x1f]/.test(String(text))) ||
    typeof data.port !== "number" ||
    !Number.isInteger(data.port) ||
    data.port < 1 ||
    data.port > 65535
  )
    throw new Error("Enter an SSH host, user and port between 1 and 65535.");
  if (data.keyPath && !isAbsolute(data.keyPath) && !data.keyPath.startsWith("~/"))
    throw new Error("SSH key path must be absolute or start with ~/ on the extension host.");
  return {
    host: data.host.trim(),
    port: data.port,
    username: data.username.trim(),
    keyPath: data.keyPath,
  };
}
export function sshFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}
export function createTunnelFactory(options: {
  verifyHost: (settings: SshConfiguration, fingerprint: string) => Promise<boolean>;
  passphrase: (path: string) => Promise<string | undefined>;
}): TunnelFactory {
  return async (raw, target, signal) => {
    const settings = parseSshConfiguration(raw);
    if (signal?.isCancellationRequested) throw new Error("Connection cancelled.");
    let privateKey: Buffer | undefined, passphrase: string | undefined;
    if (settings.keyPath) {
      const path = settings.keyPath.startsWith("~/")
        ? join(homedir(), settings.keyPath.slice(2))
        : settings.keyPath;
      const file = await open(path, "r");
      try {
        if (!(await file.stat()).isFile())
          throw new Error("Choose a regular SSH private key file.");
        const bytes = Buffer.alloc(1024 * 1024 + 1);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 1024 * 1024) throw new Error("SSH private keys must be at most 1 MiB.");
        privateKey = bytes.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
      const parsed = utils.parseKey(privateKey);
      if (parsed instanceof Error) {
        if (!/encrypt|passphrase/i.test(parsed.message))
          throw new Error("Unsupported SSH key. Use an OpenSSH or PEM private key.");
        passphrase = await options.passphrase(path);
        if (passphrase === undefined) throw new Error("SSH authentication cancelled.");
        if (utils.parseKey(privateKey, passphrase) instanceof Error)
          throw new Error("Could not unlock the SSH key.");
      }
    }
    const agent =
      process.env.SSH_AUTH_SOCK ||
      (process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined);
    if (!privateKey && !agent)
      throw new Error("Choose an SSH key or start an SSH agent on the extension host.");
    if (signal?.isCancellationRequested) throw new Error("Connection cancelled.");
    const client = new Client();
    const sockets = new Set<{ destroy(): void }>();
    const observers = new Set<() => void>();
    let closed = false,
      closing = false,
      ready = false;
    let verificationError: Error | undefined;
    let server: Server | undefined;
    let closePromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      if (closePromise) return closePromise;
      closing = true;
      closed = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      client.destroy();
      closePromise = new Promise<void>((resolve) => {
        if (server?.listening) server.close(() => resolve());
        else resolve();
      });
      return closePromise;
    };
    const cancelled = signal?.onCancellationRequested(() => {
      void stop();
    });
    const attach = (socket: {
      destroy(): void;
      once(event: "close", callback: () => void): unknown;
    }) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    };
    const forward = (socket: Socket, head?: Buffer, proxy = false) => {
      attach(socket);
      socket.on("error", () => socket.destroy());
      client.forwardOut("127.0.0.1", 0, target.host, target.port, (error, stream) => {
        if (error || closed || socket.destroyed) {
          stream?.destroy();
          socket.destroy();
          return;
        }
        attach(stream);
        stream.on("error", () => socket.destroy());
        stream.on("close", () => socket.destroy());
        socket.on("close", () => stream.destroy());
        if (proxy) socket.setTimeout(0);
        if (proxy) socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) stream.write(head);
        socket.pipe(stream).pipe(socket);
      });
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const onCancel = signal?.onCancellationRequested(() =>
          reject(new Error("Connection cancelled.")),
        );
        const done = (error?: Error) => {
          onCancel?.dispose();
          if (error) reject(error);
          else resolve();
        };
        client.once("ready", () => {
          ready = true;
          done();
        });
        client.on("error", () => {
          if (closing) return;
          if (!ready)
            done(
              verificationError ??
                new Error(
                  "SSH connection failed. Check the host key, SSH user, key and forwarding permissions.",
                ),
            );
          else {
            closed = true;
            for (const callback of observers) callback();
            void stop();
          }
        });
        client.on("close", () => {
          if (!ready) done(new Error("SSH connection closed before authentication completed."));
          if (!closing) {
            closed = true;
            for (const callback of observers) callback();
            void stop();
          }
        });
        client.connect({
          host: settings.host,
          port: settings.port,
          username: settings.username,
          ...(privateKey
            ? { privateKey, ...(passphrase !== undefined ? { passphrase } : {}) }
            : agent
              ? { agent }
              : {}),
          readyTimeout: 60000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer, callback: (trusted: boolean) => void) => {
            void options.verifyHost(settings, sshFingerprint(key)).then(
              (trusted) => {
                if (!trusted)
                  verificationError = new Error(
                    "SSH host key was not trusted. Connection cancelled.",
                  );
                callback(trusted);
              },
              (error: unknown) => {
                verificationError =
                  error instanceof Error ? error : new Error("SSH host verification failed.");
                callback(false);
              },
            );
          },
        });
      });
      if (closed || signal?.isCancellationRequested)
        throw new Error("SSH connection cancelled or closed.");
      if (target.httpProxy) {
        const proxy = createHttpServer((_request, response) => {
          response.writeHead(405);
          response.end();
        });
        proxy.on("connect", (request, socket, head) => {
          const expected = `${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
          if (request.url !== expected) {
            socket.destroy();
            return;
          }
          forward(socket as Socket, head, true);
        });
        proxy.on("connection", (socket) => {
          attach(socket);
          socket.setTimeout(30000, () => socket.destroy());
        });
        server = proxy;
      } else server = createServer((socket) => forward(socket));
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", () => {
          if (closed) server!.close();
          resolve();
        });
      });
      if (closed || signal?.isCancellationRequested) throw new Error("Connection cancelled.");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("SSH listener could not be created.");
      return {
        port: address.port,
        get closed() {
          return closed;
        },
        close: stop,
        onClose(callback) {
          observers.add(callback);
          return {
            dispose() {
              observers.delete(callback);
            },
          };
        },
      };
    } catch (error) {
      await stop();
      throw error;
    } finally {
      cancelled?.dispose();
      privateKey = undefined;
      passphrase = undefined;
    }
  };
}
