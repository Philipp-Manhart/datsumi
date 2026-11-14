# Getting started with Datsumi

Open Datsumi in VS Code's Activity Bar. The single **+** adds any supported database connection. Choose a local database file or enter server details; use Test Connection when available. Credentials can stay in memory for this session, be requested each time, or use VS Code SecretStorage. Start with a development database and a least-privileged account.

Select the connection, choose **New Query**, and use Ctrl/Cmd+Enter. Query results open in the bottom panel alongside Terminal. Pin a result to keep it while running other queries; rename it from its tab menu. History is in the collapsed sidebar view and opening an entry never executes it.

Focus a result cell, press Ctrl/Cmd+A then Ctrl/Cmd+C, and paste into a spreadsheet. Add Shift to A for column names. Copy includes all available result pages, excludes types/statistics, and refuses incomplete captures. Query captures are bounded to 64 MiB; retained result snapshots share a 128 MiB serialized-data budget. These are data budgets, not guarantees of peak process memory. Use filtered-table export or a database-native export for larger datasets. Exact TSV can contain spreadsheet formulas; choose spreadsheet-safe CSV when processing untrusted text.

Open a table with a primary key to stage edits. Change several cells, review SQL, then choose Commit changes and confirm. Views, ambiguous query projections, unsupported engines and shortened original values are protected and explain why editing is unavailable. ClickHouse grids are read-only. MongoDB and Redis have separate document/key review workflows.

A conflict retains the draft. Refresh and reconcile with current rows before reviewing again. If a connection fails while confirming COMMIT, the server may already have committed: Datsumi blocks further staged writes on that connection. Disconnect, reconnect, inspect fresh rows and reconcile the retained draft. Never blindly retry an insert or other non-idempotent operation. Uncertain outcomes cannot be safely resolved by a client automatically.

Pending table edits can be saved to an unencrypted file. Optional local draft recovery is off by default, expires, and never applies automatically. Closing a native panel cannot be vetoed; reopen its in-memory draft from the notification, or enable recovery before relying on it across reloads.

Datsumi registers SQL formatting and completion providers but leaves your default formatter intact. Use **Format SQL** directly, **Format Document With…**, or explicitly choose **Datsumi: SQL Editor Settings**. This changes SQL-specific settings, not settings for other languages.

Open **Datsumi: Help and Privacy…** for guides bundled with the extension, without a website or network request. Settings appear under `@ext:philipp-manhart.datsumi`. Remote SSH/WSL/container sessions run connections and store local data on the extension host, which may be a different machine from the VS Code window.
