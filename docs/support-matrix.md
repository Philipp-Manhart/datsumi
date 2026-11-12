# Support and validation matrix

The extension requires the VS Code version declared in apps/extension/package.json, with the Node runtime required by the clients and node:sqlite. Development/release tools use Node 24+ and pinned Bun. Native desktop/workspace extension hosts are supported, including Remote SSH/WSL/containers; web/virtual/untrusted workspaces are excluded. Paths, SSH agents and SecretStorage belong to that host.

| Engine          | Implementation / fixture                           | Grid/record editing                                                  |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| SQLite          | Node SQLite; real file/WAL fixtures                | Keyed table batches; online backup/create                            |
| DuckDB          | Official Node API/native 1.5.6-r.2                 | Keyed table batches; finish open transactions first                  |
| PostgreSQL      | pg; PostgreSQL 17 image pinned by digest           | Keyed transactional tables                                           |
| MySQL           | mysql2; MySQL 8.4 image pinned by digest           | Verified permanent InnoDB only; temporary shadows rejected           |
| MariaDB         | mysql2 with MariaDB dialect; MariaDB 11.4 digest   | Transactional tables; temporary/nontransactional shadows rejected    |
| SQL Server      | tedious; SQL Server 2022 digest                    | Keyed transactional tables                                           |
| Oracle          | oracledb Thin; Oracle Free 23 digest               | Keyed table batches; CLOB/timestamp checks and nested savepoints     |
| ClickHouse      | Official HTTP client; 25.8 digest                  | Read-only grid; no atomic batch guarantee                            |
| MongoDB         | Official client; MongoDB 8.0 digest                | Reviewed optimistic single-document replacement                      |
| Redis           | Official client; Redis 8.2 digest                  | Reviewed atomic string/small-hash changes, preserving TTL            |
| libSQL          | Official HTTP client; authenticated libSQL 0.24.32 | Keyed batches; no nested grid batch                                  |
| Turso           | Official serverless client against libSQL fixture  | Same tested subset; newer hosted engine not certified                |
| Neon / Supabase | PostgreSQL presets, TLS-enabled local PG fixture   | PostgreSQL capabilities; live provider tests still account-dependent |

Image tags and digests are recorded in the Compose fixtures. Client versions and exact transitive resolution are in package manifests/bun.lock. Production installs verify bundled/downloaded worker hashes and native archive/file hashes. No npm, compiler or system Node installation is required by extension users.

Captured server results require an unambiguous schema-qualified complete SELECT *. Table tabs are preferred for editing. Views, keyless rows, generated/shortened originals, ambiguous captures and unsafe storage engines remain protected. SQL-server **Disable grid editing** is not a server-wide read-only policy.

Fresh automated evidence in this workspace is Linux x64. Windows/macOS/arm64/musl binaries or routing options being present does not imply fresh end-to-end testing on those systems. Run focused native clipboard/keyboard, SecretStorage, SSH and DuckDB install checks on each target platform before claiming certification. Headless runs explicitly skip suggestion-widget/focus routing checks.

Real Oracle TCPS/mTLS wallets, integrated/Entra authentication, Redis Cluster/Sentinel, multi-hop SSH/MFA and hosted-provider token lifecycle are not certified by these fixtures. Do not promise these modes based only on protocol compatibility. Use the connection troubleshooting guide for supported alternatives.
