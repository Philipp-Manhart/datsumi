import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ConnectionProfile } from "@datsumi/core";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SqliteDriver, SqliteSession } from "./index";

const directory = mkdtempSync(join(tmpdir(), "datsumi-worker-"));
const path = join(directory, "sample.db");
const profile: ConnectionProfile = {
  id: "test",
  name: "test",
  driverId: "sqlite",
  family: "relational",
  configuration: { path, readOnly: false },
};
let driver: SqliteDriver;
beforeAll(async () => {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE test(id INTEGER PRIMARY KEY); INSERT INTO test VALUES (1)");
  db.close();
  const workerPath = join(directory, "worker.cjs");
  await build({
    entryPoints: [new URL("./worker.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: workerPath,
  });
  driver = new SqliteDriver(workerPath);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("SQLite worker driver", () => {
  it("connects, queries, browses and closes a real worker", async () => {
    const session = await driver.connect(profile, profile.configuration);
    try {
      expect(
        await driver.execute(session, { language: "sql", text: "SELECT * FROM test" }),
      ).toMatchObject({ rows: [[1]] });
      const resources = await driver.listResources(session);
      expect(
        await driver.browseTable(session, { resourceId: resources[0]!.id, offset: 0, limit: 100 }),
      ).toMatchObject({ hasMore: false, result: { rows: [[1]] } });
    } finally {
      await driver.disconnect(session);
    }
    expect(session.closed).toBe(true);
  });
  it("cancels an expensive query without blocking the main thread and rolls back", async () => {
    const session = await driver.connect(profile, profile.configuration);
    await driver.execute(session, { language: "sql", text: "BEGIN" });
    await driver.execute(session, { language: "sql", text: "INSERT INTO test VALUES (2)" });
    let cancel: () => void = () => {};
    const query = driver.execute(
      session,
      {
        language: "sql",
        text: "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n",
      },
      {
        isCancellationRequested: false,
        onCancellationRequested(listener) {
          cancel = listener;
          return { dispose() {} };
        },
      },
    );
    const outcome = query.catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 30));
    cancel();
    expect(await outcome).toBeInstanceOf(Error);
    expect(String(await outcome)).toMatch(/cancelled/i);
    await driver.disconnect(session);
    const next = await driver.connect(profile, profile.configuration);
    try {
      expect(
        await driver.execute(next, { language: "sql", text: "SELECT COUNT(*) FROM test" }),
      ).toMatchObject({ rows: [[1]] });
    } finally {
      await driver.disconnect(next);
    }
  });
  it("reports connection and SQL errors without hanging", async () => {
    await expect(driver.connect(profile, { path: join(directory, "missing.db") })).rejects.toThrow(
      /ENOENT/,
    );
    const session = await driver.connect(profile, profile.configuration);
    try {
      await expect(
        driver.execute(session, { language: "sql", text: "SELECT * FROM missing" }),
      ).rejects.toThrow("no such table");
      expect(await driver.execute(session, { language: "sql", text: "SELECT 1" })).toMatchObject({
        rows: [[1]],
      });
    } finally {
      await driver.disconnect(session);
    }
  });
});

it("does not forward parent tokens or Node preload configuration to SQLite workers", async () => {
  const path = join(directory, "environment-worker.cjs");
  const preload = join(directory, "private-preload.cjs");
  writeFileSync(preload, "globalThis.privatePreloadExecuted = true;");
  writeFileSync(
    path,
    `process.on('message', ({id}) => process.send({id, result: {token: process.env.DATSUMI_PRIVATE_TEST_TOKEN, options: process.env.NODE_OPTIONS, preload: globalThis.privatePreloadExecuted}})); process.on('disconnect', () => process.exit(0));`,
  );
  const previousToken = process.env.DATSUMI_PRIVATE_TEST_TOKEN;
  const previousOptions = process.env.NODE_OPTIONS;
  let session: SqliteSession;
  try {
    process.env.DATSUMI_PRIVATE_TEST_TOKEN = "environment-canary";
    process.env.NODE_OPTIONS = `--require=${preload}`;
    session = new SqliteSession(path, {});
  } finally {
    if (previousToken === undefined) delete process.env.DATSUMI_PRIVATE_TEST_TOKEN;
    else process.env.DATSUMI_PRIVATE_TEST_TOKEN = previousToken;
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
  }
  try {
    expect(await session.ready).toEqual({});
  } finally {
    await session.terminate();
  }
});
