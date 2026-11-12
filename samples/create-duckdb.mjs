import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { wideTableSql } from "./wide-table.mjs";

const require = createRequire(new URL("../packages/drivers/duckdb/package.json", import.meta.url));
const { DuckDBInstance } = require("@duckdb/node-api");
const path = fileURLToPath(new URL("./playground.duckdb", import.meta.url));
if (existsSync(path) && !process.argv.includes("--reset"))
  throw new Error(
    "Sample already exists. Disconnect it, then run bun run sample:duckdb --reset to recreate the sample schemas.",
  );
// Opening the existing file first acquires DuckDB's lock. Never unlink an open database.
const instance = await DuckDBInstance.create(path);
const connection = await instance.connect();
try {
  const result = await connection.run(`
    BEGIN;
    DROP SCHEMA IF EXISTS analytics CASCADE;
    DROP SCHEMA IF EXISTS demo CASCADE;
    CREATE SCHEMA demo;
    CREATE SCHEMA analytics;
    CREATE TABLE demo.customers(id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, email VARCHAR, plan VARCHAR, notes VARCHAR, created_at DATE);
    INSERT INTO demo.customers SELECT i::INTEGER,
      ['Alex Morgan','Sam Rivera','Jordan Lee','Amélie Dubois','José García','李明','Müller & Co.','Nora 🌱'][(i-1)%8+1],
      CASE WHEN i%17=0 THEN NULL ELSE 'customer'||i||'@example.com' END,
      ['free','pro','team'][(i-1)%3+1],
      CASE WHEN i%11=0 THEN NULL WHEN i%13=0 THEN '' ELSE 'Demo customer '||i END,
      DATE '2026-01-01'+(i%120)::INTEGER FROM range(1,376) t(i);
    CREATE TABLE demo.products(id INTEGER PRIMARY KEY, name VARCHAR, category VARCHAR, price DECIMAL(12,2), stock INTEGER);
    INSERT INTO demo.products SELECT i::INTEGER,'Product '||i,['hardware','software','accessories'][(i-1)%3+1],
      ((499+i*375)/100)::DECIMAL(12,2),(i*7%100)::INTEGER FROM range(1,33) t(i);
    CREATE TABLE demo.orders(id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES demo.customers(id),status VARCHAR,total DECIMAL(14,2),ordered_at TIMESTAMP);
    INSERT INTO demo.orders SELECT i::INTEGER,(i*17%375+1)::INTEGER,
      ['pending','paid','shipped','delivered','cancelled'][(i-1)%5+1],
      ((i*791%99999+100)/100)::DECIMAL(14,2),TIMESTAMP '2026-01-01'+i*INTERVAL '2 hours' FROM range(1,1201) t(i);
    CREATE TABLE demo.order_items(order_id INTEGER REFERENCES demo.orders(id),product_id INTEGER REFERENCES demo.products(id),quantity INTEGER,unit_price DECIMAL(12,2),PRIMARY KEY(order_id,product_id));
    INSERT INTO demo.order_items SELECT o.id,p.id,(o.id%4+1)::INTEGER,p.price FROM demo.orders o JOIN demo.products p ON p.id IN (o.id%32+1,(o.id+7)%32+1);
    CREATE TABLE demo.customer_tags(customer_id INTEGER REFERENCES demo.customers(id),tag VARCHAR,PRIMARY KEY(customer_id,tag));
    INSERT INTO demo.customer_tags SELECT id,CASE WHEN id%2=0 THEN 'returning' ELSE 'newsletter' END FROM demo.customers;
    CREATE TABLE demo."order notes"(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES demo.orders(id),"select" VARCHAR,"two words" VARCHAR);
    INSERT INTO demo."order notes" VALUES (1,1,'Quoted identifiers','Notes for the first order');
    CREATE TABLE demo.empty_table(id INTEGER PRIMARY KEY,description VARCHAR);
    CREATE TABLE demo.test_values(id INTEGER PRIMARY KEY,label VARCHAR,big_number HUGEINT,exact_decimal DECIMAL(38,9),score DOUBLE,bytes BLOB,tags VARCHAR[],profile STRUCT(active BOOLEAN,city VARCHAR));
    INSERT INTO demo.test_values VALUES
      (1,'exact values',170141183460469231731687303715884105727,12345678901234567890123456789.123456789,1.25,'\\x00\\xFF'::BLOB,['duckdb','analytics'],{'active':true,'city':'Berlin'}),
      (2,'null values',NULL,NULL,NULL,NULL,NULL,NULL),
      (3,'empty values',0,0,'Infinity'::DOUBLE,''::BLOB,[],{'active':false,'city':''}),
      (4,'Unicode 🌱',-9223372036854775808,-0.000000001,'NaN'::DOUBLE,'hello'::BLOB,['李明','José'],{'active':true,'city':'Zürich'});
    CREATE TABLE analytics.events AS SELECT i AS id,(i%375+1)::INTEGER AS customer_id,
      TIMESTAMP '2026-01-01'+i*INTERVAL '1 minute' AS occurred_at,
      ['page_view','signup','purchase'][(i-1)%3+1] AS event_type,
      {'source':CASE WHEN i%2=0 THEN 'web' ELSE 'mobile' END,'duration_ms':i%1000} AS payload,
      ['demo',CASE WHEN i%2=0 THEN 'desktop' ELSE 'phone' END] AS tags FROM range(1,10001) t(i);
    CREATE INDEX orders_customer_idx ON demo.orders(customer_id);
    CREATE VIEW demo.customer_summary AS SELECT c.id,c.name,c.plan,count(o.id) AS order_count,coalesce(sum(o.total),0)::DECIMAL(18,2) AS total_spent FROM demo.customers c LEFT JOIN demo.orders o ON o.customer_id=c.id GROUP BY c.id,c.name,c.plan;
    CREATE VIEW demo.low_stock_products AS SELECT * FROM demo.products WHERE stock<20;
    CREATE VIEW analytics.daily_revenue AS SELECT date_trunc('day',ordered_at) AS day,count(*) AS orders,sum(total) AS revenue FROM demo.orders WHERE status<>'cancelled' GROUP BY 1;
    ${wideTableSql("duckdb")}
    COMMIT;
    CHECKPOINT;
  `);
  result.closeSync();
  const check = await connection.runAndReadAll(`SELECT
    (SELECT count(*) FROM demo.customers)::INTEGER AS customers,
    (SELECT count(*) FROM demo.orders)::INTEGER AS orders,
    (SELECT count(*) FROM demo.order_items)::INTEGER AS items,
    (SELECT count(*) FROM analytics.events)::INTEGER AS events,
    (SELECT count(*) FROM demo.order_items i LEFT JOIN demo.orders o ON i.order_id=o.id LEFT JOIN demo.products p ON i.product_id=p.id WHERE o.id IS NULL OR p.id IS NULL)::INTEGER AS broken_links`);
  const [counts] = check.getRowsJson();
  check.closeSync();
  if (JSON.stringify(counts) !== JSON.stringify([375, 1200, 2400, 10000, 0]))
    throw new Error("DuckDB sample validation failed.");
  console.log(
    `Created ${path}\n10 tables, 3 views; demo.wide_table has 80 columns and 500 rows; 375 customers, 1,200 orders, 2,400 items, 10,000 events. Counts and foreign-key links verified.`,
  );
} finally {
  connection.closeSync();
  instance.closeSync();
}
