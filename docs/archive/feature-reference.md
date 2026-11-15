# Feature reference

Detailed behavior from the development releases. For current safety/access rules and tested support, use the root README, settings guide and support matrix. Historical release notes below do not override those limits.

<img src="apps/extension/resources/datsumi.svg" width="80" height="80" alt="Datsumi layered D logo">

# Datsumi

Universal Database Explorer for VS Code

**Every database. One workspace.**

A modern, unified database client for VS Code. Explore, query, and manage SQL and NoSQL databases without leaving your editor.

Datsumi brings your databases together in one clean workspace inside Visual Studio Code. Browse tables, documents, and keys; run SQL and JSON-based queries; inspect relationships; and manage connections using native editors and a focused results panel.

Work with SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, MongoDB, Redis, libSQL, and Turso. Neon and Supabase use PostgreSQL connection presets. Features vary by adapter; the sections below describe their capabilities and limits.

**Less switching. More building.**

## libSQL and Turso (0.0.22)

Use **+ → libSQL** for remote libSQL databases (including existing Turso libSQL databases), or **+ → Turso** for the newer Turso engine. These are separate adapters using the official `@libsql/client/http` 0.18.0 and `@tursodatabase/serverless` 1.4.1 clients. Both workers are bundled for automatic setup and together add about 0.18 MiB of uncompressed JavaScript; no native client or npm is needed.

Enter a visible `libsql://…` or `https://…` database URL and put the database authentication token in the separate masked **Authentication token** field. `libsql://` uses verified HTTPS. Explicit `http://` is available for local development/self-hosted endpoints; its traffic is unencrypted. URLs containing credentials, query parameters or fragments are rejected. Choose session-only, secure VS Code storage, or ask-on-reconnect. Tokens are excluded from saved profiles and driver arguments; reconnect prompts identify them as authentication tokens.

Both adapters support native SQL editors, SQLite formatting/completions, multiple result sets, schema/foreign-key navigation, relationship diagrams, bound table filters, sorting/paging, full-value viewing, query history and CSV/JSON exports. Query results preserve duplicate labels, binary values and exact 64-bit integers. Full-result capture for clipboard is available within the existing 64 MiB capture limit. CSV exports preserve exact integers as decimal text; JSON exports represent exact integers as strings.

Writable primary-keyed tables support staged inserts, updates and deletes through **Review SQL → Commit changes → native confirmation**. Complete, unambiguous `SELECT *` captures also support staged cell updates. A conflict rolls back the whole batch. Finish any open SQL transaction before committing a grid batch on libSQL or Turso; nested savepoints are not supported by these adapters. Turso transaction state comes from the server. libSQL uses the client's dedicated interactive transaction stream for **BEGIN**, **BEGIN IMMEDIATE**, **COMMIT** and **ROLLBACK**; savepoints and EXCLUSIVE transactions are rejected rather than silently changing session semantics. Disconnect/cancellation closes the isolated worker and abandons any active transaction; verify interrupted writes before retrying.

This release connects to remote databases only. Embedded replicas/sync, local libSQL files, encryption-key configuration, built-in SSH, custom CA/client certificates and provider administration are not included for these adapters. For private deployments, use an HTTPS endpoint or VS Code Remote SSH. Tests exercise both official HTTP clients against an authenticated local libSQL server; hosted Turso accounts and the newer hosted engine require separate validation.

## Security

See the [security policy](SECURITY.md) and [pre-publication audit](security-audit.md) for protections, fixes and limits. The [brand guide](brand.md) documents the identity and reusable logo assets.

## Try it

```sh
bun install
bun dev
```

In VS Code, run **Terminal: Run Task → run:extension** to open an isolated Extension Development Host. You can also use **Debug Datsumi Extension** for breakpoints after building.

1. Click the single **+** in the Datsumi Connections toolbar or run **Datsumi: Add Database Connection**. Choose SQLite, DuckDB, or a server engine. For SQLite, select an existing database and choose read/write or read-only access.
2. Expand the saved connection to browse tables and views, then expand a table to inspect columns, types, primary keys, and nullability. Click a table or view to browse its rows.
3. Use **New SQL Query** from a connection or table's context menu. The query opens in a native SQL editor. A table query starts with a quoted `SELECT` statement.
4. Press **Ctrl+Enter** / **⌘Enter**, click the editor's Run button, or run **Datsumi: Run SQL Query**. The selection runs when present; otherwise the statement at the cursor runs, including statements in a script.
5. SQL results open in the **Query Results** panel alongside Terminal, Output, and Problems. Normal runs reuse the active unpinned result for the same connection, and the SQL editor keeps focus. Pin a result to preserve it, or use **Run Query in New Result** (**Ctrl/Cmd+Alt+Enter**) to create another tab (up to 10). Each result remembers its own page size, page position, and sort. Click a column header to cycle ascending, descending, and original order. Table browsing stays in editor tabs. Table browsing has Previous/Next, page size, and Refresh controls. The SQL editor status bar shows its database; click it to select another connection.

For a disposable database to explore, run `bun run sample:db` and open [samples/playground.sqlite](../samples/playground.sqlite). [Sample queries and testing instructions](../samples/README.md) cover the SQLite workflow.

For MongoDB and Redis sample servers, run `bun run sample:nosql`. Connection URLs, sample credentials, JSON query examples and reset commands are in [samples/README.md](../samples/README.md).

Connections are remembered per workspace using VS Code extension storage. Sessions reconnect lazily after a reload or disconnect. Browsing another database does not change an existing SQL editor's connection. **Remove Connection** removes the saved profile; it does not delete the database file.

## Neon, Supabase, ClickHouse and Oracle (0.0.20)

Open **+ → PostgreSQL → Connection preset** to choose **Neon** or **Supabase**, then paste the provider's PostgreSQL connection URL. Credentials move into separate fields and continue to use the existing session/SecretStorage choices. Verified TLS is required for these presets. A Neon URL's `channel_binding=require` is retained and fails closed if SCRAM-SHA-256-PLUS is not negotiated. Use a direct Neon hostname without `-pooler`. Supabase supports direct endpoints or its session pooler on port 5432; the session pooler is useful on IPv4-only networks. Transaction pooling on port 6543 is rejected because persistent editor sessions, temporary tables and transaction state would not be reliable. The presets reuse the PostgreSQL worker; no provider SDK or extra extension is installed. These are database connections, not provider control-plane integrations.

Choose **ClickHouse** directly in the same form. Use its HTTP(S) port, normally 8123 for explicitly unencrypted local development or 8443 for ClickHouse Cloud. HTTPS verifies server certificates, with an optional PEM CA. The official `@clickhouse/client` runs in an optional worker. Queries, metadata, bound filtering/sorting/paging, full query copying and CSV/JSON table export are supported. Grid editing, foreign keys and transactions are not offered. Avoid custom `FORMAT` clauses: results use `JSONCompactEachRowWithNamesAndTypes`. Results retain exact integer/decimal strings. Captures still have memory limits; exports read pages and are not consistent snapshots.

Choose **Oracle** directly, entering the **service name** in the Database field. The official `oracledb` driver uses Thin mode; Oracle Client libraries and native compilation are not needed. Verified TLS uses TCPS with hostname matching; explicitly disable TLS only when connecting to a local TCP listener. A custom PEM CA can be supplied. Password authentication is supported; mTLS wallets, external authentication and Thick mode are not configured by this form. Queries, current-schema tables/views/keys/relationships, bound filtering/sorting/paging, full values and export are supported. Writable primary-keyed tables support staged grid editing, including CLOB conflict checks and lossless timestamp comparisons. Query-plan visualization is not supported. DML remains pending until `COMMIT`; `ROLLBACK` or disconnect discards pending changes. Oracle DDL may commit implicitly. Run one SQL statement, select a complete PL/SQL block, or separate PL/SQL blocks with a standalone `/` line.

Oracle numbers are fetched as strings to preserve precision. Table browsing/export converts dates and timestamps on the server to preserve fractional seconds. Raw editor queries returning Oracle date/timestamp objects use JavaScript Date precision (milliseconds); select `TO_CHAR(your_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.FF9')` for full fractional precision. Large LOBs remain subject to capture/export limits.

Provider URL/TLS/pooler contracts are tested, and both presets are exercised against a real TLS-enabled PostgreSQL server. Live Neon/Supabase accounts were not used. ClickHouse and Oracle are tested against disposable real servers and in the native VS Code host. See [testing details](testing.md).

## Connect to a VPS through SSH (0.0.21)

In **Add Database Connection**, choose the server engine and enable **Connect via SSH**. Fill in the SSH host, port (normally 22), SSH user and private-key path. **Choose key…** opens a file picker; leave the path empty to use an SSH agent (`SSH_AUTH_SOCK`, or the Windows OpenSSH agent pipe). Encrypted OpenSSH/PEM keys prompt for a passphrase in a native masked dialog. Key contents and passphrases stay in memory; the profile saves only SSH destination settings and the key path. No external `ssh` command, npm installation or separate extension is needed.

The ordinary **Host/Port** fields describe the database as reached **from the SSH server**. If PostgreSQL runs on the same VPS and listens on loopback, use database host `127.0.0.1`, port `5432`; the SSH host remains your VPS's public hostname. SSH and database usernames/passwords are independent. A Docker database must be reachable from the SSH server, for example through a port published on the VPS loopback address. The SSH account must permit TCP forwarding.

The first connection shows the SSH server's SHA-256 host-key fingerprint. Verify it independently before **Trust and Connect**. Trusted fingerprints are pinned per host/port in extension-host global storage. A changed key is rejected. Use **Datsumi: Forget SSH Host Key** only after independently verifying a legitimate replacement; this closes matching connections and requires trust again. Hosts trusted by Test Connection are also listed even if no database profile was saved. The extension maintains its own trust store; it does not import OpenSSH `known_hosts` or automatically trust a scan.

Test Connection starts a real tunnel and database session, then closes both without saving a profile or database credentials. Connect retains one tunnel per database session. Disconnect, Remove Connection, extension shutdown, cancelled worker queries, failed connection attempts and cancelled form submissions close their resources. A lost SSH connection closes the database worker. Reconnection starts a fresh tunnel on the next operation; interrupted SQL is never automatically replayed. Sessions may lose temporary state and uncommitted transactions.

Database TLS is separate from SSH encryption. Verified TLS still checks the original database hostname through the tunnel. PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse and Redis preserve the TLS identity; Oracle TCPS uses a restricted local CONNECT proxy. Use a database hostname matching its certificate and reachable from the SSH host. If a database accepts plain TCP only on the VPS loopback interface, explicitly disabling database TLS can be appropriate: SSH encrypts the network hop, but the server-side TCP hop is not TLS-encrypted. Do not disable certificate checks to hide a hostname mismatch.

SSH settings, key paths and agents belong to the **VS Code extension host**. With Remote SSH, WSL or Dev Containers, those resources may be on the remote host rather than your laptop. SQLite and DuckDB files use VS Code Remote SSH instead of a database TCP tunnel.

Current SSH scope is one hop with key/agent authentication. SSH passwords, interactive MFA, ProxyJump chains, OpenSSH config aliases, PuTTY PPK keys and automatic private-key passphrase storage are not provided. MongoDB tunnels use a direct `mongodb://` member connection with discovery disabled; SRV/discovery URLs are rejected. Redis Cluster/Sentinel and multi-endpoint database redirects need a different networking arrangement, commonly a VPN or Remote SSH. Oracle TCPS proxy settings have unit/transport tests; the real Oracle Docker fixture uses TCP, so a full Oracle TCPS deployment remains unverified.

See [connection troubleshooting](connection-troubleshooting.md) for the other common connection hurdles.

## Server connections and optional drivers

Run **Datsumi: Add Database Connection** (the sidebar **+** button), select PostgreSQL, MySQL, MariaDB, or SQL Server, and enter host, port, database, and username. Verified TLS is the default; choose a custom CA certificate if necessary. Disabling TLS is an explicit local-development option. Passwords use a masked field in the connection form, with **Remember for this session**, **Save securely**, or **Ask every time**. Reconnecting can prompt for credentials when needed. No user-installed npm, Node.js, or compiler is needed.

The required server driver is prepared automatically when you select a database in **Add Database Connection**. This local release includes all eleven optional worker artifacts so setup also works offline, without npm, a separate Node installation, extra extensions, or selecting driver files. Only the selected worker is installed into the cache and started; including the artifacts increases the VSIX size, while only selected workers run. **Manage Database Support** reinstalls or removes cached drivers and retains an explicit **Install from driver file** recovery option. Connecting again automatically reinstalls removed support. Every installation and load checks its size and SHA-256 against the catalog shipped in the extension.

There is no public driver download endpoint configured in this local project. A release publisher can host the generated artifacts at an HTTPS directory and set **User Settings → Datsumi: Drivers: Download Base Url** to that directory. With this setting, missing drivers download automatically instead of using bundled copies; a failed download or integrity check reports an error. Workspace overrides are ignored; redirects and credential-bearing URLs are rejected. The server cannot replace the extension's pinned checksums. The same mechanism allows future releases to omit bundled workers once hosting is available. Driver caches live in VS Code global extension storage on the extension host, including SSH/WSL/containers.

Saved passwords use **VS Code SecretStorage**, separately from workspace connection profiles. Passwords are bound to the driver, destination/settings, and execution environment before reuse. Connection profiles, results webviews, driver command-line arguments, and exports never receive persisted password fields. **Change Database Credentials**, **Forget Saved Credentials**, and **Remove Connection** manage their lifecycle. Forget disconnects before deleting; removal deletes the credential and profile. Secure-storage failures are reported without a plaintext fallback. New session-only connections can work without a functioning keychain. Encryption strength depends on VS Code's configured OS credential backend; Linux's basic fallback is weaker. Stored secrets do not sync to other machines. The remote extension host necessarily receives credentials in memory when connecting to a remote database.

Server adapters use dedicated, serialized sessions so temporary tables, session settings, and explicit transactions survive between executions. Table tabs support schema-qualified browsing, filters, sorting, primary-keyed staged inserts/updates/deletes/imports, optimistic conflict checks, and atomic batches. Existing transactions use savepoints instead of being silently committed where supported. DuckDB, libSQL and Turso require finishing the open transaction before a grid batch. MySQL/MariaDB grid writes require InnoDB. Database permissions enforce SQL access; disabling grid edits is not a substitute for a read-only database account.

Server results use the same row/memory capture bounds as SQLite. PostgreSQL and SQL Server can return multiple result sets, shown in separate result tabs within the existing ten-tab capacity. MySQL/MariaDB execute one statement at a time. PostgreSQL dollar-quoted bodies and SQL Server **GO** batch boundaries are recognized when executing at the caret. SQL formatting follows the selected engine. Schema-aware table/column completion remains a local tolerant provider, not a complete dialect language server.

Current limits: password authentication only; Entra/OAuth, integrated Windows authentication and database client-certificate authentication are not implemented. Built-in SSH supports a key file or an SSH agent. Unambiguous complete `SELECT *` server captures support staged updates; use table tabs for inserts and deletes. Derived and ambiguous captures remain read-only. SQL Server query plans are not yet implemented. PostgreSQL/MySQL/MariaDB use ordinary EXPLAIN without executing EXPLAIN ANALYZE. Server DDL panels contain a labeled structure summary rather than an authoritative database dump. SQL Server table browsing preserves decimal values as strings; raw high-precision DECIMAL/NUMERIC results require a VARCHAR cast to avoid driver rounding. Server full-value viewing reads up to 8 MiB, including hex for binary values. Full-table server export fails rather than silently exporting shortened/binary values; use server-native export for those cases. Paged exports reflect current contents and are not a transactionally consistent database snapshot.

## Connection form and database views (0.0.17)

The single **+** opens one **Add Database Connection** form. Choose an engine, enter fields or paste a connection URL, select credential storage and access settings, then **Test Connection** or **Connect**. Connection URLs stay visible; pasted usernames/passwords are extracted into separate fields, with passwords masked. Errors stay in the same form without discarding inputs. SQLite and DuckDB use the same form with a file picker; DuckDB also offers creation and `:memory:`. Test Connection opens and closes a temporary server session without saving a profile or credentials. The file-based workflow opens/creates only when Connect is selected.

Relationship diagrams use Dagre's network-simplex layered layout with measured card heights, component packing and collision recovery for saved coordinates. Auto-arrange recalculates the layout. Legacy saved arrangements are reset once, and cards dragged into each other are separated. Declared foreign keys remain the source of relationship data.

MongoDB collections open in **Table** view with fields sampled from the current batch (up to 20 columns). ObjectIds, dates, exact integers and decimals display as readable values; raw canonical Extended JSON is preserved for copying and editing. Open a row to inspect/edit it, or choose **Documents**. Redis has a searchable key list, type filtering, readable expiry durations, and hash/list/set/sorted-set viewers. Search loaded keys filters the loaded batch; the pattern input and Next batch perform live SCAN. Existing review/confirmation/conflict checks still govern edits.

## Grid and editor polish (0.0.16)

- Right-click a column header or cell to **Freeze column**. Frozen columns move to the left and stay visible while scrolling. The **Columns** menu also has per-column pin controls. Widths, order, visibility and frozen columns are remembered.
- Double-click a column divider, or focus it and press Enter, to auto-size to the loaded page. The context menu also offers **Auto-size all columns**. Fitting is bounded to 640 px; manual resizing allows 80–2,000 px.
- **Copy with headers** and **Copy headers** are available directly in the result context menu. Frozen-column display order is preserved when copying.
- Normal runs reuse the active unpinned result from the same connection. The pin button beside the result title, or **Pin / Unpin Result** on right-click, preserves it. **Run Query in New Result** always creates a separate result; its shortcut is **Ctrl/Cmd+Alt+Enter**. Disable `datsumi.results.reuseTabs` to always create new results. Failed and completed runs replace only the selected eligible tab; busy results and pending edits are protected.
- The standard format shortcut runs **Format SQL** directly inside SQL editors: **Ctrl+Shift+I** on Linux and **Shift+Alt+F** on Windows/macOS. This avoids an inherited formatter taking over the shortcut. Native Format Document still uses the registered SQL formatter unless explicitly overridden in SQL settings; **SQL Editor Settings…** repairs that override.
- Keyword completion survives removed connections. Slow schema metadata has a 600 ms completion budget: SQL vocabulary remains available, while table/column suggestions become available on a subsequent request after metadata has loaded. This does not cancel the database session.

## Excel clipboard and grid keyboard controls (0.0.15)

DuckDB startup now detects Linux native-library compatibility without assuming a diagnostic-report header is available in the VS Code extension host. Both creating a database and opening an existing file are checked with the missing-report condition.

Click a result cell to focus the grid, then use:

- **Ctrl+A / Cmd+A** or the top-left **#** button: select every data row and column across all result pages.
- **Ctrl+Shift+A / Cmd+Shift+A**: select all data with column names, excluding types.
- **Ctrl+C / Cmd+C**: copy clean tab-separated data directly into Excel. Rectangles use visible display order; select-all includes hidden columns too. NULL values become empty cells; embedded tabs, line breaks, and quotes are escaped. Excel may apply its own date/number formatting or precision limits.
- **Arrow keys**, **Shift+Arrow**, **Home/End**, **Ctrl/Cmd+Home/End**, and **Page Up/Down**: move or extend the selection; **Ctrl/Cmd+Arrow** goes to an edge.
- **Tab / Shift+Tab**: move between cells; **Shift+Space** selects a row and **Ctrl/Cmd+Space** a column.
- **Enter / F2**: edit an editable cell, or inspect a read-only cell. Changes remain staged until review and confirmed commit. **Escape** collapses the selection to the active cell.

Search inputs and cell editors keep normal text-selection/copy shortcuts. SQL query execution retains full values and rows within a 64 MiB capture budget, while only the active page is sent to the grid. Copying never reruns the original SQL. Select-all follows result search/sort order across pages. Table browsers fetch all matching pages when copying, with cancellable progress; concurrent database changes can affect that live browse. Results that exceed the budget or contain shortened values produce an explicit error and leave the clipboard unchanged. Re-run queries captured with an older extension version to obtain complete results.

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
- Large integers and decimals retain precision; nested lists/structs display as JSON, and blobs use bounded previews. SQL query results retain full values and rows within a 64 MiB budget; metadata and table-page previews remain bounded.
- Explicit SQL transactions, transaction-state display, and shared confirmed Commit/Rollback are supported. Cancellation closes the worker; reconnect never replays SQL. Uncommitted work is rolled back through DuckDB recovery.
- Writable primary-keyed DuckDB tables support staged inserts, updates and deletes with review, native confirmation and atomic rollback on conflict. Finish open SQL transactions before committing a grid batch because DuckDB does not support nested savepoints. Filtered table export supports complete scalar values and rejects shortened/binary values. Use DuckDB SQL `COPY` for richer exports.

In-memory data is lost on disconnect, cancellation, or reload. DuckDB file locks also apply: another process may prevent opening a file, particularly when it is already open for writing. Automatic DuckDB engine extension installation/loading is disabled; optional functionality such as JSON extensions requires explicit SQL `INSTALL`/`LOAD`. MotherDuck/cloud authentication is not included. Each worker uses a 512 MiB DuckDB memory limit and four query threads; the memory limit does not bound the entire process.

## UX improvements in 0.0.10

- SQL completion now also offers declared foreign-key JOIN templates. Hover shows schema/type information; Go to Definition opens a read-only schema document. Database error positions/tokens appear as SQL diagnostics when the engine provides enough information. Completion remains a tolerant local provider, not a full SQL language server.
- The SQL status bar distinguishes autocommit, idle manual-commit mode, an open transaction, a failed transaction, and unknown state after disconnect. Click it to commit/roll back an open shared transaction, with confirmation. The action affects every editor using that connection. Set a development/staging/production environment label from the connection context menu; production uses both text and a status color.
- **Quick Open Database Object** (`Ctrl+Alt+P` / `Cmd+Alt+P`) searches the active connection's tables/views/collections, ranking favorites and recent objects. Object context menus toggle favorites; connection menus filter the sidebar. Saved SQL-file connection bindings survive closing/reopening and reload.
- Table and captured-result columns support saved widths/order/visibility; diagrams remember manual positions. These are view preferences, not persisted result data. Query captures and uncommitted edits remain in memory.
- **Inspect row** offers Fields, JSON, and Raw JSON. JSON cells have a searchable/collapsible tree with copy-path/value actions. Formatting preserves numeric literals rather than round-tripping them through JavaScript numbers. **Edit JSON** opens a native JSON diff; edit its right side, then **Stage JSON Value**, review SQL, and commit normally. It never writes on editor Save. Invalid JSON, generated fields, truncated originals, and stale source pages cannot be used for this action.
- **Undo edit**, **Redo edit**, and **Revert row** operate on staged SQL changes only. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y work while the grid is focused; the inline/native editor keeps its own undo behavior.
- **Compare selected rows** highlights differences within the current page. **Compare results** aligns retained captures by selected unique key columns and opens VS Code's diff viewer. Duplicate keys are rejected; row limits and preview cells mark a comparison incomplete. Comparisons never rerun queries.
- **Paste connection URL** in Add Database Connection accepts supported SQL/MongoDB/Redis URLs through a masked prompt, separates the password, and previews non-secret settings. Unknown or conflicting security options are rejected. TLS verification remains enabled for SQL unless explicitly disabled. MongoDB and Redis also offer a read-only connection option.

## MongoDB and Redis

Both engines use the same automatic verified worker installation and SecretStorage service as SQL, with dedicated collection/key browsing rather than a SQL table facade. Select either engine in **Add Database Connection** and paste a connection URL. For local fixtures use `mongodb://localhost:27017/mydb?tls=false` or `redis://localhost:6379/0`; hosted MongoDB uses verified TLS by default, including Atlas `mongodb+srv` URLs. Use `rediss://` for verified Redis TLS. Passwords are separated before profiles are saved. Initial support uses password authentication and system certificate authorities; custom NoSQL CAs, client certificates, Redis Cluster/Sentinel, and multi-database administration are not implemented.

MongoDB displays collections in the configured database, canonical Extended JSON documents, a Find filter, and bounded cursor batches. ObjectId, dates, Decimal128 and 64-bit values keep their BSON types. Existing documents can be edited as complete canonical Extended JSON, reviewed, and confirmed; replacement requires the complete original document to match and `_id` cannot change. There is no automatic multi-document transaction or insert/delete UI. Query editors use JSON requests, not evaluated JavaScript:

```json
{ "collection": "customers", "filter": { "active": true }, "sort": { "name": 1 } }
```

Alternatively supply `pipeline` instead of `filter`. Server-side JavaScript and write stages such as `$out`/`$merge` are rejected. Query captures stop at 100 documents/4 MiB; browsing stops before documents larger than 1 MiB. Inspectors have bounded tree previews; raw text remains available. Cursors are session-bound, with at most ten retained live cursors. Back/Next can traverse cached pages; refresh discards that local navigation cache.

Redis displays keys, type, millisecond TTL, and bounded values. Pattern searching uses incremental SCAN: batches can be empty, contain repeats, or reflect concurrent changes; this is not numbered snapshot pagination. Strings and small hashes support reviewed optimistic edits. Atomic string edits preserve TTL; hash edits check write permissions before modifying fields and preserve the existing key's expiration. Hash editing requires Redis 7+ ACL-check support and at most 100 string fields. Lists, sets and sorted sets are inspected read-only. Structured-value inspection requires MEMORY USAGE permission and is limited to 1 MiB; binary/oversized strings show read-only previews. Expired/stale values fail without overwriting the current key. There is no arbitrary Redis command execution or cluster administration. A JSON query request `{ "key": "session:123" }` inspects one key.

## SQL editing and result names

Rename a result tab by double-clicking it, pressing **F2** while it is focused, or choosing **Rename Tab…** from its right-click menu. Renaming preserves the captured rows, page, and sort. Result tabs and their names last until closed, disconnected, or VS Code reloads.

Use **Format SQL** in the editor toolbar or Command Palette, or native **Format Document** in the editor context menu. It formats the selection when present, otherwise the whole document, using the selected SQL dialect and the editor's indentation settings. Native **Format Document** and **Format Selection** also work. The extension supplies SQL-specific formatter and automatic-completion defaults, so an inherited global formatter such as OXC does not take over SQL. Existing explicit SQL overrides still take precedence; run **Datsumi: SQL Editor Settings…** to repair them for this workspace (or user settings when no workspace is open), or set `"[sql]": { "editor.defaultFormatter": "philipp-manhart.datsumi" }` in VS Code settings.

SQL IntelliSense uses the database selected in each editor's status bar. Type `FROM cu` to complete tables and views, or `c.` in `SELECT c. FROM customers c` to complete columns with their types. **Ctrl+Space** opens suggestions manually. Completion supports quoted identifiers, aliases, common CTE and derived-table projections, SQL keywords, and common SQLite functions with snippets and parameter hints. Formatting and SQL vocabulary work without a database connection; schema suggestions require one. Metadata refreshes after queries and **Refresh Connections**, with a short cache for external changes. Attached and temporary schemas and full SQL semantic diagnostics are not supported yet.

## Data browser and relationships

Table tabs provide **Filters & schema** with AND-combined column filters, NULL checks, comparisons, and contains searches. Header sorting and filters run against the whole database table; the bottom Query Results panel sorts and searches only its captured snapshot. Click or Shift-click cells for rectangular selection, use arrow keys with Shift to extend it, and copy with **Ctrl/Cmd+C**, **Copy selection**, or **Copy JSON**. Drag header separators to resize columns; **Columns** hides/shows fields. Column widths, order, and visibility are remembered per workspace/connection/table. Filters and table page size also persist. These preferences can contain filter values; they use workspace extension storage.

**Inspect row** displays a row vertically, formats JSON, and distinguishes NULL, empty text, and blob/text previews. **Open complete value** reads the current value from a primary-keyed table into a native editor (up to 8 MiB text or 4 MiB binary as hex). Values may have changed since the table page was loaded. SQL query snapshots retain complete values within their capture budget; table browser cells remain bounded previews.

Right-click a connection or table and choose **Show Table Relationships**, or use **Relationships** in a table tab. The diagram shows declared foreign keys, including composite keys, with table/column highlighting. Related tables are layered together; disconnected groups are packed across the available width, with an initial fit to the viewport. Search, focus on one table and its neighbors, expand neighbors, drag cards/background, zoom, and fit the layout. **Browse rows** opens the selected table. The record inspector's **Related rows** actions open referenced or referencing tables with matching filters. Undeclared/inferred relationships and diagram-based schema editing are not supported.

**Table definition, indexes & constraints** shows CREATE SQL, defaults, generated columns, indexes, and foreign-key actions. Copy the CREATE SQL or open SELECT/INSERT/UPDATE templates in a connection-bound SQL editor. Templates are examples to edit before running.

## Editing and interchange

Writable tables with primary keys support **Edit row** and direct cell editing (double-click, Enter to stage, Escape to cancel), **+ Row**, **Duplicate**, and **Delete row**. Changes are staged locally; **Review SQL** shows the generated statements before **Commit changes** becomes available. Committing opens a native confirmation before any database write. **Discard** removes pending changes. Navigation pauses while edits are pending. Staged edits are discarded if their table tab closes or VS Code reloads.

Direct single-table SELECT results are also editable when they include every original table column without aliases (for example `SELECT * FROM customers`). Changes stay attached to their capture; new queries are paused until changes are committed or discarded. Closing a result with pending edits requires discard confirmation. Query captures support updates only; row creation/deletion/import remain in table tabs. Joins, views, aggregates, projections missing columns, and computed results remain read-only. After commit, only affected keys are refreshed in that capture; the original query is never rerun. Other captures remain snapshots.

Each SQL batch runs transactionally and compares the complete original row before updating/deleting. Existing transactions use savepoints where supported; DuckDB, libSQL and Turso require committing or rolling back the open transaction first. A conflict rolls back the whole batch. Existing explicit transactions remain open until COMMIT/ROLLBACK. Views, keyless tables, rows with NULL primary keys, and rows containing truncated text/blob originals cannot be edited through the grid. Generated columns are read-only. The row editor distinguishes text, numbers, exact integers, NULL, and omitted/default values. Batches are limited to 1,000 row changes.

**Export** offers CSV/JSON for the current page, the searched/sorted captured query result, or the entire filtered/sorted table. Full-table exports stream complete values in the database process and replace the chosen destination only after success. Captured exports include their existing bounds/previews and ask before exporting incomplete values. Captured JSON uses `{ columns, rows, truncated }` to preserve duplicate column names and tagged values. Full-table JSON uses an array of objects; unsafe integers are decimal strings and blobs have tagged hex values. CSV writes NULL as an empty field, so use JSON when that distinction matters.

**Import CSV** maps the header columns to a writable table, previews sample rows, and lets you keep empty fields as text or convert them to NULL. Imported rows are staged for SQL review and use the same atomic Apply workflow. SQLite applies column affinity to imported text. Imports support up to 8 MiB per file, 1 MiB per record, and 1,000 data rows per batch. JSON import and database dump/restore are not included.

## Query workflow

**Ctrl/Cmd+Enter** runs selected text, otherwise the SQL statement containing the cursor. Statement boundaries respect quoted names, literals, comments, and CREATE TRIGGER bodies. **Query History** opens a searchable local history for the selected connection and restores a statement to a new editor without executing it. The default retention is 200 recent statements across the workspace (up to 100,000 characters each), plus favorites. Timings, captured/affected counts, errors, and cancellation status are stored locally. **Manage Query History…** offers favorites, status filters, copying, file saving, and individual deletion. Set `datsumi.history.limit` to change retention; the connection context menu can disable history for that connection. SQL can contain sensitive values; disable `datsumi.history.enabled` or use **Clear Query History** as needed. Save reusable queries as ordinary `.sql` files.

**Explain Query Plan** in the SQL editor context menu runs SQLite EXPLAIN QUERY PLAN for the current SELECT/WITH statement and displays a tree of steps, scans, and searches in a result tab. It does not execute the query. There is no automatic EXPLAIN ANALYZE or dashboard.

## SQLite behavior

- Opens existing files without silently creating a database when a saved file has moved. Read-only mode is enforced by SQLite.
- SQL writes commit automatically unless you explicitly run `BEGIN`, followed by statements and `COMMIT` or `ROLLBACK`. Sessions are shared by all editors and panels using the same connection.
- Each connection owns a child process using Node's built-in `node:sqlite`. Queries do not block the extension host, and no separately compiled SQLite addon is required.
- Cancel a query through VS Code's progress notification. Cancellation terminates the connection process and rolls back uncommitted changes. Other pending operations on that connection also fail. The next operation reconnects. Disconnecting, reloading, or closing VS Code also rolls back open transactions.
- Query result tabs retain captured snapshots in extension-host memory until closed, disconnected, or VS Code reloads. Switching tabs, paging, and sorting never re-execute SQL, including writes with `RETURNING`. Sorting applies to the whole captured snapshot before paging; large text/blob cells use their displayed previews for comparisons. A result reaching the row/size cap is explicitly marked, and any SQL `LIMIT` still applies.
- SQL query results retain rows and full cell values within a 64 MiB serialized-data budget. Oversized results are marked incomplete, and select-all copying refuses to write partial data. Table pages support 25–500 rows, ordered by primary key where available, otherwise by visible columns. Pages reflect current database contents; concurrent changes can shift rows between pages.
- Duplicate result column names are preserved. Unsafe integers use exact decimal strings with a type tag, `NULL` stays distinct from an empty string, and table-browser blobs show their byte length with a hex preview of the first 256 bytes. Table-browser text cells over 16,384 characters show an explicitly marked preview. SQL query capture retains full values for copying. These display bounds do not change database values.
- Only the main SQLite database is browsed in the sidebar. SQL can use SQLite features such as transactions and attached databases, but attached and temporary schemas are not currently shown in the tree. Executing an entire script, editing arbitrary query results, visual schema design, and visual schema design remain future work for SQLite.

## Structure

```text
apps/
├── extension/             # VS Code commands, connections, native tree, results panels
└── webview/               # React/Vite results grid and standalone sample preview
packages/
├── core/                  # Database-neutral profiles, resources, results, paging types
├── protocol/              # Runtime-validated messages and JSON-safe result values
├── drivers/
│   ├── api/               # Driver contract and registry
│   ├── sqlite/            # SQLite process client, database implementation, tests
│   ├── sql/               # Relational workers, catalog builds, dialects and real-server tests
│   └── nosql/             # MongoDB/Redis workers, typed data browsing and conformance tests
└── ui/                    # Shared UI utilities and VS Code theme tokens
```

The extension host owns profiles, driver instances, and sessions. Only non-secret settings belong in connection profiles. Remembered credentials use `ExtensionContext.secrets`, never workspace files or webview messages. Webviews receive display data and request scoped operations for their host-owned table; they cannot supply arbitrary file paths or SQL. Both message directions are validated, database strings are rendered as text, assets are local, and the webview uses a restrictive Content Security Policy.

New engines belong behind the driver API; related server adapters share code under `packages/drivers/sql/`. Each driver declares capabilities and implements the shared API. The core retains support for tabular, graph, and value results for future drivers.

The extension runs in the workspace Node.js host, including remote SSH, WSL, and containers. Database paths refer to that host's filesystem. VS Code for the Web, virtual workspaces, and untrusted workspaces are not supported. The manifest's minimum VS Code version provides the Node.js 22 runtime required by SQLite; the implementation needs Node.js 22.18 or later.

## Development and validation

The workspace uses Bun, Turborepo, TypeScript, React/Vite, esbuild, Oxfmt, Oxlint, and Vitest.

```sh
bun dev                     # Watch the extension and its embedded webview; start standalone Vite
bun run build               # Build applications, including embedded webview and SQLite process
bun run check               # Formatting, lint, type checks, and unit/integration tests for shared code
bun run test:integration    # Native VS Code smoke test in a temporary user profile (requires code + display)
bun run test:drivers        # Four isolated Docker servers, generated TLS certificates and conformance tests
bun run test:drivers:native # Also exercise native PostgreSQL setup and real VS Code SecretStorage
bun run test:nosql          # Disposable MongoDB and Redis real-service conformance
bun run test:nosql:native   # Also exercise native NoSQL wizard, browser and JSON query editor
bun run build:drivers      # Build optional .cjs artifacts, pinned catalog and license notices
bun run package:extension   # Build and create apps/extension/datsumi-0.0.21.vsix
bun run clean               # Remove application build output
```

The native smoke test opens a fixture database in an isolated VS Code host, creates a SQL editor, verifies formatting, completion, function hints, schema refresh, and per-editor database selection, executes a write, checks statement-at-cursor execution, query history, query plans, the reusable bottom results panel and editor focus, opens table and relationship tabs, and disconnects. Profile persistence/restoration and connection concurrency are covered by unit tests. Set `VSCODE_EXECUTABLE` to use a different VS Code executable for the native test. Failed native tests retain their temporary diagnostics directory. The automatic suggestion-widget and workbench Format Document routing checks require desktop focus. If your compositor prevents focusing automated windows, `DATSUMI_TEST_HEADLESS=1 bun run test:integration` uses deterministic Quick Pick selections and explicitly skips those focus-dependent checks, reporting the skip; native completion-provider, formatter, command, query, and webview lifecycle checks still run.

The standalone webview at `http://127.0.0.1:5173` uses clearly labeled sample data and Vite hot module replacement. The extension bundles its own webview assets; the Vite server is not required when using the extension. Changes to extension host code require **Developer: Reload Window** in the Development Host. Reload a results panel after its bundled UI rebuilds.

Datsumi has its own extension identity, `philipp-manhart.datsumi`. Re-add connections when switching from earlier development builds; saved credentials are not migrated between extension identities.

See [the current product review](product-review.md) for focused next steps and remaining limits.

The server conformance runner needs Docker with Compose, OpenSSL, and access to official database images. It uses uniquely named disposable containers, loopback-only random ports, generated test certificates, and test-only credentials; cleanup targets only that run's containers/volumes. It covers persistent sessions, duplicate columns, schemas/foreign keys, paging/filter injection, stage/commit/conflicts, rollback, explicit transactions, CRUD, full values, export, precision, cancellation, TLS success/failure, and credential redaction. Native tests require a graphical VS Code installation; the `test:drivers:native` variant explicitly skips focus-dependent automatic popup tests while keeping native command/provider and credential checks. GitHub Actions workflows are intentionally not included. Run the local release checks in [Testing and maintenance](testing.md), including all database/native suites, the dependency audit and production packaging before publishing.

For the focused native clipboard regression, build the extension and run `DATSUMI_TEST_CLIPBOARD_ONLY=1 node apps/extension/test/run.mjs`. It checks 12,001 SQLite rows across pages, header-only metadata, native clipboard TSV and no replay of writes with RETURNING. Only the webview transport is simulated; clipboard access, activation, SQL workers and commands are native. It restores the previous clipboard text when finished.

## Testing and maintenance

Run `bun run test:all` for static checks, real database adapter tests, native VS Code connection tests for all twelve engines, and clipboard regression tests. See [the testing guide](testing.md) for prerequisites, individual commands, coverage and limitations.
