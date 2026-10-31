# Product review — SQLite developer workflow

Initial review: 2026-10-25. Updated implementation status: 2026-10-27. These are product recommendations, not claims of measured usage or commitments to add every feature.

## Direction

The extension now covers the core loop: open a database, inspect its structure and relationships, browse/filter data, write SQL with completion/formatting, retain results, stage changes, and move data through CSV/JSON. Further work should make this loop dependable before adding dashboards, AI tools, broad administration, or many database engines.

Version 0.0.7 addresses concrete usability gaps: compact query results without repeated titles/SQL, direct cell editing in eligible captures, reviewed/confirmed commits, responsive schema packing, SQL-specific editor settings, and native typing tests. The completion tests exercise the actual suggestion widget, including keyword priority after FROM. The formatter test reproduces an inherited non-SQL formatter.

## Implemented in 0.0.10

SQL JOIN assistance, hover/definition navigation and error diagnostics; richer query history and favorites; lossless JSON inspection and native diff staging; transaction/environment visibility; saved view preferences and SQL-file bindings; staged-edit undo/redo/revert; row/result comparisons; quick navigation and URL import; MongoDB and Redis browsing with reviewed optimistic updates. See the root README for exact behavior, test commands and engine limitations. The research behind this scope is in [the UX review](ux-research-2026-10.md).

Native tests validate formatter/provider behavior and real connection workflows. Focus-dependent automatic suggestion-widget tests are explicitly skipped on headless desktops; provider tests do not establish popup behavior on every compositor.

## Highest-value remaining work

1. **Optional recovery for pending edits.** Undo/redo and row revert exist; reload recovery does not. A recovery feature needs an explicit retention choice because staged values can be sensitive. Recovery must never automatically execute writes.
2. **Editing projected SQL results safely.** The current conservative rule requires all original columns from a single base table without aliases. Support common primary-keyed projections next, keeping joins, aggregates and ambiguous origins read-only.
3. **SQLite creation and backup.** Opening existing files works. Add a deliberate new-database action and SQLite's backup API rather than copying a live file without its WAL.
4. **Deeper SQL semantics and plans.** Basic hover, schema definitions, FK JOIN suggestions and error locations now exist. Better CTE/subquery semantics, real server DDL retrieval, and SQL Server plans would be incremental improvements.
5. **Large datasets and external changes.** Seek/keyset paging and better feedback about outside writes would help. Preserve the difference between a captured query result and live database-wide operations.
6. **Broader NoSQL workflows only on demand.** MongoDB insert/delete and transactions, Redis collections editing/Cluster, and provider-specific authentication need dedicated tests and UI. Initial support deliberately covers browsing and reviewed updates.

## Deliberate limits to keep

- Use native `.sql` files, VS Code search, Git, and editor commands instead of building another project/file system.
- Keep diagrams for exploration. A drag-and-drop schema designer is a separate, much larger feature.
- Keep imports staged and bounded. Reliable CSV mapping and rollback matter more than many file formats.
- Keep edits restricted by primary keys and optimistic conflict checks. Avoid silently treating arbitrary query results as writable tables.
- Keep the seven supported engines dependable before adding more; choose future engines from actual project needs.
- Defer dashboards, workflow automation, team/cloud synchronization, role administration, and a separate AI chat interface.

## Suggested next release

Focus next on optional pending-edit recovery, projected-result editing and SQLite creation/backup. These improve everyday work without turning the extension into a general administration suite.
