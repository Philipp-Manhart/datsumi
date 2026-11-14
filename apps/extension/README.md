<img src="resources/datsumi.png" width="80" height="80" alt="Datsumi logo">

# Datsumi — Database Explorer

**Every database. One workspace.**

A focused database client inside VS Code: connect, browse, query, inspect relationships and review changes without leaving your editor. SQL, documents and keys share one workspace; capabilities vary by engine.

## Start

This release is a preview. Install a Datsumi VSIX using **Extensions → … → Install from VSIX**. Open Datsumi in the Activity Bar and use the single **+ → Add Database Connection**. Enter a database file or server details, test, then connect. Optional drivers install automatically; npm is not required. Credentials remain separate from profiles and can use VS Code SecretStorage.

Use a table/collection/key to browse data, or **New Query → Ctrl/Cmd+Enter**. Results appear in the bottom **Query Results** panel. The sidebar's collapsed **History** view lists previous queries and their database. SQL completion/formatting use the selected connection. Your default formatter stays unchanged; use **Format SQL** directly or explicitly choose **SQL Editor Settings**.

For SQL grid edits: **stage cells/rows → Review SQL → Commit changes → native confirmation**. Conflicts roll back supported transactional batches. Server captures require a complete schema-qualified single-table SELECT *; views, unsafe/ambiguous targets and shortened originals stay protected. ClickHouse grids are read-only. MongoDB/Redis use their reviewed document/key workflows.

**Server access warning:** _Disable grid editing_ only affects staged edits. Editor SQL always uses your database account permissions. Use a database-enforced read-only account to prohibit all writes. SQLite/DuckDB file read-only mode is enforced by their engines.

## Supported engines

SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, ClickHouse, MongoDB, Redis, libSQL and Turso. Neon and Supabase reuse PostgreSQL presets. See the [support matrix](https://github.com/Philipp-Manhart/datsumi/blob/main/docs/support-matrix.md) for tested versions, authentication, transactions, platforms and cloud limitations. A supported protocol is not a promise of every provider feature.

## Everyday tools

- Multiple results, pinning/renaming, sorting, paging, inspectors, comparisons and full-result copy within documented memory budgets.
- **Cmd/Ctrl+A → Cmd/Ctrl+C** copies all available data as clean TSV; add Shift to A to include column names. Types, statistics and UI elements are excluded.
- CSV/JSON export, bounded staged CSV import, exact integer/JSON/BSON preservation, and optional spreadsheet-safe CSV. Exact clipboard transfer remains unchanged.
- Schema relationships, foreign-key navigation, SQL completion/formatting, history/favorites and native SQL files.
- Connection edit/duplicate, SSH tunneling with host-key trust, verified TLS, environment labels and redacted diagnostics.
- SQLite create/open and online backup. Pending table drafts can be saved to a file; optional local reload recovery is off by default and never auto-applies.

Use **Datsumi: Getting Started** for the native walkthrough and **Datsumi: Help and Privacy…** for guides bundled with the extension, available offline.

## In VS Code

![Native SQL editor with query results in the bottom panel](media/query-results.png)

![Foreign-key relationships between tables](media/relationships.png)

Screenshots use synthetic data in an isolated installed-extension test profile.

## Customize

Open Settings and search **`@ext:philipp-manhart.datsumi`**. Choose grid density/page size/type labels/NULL display; SQL keyword casing/spacing/completion; history limits/expiry; credential defaults; CSV safety; and optional draft recovery. [Settings guide](https://github.com/Philipp-Manhart/datsumi/blob/main/docs/settings.md) describes defaults, scope and privacy implications. Native VS Code themes/fonts remain in control.

## Help and privacy

Read the [settings guide](https://github.com/Philipp-Manhart/datsumi/blob/main/docs/settings.md), [support matrix](https://github.com/Philipp-Manhart/datsumi/blob/main/docs/support-matrix.md), [privacy statement](https://github.com/Philipp-Manhart/datsumi/blob/main/PRIVACY.md), and [connection troubleshooting](https://github.com/Philipp-Manhart/datsumi/blob/main/docs/connection-troubleshooting.md).

Query history is unencrypted local text, bounded by age/count/size. Production history and persisted draft recovery require explicit User Settings opt-in. Workers are trusted code rather than an OS sandbox. Remote development runs on the extension host's machine. No Datsumi account or analytics backend is required.

## License

Datsumi's own code, documentation and original logo are [MIT](https://github.com/Philipp-Manhart/datsumi/blob/main/LICENSE). Bundled dependencies and assets retain their own licenses and required notices. Database server/container licenses are separate; servers are not distributed in the extension.
