-- Open playground.sqlite using Datsumi: Open SQLite Database.
-- Select ONE statement below, then press Ctrl+Enter / Cmd+Enter.
-- Running this entire file is intentionally rejected: the extension runs one statement at a time.

-- 1. Basic results, sorting and filtering.
SELECT id, name, email, plan, is_active
FROM customers
WHERE plan = 'pro'
ORDER BY id
LIMIT 25;

-- 2. Relations, joins and aggregation (also available as sidebar views).
SELECT * FROM customer_summary ORDER BY total_spent DESC LIMIT 20;

SELECT * FROM order_details WHERE status = 'paid' ORDER BY ordered_at DESC LIMIT 50;

SELECT * FROM low_stock_products ORDER BY stock, id;

-- 3. Pagination: click orders in the sidebar, change page size, use Next/Previous.
-- This query returns 1,200 rows: page through the captured snapshot and click column headers to sort.
-- The capture cap is 10,000 rows (or 4 MiB); a SQL LIMIT still applies.
SELECT * FROM orders ORDER BY id;

-- 4. NULL, empty strings, Unicode, exact 64-bit integers, long text, binary and infinity.
SELECT * FROM test_values ORDER BY id;

-- 5. Duplicate column names must both remain visible.
SELECT c.id, o.id, c.name, o.status
FROM customers c JOIN orders o ON o.customer_id = c.id
ORDER BY o.id LIMIT 20;

-- 6. Composite primary keys and WITHOUT ROWID table browsing.
SELECT * FROM order_items ORDER BY order_id, product_id LIMIT 25;

-- 7. Quoted table and column names (click this table in the sidebar too).
SELECT id, "select", "two words" FROM "order ""notes""";

-- 8. Empty results and column headers without rows.
SELECT * FROM empty_table;

SELECT id, name FROM customers WHERE id = -1;

-- 9. Transaction test. Run each statement separately, in this order.
-- The note changes inside the transaction and returns to its original value after ROLLBACK.
SELECT id, notes FROM customers WHERE id = 1;

BEGIN;

UPDATE customers SET notes = 'Changed inside a test transaction' WHERE id = 1;

SELECT id, notes FROM customers WHERE id = 1;

ROLLBACK;

SELECT id, notes FROM customers WHERE id = 1;

-- 10. Write result / read-only enforcement.
-- In read/write mode: reports one affected row, leaving the value unchanged.
-- Open a second read-only connection and select it in the SQL status bar: this must fail.
UPDATE customers SET notes = notes WHERE id = 1;

-- Paging/sorting this captured write result must not execute the UPDATE again.
UPDATE customers SET notes = notes WHERE id <= 200 RETURNING id, notes;

-- 11. Expected error: missing table. A later valid query should still work.
SELECT * FROM intentionally_missing_table;

-- 12. Expected error: foreign-key enforcement; inserts nothing.
INSERT INTO orders (id, customer_id, status, total, ordered_at)
VALUES (50000, 999999, 'pending', 0, '2026-10-25T00:00:00.000Z');

-- 13. Optional cancellation test: this deliberately runs until you cancel it.
-- Run ONLY this statement, then use Cancel in the VS Code progress notification.
-- The connection closes; the next SELECT reconnects automatically.
WITH RECURSIVE forever(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM forever
)
SELECT MAX(n) FROM forever;

-- Run after cancellation to confirm reconnection.
SELECT 'Connection is working again' AS status, COUNT(*) AS customers FROM customers;
