/* oxlint-disable no-await-in-loop -- Seed, verify and reset sample data sequentially on each service. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../packages/drivers/nosql/package.json", import.meta.url));
const { MongoClient, ObjectId, Decimal128, Long, Binary } = require("mongodb");
const { createClient } = require("redis");
const password = "Datsumi_Sample_Only_2026!";
const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (!["--reset", "--stop", "--mongodb", "--redis"].includes(arg))
    throw new Error(`Unknown argument: ${arg}`);
if (args.has("--reset") && args.has("--stop")) throw new Error("Choose --reset or --stop.");
const services =
  args.has("--mongodb") || args.has("--redis")
    ? ["mongodb", "redis"].filter((id) => args.has(`--${id}`))
    : ["mongodb", "redis"];
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${name}`);
  return value;
};
const mongoPort = port("DATSUMI_SAMPLE_MONGO_PORT", 27018),
  redisPort = port("DATSUMI_SAMPLE_REDIS_PORT", 6380);
const compose = [
  "compose",
  "-p",
  "datsumi-playground",
  "-f",
  fileURLToPath(new URL("./nosql-compose.yml", import.meta.url)),
];
const result = spawnSync(
  "docker",
  [
    ...compose,
    ...(args.has("--stop")
      ? ["stop", ...services]
      : ["up", "-d", "--wait", "--wait-timeout", "180", ...services]),
  ],
  { stdio: "inherit" },
);
if (result.error) throw new Error(`Docker Compose is required: ${result.error.message}`);
if (result.status !== 0)
  throw new Error(
    "Sample services could not start. Check Docker and whether the sample ports are available.",
  );
if (args.has("--stop")) {
  console.log("Sample services stopped. Data is preserved in Docker volumes.");
  process.exit(0);
}

const names = [
  "Alex Morgan",
  "Sam Rivera",
  "Jordan Lee",
  "Amélie Dubois",
  "José García",
  "李明",
  "Müller & Co.",
  "Nora 🌱",
];
const id = (n) => new ObjectId(n.toString(16).padStart(24, "0"));
const date = (n) => new Date(Date.UTC(2026, 0, 1 + n));
if (services.includes("mongodb")) {
  const endpoint = `mongodb://127.0.0.1:${mongoPort}/datsumi_playground?authSource=admin&tls=false&directConnection=true`;
  const client = new MongoClient(endpoint, {
    auth: { username: "datsumi", password },
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  try {
    const db = client.db("datsumi_playground");
    const marker = db.collection("_datsumi_sample");
    const existing = await marker.findOne({ _id: "seed" });
    if (existing && !args.has("--reset")) {
      if (existing.status !== "ready")
        throw new Error(
          "MongoDB sample setup was interrupted. Run bun run sample:mongodb --reset.",
        );
      console.log(
        "MongoDB sample already exists; edits were preserved. Use --reset to recreate it.",
      );
    } else {
      if (!existing && (await db.listCollections({}, { nameOnly: true }).toArray()).length)
        throw new Error(
          "MongoDB database datsumi_playground already contains unrelated data. Nothing was changed.",
        );
      await marker.updateOne(
        { _id: "seed" },
        { $set: { status: "seeding", version: 1 } },
        { upsert: true },
      );
      const counts = {
        customers: 375,
        products: 32,
        orders: 1200,
        events: 1000,
        edge_cases: 5,
        empty_collection: 0,
      };
      for (const collection of Object.keys(counts)) {
        if ((await db.listCollections({ name: collection }).toArray()).length)
          await db.collection(collection).drop();
        await db.createCollection(collection);
      }
      await db.collection("customers").insertMany(
        Array.from({ length: 375 }, (_, i) => ({
          _id: id(i + 1),
          name: names[i % names.length],
          email: i % 17 === 0 ? null : `customer${i + 1}@example.com`,
          plan: ["free", "pro", "team"][i % 3],
          active: i % 9 !== 0,
          tags: i % 2 ? ["returning", "newsletter"] : ["new"],
          address: {
            city: ["Berlin", "Lisbon", "東京", "Montréal"][i % 4],
            country: ["DE", "PT", "JP", "CA"][i % 4],
          },
          preferences: {
            theme: i % 2 ? "dark" : "light",
            notifications: { email: i % 3 !== 0, push: false },
          },
          notes: i % 11 === 0 ? null : i % 13 === 0 ? "" : `Demo customer ${i + 1}`,
          created_at: date(i % 100),
        })),
      );
      await db.collection("products").insertMany(
        Array.from({ length: 32 }, (_, i) => ({
          _id: id(i + 1),
          sku: `DEMO-${String(i + 1).padStart(3, "0")}`,
          name: `Sample product ${i + 1}`,
          category: ["books", "electronics", "home", "garden"][i % 4],
          price: Decimal128.fromString(((i + 1) * 12.35).toFixed(2)),
          stock: i % 5 === 0 ? 0 : 50 - i,
          attributes: { color: ["blue", "green", "red"][i % 3], sizes: ["S", "M", "L"] },
        })),
      );
      await db.collection("orders").insertMany(
        Array.from({ length: 1200 }, (_, i) => ({
          _id: id(i + 1),
          customer_id: id((i % 375) + 1),
          status: ["pending", "paid", "shipped", "delivered", "cancelled"][i % 5],
          total: Decimal128.fromString((((i % 100) + 1) * 23.47).toFixed(2)),
          ordered_at: date(i % 120),
          items: [
            {
              product_id: id((i % 32) + 1),
              quantity: (i % 3) + 1,
              unit_price: Decimal128.fromString("23.47"),
            },
          ],
          shipping: {
            method: i % 2 ? "express" : "standard",
            tracking: i % 3 ? `TRACK-${i + 1}` : null,
          },
        })),
      );
      await db.collection("events").insertMany(
        Array.from({ length: 1000 }, (_, i) => ({
          _id: id(i + 1),
          customer_id: id((i % 375) + 1),
          type: ["page_view", "checkout", "purchase"][i % 3],
          at: date(i % 100),
          context: {
            page: `/products/${(i % 32) + 1}`,
            device: { mobile: i % 2 === 0, browser: ["Firefox", "Chrome", "Safari"][i % 3] },
          },
          metrics: { duration_ms: i * 17, scroll_depth: i % 101 },
        })),
      );
      await db.collection("edge_cases").insertMany([
        {
          _id: "bson-types",
          exact_integer: Long.fromString("9007199254740993"),
          decimal: Decimal128.fromString("12345678901234567890.12"),
          binary: new Binary(Buffer.from([0, 255, 128, 10])),
          date: date(0),
          reference: id(1),
        },
        {
          _id: "empty-and-null",
          null_value: null,
          empty_string: "",
          empty_array: [],
          empty_object: {},
        },
        {
          _id: "unicode",
          text: "Hello · Grüß dich · こんにちは · 李明 · 🌱",
          multiline: "First line\nSecond line\twith a tab",
          html: "<script>This is plain text</script>",
        },
        {
          _id: "nested",
          profile: { settings: { notifications: { channels: ["email", "push"] } } },
          mixed_array: [1, "two", null, { three: true }],
        },
        {
          _id: "long-text",
          text: "Sample text 🌱 ".repeat(2000),
          description: "Long but complete editable document",
        },
      ]);
      await db.collection("customers").createIndex({ email: 1 });
      await db.collection("orders").createIndex({ customer_id: 1, ordered_at: -1 });
      await db.collection("events").createIndex({ "context.device.browser": 1 });
      for (const [collection, count] of Object.entries(counts))
        assert.equal(await db.collection(collection).countDocuments(), count, collection);
      assert.equal(
        (
          await db
            .collection("orders")
            .aggregate([
              {
                $lookup: {
                  from: "customers",
                  localField: "customer_id",
                  foreignField: "_id",
                  as: "customer",
                },
              },
              { $match: { customer: { $size: 0 } } },
              { $count: "missing" },
            ])
            .toArray()
        ).length,
        0,
        "Every order references a customer",
      );
      await marker.updateOne(
        { _id: "seed" },
        { $set: { status: "ready", created_at: new Date(), counts } },
      );
      console.log(
        "MongoDB verified: 375 customers, 32 products, 1,200 orders, 1,000 events, 5 edge-case documents and an empty collection.",
      );
    }
    console.log(
      `MongoDB URL: ${endpoint.replace("://", "://datsumi@")}\nUsername: datsumi\nPassword: ${password}`,
    );
  } finally {
    await client.close();
  }
}

if (services.includes("redis")) {
  const endpoint = `redis://127.0.0.1:${redisPort}/0`;
  const client = createClient({
    url: endpoint,
    password,
    socket: { connectTimeout: 10000, reconnectStrategy: false },
  });
  client.on("error", () => {});
  await client.connect();
  try {
    const prefix = "datsumi:sample:",
      marker = `${prefix}__seed`;
    const existing = await client.get(marker);
    if (existing && !args.has("--reset")) {
      if (JSON.parse(existing).status !== "ready")
        throw new Error("Redis sample setup was interrupted. Run bun run sample:redis --reset.");
      console.log(
        "Redis sample already exists; edits and expiry times were preserved. Use --reset to recreate it.",
      );
    } else {
      // SCAN only the sample namespace; never FLUSHDB or touch unrelated keys.
      const owned = new Set();
      for await (const keys of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 }))
        for (const key of keys) owned.add(key);
      if (!existing && owned.size)
        throw new Error(
          "Redis sample namespace already contains unrelated data. Nothing was changed.",
        );
      for (const key of owned) await client.del(key);
      await client.set(marker, JSON.stringify({ status: "seeding", version: 1 }));
      const transaction = client.multi();
      for (let i = 1; i <= 375; i++)
        transaction.hSet(`${prefix}customer:${String(i).padStart(3, "0")}`, {
          id: String(i),
          name: names[(i - 1) % names.length],
          plan: ["free", "pro", "team"][i % 3],
          active: i % 9 ? "true" : "false",
          email: `customer${i}@example.com`,
        });
      transaction.set(`${prefix}welcome`, "Hello from Datsumi · Grüß dich · こんにちは · 🌱");
      transaction.set(
        `${prefix}json`,
        JSON.stringify({
          customer: {
            id: 1,
            name: "Alex Morgan",
            preferences: { theme: "dark", notifications: ["email", "push"] },
          },
          tags: ["demo", "json"],
          nullable: null,
        }),
      );
      transaction.set(`${prefix}empty`, "");
      transaction.set(`${prefix}multiline`, "First line\nSecond line\twith a tab");
      transaction.set(`${prefix}long-text`, "Long sample text 🌱 ".repeat(2000));
      transaction.set(`${prefix}binary`, Buffer.from([0, 255, 128, 10, 0, 254]));
      transaction.set(
        `${prefix}session:expires`,
        JSON.stringify({ user_id: 1, authenticated: true }),
        { EX: 86400 },
      );
      transaction.lPush(
        `${prefix}queue:orders`,
        Array.from({ length: 250 }, (_, i) =>
          JSON.stringify({ order_id: i + 1, status: "pending" }),
        ),
      );
      transaction.sAdd(`${prefix}tags`, ["new", "returning", "newsletter", "日本語", "🌱"]);
      transaction.zAdd(
        `${prefix}leaderboard`,
        Array.from({ length: 150 }, (_, i) => ({
          score: (i + 1) * 137,
          value: `customer:${i + 1}`,
        })),
      );
      transaction.hSet(
        `${prefix}large-hash`,
        Object.fromEntries(
          Array.from({ length: 150 }, (_, i) => [`field_${i + 1}`, `value_${i + 1}`]),
        ),
      );
      await transaction.exec();
      assert.equal(await client.hGet(`${prefix}customer:001`, "name"), names[0]);
      assert.equal(await client.lLen(`${prefix}queue:orders`), 250);
      assert.equal(await client.sCard(`${prefix}tags`), 5);
      assert.equal(await client.zCard(`${prefix}leaderboard`), 150);
      assert.equal(await client.hLen(`${prefix}large-hash`), 150);
      assert.ok((await client.pTTL(`${prefix}session:expires`)) > 0);
      await client.set(
        marker,
        JSON.stringify({ status: "ready", version: 1, created_at: new Date().toISOString() }),
      );
      console.log(
        "Redis verified: 387 sample keys including customer hashes, JSON/text/binary strings, an expiring session, list, set, sorted set and large hash.",
      );
    }
    console.log(
      `Redis URL: ${endpoint.replace("://", "://default@")}\nUsername: default\nPassword: ${password}\nBrowse pattern: datsumi:sample:*`,
    );
  } finally {
    client.destroy();
  }
}
