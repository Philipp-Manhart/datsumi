# Datsumi

A native VS Code database client with SQLite included and automatically prepared PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, libSQL, Turso, MongoDB and Redis drivers. Connections use the native sidebar, SQL uses normal editors, and query results appear beside Terminal in the bottom panel.

## Datsumi 0.1.0

The product, commands, settings and workspace packages use the Datsumi name. Its extension identifier is `philipp-manhart.datsumi`. Connections and secrets from earlier development extension identities are not migrated; re-add connections after installing this build.

## Getting started

Use the single **+** in the Connections toolbar or run **Datsumi: Add Database Connection**, then choose SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, libSQL, Turso, MongoDB or Redis. Verified TLS is the default, with an optional custom CA certificate.

Server support installs automatically when you choose a database. Version 0.1.0 includes all eleven optional driver artifacts for offline setup; no file picker, npm, compiler, separately installed Node.js, or additional extension is needed. Only the selected worker is cached and started. **Manage Database Support** reinstalls or removes cached drivers and offers a manual file recovery option. Size and SHA-256 checks against the extension's bundled catalog run before installation and loading. A configured user-level HTTPS download base URL is used automatically instead of bundled artifacts.

There is no public driver hosting endpoint configured yet. Release publishers can host the generated files at an HTTPS directory and configure **User Settings → Datsumi: Drivers: Download Base Url**. Workspace overrides and redirects are rejected; files must still match the catalog shipped with this extension. Offline installation works without that setting.

## libSQL and Turso (0.0.22)

Use **+ → libSQL** for remote libSQL databases (including existing Turso libSQL databases), or **+ → Turso** for the newer Turso engine. These are separate adapters using the official `@libsql/client/http` 0.18.0 and `@tursodatabase/serverless` 1.4.1 clients. Both workers are bundled for automatic setup and together add about 0.18 MiB of uncompressed JavaScript; no native client or npm is needed.

Enter a visible `libsql://…` or `https://…` database URL and put the database authentication token in the separate masked **Authentication token** field. `libsql://` uses verified HTTPS. Explicit `http://` is available for local development/self-hosted endpoints; its traffic is unencrypted. URLs containing credentials, query parameters or fragments are rejected. Choose session-only, secure VS Code storage, or ask-on-reconnect. Tokens are excluded from saved profiles and driver arguments; reconnect prompts identify them as authentication tokens.

Both adapters support native SQL editors, SQLite formatting/completions, multiple result sets, schema/foreign-key navigation, relationship diagrams, bound table filters, sorting/paging, full-value viewing, query history and CSV/JSON exports. Query results preserve duplicate labels, binary values and exact 64-bit integers. Full-result capture for clipboard is available within the existing 64 MiB capture limit. CSV exports preserve exact integers as decimal text; JSON exports represent exact integers as strings.

Use explicit SQL for writes; staged grid editing is disabled for these two adapters. Turso transaction state comes from the server. libSQL uses the client's dedicated interactive transaction stream for **BEGIN**, **BEGIN IMMEDIATE**, **COMMIT** and **ROLLBACK**; savepoints and EXCLUSIVE transactions are rejected rather than silently changing session semantics. Disconnect/cancellation closes the isolated worker and abandons any active transaction; verify interrupted writes before retrying.

This release connects to remote databases only. Embedded replicas/sync, local libSQL files, encryption-key configuration, built-in SSH, custom CA/client certificates and provider administration are not included for these adapters. For private deployments, use an HTTPS endpoint or VS Code Remote SSH. Tests exercise both official HTTP clients against an authenticated local libSQL server; hosted Turso accounts and the newer hosted engine require separate validation.

## Credentials

Passwords use native masked input. Choose **Remember for this session**, **Save securely**, or **Ask every time**. Saved passwords use VS Code SecretStorage and do not appear in profiles, results webviews, exports, driver process arguments, or environment variables. Destination/settings and execution environment must match before a saved password is reused. Secrets do not synchronize between machines.

Use **Change Database Credentials** or **Forget Saved Credentials** from the connection context menu. Forget disconnects and deletes the saved password. Remove Connection deletes the profile and its credential, without deleting database data. Storage failures never fall back to plaintext. Actual protection depends on VS Code's configured credential backend; Linux's basic fallback is weaker than an OS keyring. Remote database workers necessarily receive credentials in memory, so the remote host must be trusted.

## Daily workflows

- **Ctrl+Enter / Cmd+Enter** runs selected SQL or the statement at the cursor. PostgreSQL dollar-quoted bodies and SQL Server GO batch boundaries are recognized.
- Format SQL using the selected database dialect. Table/column/alias completion and common dialect functions use the SQL editor's selected connection. **Configure SQL Editor** repairs a conflicting SQL formatter setting.
- Retain up to ten result tabs. Rename, sort, search, and paginate each captured result without rerunning SQL. Captures are bounded at 10,000 rows and 4 MiB; oversized cells show previews.
- Browse schema-qualified tables with database-side filters, sorting, paging, column selection/copy, record inspection, and full-value viewing up to 8 MiB.
- Explore declared foreign keys in the relationship diagram and follow related rows. No inferred relationships or visual schema designer.
- Stage inserts, cell/row updates, duplicates, deletes, and CSV imports in writable primary-keyed table tabs. **Review SQL → Commit changes → native confirmation** applies an atomic batch with optimistic conflict checks. Existing explicit transactions remain open until COMMIT/ROLLBACK. MySQL/MariaDB grid editing requires InnoDB. Database permissions enforce SQL access.
- Export captured results or filtered tables as CSV/JSON. Full-table files replace the destination only after success. Server exports reject shortened/binary values rather than silently losing data; use server-native export for those cases.
- Open local Query History in the sidebar without executing entries. SQL can contain sensitive values: disable `datsumi.history.enabled` or clear history as needed.

## Fixes and grid keyboard controls (0.0.14)

DuckDB startup now detects Linux native-library compatibility without assuming a diagnostic-report header is available in the VS Code extension host. Both creating a database and opening an existing file are checked with the missing-report condition.

Click a result cell to focus the grid, then use:

- **Ctrl+A / Cmd+A** or the top-left **#** button: select all visible cells on the current page. The toolbar shows the selected row/column counts and page scope.
- **Ctrl+C / Cmd+C**: copy the selected rectangle as tab-separated values in the displayed column order, excluding hidden columns.
- **Arrow keys**, **Shift+Arrow**, **Home/End**, **Ctrl/Cmd+Home/End**, and **Page Up/Down**: move or extend the selection; **Ctrl/Cmd+Arrow** goes to an edge.
- **Tab / Shift+Tab**: move between cells; **Shift+Space** selects a row and **Ctrl/Cmd+Space** a column.
- **Enter / F2**: edit an editable cell, or inspect a read-only cell. Changes remain staged until review and confirmed commit. **Escape** collapses the selection to the active cell.

Search inputs and cell editors keep normal text-selection/copy shortcuts. Select-all covers the displayed page and does not fetch or select unseen database rows.

## Query History sidebar (0.0.13)

**Query History** is a native section beneath Connections in the Datsumi sidebar. It starts collapsed and updates automatically as queries finish. Expand it to see a newest-first list across all connections in the workspace. Each entry identifies its database and SQL; engine, execution time and duration appear alongside it, and hovering shows full SQL, status, captured/affected counts, and errors.

Select an entry to open it in a native editor bound to the original connection, without executing it. History retains its database label after a connection is removed; reopening still works, and execution requires explicitly choosing a replacement connection. The clock buttons focus this sidebar section. Its Search button opens searchable history across all connections; right-click an entry to copy, favorite or delete it. Clear removes retained history. Existing local retention and per-connection recording settings still apply (200 entries by default).

A DuckDB repository sample is available at `samples/playground.duckdb`, with example statements in `samples/duckdb-queries.sql`. Recreate it using `bun run sample:duckdb --reset` after disconnecting it. Use **Add Database Connection → DuckDB** to open it.

## Navigation in 0.0.12

- **Add a connection:** the single **+** in the Connections toolbar opens the database chooser for every supported engine. Separate SQLite/DuckDB open commands remain internal compatibility commands, hidden from the Command Palette and file menus.
- **Query History:** clock icon in the Connections toolbar or SQL editor toolbar, right-click a connection/SQL editor, or the Command Palette. Selecting history opens SQL without executing it; **Manage Query History…** contains favorites, filters, copying, saving and deletion.
- **Result tools:** **Inspect row** and a **More actions (…)** button above the grid. Copy, compare, edit, column visibility/order, import and export live in More actions and the grid's right-click menu. Shift+F10 opens the same menu with the keyboard; arrows navigate and Escape closes it. Right-clicking inside an existing range preserves that selection. Review/commit/discard remain visible while changes are staged.
- **Connection settings:** right-click a connection → **Connection Settings** for environment, history recording, and credentials. SQL editor context menus keep Run Query and Query History; **Database Tools** contains Explain Query and SQL Editor Settings. VS Code and other extensions control their own menu entries.
- Repeated table headers are removed; database context and Refresh appear in the footer. Result tabs and controls use VS Code Codicons and workbench theme tokens. Relationship diagrams retain dependency layers, center connected cards and route long links around intervening cards; **Auto-arrange** resets manual positions.

## DuckDB (new in 0.0.11)

Run **Datsumi: Add Database Connection** and choose **DuckDB**. Open an existing file, create a `.duckdb` file, or start an in-memory database. Existing files offer read/write or read-only access. No database password is required.

The first connection automatically downloads the matching official DuckDB **1.5.6-r.2 Node client** native package from the npm registry over HTTPS. No npm executable, compiler, or extra extension is needed. The extension pins the archive SHA-512 and each extracted file's SHA-256/size, verifies cached files before loading, and extracts only explicitly expected regular files. Later connections work offline. Native binaries are kept outside the VSIX in extension storage; initial download is approximately 13–35 MiB depending on platform. Linux (glibc/musl), macOS, and Windows x64/arm64 artifacts are provided; runtime integration is verified on Linux x64.

- Native SQL editors with DuckDB formatting, keyword/function/table/column completion, query history, multiple result tabs, and Explain.
- Browse tables/views in the current database with server-side paging, sorting, filters, schema definitions, indexes, and declared foreign-key diagrams. Attached catalogs and temporary tables can be queried through SQL; metadata navigation covers the current database.
- Query CSV and Parquet directly through `read_csv('/absolute/path/data.csv')` and `read_parquet('/absolute/path/data.parquet')`. Files are on the extension host when using SSH/WSL/containers.
- Large integers and decimals retain precision; nested lists/structs display as JSON, and blobs use bounded previews. Captures keep the existing 10,000-row / 4 MiB limits.
- Explicit SQL transactions, transaction-state display, and shared confirmed Commit/Rollback are supported. Cancellation closes the worker; reconnect never replays SQL. Uncommitted work is rolled back through DuckDB recovery.
- Grid editing is disabled for DuckDB in this release; use SQL for writes. Filtered table export supports complete scalar values and rejects shortened/binary values. Use DuckDB SQL `COPY` for richer exports.

In-memory data is lost on disconnect, cancellation, or reload. DuckDB file locks also apply: another process may prevent opening a file, particularly when it is already open for writing. Automatic DuckDB engine extension installation/loading is disabled; optional functionality such as JSON extensions requires explicit SQL `INSTALL`/`LOAD`. MotherDuck/cloud authentication is not included. Each worker uses a 512 MiB DuckDB memory limit and four query threads; the memory limit does not bound the entire process.

## New in 0.0.10

- Improved SQL assistance: foreign-key JOIN suggestions, schema/type hover, Go to Definition, and database-error diagnostics. Configure SQL Editor repairs SQL-specific settings without replacing formatters for other languages.
- Searchable local history with favorites, counts/status, retention controls, file saving, individual deletion, and per-connection opt-out.
- Fields/JSON/raw inspection, lossless JSON formatting, tree/path search, and native JSON diff editing. **Stage JSON Value** only stages; review and confirmed commit remain required.
- Shared transaction state with confirmed Commit/Rollback, plus explicit environment labels and production highlighting.
- Persistent column widths/order/visibility, filters, page size, saved SQL connection bindings, and diagram positions.
- Staged-edit undo/redo/individual-row revert, selected-row comparisons, and key-aligned captured-result diffs.
- Native Quick Open Database Object, favorites/recent objects, sidebar filters, and masked connection URL import with separated credentials.
- MongoDB collection browsing, canonical Extended JSON, filter/aggregation JSON query editors, cursor batches and reviewed conflict-checked document replacement. No evaluated JavaScript or write pipelines.
- Redis SCAN/key/type/TTL browsing, read-only collection previews, and reviewed atomic string/small-hash edits that preserve expiration. Hash editing needs Redis 7+; structured inspection requires MEMORY USAGE permission. Cluster/Sentinel and arbitrary Redis commands are excluded.

MongoDB/Redis are available through **Add Database Connection**. URLs use verified TLS for MongoDB by default and `rediss://` for Redis TLS. Local development can explicitly use MongoDB `?tls=false` or `redis://`. Read-only mode is the first NoSQL access option. Each edit applies one document/key after review and native confirmation; multi-record NoSQL transactions are not offered.

## Current limits

Database authentication currently uses username/password. Entra/OAuth, integrated Windows authentication and database client certificates are not configured by the form. Built-in SSH key/agent tunnels are supported. Drivers run in the workspace extension host, including SSH/WSL/containers; browser-only VS Code, virtual workspaces, and untrusted workspaces are unsupported.

Server query captures are read-only; use table tabs for staged editing. SQLite supports eligible complete single-table capture updates. Views, keyless rows, generated columns, shortened originals, and rows without complete primary keys cannot be edited. Staged drafts are lost on reload or closing their table tab.

SQL Server table browsing preserves decimals as strings. Raw high-precision DECIMAL/NUMERIC results require an explicit VARCHAR cast to avoid driver rounding. SQL Server query plans are not implemented; other server engines use ordinary EXPLAIN, without EXPLAIN ANALYZE. Server DDL displays are labeled structure summaries rather than authoritative dumps. MySQL/MariaDB run one statement at a time; PostgreSQL/SQL Server result sets use separate tabs within the ten-tab limit.

Each connection owns a serialized child-process session. Cancelling closes the session, fails its pending operations, and requires reconnection; server rollback takes effect when disconnection is detected. Never assume an interrupted write did not commit: verify state before retrying. Paged browsing and exports reflect current database contents and are not transactionally consistent snapshots.

This development extension is `philipp-manhart.datsumi`, separate from the unrelated Datsumi Marketplace extension.

## New database connections (0.0.20)

The Add Database Connection form includes ClickHouse and Oracle. Choose PostgreSQL and then the Neon or Supabase preset for those cloud services. ClickHouse/Oracle support query, browse/filter/sort/page and export; their grids are read-only. Oracle writes require COMMIT and roll back on disconnect; ClickHouse has no transaction support. The project README documents TLS, pooler, authentication and data-type limits.

## Built-in SSH (0.0.21)

Enable Connect via SSH in Add Database Connection. Enter the SSH host, port and user; choose an OpenSSH/PEM private key or leave the path empty for an SSH agent. Database Host/Port are reached from that SSH server. Host fingerprints require first-use verification and changed keys are rejected. Keys and passphrases are not saved in profiles. Test Connection, cancellation and disconnect clean up tunnels; reconnect starts a new tunnel without replaying SQL. Paths and agents are on the extension host. SSH passwords/MFA, jump chains and discovered MongoDB/Redis cluster topologies are outside the current scope.
