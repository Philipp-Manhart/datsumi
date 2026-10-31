-- Add Database Connection → DuckDB → Open existing database → playground.duckdb.
-- Bind this SQL file to the DuckDB connection using the bottom status bar.
-- Run a statement with Ctrl+Enter / Cmd+Enter; select several statements to run together.

SELECT * FROM demo.customers ORDER BY id;
SELECT * FROM demo.orders ORDER BY ordered_at DESC;
SELECT * FROM demo.customer_summary ORDER BY total_spent DESC LIMIT 20;
SELECT * FROM analytics.daily_revenue ORDER BY day;

-- Nested STRUCT/LIST values: inspect a row and switch to JSON.
SELECT id, event_type, payload, tags FROM analytics.events LIMIT 100;
SELECT payload.source AS source, count(*) AS events,
       round(avg(payload.duration_ms), 2) AS average_duration_ms
FROM analytics.events GROUP BY source;

-- DuckDB QUALIFY and window functions: latest order for each customer.
SELECT id, customer_id, total, ordered_at
FROM demo.orders
QUALIFY row_number() OVER (PARTITION BY customer_id ORDER BY ordered_at DESC) = 1;

-- Exact HUGEINT/DECIMAL, NULL/empty values, blobs, nested data and Unicode.
SELECT * FROM demo.test_values ORDER BY id;
SELECT * FROM demo.empty_table;
SELECT "select", "two words" FROM demo."order notes";

-- Relationships and joins.
SELECT o.id, c.name, p.name AS product, i.quantity, i.unit_price
FROM demo.orders o JOIN demo.customers c ON c.id=o.customer_id
JOIN demo.order_items i ON i.order_id=o.id
JOIN demo.products p ON p.id=i.product_id
ORDER BY o.id LIMIT 100;

-- Harmless transaction example. Execute each line separately, ending with ROLLBACK.
BEGIN;
UPDATE demo.customers SET notes='Temporary staged SQL test' WHERE id=1;
SELECT id, name, notes FROM demo.customers WHERE id=1;
ROLLBACK;

-- Optional export (writes a file; replace with an absolute path on the extension host).
-- COPY analytics.events TO '/absolute/path/events.parquet' (FORMAT PARQUET);
-- SELECT * FROM read_parquet('/absolute/path/events.parquet') LIMIT 100;

-- Expected error: useful for testing history error status and SQL diagnostics.
-- SELECT * FROM demo.does_not_exist;
