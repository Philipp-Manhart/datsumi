import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("./playground.sqlite", import.meta.url));
if (existsSync(path)) {
  if (!process.argv.includes("--reset"))
    throw new Error(
      "Sample already exists. Disconnect it in VS Code, then run bun run sample:db --reset to recreate it.",
    );
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(path + suffix)) unlinkSync(path + suffix);
  }
}

const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
const names = [
  "Alex Morgan",
  "Sam Rivera",
  "Jordan Lee",
  "Casey Chen",
  "Taylor Kim",
  "Amélie Dubois",
  "José García",
  "李明",
  "Müller & Co.",
  "Nora 🌱",
];
const plans = ["free", "pro", "team"];
const prices = Array.from({ length: 32 }, (_, i) => (499 + i * 375) / 100);
function date(day) {
  return new Date(Date.UTC(2026, 0, 1 + day)).toISOString();
}
try {
  database.exec(`
    BEGIN;
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      plan TEXT NOT NULL CHECK(plan IN ('free', 'pro', 'team')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL CHECK(price >= 0),
      stock INTEGER NOT NULL CHECK(stock >= 0)
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
      total REAL NOT NULL DEFAULT 0,
      ordered_at TEXT NOT NULL
    );
    CREATE TABLE order_items (
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL,
      PRIMARY KEY (order_id, product_id)
    ) WITHOUT ROWID;
    CREATE TABLE customer_tags (
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      tag TEXT NOT NULL,
      PRIMARY KEY (customer_id, tag)
    ) WITHOUT ROWID;
    CREATE TABLE test_values (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      integer_value INTEGER,
      real_value REAL,
      text_value TEXT,
      blob_value BLOB
    );
    CREATE TABLE "order ""notes""" (
      id INTEGER PRIMARY KEY,
      "select" TEXT NOT NULL,
      "two words" TEXT
    );
    CREATE TABLE empty_table (id INTEGER PRIMARY KEY, description TEXT);
    CREATE INDEX idx_orders_customer_date ON orders(customer_id, ordered_at);
    CREATE INDEX idx_orders_status ON orders(status);
    CREATE VIEW customer_summary AS
      SELECT c.id, c.name, c.plan, COUNT(o.id) AS order_count,
             ROUND(COALESCE(SUM(o.total), 0), 2) AS total_spent
      FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
      GROUP BY c.id;
    CREATE VIEW order_details AS
      SELECT o.id, c.name AS customer, c.email, o.status, o.total, o.ordered_at
      FROM orders o JOIN customers c ON c.id = o.customer_id;
    CREATE VIEW low_stock_products AS SELECT * FROM products WHERE stock < 10;
  `);
  const customer = database.prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?)");
  const tag = database.prepare("INSERT INTO customer_tags VALUES (?, ?)");
  for (let id = 1; id <= 375; id++) {
    customer.run(
      id,
      names[(id - 1) % names.length],
      id % 17 === 0 ? null : `customer${id}@example.com`,
      plans[(id - 1) % plans.length],
      id % 9 === 0 ? 0 : 1,
      id % 11 === 0 ? null : id % 13 === 0 ? "" : `Demo customer ${id}`,
      date(id % 250),
    );
    tag.run(id, id % 2 ? "newsletter" : "returning");
    if (id % 5 === 0) tag.run(id, "priority");
  }
  const product = database.prepare("INSERT INTO products VALUES (?, ?, ?, ?, ?)");
  for (let id = 1; id <= 32; id++)
    product.run(
      id,
      `Sample product ${id}`,
      ["office", "books", "accessories", "software"][(id - 1) % 4],
      prices[id - 1],
      (id * 7) % 60,
    );
  const order = database.prepare("INSERT INTO orders VALUES (?, ?, ?, 0, ?)");
  const item = database.prepare("INSERT INTO order_items VALUES (?, ?, ?, ?)");
  for (let id = 1; id <= 1200; id++) {
    order.run(
      id,
      ((id * 17) % 375) + 1,
      ["pending", "paid", "shipped", "delivered", "cancelled"][(id - 1) % 5],
      date(id % 290),
    );
    for (const offset of [0, 7]) {
      const productId = ((id + offset) % 32) + 1;
      item.run(id, productId, (id % 4) + 1, prices[productId - 1]);
    }
  }
  database.exec(
    "UPDATE orders SET total = (SELECT ROUND(SUM(quantity * unit_price), 2) FROM order_items WHERE order_id = orders.id)",
  );
  const value = database.prepare("INSERT INTO test_values VALUES (?, ?, ?, ?, ?, ?)");
  value.run(1, "NULL values", null, null, null, null);
  value.run(2, "Empty string and empty blob", 0, 0, "", Buffer.alloc(0));
  value.run(3, "Unicode and emoji", 42, 3.141592653589793, "Grüße · 日本語 · العربية · 🚀", null);
  value.run(
    4,
    "HTML renders as plain text",
    null,
    null,
    '<script>alert("sample")</script><b>Not bold</b>',
    null,
  );
  value.run(
    5,
    "Maximum signed 64-bit integer",
    9223372036854775807n,
    null,
    "Exact integer; should not round",
    null,
  );
  value.run(6, "Minimum signed 64-bit integer", -9223372036854775808n, null, null, null);
  value.run(7, "Integer beyond JavaScript safe range", 9007199254740993n, null, null, null);
  value.run(
    8,
    "Multiline text",
    null,
    null,
    "First line\nSecond line\twith a tab\nThird line",
    null,
  );
  value.run(
    9,
    "Long text preview",
    null,
    null,
    "This is intentionally long sample text. ".repeat(1200),
    null,
  );
  value.run(
    10,
    "Binary preview (2048 bytes)",
    null,
    null,
    null,
    Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256)),
  );
  value.run(11, "Positive infinity", null, Infinity, null, null);
  value.run(
    12,
    "Small negative decimal",
    -7,
    -0.000001,
    "   leading and trailing whitespace   ",
    null,
  );
  database
    .prepare('INSERT INTO "order ""notes""" VALUES (?, ?, ?)')
    .run(1, "Quoted table and reserved column", "SELECT quoting works");
  database.exec("COMMIT; ANALYZE;");
  const integrity = database.prepare("PRAGMA integrity_check").get();
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  if (integrity.integrity_check !== "ok" || foreignKeys.length)
    throw new Error("Sample database validation failed.");
  console.log(`Created ${path}`);
  console.log(
    "8 tables, 3 views; 375 customers, 1,200 orders, 2,400 order items, and display edge cases.",
  );
} finally {
  database.close();
}
