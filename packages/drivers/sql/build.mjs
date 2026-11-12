/* oxlint-disable no-await-in-loop -- Build and collect each artifact and its dependency notices deterministically. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { writeLicenses } from "../../../scripts/licenses.mjs";
import { duckDbNativePlugin } from "../duckdb/build.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = new URL("../../../dist/drivers/", import.meta.url);
await mkdir(out, { recursive: true });
const catalog = [];
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
  const file = `${id}.cjs`;
  const result = await build({
    absWorkingDir: root,
    entryPoints: [
      `packages/drivers/${id === "duckdb" ? "duckdb" : id === "mongodb" || id === "redis" ? "nosql" : "sql"}/src/entry-${id}.ts`,
    ],
    outfile: fileURLToPath(new URL(file, out)),
    plugins: id === "duckdb" ? [duckDbNativePlugin] : [],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    minify: true,
    legalComments: "eof",
    metafile: true,
  });
  const bytes = await readFile(new URL(file, out));
  catalog.push({
    id,
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    nodeMajor: 22,
  });
  await writeLicenses(Object.keys(result.metafile.inputs), fileURLToPath(new URL(id, out)), root);
}
await writeFile(new URL("catalog.json", out), JSON.stringify(catalog, null, 2) + "\n");
console.log(
  catalog.map((item) => `${item.id}: ${(item.bytes / 1024 / 1024).toFixed(2)} MiB`).join("\n"),
);
