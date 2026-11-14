import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifiedDownload } from "./verified-download.mjs";
const pins = JSON.parse(await readFile(new URL("./test-runtimes.json", import.meta.url), "utf8"));
const manifest = JSON.parse(
  await readFile(new URL("../apps/extension/package.json", import.meta.url), "utf8"),
);
if (manifest.engines.vscode !== `^${pins.version}`)
  throw new Error("Review and repin the minimum VS Code runtime after changing engines.vscode.");
let executable = process.env.DATSUMI_TEST_MINIMUM_CODE;
let directory;
try {
  if (!executable) {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw new Error(
        "Set DATSUMI_TEST_MINIMUM_CODE to a trusted minimum-version VS Code CLI on this platform.",
      );
    directory = await mkdtemp(join(tmpdir(), "datsumi-minimum-"));
    const archive = join(directory, "code.tar.gz");
    console.log("Preparing checksum-pinned VS Code", pins.version);
    await writeFile(archive, await verifiedDownload(pins["linux-x64"]), { mode: 0o600 });
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", directory], { stdio: "inherit" });
    if (extracted.status !== 0) throw new Error("Minimum runtime extraction failed.");
    executable = join(directory, "VSCode-linux-x64", "bin", "code");
  }
  const env = {
    ...process.env,
    VSCODE_EXECUTABLE: executable,
    DATSUMI_TEST_RUNTIME_LABEL: "minimum",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const version = spawnSync(executable, ["--version"], { env, encoding: "utf8" });
  if (version.status !== 0 || version.stdout.split(/\r?\n/)[0] !== pins.version)
    throw new Error("The minimum-version test executable has the wrong VS Code version.");
  const result = spawnSync(process.execPath, ["apps/extension/test/package-run.mjs"], {
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Minimum-version installed-package acceptance failed.");
} finally {
  if (directory)
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
