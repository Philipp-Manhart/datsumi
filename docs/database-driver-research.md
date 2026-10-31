# Database driver research

Research date: 2026-10-26. Research only; these drivers have not been integrated or tested in the extension.

## Scope and decision

Use the October 2026 [DB-Engines popularity ranking](https://db-engines.com/en/ranking) as a reproducible definition of the ten biggest systems: Oracle, MySQL, SQL Server, PostgreSQL, MongoDB, Snowflake, Databricks, Redis, IBM Db2, and Cassandra. Popularity is not market share or suitability for this product. SQLite and MariaDB remain important despite falling outside this particular top ten.

Recommendation: one VS Code extension, SQLite bundled, separately downloadable versioned adapter artifacts. Prefer established engine-specific Node.js drivers to a universal ORM. Build dependencies in CI; never require npm or compilation on user machines. Official SDKs are especially valuable for proprietary authentication and protocols. A small native dependency can still be harder to distribute than a larger JavaScript SDK.

## Driver choices

1. **Oracle — `oracledb`, Thin mode.** Oracle's driver uses JavaScript by default, without Oracle Client libraries; Thin mode supports Oracle Database 12.1 and later. Prefer it to an ODBC bridge. Thick mode supports additional features and older servers but needs native components and external Oracle Client libraries. Start with a clearly documented Thin-only support scope. [Installation](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html), [feature differences](https://node-oracledb.readthedocs.io/en/latest/user_guide/appendix_a.html).
2. **MySQL — `mysql2`.** JavaScript implementation with prepared statements, TLS, and field metadata. Prefer it to an ORM for raw user SQL and result metadata. Preserve large integers and decimal values instead of coercing them to unsafe numbers. [Documentation](https://sidorares.github.io/node-mysql2/docs).
3. **SQL Server — `mssql` with its default Tedious driver.** Cross-platform JavaScript route, with streaming, cancellation, multiple recordsets, and authentication support. Prefer it over native ODBC/MSNodeSQLv8 for the initial supported configuration. Windows integrated authentication needs an explicit support matrix; do not promise it works through every driver/authentication mode. Session semantics need care: ordinary requests can acquire different pooled connections, while the Transaction API reserves one connection. [Documentation](https://tediousjs.github.io/node-mssql/).
4. **PostgreSQL — `pg`.** Prefer the JavaScript driver over optional `pg-native`. Exposes result metadata and type parsers; `pg-cursor` can be evaluated for bounded fetching. Keep a checked-out client for each interactive session so temporary tables, SET, and explicit transactions behave predictably. Do not use arbitrary pool.query calls for a transaction. `postgres`/Postgres.js is a reasonable alternative, but pg's explicit client model fits the existing driver contract. [Documentation](https://node-postgres.com/), [transactions](https://node-postgres.com/features/transactions).
5. **MongoDB — `mongodb`.** Official driver for self-hosted databases and Atlas. Basic connections do not require native add-ons; optional authentication, encryption, and compression features may. Preserve BSON types and use document browsing/filtering and aggregation UI. Do not execute arbitrary shell JavaScript through eval or pretend relational foreign-key diagrams apply. [Documentation](https://www.mongodb.com/docs/drivers/node/current/).
6. **Snowflake — `snowflake-sdk`.** Official JavaScript driver handles Snowflake sessions and authentication. Prefer it over a hand-built SQL REST wrapper initially. The dependency graph includes several cloud authentication/storage libraries, making on-demand delivery particularly useful. Model warehouse/role/database/schema explicitly and show execution/cancellation state. Browsing should use bounded results; do not assume all rows are safely editable. [Documentation](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver).
7. **Databricks — `@databricks/sql`.** Official SQL driver supports PAT and OAuth authentication and operation/session APIs. Current package metadata includes optional native compression/kernel packages: inspect the selected release's fallback behavior and platform coverage before building artifacts. Do not label the complete current dependency tree JavaScript-only. Start with SQL warehouses, catalog/schema browsing, bounded fetching, cancellation, and query history. [Documentation](https://docs.databricks.com/aws/en/dev-tools/nodejs-sql-driver), [repository](https://github.com/databricks/databricks-sql-nodejs).
8. **Redis — `@redis/client` from node-redis.** Use the base package rather than the umbrella redis package if module-specific commands are not needed. Redis recommends node-redis for new projects; ioredis remains supported. A useful adapter requires a key browser, typed value viewers, TTL controls, and incremental SCAN-based discovery rather than SQL grids or blocking KEYS scans. [Repository](https://github.com/redis/node-redis), [client recommendations](https://redis.io/docs/latest/develop/clients/).
9. **IBM Db2 — `ibm_db`, conditional on a distribution proof of concept.** IBM-maintained bindings require native code and the CLI driver. Current releases use Node-API, which helps Node/Electron compatibility but does not eliminate OS, architecture, libc, or runtime library dependencies. Produce tested platform artifacts; mark unavailable platforms unsupported. Separately verify client redistribution and any Db2 Connect licensing required by the target server configuration. The npm wrapper's MIT metadata does not settle the native client's terms. Prefer this over adding a JVM/JDBC runtime solely for Db2; reconsider if enterprise demand justifies a broader JDBC bridge. [Repository and requirements](https://github.com/ibmdb/node-ibm_db).
10. **Cassandra — `cassandra-driver`, maintained under Apache Cassandra.** Prefer the current Apache project over assuming the older DataStax repository remains the upstream. Core JavaScript driver supports CQL, prepared statements, paging, and topology discovery. Model keyspaces and partition/clustering keys. CQL does not provide ordinary relational joins, foreign keys, or SQL transaction semantics; disable inappropriate actions. [Repository](https://github.com/apache/cassandra-nodejs-driver).

## Published package metadata snapshot

Read directly from the npm registry's `/latest` endpoints during this review. These are research observations, not implementation pins. Latest versions must pass runtime, security, packaging, and live-server tests before adoption. License identifiers below describe the published top-level package, not every transitive dependency or the database server.

| Package          | Observed version | Declared Node minimum                                     | Declared license      |
| ---------------- | ---------------- | --------------------------------------------------------- | --------------------- |
| pg               | 8.23.1           | 16                                                        | MIT                   |
| mysql2           | 3.24.6           | 8                                                         | MIT                   |
| mssql            | 12.7.13          | 18.19                                                     | MIT                   |
| oracledb         | 26.0.0           | 14.17                                                     | Apache-2.0 OR UPL-1.0 |
| mongodb          | 7.7.0            | 20.19                                                     | Apache-2.0            |
| snowflake-sdk    | 3.4.0            | 20                                                        | Apache-2.0            |
| @databricks/sql  | 2.4.0            | 20                                                        | Apache-2.0            |
| @redis/client    | 6.3.0            | 20                                                        | MIT                   |
| ibm_db           | 4.1.0            | 6 (package declaration; not a tested compatibility claim) | MIT                   |
| cassandra-driver | 4.10.0           | 20                                                        | Apache-2.0            |
| mariadb          | 3.5.4            | 20                                                        | LGPL-2.1-or-later     |

Registry sources: `https://registry.npmjs.org/<URL-encoded-package-name>/latest`. Documentation, repository main branches, and published package versions can disagree. Validate the exact release artifact rather than following main or trusting old installation instructions. Transitive dependencies can require newer Node versions than the root package.

No final adapter download sizes were measured. npm unpackedSize excludes transitive dependencies and sometimes post-install downloads, so it is not a valid estimate of our final compressed artifact. Measure compressed, installed, and loaded memory sizes in a packaging spike, including native/client assets and license notices.

## SQLite, MariaDB, and cloud coverage

- Keep existing SQLite support in the core extension. It is already integrated and does not need another downloaded driver.
- For MariaDB, initially evaluate the shared MySQL adapter using mysql2 against real supported MariaDB versions. MariaDB's own `mariadb` connector is the alternative if compatibility or metadata behavior warrants it. Its published LGPL license differs from mysql2's MIT metadata; distribution must preserve applicable terms and notices. [Official connector](https://github.com/mariadb-corporation/mariadb-connector-nodejs).
- Neon uses the PostgreSQL adapter with a standard connection string. A Neon management API integration for projects/branches is separate from querying. [Neon connection guide](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md).
- Supabase also uses PostgreSQL connectivity. For an interactive GUI, use a direct connection or session pooler, accounting for IPv4/IPv6 reachability. Transaction pooling changes session behavior and prepared-statement support. [Supabase guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
- Aurora MySQL and Aurora PostgreSQL use their corresponding engine adapters, with version-specific testing. Provider-specific IAM authentication is an additional feature, not a new wire driver. [AWS compatibility guidance](https://docs.aws.amazon.com/rds/latest/auroraextendedcontent/aurora-faq.html).
- MongoDB Atlas uses the MongoDB driver. Cloud-hosted compatible protocols still need tested authentication, certificates, and server feature capabilities; wire compatibility alone is insufficient.
- BigQuery, DynamoDB, and other proprietary APIs need their own adapters later. They cannot be covered by a PostgreSQL provider preset.

## Implications for this extension

The existing DatabaseDriver interface and registry are a good boundary, but full support needs structured catalog/schema/object identities, dialect-aware generated SQL and completion, capability flags, multi-result responses, richer value types, transaction state, and normalized diagnostics.

Each downloaded artifact should declare adapter API range, driver/dependency versions, minimum extension-host Node version, OS/architecture/libc where relevant, and integrity information. Verify against a trusted or signed manifest, reject incompatible artifacts, install atomically, retain working versions, and provide offline import. Remote windows install on their extension-host machine. Do not synchronize database credentials or download locations through workspace files.

Prefer one child process per interactive connection/session to contain driver crashes and native dependencies. A process boundary does not itself provide a security sandbox. Preserve backend session state, implement server-side cancellation when possible, and report when cancellation forces reconnection. Never automatically replay writes after a dropped connection.

Build a shared conformance suite against real servers: session persistence, cancellation, TLS/auth, duplicate column names, multi-result queries, bounded fetches, exact integers/decimals/timestamps, metadata, permissions, rollback, and optimistic edit conflicts. Only advertise editing when provenance and row identity are proven.

Recommended implementation order is SQLite (existing), PostgreSQL, MySQL/MariaDB, SQL Server, Oracle Thin, then Snowflake/Databricks. Treat MongoDB, Redis, and Cassandra as distinct UI projects; schedule them by actual demand. Db2 comes after its native distribution and licensing proof of concept. This order is product judgment, not the popularity ranking.
