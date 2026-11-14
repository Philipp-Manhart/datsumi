/* oxlint-disable no-await-in-loop -- Release gates are ordered, each must finish before the next begins. */
import { spawnSync, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, copyFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { verifiedDownload } from "./verified-download.mjs";
const root = resolve(import.meta.dirname, "..");
const allowDirty = process.argv.includes("--allow-dirty");
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (dirty && !allowDirty)
  throw new Error(
    "Release checks require a clean committed tree. For development evidence only, pass --allow-dirty; its report cannot approve publication.",
  );
const output = join(
  root,
  "test-results",
  "release",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: Boolean(dirty),
  releaseReady: false,
  steps: [],
  started: new Date().toISOString(),
};
function run(command, args) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  report.steps.push({
    command: [command, ...args].join(" "),
    exitCode: result.status,
    elapsedMs: Date.now() - started,
  });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error("Release gate failed: " + command + " " + args.join(" "));
}
const temp = await mkdtemp(join(tmpdir(), "datsumi-release-"));
try {
  run("bun", ["install", "--frozen-lockfile"]);
  run("bun", ["run", "test:all"]);
  run("bun", ["audit", "--json"]);
  let gitleaks = process.env.GITLEAKS_BIN;
  if (!gitleaks) {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw new Error(
        "Set GITLEAKS_BIN to a trusted Gitleaks 8.30.1+ executable on this platform.",
      );
    const pins = JSON.parse(await readFile(join(root, "scripts/release-tools.json"), "utf8"));
    const bytes = await verifiedDownload(pins.gitleaks);
    const archive = join(temp, "gitleaks.tar.gz");
    await writeFile(archive, bytes, { mode: 0o600 });
    run("tar", ["-xzf", archive, "-C", temp, "gitleaks"]);
    gitleaks = join(temp, "gitleaks");
  }
  const toolVersion = execFileSync(gitleaks, ["version"], { encoding: "utf8" }).trim();
  const version = toolVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (
    !version ||
    Number(version[1]) < 8 ||
    (Number(version[1]) === 8 && Number(version[2]) < 30) ||
    (Number(version[1]) === 8 && Number(version[2]) === 30 && Number(version[3]) < 1)
  )
    throw new Error("Gitleaks 8.30.1 or newer is required.");
  run(gitleaks, [
    "git",
    root,
    "--redact",
    "--no-banner",
    "--report-format",
    "json",
    "--report-path",
    join(output, "secrets-history.json"),
  ]);
  const snapshot = join(temp, "source");
  await mkdir(snapshot, { mode: 0o700 });
  const files = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0");
  for (const file of files) {
    if (!file || !(await stat(join(root, file)).catch(() => undefined))?.isFile()) continue;
    const destination = join(snapshot, file);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(join(root, file), destination);
  }
  run(gitleaks, [
    "dir",
    snapshot,
    "--redact",
    "--no-banner",
    "--report-format",
    "json",
    "--report-path",
    join(output, "secrets-source.json"),
  ]);
  for (const name of ["secrets-history.json", "secrets-source.json"]) {
    const findings = JSON.parse(await readFile(join(output, name), "utf8"));
    if (!Array.isArray(findings) || findings.length)
      throw new Error("Secret scanner did not produce a clean report.");
  }
  run("bun", ["run", "package:extension"]);
  const manifest = JSON.parse(await readFile(join(root, "apps/extension/package.json"), "utf8"));
  run(process.platform === "win32" ? "python" : "python3", [
    "scripts/verify-package.py",
    `apps/extension/datsumi-${manifest.version}.vsix`,
  ]);
  run("bun", ["run", "test:installed"]);
  run("bun", ["run", "test:minimum"]);
  run("bun", ["run", "benchmark:results"]);
  report.releaseReady =
    !dirty &&
    !execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() &&
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() ===
      report.commit;
} finally {
  report.finished = new Date().toISOString();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  await rm(temp, { recursive: true, force: true });
  console.log("Local release report:", join(output, "report.json"));
}
