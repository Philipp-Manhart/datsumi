# Changelog

## 0.1.0 — 2026-10-31

- Introduce Datsumi across the extension, commands, settings, monorepo packages and documentation. The extension ID is `philipp-manhart.datsumi`; re-add connections from earlier development builds.
- Include SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, MongoDB, Redis, libSQL and Turso adapters. Neon and Supabase use PostgreSQL presets. Hosted providers still need deployment-specific validation.
- Keep query results in the native bottom panel with sorting, paging, full-result TSV copy, history, reviewed grid edits and table relationships.
- Patch dependency advisories, isolate SQLite worker environments, harden credential revocation, pin CI action commits and add publication safeguards. See the repository's security policy and audit report for coverage and limits.
