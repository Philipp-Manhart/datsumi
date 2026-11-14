/* oxlint-disable no-await-in-loop -- Install/launch/upgrade phases share one isolated VS Code profile. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extension = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(extension, "package.json"), "utf8"));
const vsix = resolve(
  process.env.DATSUMI_TEST_VSIX || join(extension, `datsumi-${manifest.version}.vsix`),
);
const previous = resolve(
  process.env.DATSUMI_TEST_PREVIOUS_VSIX || join(extension, "datsumi-0.1.0.vsix"),
);
// Published v0.1.0 release asset digest. An upgrade test must use the actual previous distributable.
const previousSha = "72c8472d7a59e0d99177618d545922d6b84cb9a918ac731fa0e84be13ed4821e";
if (
  createHash("sha256")
    .update(await readFile(previous))
    .digest("hex") !== previousSha
)
  throw new Error(
    "Supply the published v0.1.0 VSIX using DATSUMI_TEST_PREVIOUS_VSIX (pinned digest mismatch).",
  );
const executable = process.env.VSCODE_EXECUTABLE || "code";
const screenshots = process.argv.includes("--screenshots");
const root = await mkdtemp(join(tmpdir(), "datsumi-package-"));
const harness = join(root, "harness");
await mkdir(harness);
await writeFile(
  join(harness, "package.json"),
  JSON.stringify({
    name: "datsumi-package-test",
    publisher: "local-test",
    version: "0.0.0",
    engines: { vscode: "^1.138.0" },
    main: "index.cjs",
    activationEvents: ["onStartupFinished"],
  }),
);
await writeFile(
  join(harness, "index.cjs"),
  `
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
exports.activate = async () => {
  try {
    await vscode.workspace.getConfiguration("files").update("hotExit", "onExitAndWindowClose", vscode.ConfigurationTarget.Global);
    await require(process.env.DATSUMI_INSTALLED_TEST_FILE).run();
  } catch (error) {
    fs.writeFileSync(path.join(process.env.DATSUMI_TEST_DIRECTORY, "failure.txt"), String(error.stack || error));
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeWindow");
  }
};
`,
);
const steps = [];
let supportsSharedData = false;
async function run(profile, args, env = {}) {
  const started = Date.now();
  const common = [
    `--user-data-dir=${join(root, profile, "user")}`,
    `--extensions-dir=${join(root, profile, "extensions")}`,
    ...(supportsSharedData ? [`--shared-data-dir=${join(root, profile, "shared")}`] : []),
  ];
  const output = [];
  await new Promise((resolveRun, reject) => {
    const childEnv = { ...process.env, ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [...common, ...args], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output.push(chunk);
        process.stdout.write(chunk);
      });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Installed-package test timed out."));
    }, 180000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun();
      else reject(new Error(`Installed-package phase failed (${code}).`));
    });
  });
  steps.push({ phase: env.DATSUMI_LIFECYCLE_PHASE || args[0], elapsedMs: Date.now() - started });
  return Buffer.concat(output).toString("utf8");
}
async function launch(profile, test, phase, expected) {
  const directory = join(root, profile),
    workspace = join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  // VS Code exposes a separate API object per extension. Stage ONLY test fixtures
  // under the installed target so provider instrumentation shares its API scope.
  // Production entrypoints, workers, resources and manifests are never replaced.
  const tests = join(
    directory,
    "extensions",
    `philipp-manhart.datsumi-${expected}`,
    ".datsumi-tests",
  );
  await mkdir(tests, { recursive: true });
  for (const file of [test, "connection-form.cjs"])
    await copyFile(join(extension, "test", file), join(tests, file));
  await run(
    profile,
    [
      ...(screenshots ? ["--ozone-platform=x11", "--disable-gpu"] : []),
      "--wait",
      "--new-window",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      `--extensionDevelopmentPath=${harness}`,
      workspace,
    ],
    {
      DATSUMI_TEST_DIRECTORY: directory,
      DATSUMI_INSTALLED_TEST_FILE: join(tests, test),
      DATSUMI_TEST_CAPTURE_DIR: join(extension, "media"),
      DATSUMI_TEST_INSTALLED_ROOT: join(directory, "extensions"),
      DATSUMI_LIFECYCLE_PHASE: phase,
      DATSUMI_TEST_EXPECTED_VERSION: expected,
      DATSUMI_TEST_HEADLESS: "1",
    },
  );
  const marker = test === "smoke.cjs" ? "open" : phase;
  const failure = await readFile(join(directory, "failure.txt"), "utf8").catch(() => undefined);
  if (failure) throw new Error(failure);
  if ((await readFile(join(directory, `${marker}.passed`), "utf8")) !== "ok")
    throw new Error(`Installed test did not complete: ${phase}`);
}
let success = false;
try {
  const version = await run("fresh", ["--version"]);
  supportsSharedData = Number(version.match(/^1\.(\d+)/)?.[1] ?? 0) >= 146;
  await run("fresh", ["--install-extension", vsix, "--force"]);
  if (screenshots) {
    await launch("fresh", "capture.cjs", "screenshots", manifest.version);
  } else {
    await launch("fresh", "smoke.cjs", "fresh-package", manifest.version);
    await run("upgrade", ["--install-extension", previous, "--force"]);
    await launch("upgrade", "installed.cjs", "seed", "0.1.0");
    await run("upgrade", ["--install-extension", vsix, "--force"]);
    await launch("upgrade", "installed.cjs", "upgrade", manifest.version);
    await launch("upgrade", "installed.cjs", "reload", manifest.version);
    await run("upgrade", ["--uninstall-extension", "philipp-manhart.datsumi"]);
    await run("upgrade", ["--install-extension", vsix, "--force"]);
    await launch("upgrade", "installed.cjs", "reinstall", manifest.version);
  }
  const report = {
    passed: true,
    vscode: version.trim(),
    platform: process.platform,
    arch: process.arch,
    vsixSha256: createHash("sha256")
      .update(await readFile(vsix))
      .digest("hex"),
    previousSha256: previousSha,
    steps,
  };
  const results = resolve(extension, "../../test-results");
  await mkdir(results, { recursive: true });
  await writeFile(
    join(
      results,
      `installed-${screenshots ? "screenshots" : process.env.DATSUMI_TEST_RUNTIME_LABEL || "current"}.json`,
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    screenshots
      ? "Synthetic installed-extension screenshots captured."
      : "Installed VSIX, upgrade, reload and reinstall checks passed.",
  );
  success = true;
} finally {
  if (success && !process.env.DATSUMI_TEST_KEEP)
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  else console.error("Installed-package diagnostics:", root);
}
