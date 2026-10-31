import { resolve } from "node:path";

import type { ConnectionProfile } from "@datsumi/core";
import type { ServerSession } from "@datsumi/driver-sql";
import { MongoClient, BSON } from "mongodb";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NoSqlDriverAdapter } from "../src/index";
const password = "Datsumi_Test_Only_2026";
const mongoEndpoint = `mongodb://127.0.0.1:${process.env.DATSUMI_TEST_MONGODB_PORT}/datsumi?tls=false&authSource=admin`;
const redisEndpoint = `redis://127.0.0.1:${process.env.DATSUMI_TEST_REDIS_PORT}/0`;
const driver = (id: "mongodb" | "redis") =>
  new NoSqlDriverAdapter(id, async () => resolve(`dist/drivers/${id}.cjs`));
const profile = (id: string): ConnectionProfile => ({
  id: "fixture",
  name: id,
  driverId: id,
  family: id === "mongodb" ? "document" : "key-value",
  configuration: {},
});
const mongo = driver("mongodb"),
  redis = driver("redis");
let ms: ServerSession, rs: ServerSession;
const seedMongo = new MongoClient(mongoEndpoint, { auth: { username: "datsumi", password } });
const seedRedis = createClient({ url: redisEndpoint, password });
beforeAll(async () => {
  await seedMongo.connect();
  await seedRedis.connect();
  await seedMongo
    .db()
    .collection("records")
    .insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        _id: new BSON.ObjectId(),
        name: `record${i}`,
        exact: BSON.Long.fromString("9223372036854775807"),
        amount: BSON.Decimal128.fromString("123456789.123456789"),
        when: new Date("2026-01-01"),
        nested: { x: i },
      })),
    );
  await seedRedis.set("fixture:string", "original", { PX: 60000 });
  await seedRedis.hSet("fixture:hash", { a: "one", b: "two" });
  await seedRedis.pExpire("fixture:hash", 60000);
  await seedRedis.rPush("fixture:list", ["a", "b"]);
  await seedRedis.sAdd("fixture:set", ["alpha", "beta"]);
  await seedRedis.zAdd("fixture:zset", [
    { value: "leader", score: 1.5 },
    { value: "runner-up", score: 2.5 },
  ]);
  await seedRedis.set("fixture:binary", Buffer.from([0, 255]));
  ms = await mongo.connect(profile("mongodb"), {
    endpoint: mongoEndpoint,
    username: "datsumi",
    readOnly: false,
    password,
  });
  rs = await redis.connect(profile("redis"), {
    endpoint: redisEndpoint,
    username: "",
    readOnly: false,
    password,
  });
});
afterAll(async () => {
  await Promise.allSettled([
    ms && mongo.disconnect(ms),
    rs && redis.disconnect(rs),
    seedMongo.close(),
    seedRedis.isOpen ? seedRedis.quit() : Promise.resolve(),
  ]);
});
describe("MongoDB worker", () => {
  it("browses collections and preserves BSON types", async () => {
    expect((await mongo.listResources(ms)).some((r) => r.id === "records")).toBe(true);
    const page = await mongo.browseData(ms, { resource: "records", limit: 2 });
    expect(page.records).toHaveLength(2);
    expect(page.cursor).toBeTruthy();
    expect(page.records[0]!.text).toContain('"$numberLong":"9223372036854775807"');
    expect(page.records[0]!.text).toContain('"$numberDecimal"');
    expect(page.records[0]!.text).toContain('"$date"');
    const next = await mongo.browseData(ms, {
      resource: "records",
      limit: 2,
      cursor: page.cursor!,
    });
    expect(next.records[0]!.id).not.toBe(page.records[0]!.id);
  });
  it("reviews without writes, commits optimistically, and rejects stale edits", async () => {
    const record = (await mongo.browseData(ms, { resource: "records", limit: 1 })).records[0]!;
    const doc = BSON.EJSON.parse(record.text, { relaxed: false });
    doc.name = "edited";
    const text = BSON.EJSON.stringify(doc, { relaxed: false });
    const request = { resource: "records", id: record.id, original: record.text, text };
    await mongo.changeData(ms, request, false);
    expect((await mongo.browseData(ms, { resource: "records", limit: 1 })).records[0]!.text).toBe(
      record.text,
    );
    await mongo.changeData(ms, request, true);
    await expect(mongo.changeData(ms, request, true)).rejects.toThrow("changed");
  });
  it("rejects identity changes and executable/write pipelines", async () => {
    const record = (await mongo.browseData(ms, { resource: "records", limit: 1 })).records[0]!;
    await expect(
      mongo.changeData(
        ms,
        { resource: "records", id: record.id, original: record.text, text: '{"_id":"different"}' },
        true,
      ),
    ).rejects.toThrow("identity");
    for (const text of [
      '{"collection":"records","filter":{"$where":"return true"}}',
      '{"collection":"records","pipeline":[{"$out":"bad"}]}',
    ])
      await expect(mongo.execute(ms, { language: "custom", text })).rejects.toThrow("unavailable");
  });
  it("runs bounded find and aggregation requests without JS evaluation", async () => {
    const a = await mongo.execute(ms, {
      language: "custom",
      text: '{"collection":"records","filter":{},"sort":{"name":1}}',
    });
    expect(a.kind).toBe("value");
    const b = await mongo.execute(ms, {
      language: "custom",
      text: '{"collection":"records","pipeline":[{"$match":{}}]}',
    });
    expect(b.kind).toBe("value");
  });
  it("enforces read-only mode and redacts authentication failures", async () => {
    const session = await mongo.connect(profile("mongodb"), {
      endpoint: mongoEndpoint,
      username: "datsumi",
      readOnly: true,
      password,
    });
    try {
      await expect(
        mongo.changeData(
          session,
          { resource: "records", id: "x", original: "{}", text: "{}" },
          true,
        ),
      ).rejects.toThrow("read-only");
    } finally {
      await mongo.disconnect(session);
    }
    await expect(
      mongo.connect(profile("mongodb"), {
        endpoint: mongoEndpoint,
        username: "datsumi",
        readOnly: false,
        password: "secret-bad",
      }),
    ).rejects.not.toThrow("secret-bad");
  });
});
describe("Redis worker", () => {
  it("scans keys and inspects typed values", async () => {
    const page = await redis.browseData(rs, { resource: "keys", filter: "fixture:*", limit: 100 });
    expect(page.records.some((r) => r.type === "string")).toBe(true);
    expect(page.records.some((r) => r.type === "hash")).toBe(true);
    expect(page.records.find((r) => r.type === "list")?.editable).toBe(false);
  });
  it("preserves list, set, sorted-set and binary values in read-only previews", async () => {
    const page = await redis.browseData(rs, { resource: "keys", filter: "fixture:*", limit: 100 });
    const records = new Map(page.records.map((record) => [record.id, record]));
    expect(JSON.parse(records.get("fixture:list")!.text)).toEqual({
      length: 2,
      first100: ["a", "b"],
    });
    const set = JSON.parse(records.get("fixture:set")!.text);
    expect(set.size).toBe(2);
    expect(set.scan.members.sort()).toEqual(["alpha", "beta"]);
    expect(JSON.parse(records.get("fixture:zset")!.text)).toEqual({
      size: 2,
      first100: [
        { value: "leader", score: 1.5 },
        { value: "runner-up", score: 2.5 },
      ],
    });
    for (const type of ["list", "set", "zset", "binary"])
      expect(records.get(`fixture:${type}`)?.editable).toBe(false);
    expect(records.get("fixture:binary")!.text).toContain("00ff");
  });
  it("reviews and atomically edits strings preserving TTL", async () => {
    const record = (
      await redis.browseData(rs, { resource: "keys", filter: "fixture:string", limit: 100 })
    ).records[0]!;
    const before = await seedRedis.pTTL(record.id);
    const request = { resource: "keys", id: record.id, original: record.text, text: "changed" };
    await redis.changeData(rs, request, false);
    expect(await seedRedis.get(record.id)).toBe("original");
    await redis.changeData(rs, request, true);
    expect(await seedRedis.get(record.id)).toBe("changed");
    const after = await seedRedis.pTTL(record.id);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    await expect(redis.changeData(rs, request, true)).rejects.toThrow("changed");
  });
  it("atomically edits hashes and preserves TTL", async () => {
    const record = (
      await redis.browseData(rs, { resource: "keys", filter: "fixture:hash", limit: 100 })
    ).records[0]!;
    await redis.changeData(
      rs,
      { resource: "keys", id: record.id, original: record.text, text: '{"a":"new","c":"three"}' },
      true,
    );
    expect(await seedRedis.hGetAll(record.id)).toEqual({ a: "new", c: "three" });
    expect(await seedRedis.pTTL(record.id)).toBeGreaterThan(0);
  });
  it("checks all hash write permissions before changing any fields", async () => {
    await seedRedis.hSet("fixture:acl", { a: "original", b: "must-remain" });
    await seedRedis.aclSetUser("limited", [
      "on",
      ">limited-secret",
      "~fixture:*",
      "+@read",
      "+ping",
      "+eval",
      "+hset",
      "-hdel",
    ]);
    const session = await redis.connect(profile("redis"), {
      endpoint: redisEndpoint,
      username: "limited",
      readOnly: false,
      password: "limited-secret",
    });
    try {
      await expect(
        redis.changeData(
          session,
          {
            resource: "keys",
            id: "fixture:acl",
            original: '{"a":"original","b":"must-remain"}',
            text: '{"a":"changed"}',
          },
          true,
        ),
      ).rejects.toThrow("permission denied before writing");
      expect(await seedRedis.hGetAll("fixture:acl")).toEqual({ a: "original", b: "must-remain" });
    } finally {
      await redis.disconnect(session);
      await seedRedis.aclDelUser("limited");
    }
  });
  it("rejects expired keys and read-only changes", async () => {
    const request = { resource: "keys", id: "fixture:string", original: "changed", text: "retry" };
    await seedRedis.del(request.id);
    await expect(redis.changeData(rs, request, true)).rejects.toThrow("Only complete");
    const session = await redis.connect(profile("redis"), {
      endpoint: redisEndpoint,
      username: "",
      readOnly: true,
      password,
    });
    try {
      await expect(redis.changeData(session, request, true)).rejects.toThrow("unavailable");
    } finally {
      await redis.disconnect(session);
    }
  });
  it("bounds structured values before retrieving their contents", async () => {
    await seedRedis.hSet("fixture:large-hash", { large: "x".repeat(1024 * 1024 + 1) });
    const page = await redis.browseData(rs, {
      resource: "keys",
      filter: "fixture:large-hash",
      limit: 100,
    });
    expect(page.records[0]!.editable).toBe(false);
    expect(page.records[0]!.text).toContain("inspection is limited");
  });
  it("limits large values and rejects bad authentication without leaking it", async () => {
    await seedRedis.set("fixture:large", "x".repeat(1024 * 1024 + 1));
    const page = await redis.browseData(rs, {
      resource: "keys",
      filter: "fixture:large",
      limit: 100,
    });
    expect(page.records[0]!.editable).toBe(false);
    expect(page.records[0]!.text.length).toBeLessThan(1000);
    await expect(
      redis.connect(profile("redis"), {
        endpoint: redisEndpoint,
        username: "",
        readOnly: false,
        password: "secret-bad",
      }),
    ).rejects.not.toThrow("secret-bad");
  });
});
