# Contributing to Datsumi

Datsumi is MIT-licensed. Third-party code/assets keep their own licenses; see [the license audit](docs/license-audit.md).

## Start locally

Use Node.js 24+ and the Bun version pinned in package.json. Run `bun install --frozen-lockfile`, then `bun run check`. Open the root folder in VS Code, run `bun run --cwd apps/extension build`, and use **Debug Datsumi Extension** (F5). `bun run dev` watches development assets. Database paths and credentials belong to the extension host, including Remote SSH/WSL/containers.

Create disposable samples with `bun run sample:db`, `bun run sample:duckdb`, or `bun run sample:nosql`. The NoSQL fixtures require Docker. Never point tests at a personal or production connection. Do not commit database files, tokens, private keys, .env files, exported data or unredacted query history.

## Verify changes

- `bun run check`: format, lint, types, components and real local SQLite/DuckDB workers.
- `DATSUMI_TEST_GROUP=core bun run test:drivers`: PostgreSQL, MySQL, MariaDB and SQL Server fixtures.
- `DATSUMI_TEST_GROUP=extended bun run test:drivers`: Oracle and ClickHouse fixtures.
- `bun run test:nosql` / `bun run test:remote`: MongoDB/Redis and authenticated libSQL/Turso transport checks.
- `DATSUMI_TEST_HEADLESS=1 bun run release:check`: full local release gates, secret/dependency scans and distributable verification. Requires a clean commit. For development evidence use `--allow-dirty`; that report cannot approve publication.

See [testing](docs/testing.md), [support matrix](docs/support-matrix.md) and [release checklist](docs/release-checklist.md) for Docker, VS Code/display, credential-store and platform prerequisites. GitHub Actions and automatic Git hooks are intentionally absent.

## Design and adapter contract

Keep native SQL editors and a focused database explorer. Do not add a dashboard, account system, migration designer or new framework for a small feature. Shared types live in core; webview messages are validated in protocol; drivers own database behavior; the extension host owns credentials, file dialogs and review/confirmation.

Adapters must preserve exact values, bind data separately from identifiers, validate resource identity and actual transactional capabilities, respect cancellation, and report unknown commit outcomes truthfully. A worker is trusted code, not an OS sandbox. Never infer safe editing from a column name or permanent-table catalog alone. Add regression tests asserting the actual stored values after failures. No test may require a user's credentials or SSH agent.

New bundled dependencies must pass the license inventory policy, include full notices, and have a reason to exist. The application is MIT; dependencies are not relicensed. The packaging checks fail on missing notices or unreviewed licenses. See scripts/licenses.mjs for the explicit policy and pinned upstream notice exceptions.

## Issues and reviews

Include engine/server version, VS Code/OS/architecture, minimal synthetic schema/query, expected/actual behavior, and redacted diagnostics. Use **Copy Redacted Connection Diagnostics**; it excludes credentials, hostnames, SQL and values. Do not paste an auth token or customer data. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
