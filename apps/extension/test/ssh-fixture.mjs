import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ssh2 from "ssh2";
const { Server, utils } = ssh2;

export async function startSshFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-ssh-"));
  const key = (passphrase) =>
    generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      type: "pkcs1",
      format: "pem",
      ...(passphrase ? { cipher: "aes-256-cbc", passphrase } : {}),
    });
  const hostKey = key(),
    identity = key(options.passphrase);
  const parsedIdentity = utils.parseKey(identity, options.passphrase);
  if (parsedIdentity instanceof Error) throw parsedIdentity;
  const identityPath = join(directory, "identity.pem");
  await writeFile(identityPath, identity, { mode: 0o600 });
  const clients = new Set(),
    sockets = new Set(),
    forwards = [];
  let authentications = 0;
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", (context) => {
      if (
        context.username !== "fixture" ||
        context.method !== "publickey" ||
        !context.key.data.equals(parsedIdentity.getPublicSSH()) ||
        (context.signature &&
          parsedIdentity.verify(context.blob, context.signature, context.hashAlgo) !== true)
      )
        return context.reject();
      context.accept();
    });
    client.on("ready", () => {
      authentications++;
      client.on("tcpip", (accept, reject, info) => {
        if (
          options.denyForward ||
          !["127.0.0.1", "localhost", "db.internal", "::1"].includes(info.destIP)
        )
          return reject();
        const port = options.targets ? options.targets[info.destPort] : info.destPort;
        if (!port) return reject();
        forwards.push({ host: info.destIP, port: info.destPort });
        const channel = accept(),
          socket = connect({ host: "127.0.0.1", port });
        sockets.add(socket);
        socket.on("close", () => {
          sockets.delete(socket);
          channel.destroy();
        });
        channel.on("close", () => socket.destroy());
        socket.on("error", () => channel.destroy());
        channel.on("error", () => socket.destroy());
        socket.pipe(channel).pipe(socket);
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    directory,
    identityPath,
    hostKey: utils.parseKey(hostKey).getPublicSSH(),
    settings: {
      host: "127.0.0.1",
      port: server.address().port,
      username: "fixture",
      keyPath: identityPath,
    },
    get clients() {
      return clients.size;
    },
    get authentications() {
      return authentications;
    },
    forwards,
    drop() {
      for (const client of clients) client.end();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
