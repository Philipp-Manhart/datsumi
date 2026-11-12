# Changelog

## 0.2.0 — 2026-11-11

- License Datsumi under MIT; retain complete dependency inventories/notices for host, webview, workers and native components. Use the existing MIT mysql2 transport for MariaDB.
- Reject temporary/nontransactional shadow tables before any MySQL/MariaDB grid mutation; require qualified server captures and clarify that disabled grid editing does not restrict editor SQL.
- Add grouped Settings for result display, formatting/completion, history/privacy, CSV safety, credentials and optional expiring table-draft recovery.
- Add non-secret connection editing/duplication, redacted diagnostics, explicit editing feedback, draft file saving, SQLite creation and online WAL-aware backup.
- Harden artifact caches, download timeouts, file permissions, retention and local release gates. Add contributor/privacy/support documentation and digest-pinned test fixtures. Remove GitHub Actions; all release checks run explicitly locally.

## 0.1.2 — 2026-11-08

- Enable staged inserts, updates and deletes for writable primary-keyed libSQL, Turso, DuckDB and Oracle tables, with review, native confirmation and atomic conflict rollback.
- Enable cell updates in unambiguous complete single-table SELECT * captures across transactional SQL adapters.
- Preserve Oracle transaction/savepoint semantics, CLOB originals and timestamp precision. DuckDB/libSQL/Turso require finishing open transactions before committing grid batches.
- Keep ClickHouse grid edits unavailable because its adapter cannot roll back a batch. MongoDB document and Redis string/hash edits retain reviewed optimistic commits.

## 0.1.1 — 2026-10-31

- Adopt the layered D identity, midnight/mint palette, “Every database. One workspace.” slogan, and “Datsumi — Database Explorer” display name.
- Add a Marketplace PNG icon, SVG logo variants, and a theme-compatible monochrome sidebar icon.

## 0.1.0 — 2026-10-31

- Introduce Datsumi across the extension, commands, settings, monorepo packages and documentation. The extension ID is `philipp-manhart.datsumi`; re-add connections from earlier development builds.
- Include SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, MongoDB, Redis, libSQL and Turso adapters. Neon and Supabase use PostgreSQL presets. Hosted providers still need deployment-specific validation.
- Keep query results in the native bottom panel with sorting, paging, full-result TSV copy, history, reviewed grid edits and table relationships.
- Patch dependency advisories, isolate SQLite worker environments, harden credential revocation, pin CI action commits and add publication safeguards. See the repository's security policy and audit report for coverage and limits.
