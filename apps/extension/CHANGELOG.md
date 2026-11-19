# Changelog

## 0.0.3 — 2026-11-19

- Fix the Marketplace logo and screenshots by resolving README images from the extension directory in the monorepo.
- Check packaged README image links against the bundled assets before publishing.

## 0.0.2 — 2026-11-19

- Publish Datsumi on the regular Marketplace release channel and remove the Preview label.
- Keep the database features and connection settings from 0.0.1.

## 0.0.1 — 2026-11-15 (preview)

Initial public preview of Datsumi — Every database. One workspace.

- Connect to SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, ClickHouse, libSQL, Turso, MongoDB, and Redis. Neon and Supabase presets reuse PostgreSQL support.
- Write SQL with connection-aware completion, formatting, query plans, and native query editors.
- Browse results in the bottom panel with multiple tabs, sorting, pagination, record/JSON inspection, and clean spreadsheet copying.
- Review staged edits before committing supported database changes, with conflict detection and transactional batches where available.
- Explore declared table relationships and reopen queries from local history.
- Use secure credential storage, verified TLS, SSH tunnels, and configurable privacy/display settings.
- Navigate result grids and menus with the keyboard, with accessible cell semantics and high-contrast support.

Datsumi is free and MIT-licensed, with all features included and no Pro edition. Third-party components retain their own licenses.
