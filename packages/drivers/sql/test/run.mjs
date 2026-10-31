import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const project = `datsumi-test-${randomUUID().slice(0, 8)}`;
const base = ["compose", "-p", project, "-f", "packages/drivers/sql/test/compose.yml"];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
  return result;
}
const group = process.env.DATSUMI_TEST_GROUP;
if (group && !["core", "extended"].includes(group)) throw new Error("Invalid database test group.");
const targets = [
  ["postgres", 5432],
  ["mysql", 3306],
  ["mariadb", 3306],
  ["mssql", 1433],
  ["clickhouse", 8123],
  ["oracle", 1521],
].filter(([id]) => !group || (group === "extended") === ["clickhouse", "oracle"].includes(id));
const tlsDirectory = mkdtempSync(join(tmpdir(), "datsumi-test-tls-"));
process.env.DATSUMI_TEST_TLS_DIR = tlsDirectory;
try {
  chmodSync(tlsDirectory, 0o755);
  run(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      join(tlsDirectory, "server.key"),
      "-out",
      join(tlsDirectory, "server.crt"),
    ],
    { stdio: "pipe" },
  );
  // Disposable fixture key only: readable by database users inside test containers.
  chmodSync(join(tlsDirectory, "server.key"), 0o644);
  writeFileSync(
    join(tlsDirectory, "mssql.conf"),
    "[network]\ntlscert = /certs/server.crt\ntlskey = /certs/server.key\nforceencryption = 0\n",
  );
  writeFileSync(
    join(tlsDirectory, "clickhouse.xml"),
    `<clickhouse><https_port>8443</https_port><openSSL><server><certificateFile>/certs/server.crt</certificateFile><privateKeyFile>/certs/server.key</privateKeyFile><verificationMode>none</verificationMode><cacheSessions>true</cacheSessions></server></openSSL></clickhouse>`,
  );
  run("node", ["packages/drivers/sql/build.mjs"]);
  run("docker", [...base, "up", "-d", ...targets.map(([id]) => id)]);
  const env = {
    ...process.env,
    DATSUMI_TEST_PASSWORD: "Datsumi_Test_Only_2026!",
    DATSUMI_TEST_CA: readFileSync(join(tlsDirectory, "server.crt"), "utf8"),
  };
  for (const [id, port] of targets) {
    const result = run("docker", [...base, "port", id, String(port)], {
      stdio: "pipe",
      encoding: "utf8",
    });
    env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`] = result.stdout.trim().split(":").at(-1);
  }
  if (targets.some(([id]) => id === "clickhouse")) {
    const port = run("docker", [...base, "port", "clickhouse", "8443"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    env.DATSUMI_TEST_CLICKHOUSE_TLS_PORT = port.stdout.trim().split(":").at(-1);
  }
  run(
    "bun",
    [
      "x",
      "vitest",
      "run",
      "--config",
      "packages/drivers/sql/test/vitest.config.ts",
      ...(group
        ? [
            group === "core" ? "adapters.integration.ts" : "extended.integration.ts",
            "ssh.integration.ts",
          ]
        : []),
    ],
    {
      env,
    },
  );
  if (process.env.DATSUMI_TEST_NATIVE === "1")
    run("bun", ["run", "test:integration"], { env: { ...env, DATSUMI_TEST_HEADLESS: "1" } });
} finally {
  spawnSync("docker", [...base, "down", "--volumes", "--remove-orphans"], {
    cwd: root,
    stdio: "inherit",
  });
  rmSync(tlsDirectory, { recursive: true, force: true });
}
