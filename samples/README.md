# Sample databases

## Wide table for grid testing

Both local SQL samples include **80 columns and 500 rows** in `wide_table` (SQLite) and `demo.wide_table` (DuckDB). To add this table to existing sample files without resetting their other tables, run:

```sh
bun run sample:wide
```

Disconnect DuckDB first if it is open in Datsumi or another client. Use `--sqlite` or `--duckdb` to update just one sample. Existing wide tables and edits are preserved when rerunning this command. Newly generated SQLite/DuckDB samples include the table automatically.

Refresh the connection tree, open the table, and scroll horizontally to the last column, `segment_10`. The data includes numbers, dates, booleans, categories, Unicode, quotes, nulls, empty text, tabs and line breaks. Try resizing/reordering/hiding columns, sorting a far-right column, changing page size and copying all 500 rows into Excel. The query files begin with an unrestricted `SELECT *` so query-result pagination can also be exercised.

## MongoDB and Redis playgrounds

Start both local services and create their sample data:

```sh
bun run sample:nosql
```

This requires Docker with Compose and the repository dependencies (`bun install`). No MongoDB server, Redis server, `mongosh`, or `redis-cli` installation is needed on your machine. Services listen on localhost only and preserve their data in Docker volumes. These are disposable development services with the fixed sample password shown below.

In the extension, click **+**, select **MongoDB** or **Redis** in the connection form, choose **Connection URL**, and paste the matching URL:

| Database | URL                                                                                                     | Username                    | Password                    |
| -------- | ------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------- |
| MongoDB  | `mongodb://datsumi@127.0.0.1:27018/datsumi_playground?authSource=admin&tls=false&directConnection=true` | `datsumi` (included in URL) | `Datsumi_Sample_Only_2026!` |
| Redis    | `redis://default@127.0.0.1:6380/0`                                                                      | `default` (included in URL) | `Datsumi_Sample_Only_2026!` |

Enter the password in the same form. Leave **Read-only connection** unchecked to test reviewed editing, then click **Test Connection** or **Connect**. The extension separates credentials from the saved URL. You can add a second connection in **Read-only** mode to check that edits are unavailable there. TLS is disabled explicitly for these local containers.

**MongoDB:** expand the connection and open `customers`, `products`, `orders`, `events`, `edge_cases`, or `empty_collection`. There are 375 customers, 32 products, 1,200 orders and 1,000 events, with ObjectId references, nested objects/arrays, Unicode, null/empty values, dates, exact 64-bit integers, Decimal128 and binary values. `_datsumi_sample` is the generator's setup record. Browse customers to test Next/Back, and filter using a JSON object such as `{"plan":"pro","active":true}`. Use `edge_cases` to inspect BSON Extended JSON and long/nested values. Changes to existing documents support review and explicit confirmation; keep `_id` unchanged.

**Redis:** open **Keys** and search `datsumi:sample:*`. There are initially 387 keys: 375 customer hashes, JSON and plain text strings, empty/multiline/long text, binary data, a list, a set, a sorted set, a large hash, and an expiring session. Try `datsumi:sample:customer:*` for paging. Only complete strings and small hashes are editable; the binary string, collections and large hash demonstrate read-only inspection. TTL is shown in milliseconds. `datsumi:sample:session:expires` expires 24 hours after seeding; reset refreshes it. `datsumi:sample:__seed` is setup metadata.

To run examples, right-click the connection → **New Query**, paste the contents of any file in [mongodb](mongodb) or [redis](redis), then press **Ctrl+Enter / Cmd+Enter**. These editors accept JSON query descriptions, not Mongo shell expressions or Redis command lines. The MongoDB examples cover filters, projections, aggregation, customer/order lookups, BSON values, nested filters and empty results. Queries currently capture up to 100 MongoDB documents; use the collection browser to traverse all documents.

Existing data is preserved when you rerun the start command. To restore the original sample after editing:

```sh
bun run sample:nosql --reset
```

Reset recreates only the named MongoDB sample collections and Redis keys under `datsumi:sample:`. It does not drop the MongoDB database or run Redis `FLUSHDB`; unrelated collections and keys are preserved. If interrupted during setup, rerun with `--reset`.

You can manage either sample separately, or stop both while preserving data:

```sh
bun run sample:mongodb
bun run sample:redis
bun run sample:mongodb --reset
bun run sample:redis --reset
bun run sample:nosql:stop
```

If a sample port is occupied, set `DATSUMI_SAMPLE_MONGO_PORT` and/or `DATSUMI_SAMPLE_REDIS_PORT` when starting the generator and use those ports in the connection URLs. The Compose project is `datsumi-playground`; its definitions are in [nosql-compose.yml](nosql-compose.yml).

## DuckDB playground

Open **playground.duckdb** through **Datsumi: Add Database Connection → DuckDB → Open existing database**. Open **duckdb-queries.sql**, choose the DuckDB connection in the status bar, and run statements with Ctrl+Enter / Cmd+Enter.

The disposable database contains 10 tables and 3 views across `demo` and `analytics`: 375 customers, 32 products, 1,200 orders, 2,400 order items, customer tags, quoted column/table names, an empty table, exact HUGEINT/DECIMAL values, blobs, Unicode, nested STRUCT/LIST values, and 10,000 analytics events. Foreign keys populate the relationship diagram; order/event tables support paging, filters and sorting. DuckDB grid editing remains disabled; the query file includes an SQL UPDATE followed by ROLLBACK.

Create the sample with `bun run sample:duckdb`. If it already exists, disconnect it and run `bun run sample:duckdb --reset`. Reset acquires DuckDB's file lock and recreates only the `demo` and `analytics` sample schemas, without unlinking an open database. Counts and foreign-key links are checked before reporting success. The generator requires the repository dependencies (`bun install`) and uses the pinned official DuckDB Node client.

Run several example queries, expand the initially collapsed **Query History** section beneath Connections, and select an entry to reopen it. Each entry identifies its original database; hover for time, duration, status, counts and complete SQL. Opening history never reruns a query.

## SQLite playground

Open **playground.sqlite** through **Datsumi: Add Database Connection → SQLite**. Start in read/write mode, expand its tables and views, and click **orders** to try pagination with 1,200 rows.

Normal runs reuse the active unpinned result in the bottom panel. Pin a result to preserve it, or use **Run Query in New Result** (Ctrl/Cmd+Alt+Enter) for a separate tab. Run a few different statements, switch between their results, change the page size, and click a column header to cycle ascending, descending, and original order. Each tab remembers its own page and sort. Results are captured snapshots, so paging and sorting do not rerun SQL.

Open **queries.sql** in VS Code. Place the cursor inside a statement (or select one explicitly) and press **Ctrl+Enter / Cmd+Enter**. It includes joins, views, filtering, duplicate column names, empty results, writes, transaction rollback, expected SQL/foreign-key errors, and an optional long-running query to cancel. Read the comments before the transaction and cancellation examples.

The database contains:

- `customers`: 375 customers with names in several scripts, optional emails, NULL and empty notes.
- `products`: 32 products with decimal prices, categories and stock levels.
- `orders`: 1,200 orders linked to customers.
- `order_items`: 2,400 items with a composite primary key in a WITHOUT ROWID table.
- `customer_tags`: 450 tags, also using a composite primary key.
- `test_values`: NULLs, empty strings/blobs, Unicode, HTML as text, signed 64-bit integers, multiline/long text, a 2,048-byte blob, and infinity.
- `order "notes"`: a quoted table name and reserved/spaced column names.
- `empty_table`: an empty table for the zero-row state.
- Views: `customer_summary`, `order_details`, and `low_stock_products`.

To test connection selection and read-only enforcement, open the same file again in read-only mode. Use the database status bar item to choose between the two connections. The no-op UPDATE in `queries.sql` succeeds on the writable connection and fails on the read-only connection. Reload VS Code to check saved connections; disconnect and rerun a query to check reconnection.

All names and emails are fictional. The database is disposable, so you can edit it freely. To recreate the original data, first disconnect **all** connections to this sample, then run from the repository root:

```sh
bun run sample:db --reset
```

To create it if it does not exist:

```sh
bun run sample:db
```

The generator uses Node's built-in SQLite module (Node.js 22.18+); it checks database integrity and foreign keys before reporting success. Generated database files and sidecars are ignored by Git; the generator and SQL examples are kept as source.

## Workbench checks

- Open **orders**, add a `status = paid` filter, sort by `total`, change pages, and inspect a row. Follow its customer, or open **customers** and follow incoming orders.
- Choose **View Relationships** on **orders**. Highlight the `customer_id` relationship, expand **order_items** to reveal **products**, move cards, and use Fit.
- Edit a customer's notes, review the SQL, then discard. Repeat and apply; duplicate a row with a new unique email or add a row. Use **Exact integer** when editing 64-bit values.
- Export a filtered table as CSV/JSON. Export query results separately to check snapshot scope labels.
- Create a small CSV with `name,email` headers, import into **customers**, review the column mapping and SQL, then apply or discard.
- Open **test_values** and inspect JSON, NULLs, long text, and blobs. Use **Open complete value** for previews. Rows containing previewed originals require SQL for edits.
- Run two statements from **queries.sql** using the cursor, reopen one through **Query History**, and use **Explain Query** on a SELECT.
