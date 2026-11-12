// An isolated real libSQL server exercises both official HTTP clients. No cloud account required.
import { spawn, execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { verifiedDownload } from "../../../../scripts/verified-download.mjs";
const version = "0.24.32";
const checksum = "71720fc8648c19efef416efebd47145ef59b62e198770533530a858e1336879f";
const dir = await mkdtemp(join(tmpdir(), "datsumi-remote-test-"));
let binary = process.env.DATSUMI_TEST_SQLD_BIN;
if (!binary) {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      "Set DATSUMI_TEST_SQLD_BIN to a trusted libSQL server 0.24.32 executable on this platform.",
    );
  const bytes = await verifiedDownload({
    url: `https://github.com/tursodatabase/libsql/releases/download/libsql-server-v${version}/libsql-server-x86_64-unknown-linux-gnu.tar.xz`,
    sha256: checksum,
    maxBytes: 128 * 1024 * 1024,
  });
  const archive = join(dir, "server.tar.xz");
  await writeFile(archive, bytes, { mode: 0o600 });
  execFileSync("tar", ["-xJf", archive, "-C", dir]);
  binary = join(dir, "libsql-server-x86_64-unknown-linux-gnu/sqld");
}
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// libSQL accepts the raw Ed25519 verification key in URL-safe base64.
await writeFile(
  join(dir, "key"),
  publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url"),
);
const encoded = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const payload = `${encoded({ alg: "EdDSA", typ: "JWT" })}.${encoded({ a: "rw", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const token = `${payload}.${sign(null, Buffer.from(payload), privateKey).toString("base64url")}`;
const child = spawn(
  binary,
  [
    "--db-path",
    join(dir, "db"),
    "--http-listen-addr",
    `127.0.0.1:${port}`,
    "--auth-jwt-key-file",
    join(dir, "key"),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
child.stdout.on("data", (data) => {
  log += data;
});
child.stderr.on("data", (data) => {
  log += data;
});
let startupError;
child.on("error", (error) => {
  startupError = error;
});
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Test server exited: ${log}`);
    try {
      await fetch(endpoint);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`Test server did not start: ${log}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const tests = spawn(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "packages/drivers/sql/test/remote.config.ts",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, DATSUMI_TEST_REMOTE_URL: endpoint, DATSUMI_TEST_REMOTE_TOKEN: token },
    },
  );
  process.exitCode = await new Promise((resolve) => tests.on("exit", (code) => resolve(code ?? 1)));
  if (!process.exitCode && process.env.DATSUMI_TEST_NATIVE === "1") {
    const native = spawn(process.execPath, ["apps/extension/test/run.mjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        DATSUMI_TEST_REMOTE_URL: endpoint,
        DATSUMI_TEST_REMOTE_TOKEN: token,
        DATSUMI_TEST_HEADLESS: process.env.DATSUMI_TEST_HEADLESS || "1",
      },
    });
    process.exitCode = await new Promise((resolve) =>
      native.on("exit", (code) => resolve(code ?? 1)),
    );
  }
} finally {
  if (process.exitCode) console.error(log.slice(-5000));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (child.exitCode === null && !startupError) {
    child.kill();
    await exited;
  }
  await rm(dir, { recursive: true, force: true });
}
