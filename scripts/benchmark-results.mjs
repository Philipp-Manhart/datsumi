import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { QueryResultsStore } from "../apps/extension/src/results/QueryResultsStore.ts";

const results = [];
for (const [name, count, width, value] of [
  ["long", 12001, 3, "value"],
  ["wide", 5000, 80, "value"],
  ["json", 1000, 8, JSON.stringify({ nested: { text: "x".repeat(1000), items: [1, 2, 3] } })],
]) {
  const store = new QueryResultsStore();
  const data = {
    kind: "table",
    columns: Array.from({ length: width }, (_, i) => `column_${i}`),
    rows: Array.from({ length: count }, (_, row) =>
      Array.from({ length: width }, (_, col) => (col ? `${value}${row}` : row)),
    ),
  };
  const before = process.memoryUsage().rss;
  const id = store.begin("fixture", "Synthetic data", "SELECT fixture");
  let start = performance.now();
  store.complete(id, data);
  const captureMs = performance.now() - start;
  start = performance.now();
  store.sort(id, { column: 0, direction: "desc" });
  const sortMs = performance.now() - start;
  start = performance.now();
  const copy = store.copy(
    id,
    data.columns.map((_, i) => i),
    true,
    "tsv",
  );
  results.push({
    name,
    rows: count,
    columns: width,
    captureMs: Math.round(captureMs),
    sortMs: Math.round(sortMs),
    copyMs: Math.round(performance.now() - start),
    clipboardBytes: Buffer.byteLength(copy),
    rssDeltaMiB: Math.round((process.memoryUsage().rss - before) / 1048576),
  });
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/result-benchmark.json",
  JSON.stringify(
    { runtime: process.version, platform: process.platform, arch: process.arch, results },
    null,
    2,
  ) + "\n",
);
console.table(results);
