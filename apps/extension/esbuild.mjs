/* oxlint-disable no-await-in-loop -- Copy release notices as part of the ordered packaging pipeline. */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { build, context } from "esbuild";
import { build as buildWebview } from "vite";

import { writeLicenses } from "../../scripts/licenses.mjs";

await import("../../packages/drivers/sql/build.mjs");
await mkdir("dist/drivers", { recursive: true });
await copyFile("../../LICENSE", "LICENSE");
for (const [source, target] of [
  ["PRIVACY.md", "PRIVACY.md"],
  ["SECURITY.md", "SECURITY.md"],
  ["docs/archive/security-audit.md", "SECURITY-AUDIT.md"],
  ["SUPPORT.md", "SUPPORT.md"],
  ["docs/settings.md", "SETTINGS.md"],
  ["docs/support-matrix.md", "SUPPORT-MATRIX.md"],
  ["docs/connection-troubleshooting.md", "CONNECTIONS.md"],
  ["docs/getting-started.md", "GETTING-STARTED.md"],
]) {
  const text = (await readFile(`../../${source}`, "utf8"))
    .replaceAll("(docs/support-matrix.md)", "(SUPPORT-MATRIX.md)")
    .replaceAll("(docs/connection-troubleshooting.md)", "(CONNECTIONS.md)")
    .replaceAll("(docs/archive/security-audit.md)", "(SECURITY-AUDIT.md)");
  await writeFile(target, text);
}
const duckRequire = createRequire(
  new URL("../../packages/drivers/duckdb/package.json", import.meta.url),
);
const apiRequire = createRequire(duckRequire.resolve("@duckdb/node-api"));
const bindingRequire = createRequire(apiRequire.resolve("@duckdb/node-bindings"));
await writeLicenses(
  [
    apiRequire.resolve("@duckdb/node-bindings"),
    bindingRequire.resolve(`@duckdb/node-bindings-${process.platform}-${process.arch}/duckdb.node`),
  ],
  "dist/NATIVE",
);
await writeFile(
  "dist/CODICONS.NOTICES.txt",
  "VS Code Codicons 0.0.45 — Microsoft Corporation\nhttps://github.com/microsoft/vscode-codicons\nIcons used without modification; CC BY 4.0.\n\n" +
    (await readFile("../webview/node_modules/@vscode/codicons/LICENSE", "utf8")),
);
await writeFile(
  "dist/DAGRE.NOTICES.txt",
  "Dagre 3.1.3 — MIT\nhttps://github.com/dagrejs/dagre\n\n" +
    (await readFile("../webview/node_modules/@dagrejs/dagre/LICENSE", "utf8")) +
    "\n\n" +
    (await readFile("../webview/node_modules/@dagrejs/dagre/dist/dagre.esm.js.LEGAL.txt", "utf8")),
);
await copyFile("../../dist/drivers/catalog.json", "dist/driver-catalog.json");
// Local releases include verified workers for automatic offline setup.
for (const id of [
  "postgres",
  "mysql",
  "mariadb",
  "mssql",
  "clickhouse",
  "oracle",
  "libsql",
  "turso",
  "mongodb",
  "redis",
  "duckdb",
]) {
  await copyFile(`../../dist/drivers/${id}.NOTICES.txt`, `dist/${id}.NOTICES.txt`);
  await copyFile(`../../dist/drivers/${id}.components.json`, `dist/${id}.components.json`);
  await copyFile(`../../dist/drivers/${id}.cjs`, `dist/drivers/${id}.cjs`);
}
const webviewRoot = fileURLToPath(new URL("../webview/", import.meta.url));
await buildWebview({
  root: webviewRoot,
  configFile: `${webviewRoot}vite.config.ts`,
  build: {
    outDir: fileURLToPath(new URL("./dist/webview/", import.meta.url)),
    emptyOutDir: true,
    watch: process.argv.includes("--watch") ? {} : null,
  },
});

const watch = process.argv.includes("--watch");
const options = {
  bundle: true,
  entryPoints: {
    extension: "src/extension.ts",
    "sqlite-worker": "../../packages/drivers/sqlite/src/worker.ts",
  },
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  minify: !watch,
  metafile: true,
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  // This bundle only runs in Node; avoid browser probes in dependency code.
  define: { navigator: "undefined" },
  sourcemap: watch,
  target: "node22",
};

if (!watch) {
  const result = await build(options);
  await writeLicenses(Object.keys(result.metafile.inputs), "dist/CORE", process.cwd());
} else {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("Watching extension sources...");

  const dispose = async () => {
    await buildContext.dispose();
    process.exit(0);
  };

  process.once("SIGINT", () => void dispose());
  process.once("SIGTERM", () => void dispose());
  await new Promise(() => {});
}
