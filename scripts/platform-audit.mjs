/* oxlint-disable no-await-in-loop -- Limit simultaneous native archive decompression to two platforms. */
import { readFile, mkdir, writeFile } from "node:fs/promises";

import { extractNativeArchive } from "../apps/extension/src/drivers/DuckDbNativeInstaller.ts";

const catalog = JSON.parse(
  await readFile(
    new URL("../packages/drivers/duckdb/native-catalog.json", import.meta.url),
    "utf8",
  ),
);
const results = [];
for (let offset = 0; offset < catalog.length; offset += 2) {
  const batch = await Promise.allSettled(
    catalog.slice(offset, offset + 2).map(async (artifact) => {
      const url = new URL(artifact.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "registry.npmjs.org" ||
        url.username ||
        url.password
      )
        throw new Error("Unexpected native artifact host.");
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body)
        throw new Error(`Native download failed for ${artifact.platform}`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > artifact.bytes) throw new Error("Native archive size exceeded its pin.");
        chunks.push(chunk);
      }
      const files = extractNativeArchive(artifact, Buffer.concat(chunks));
      const library = artifact.platform.startsWith("win32")
        ? "duckdb.dll"
        : artifact.platform.startsWith("darwin")
          ? "libduckdb.dylib"
          : "libduckdb.so";
      if (!files.has(library) || !files.has("duckdb.node") || !files.has("LICENSE"))
        throw new Error(`Incomplete platform payload: ${artifact.platform}`);
      return {
        platform: artifact.platform,
        archiveVerified: true,
        filesVerified: [...files.keys()],
        executedNativeBinary: false,
      };
    }),
  );
  for (const result of batch) {
    if (result.status === "rejected") throw result.reason;
    results.push(result.value);
    console.log("Verified native artifact:", result.value.platform);
  }
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/platform-audit.json",
  JSON.stringify(
    {
      host: process.platform + "-" + process.arch,
      scope:
        "Official archive integrity and contents verified. Foreign-platform native code is not executable on this host; runtime portability additionally relies on source/contract tests.",
      results,
    },
    null,
    2,
  ) + "\n",
);
