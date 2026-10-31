/* oxlint-disable no-await-in-loop -- Build and collect each artifact and its dependency notices deterministically. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

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
  const notices = [];
  if (id === "duckdb") {
    notices.push(
      "@duckdb/node-api 1.5.6-r.2\n" +
        (await readFile(
          new URL("../duckdb/node_modules/@duckdb/node-api/LICENSE", import.meta.url),
          "utf8",
        )),
    );
  }
  if (id === "oracle") {
    for (const file of ["NOTICE.txt", "THIRD_PARTY_LICENSES.txt"])
      notices.push(
        `oracledb ${file}\n${await readFile(new URL(`./node_modules/oracledb/${file}`, import.meta.url), "utf8")}`,
      );
  }
  // Upstream 6.3.0 npm workspaces omit the monorepo root LICENSE; retain the pinned release copy.
  if (id === "redis")
    notices.push(
      "node-redis and @redis/* 6.3.0\n" +
        (await readFile(`${root}packages/drivers/nosql/notices/node-redis-6.3.0.LICENSE`, "utf8")),
    );
  // The serverless npm tarball omits the repository LICENSE. Pinned npm gitHead: d064d97544f940e7198e4635f8c9212bf80385a0.
  if (id === "turso")
    notices.push(
      "@tursodatabase/serverless 1.4.1\n" +
        (await readFile(
          `${root}packages/drivers/sql/notices/turso-serverless-1.4.1.LICENSE`,
          "utf8",
        )),
    );
  const seen = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    for (const name of [
      "LICENSE",
      "LICENSE.md",
      "LICENSE.txt",
      "license",
      "COPYING",
      "COPYING.LESSER",
    ]) {
      try {
        notices.push(`${match[2]}\n${await readFile(`${root}${match[1]}/${name}`, "utf8")}`);
      } catch {}
    }
  }
  await writeFile(new URL(`${id}.NOTICES.txt`, out), notices.join("\n\n---\n\n"));
}
await writeFile(new URL("catalog.json", out), JSON.stringify(catalog, null, 2) + "\n");
console.log(
  catalog.map((item) => `${item.id}: ${(item.bytes / 1024 / 1024).toFixed(2)} MiB`).join("\n"),
);
