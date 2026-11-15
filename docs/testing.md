# Testing and maintenance

Run `bun run test:all` from the repository root for the complete suite. The SQL native suites run in separate core and extended groups, keeping each VS Code session focused. Tests use disposable databases and isolated VS Code profiles; they do not use saved connections or sample databases.

GitHub Actions workflows are intentionally not included. Maintainers run the release checks locally before publishing; a green unit-test run alone does not replace the database and native suites.

See [the publication follow-up](archive/publication-follow-up-2026-11-11.md) for implemented safety changes and remaining platform/provider acceptance checks; the original readiness review is historical evidence.

## Prerequisites

- Bun (the version in `package.json`) and Node.js 24 or newer.
- Docker with Compose and a running daemon; enough memory for SQL Server alongside the other SQL containers.
- OpenSSL for disposable TLS certificates.
- VS Code on PATH, or `VSCODE_EXECUTABLE` pointing to its executable.
- A display for native VS Code tests. On headless Linux, use `DATSUMI_TEST_HEADLESS=1 xvfb-run -a bun run test:all`.
- Network access for the first container image pulls and DuckDB native installation. Native tests use the host OS credential backend; a functioning backend is required to exercise saved credentials.

## Commands

| Command                       | Checks                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `bun run check`               | Formatting, lint, TypeScript, unit/component tests, real SQLite and DuckDB workers                                      |
| `bun run test:drivers`        | PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse and Oracle against disposable real servers                           |
| `bun run test:nosql`          | MongoDB and Redis against disposable authenticated servers                                                              |
| `bun run test:drivers:native` | SQL adapter tests plus native VS Code workflows for the six SQL servers, SQLite and DuckDB                              |
| `bun run test:nosql:native`   | NoSQL adapter tests plus native MongoDB/Redis connection, query, browsing and edit workflows                            |
| `bun run test:remote`         | Both libSQL and Turso official HTTP clients against an isolated authenticated real libSQL server                        |
| `bun run test:remote:native`  | Remote SQL tests plus native connection form, optional worker installation, secure tokens, reconnect/Forget and history |
| `bun run test:clipboard`      | Native clipboard with 12,001 rows, paging, headers, clean TSV and no replay of writes                                   |
| `bun run package:extension`   | Fresh driver, webview and extension builds, checksums and license notices                                               |

For smaller Docker hosts, split the SQL suite with `DATSUMI_TEST_GROUP=core bun run test:drivers:native` (PostgreSQL/MySQL/MariaDB/SQL Server), then `DATSUMI_TEST_GROUP=extended bun run test:drivers:native` (ClickHouse/Oracle). Run these groups sequentially to limit memory use.

## Coverage by database

| Engine     | Real-engine checks                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite     | Schema/keys/relationships, quoted identifiers, bound parameters, duplicate columns, exact integers/blobs, paging/filtering/sorting, read-only mode, transactions, staged atomic edits/conflicts, export, cancellation and reconnect                           |
| DuckDB     | File creation/reopen, read-only mode, schemas and composite relationships, exact/nested values, paging/filtering/sorting, transactions, staged edits/conflict rollback, CSV/Parquet queries, cancellation, full-result capture and native module installation |
| PostgreSQL | SQL conformance suite below, failed transaction state, multiple result sets and native TLS/credential lifecycle                                                                                                                                               |
| MySQL      | SQL conformance suite, manual/autocommit state, prepared binding with changed escape rules and native TLS/credential lifecycle                                                                                                                                |
| MariaDB    | SQL conformance suite, manual/autocommit state, prepared binding with changed escape rules and native TLS/credential lifecycle                                                                                                                                |
| SQL Server | SQL conformance suite, implicit transactions, multiple result sets and native TLS/credential lifecycle                                                                                                                                                        |
| MongoDB    | Collection paging, BSON precision/type preservation, find/aggregation, rejection of executable/write pipelines, reviewed edits, stale-write protection, immutable identity, read-only access and authentication redaction                                     |
| Redis      | SCAN, string/hash/list/set/sorted-set/binary inspection, bounded previews, TTL preservation, optimistic edits, ACL checks before writes, expiration, read-only access and authentication redaction                                                            |

The shared SQL server conformance suite covers metadata/relationships, duplicate columns, session state, bound filtering/paging/sorting, reviewed atomic writes and rollback, conflicts, outer transactions, insert/delete, complete export/cell reads, precise numeric values, cancellation/reconnect, verified TLS, certificate rejection and credential redaction.

Component tests cover grid selection/copying, schema layout, connection form credential separation, Redis filters/typed viewers, readable BSON values and review-before-commit. The Redis filters stay disabled while a draft exists so filtering cannot change the edit target.

ClickHouse and Oracle also have real-worker tests for metadata, bound filtering (including literal contains patterns), pagination, precise numbers, capture beyond 10,000 rows, export, bad credentials, cancellation and reconnect. ClickHouse HTTPS is tested with trusted and untrusted certificates. Oracle disconnect rollback, foreign keys, reviewed atomic edits, CLOB original-value checks, nested savepoints and timestamp edits are tested. Native host tests exercise optional driver setup and saved credential reuse/forget for both engines. Oracle TCPS options and descriptor-injection rejection have unit tests, but a real TCPS Oracle listener is not exercised by the Docker fixture.

Neon and Supabase presets have form/URL tests for credential separation, TLS enforcement, default ports, session-pooler selection and rejection of transaction poolers. Native tests connect both presets to a local TLS-enabled PostgreSQL server; the Neon test requires SCRAM channel binding. These are protocol-level tests, not live hosted-provider certification.

## Limits

These tests do not certify every database version, cloud authentication mode, operating system or arbitrary query. Fixture image digests are pinned explicitly in the Compose files. Cloud services that use these database protocols still need provider-specific connection testing. Headless native runs explicitly skip automatic suggestion-popup and workbench-focus routing checks; provider-level completion, formatting and the direct Format SQL command remain tested. The native suites can run locally under Xvfb. The clipboard fixture selects X11 on Linux when DISPLAY is available; an unfocused Wayland test window cannot reliably own the native clipboard. Production VS Code keeps its normal display backend.

## Cleanup decisions

The unused UI workspace, `cn` helper, `clsx` and `tailwind-merge` were removed; the actual VS Code theme CSS now belongs to the webview. Tailwind remains because its base reset is used by the existing stylesheet. Driver workers and integration entry points loaded by generated paths must remain even when a basic unused-file scanner reports them.

TypeScript rejects unused locals and parameters. Turbo invalidates cached checks when the shared TypeScript settings change. Builds are uncached because the extension build reads worker and webview sources outside its own package and produces shared artifacts; reusing a package-local build cache could ship stale code. Tests remain uncached and execute on each invocation.

## SSH coverage

Unit/component tests cover SSH fields and key browsing, key-path/port validation, credential binding, host-key pinning and change rejection, concurrent trust decisions, trust reset, resource cleanup, cancelled form submission and cancellation while persisting a new profile. A real local SSH2 server exercises key authentication, encrypted keys, forwarding, rejected hosts/users, disconnected sessions, startup cancellation and the restricted Oracle CONNECT proxy.

The SQL conformance suite includes SSH tests for PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse and Oracle: real database connections, ephemeral routing, Test Connection cleanup, lazy reconnect, query cancellation and failed database authentication. The first five exercise verified TLS through the tunnel; the Oracle fixture uses TCP. NoSQL conformance includes real SSH connections to MongoDB and Redis. The native VS Code suite additionally tests the bundled SSH client, first-use host confirmation, pinned reconnect, host-key reset, database TLS and successful query history.

The fixtures generate disposable key pairs and loopback-only listeners; they never read a user's SSH agent or private keys. Platform-specific agents, interactive MFA, ProxyJump and a full Oracle TCPS server are not covered.

## Remote SQLite-compatible clients

`bun run test:remote` downloads the pinned official libSQL server 0.24.32 release on Linux x64 and verifies SHA-256 before extraction. On other platforms, set `DATSUMI_TEST_SQLD_BIN` to a compatible `sqld` executable. The runner creates temporary database files, an Ed25519 signing key and a short-lived JWT, binds to a random loopback port, and removes its owned server/data afterward. Bun and Node run the harness; no Turso account is needed. A cached server binary is reused. Native tests require the same VS Code/display/credential-store prerequisites as the other native suites.

Coverage includes both real optional workers, both official HTTP transports, valid/invalid tokens, scripts/duplicate columns, exact integers/blobs, PRAGMA schema/keys/indexes/relationships, bound filters, paging, full cell values, CSV export, staged inserts/updates/deletes, preview without writes, whole-batch conflict rollback, rejection of nested grid batches, interactive transactions, rollback on disconnect, cancellation/reconnect, and 12,001-row complete captures. Unit/component tests cover URL normalization/rejection, token separation, SQL splitting, capture limits and the two URL-only connection forms. Native tests add secure token reuse/Forget and history. The transport test server is libSQL: this does **not** establish compatibility with every version/configuration of the newer hosted Turso engine. Hosted endpoints, token expiry/rotation and cloud routing remain account-dependent validation.

## Installed artifacts and benchmarks

After packaging, `bun run test:installed` validates the actual VSIX on the selected current VS Code runtime, using a fresh, isolated profile without a previous-version artifact. `bun run test:minimum` repeats it on the pinned declared minimum runtime. Completion markers are required, not just CLI exit status. See [launch acceptance](launch-acceptance.md) for runtime prerequisites and limitations. `bun run benchmark:results` records synthetic long, wide and nested-JSON measurements in test-results/result-benchmark.json. No real connection data is used.

`bun run test:ui` drives real keyboard events in the rendered installed webview, checks OS clipboard transfers, editor/menu/dropdown focus, ARIA grid nodes and high-contrast rendering. `bun run platform:check` verifies all eight official pinned native archives without claiming that foreign-platform binaries executed on Linux.
