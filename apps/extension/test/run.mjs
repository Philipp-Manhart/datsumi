import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startSshFixture } from "./ssh-fixture.mjs";

const extension = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "datsumi-vscode-"));
const workspace = join(directory, "workspace");
await mkdir(workspace);
let succeeded = false;
let sshFixture;
try {
  const env = { ...process.env, DATSUMI_TEST_DIRECTORY: directory };
  if (env.DATSUMI_TEST_POSTGRES_PORT && env.DATSUMI_TEST_CLIPBOARD_ONLY !== "1") {
    sshFixture = await startSshFixture({
      targets: { 5432: Number(env.DATSUMI_TEST_POSTGRES_PORT) },
    });
    env.DATSUMI_TEST_SSH_PORT = String(sshFixture.settings.port);
    env.DATSUMI_TEST_SSH_KEY = sshFixture.identityPath;
    env.DATSUMI_TEST_SSH_FINGERPRINT = `SHA256:${createHash("sha256").update(sshFixture.hostKey).digest("base64").replace(/=+$/, "")}`;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  // Unfocused Wayland windows cannot reliably own the clipboard used by this headless test.
  // Keep production VS Code's platform unchanged; select X11 only for the clipboard fixture.
  const clipboardOnX11 =
    process.platform === "linux" && Boolean(env.DISPLAY) && env.DATSUMI_TEST_CLIPBOARD_ONLY === "1";
  if (clipboardOnX11) delete env.WAYLAND_DISPLAY;
  await new Promise((resolveRun, reject) => {
    const child = spawn(
      process.env.VSCODE_EXECUTABLE || "code",
      [
        "--wait",
        "--new-window",
        ...(clipboardOnX11 ? ["--ozone-platform=x11"] : []),
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        `--user-data-dir=${join(directory, "user")}`,
        `--extensions-dir=${join(directory, "extensions")}`,
        `--extensionDevelopmentPath=${resolve(extension)}`,
        `--extensionTestsPath=${join(extension, "test", process.env.DATSUMI_TEST_CLIPBOARD_ONLY === "1" ? "clipboard.cjs" : "smoke.cjs")}`,
        workspace,
      ],
      { env, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`VS Code smoke test failed (${code}).`)),
    );
  });
  if (process.env.DATSUMI_TEST_CLIPBOARD_ONLY === "1") {
    if ((await readFile(join(directory, "clipboard.passed"), "utf8")) !== "ok")
      throw new Error("Missing clipboard results.");
    console.log(
      "Native VS Code clipboard test passed: 12001 SQL rows across pages, headers, TSV, tab reuse, pinning, explicit new results and no replay of RETURNING writes.",
    );
    succeeded = true;
  } else {
    if ((await readFile(join(directory, "open.passed"), "utf8")) !== "ok")
      throw new Error("Missing smoke test result.");
    for (const driver of ["postgres", "mysql", "mariadb", "mssql", "clickhouse", "oracle"]) {
      if (!process.env[`DATSUMI_TEST_${driver.toUpperCase()}_PORT`]) continue;
      if ((await readFile(join(directory, `server-${driver}.passed`), "utf8")) !== "ok")
        throw new Error(`Missing native ${driver} test result.`);
      console.log(
        `Native ${driver}: optional driver install, saved-credential reuse, and Forget passed.`,
      );
    }
    if (
      process.env.DATSUMI_TEST_MONGODB_PORT &&
      (await readFile(join(directory, "nosql.passed"), "utf8")) !== "ok"
    )
      throw new Error("Missing native NoSQL results.");
    if (process.env.DATSUMI_TEST_REMOTE_URL) {
      if ((await readFile(join(directory, "remote.passed"), "utf8")) !== "ok")
        throw new Error("Missing native remote SQL test result.");
      console.log(
        "Native libSQL and Turso: optional driver setup, secure token reuse/Forget, SQL editors, queries and history passed.",
      );
    }
    if (sshFixture) {
      if ((await readFile(join(directory, "ssh.passed"), "utf8")) !== "ok")
        throw new Error("Missing native SSH result.");
      console.log(
        "Native SSH: bundled client, host-key verification/pinning, verified database TLS, reconnect, cleanup and host-key reset passed.",
      );
    }
    if (process.env.DATSUMI_TEST_HEADLESS === "1") {
      if ((await readFile(join(directory, "duckdb.passed"), "utf8")) !== "ok")
        throw new Error("Missing native DuckDB results.");
      console.log(
        "Native DuckDB automatic native installation, creation/existing-file opening without a report header, SQL tools, queries, browsing and reconnect passed.",
      );
    }
    const skipped = await readFile(join(directory, "typing.skipped"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (skipped) console.warn(skipped);
    console.log(
      "Native VS Code smoke test passed: activation, SQLite connection, SQL editor, query execution, table panel, disconnect.",
    );
    succeeded = true;
  }
} finally {
  await sshFixture?.close();
  if (succeeded) await rm(directory, { recursive: true, force: true });
  else console.error(`VS Code smoke test diagnostics: ${directory}`);
}
