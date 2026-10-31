# SQL adapters and credential storage

Research date: 2026-10-26. Scope: PostgreSQL, MySQL, MariaDB, SQL Server, while retaining SQLite. The design below informed version 0.0.8; implemented scope and remaining limits are described in the root README. This is not a security audit.

## Recommended drivers

### PostgreSQL: pg

Use the JavaScript `pg` driver, without pg-native. Prefer an explicit `Client` per interactive SQL session; a retained checked-out pool client is also possible. A database client needs predictable temporary tables, SET/search_path, and BEGIN/COMMIT behavior across executions. Do not send statements from one transaction through arbitrary pool.query calls. Evaluate pg-cursor for fetching large results without unbounded buffering.

The adapter owns pg_catalog/information_schema queries, parameter placeholders, identifier quoting, generated edit SQL, and exact value conversion. Preserve int8/numeric precision and distinguish timestamps with and without time zones. Use structured connection options and explicitly normalized TLS settings: pg documents that sslmode/sslcert/sslkey/sslrootcert in a connection string can overwrite a separately provided ssl object.

`postgres`/Postgres.js is a credible alternative, but pg's explicit connection model matches our current session contract. An ORM does not replace the needed raw result metadata or catalog queries.

Sources: [pg](https://node-postgres.com/), [transactions](https://node-postgres.com/features/transactions), [TLS configuration](https://node-postgres.com/features/ssl).

### MySQL: mysql2

Use `mysql2` with an explicit connection and serialized user requests. Its JavaScript implementation avoids platform-specific native bindings. Configure lossless BIGINT/DECIMAL handling, array-shaped rows to retain duplicate output column names, field metadata, and explicit date/time conversion. Use parameterized execution for generated data edits and bounded/streaming fetching for result captures.

A user-written script and a generated parameterized operation are different execution paths. Do not enable multi-statement handling indiscriminately on every generated operation. If script execution is supported, make it explicit and preserve multi-result responses. Handle DELIMITER as a client-side directive if supported rather than sending it to the server.

Do not substitute Oracle's Connector/Node.js simply because it is official: its X DevAPI/X Protocol scope is different from a conventional MySQL SQL client.

Sources: [mysql2](https://sidorares.github.io/node-mysql2/docs), [TLS](https://sidorares.github.io/node-mysql2/docs/documentation/ssl), [Oracle Connector scope](https://dev.mysql.com/downloads/connector/nodejs/).

### MariaDB: mariadb

For deliberate first-class MariaDB support, prefer MariaDB's own JavaScript connector. Sharing mysql2 would reduce dependencies, but the official connector includes MariaDB-specific features and ed25519 authentication. Shared browsing/filter-generation utilities can still serve both adapters; connection/authentication and catalog differences remain separate.

Use explicit sessions and conservative execution ordering; performance features such as pipelining should not make error recovery or cancellation harder to understand. Preserve BigInt/DECIMAL values and metadata rather than forcing MySQL's conversions onto the connector.

The connector's declared license is LGPL-2.1-or-later. Preserve applicable distribution/source/replacement terms; do not treat the top-level license as equivalent to MIT. Keep the connector as an identifiable, separately packaged dependency rather than silently flattening it into an opaque proprietary bundle. Confirm the final distribution complies before release. This does not by itself make the connector unsuitable.

Sources: [official repository](https://github.com/mariadb-corporation/mariadb-connector-nodejs), [published connector README](https://www.npmjs.com/package/mariadb), [connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options).

### SQL Server: Tedious directly for interactive sessions

The general-purpose option remains `mssql` using Tedious, but this review favors direct `tedious` for our interactive adapter. A Tedious Connection represents one server connection, making raw T-SQL session behavior easier to control. In contrast, mssql ordinarily obtains a pooled connection per request. Its transaction wrapper pins a connection, but an interactive client must also preserve arbitrary user-written BEGIN/COMMIT, temporary tables, USE, and session SET options.

Serialize requests, consume row/metadata/result-boundary events with bounded buffers, and normalize messages, affected-row counts, and errors. Use raw batch execution for editor SQL when batch scope is needed; parameterized generated edits use the appropriate parameter API. Tedious documents temp-table scope differences between execSql and execSqlBatch. Treat GO as a client batch separator only when supported by our parser; GO is not a server SQL statement.

Start with SQL authentication over verified TLS. Add Microsoft Entra token authentication as a separate capability, using VS Code authentication integration where suitable and refreshing tokens when required. Windows integrated authentication is a separate support target; native ODBC/MSNodeSQLv8 dependencies should not become the default bundle.

This refines the earlier broad mssql recommendation: pooling ergonomics are useful for applications, while persistent sessions are essential for a query editor. Validate the direct-driver choice with a temporary-table/transaction prototype before committing to it.

Sources: [Tedious Connection API](https://tediousjs.github.io/tedious/api-connection.html), [mssql pooling and authentication](https://tediousjs.github.io/node-mssql/), [Tedious license](https://raw.githubusercontent.com/tediousjs/tedious/master/LICENSE).

## Current code findings

- `ConnectionProfile` documents non-secret configuration plus an optional secretStorageKey; that is only a placeholder, not implemented credential storage.
- `ConnectionManager` currently persists SQLite profiles in workspaceState. Its loader accepts only sqlite, opens drivers with profile.configuration, and export checks assume a local SQLite file path. These paths need typed per-engine validation and separation before adding server connections.
- The driver registry and DatabaseDriver interface are useful existing boundaries. Keep credentials out of protocol/webview data models.
- Explicitly select supported server versions after integration testing. Published package Node minima and old documentation examples are not evidence that an adapter works in every VS Code runtime.

## Credential architecture

### Use VS Code SecretStorage

Store remembered secrets with `ExtensionContext.secrets.store/get/delete`. Use unpredictable connection IDs and opaque keys, for example `datsumi.credential.v1.<uuid>`. Store a versioned secret record containing the password or other durable authentication material and the authorized connection identity. Do not implement our own AES file with a key beside it, install keytar, or require a master password for the initial release.

The API documents encrypted, platform-dependent storage and no cross-machine secret synchronization. On desktop, effective protection depends on the configured OS-backed credential storage. Linux's optional basic fallback is not equivalent to a secure keyring. The public SecretStorage API does not expose a reliable backend-health attestation, so do not claim we can certify the backend or detect every weak configuration. If store/get fails, offer session-only use and actionable guidance; never fall back to plaintext persistence.

VS Code brokers secrets through its main-thread secret service. Do not assume remote extensions write credentials into a remote JSON file. In SSH/WSL/containers, retrieval and use can still deliver the credential into the remote extension host and database worker memory. The remote host must be trusted; test desktop remote and Codespaces/browser scenarios separately.

Sources: [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage), [keychain troubleshooting](https://code.visualstudio.com/docs/configure/settings-sync#troubleshoot-credential-store-issues), [extension-host secret proxy](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/api/common/extHostSecretState.ts), [main-thread secret service](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/api/browser/mainThreadSecretState.ts).

### Separate settings, secrets, and runtime credentials

- **Private connection profile:** driver ID, display name, host, port, database, username, authentication method, TLS policy, and secret reference. This is ordinary extension state, not an encrypted vault. Hostnames/usernames can be sensitive, so keep it out of committed workspace settings and opt out of automatic profile sync initially.
- **SecretStorage:** saved passwords, private-key passphrases or private-key contents when explicitly supported, and durable refresh credentials only when the selected authentication integration actually requires them.
- **Session memory:** passwords when Save is off; short-lived access tokens; driver runtime configuration. Fetch fresh expiring tokens instead of assuming a saved token lasts forever. Clear references when disconnected/disposed; JavaScript cannot guarantee secure zeroing of immutable strings or absence from process dumps.
- **Public certificates:** custom CA/server certificates can be normal profile attachments or paths, but a client private key is secret. A path to a key does not encrypt that file. Explain remote path semantics; never copy private keys into workspace storage.

Provide Ask every time, Remember for this session, and Save securely choices. Start with Remember for this session, with saving as an explicit choice. Use native masked input rather than placing stored passwords in the React connection view. Show saved-credential status without returning the stored value to the webview. Provide Change password and Forget saved credentials commands.

If accepting a pasted connection URI, collect it as sensitive input, parse into allowlisted typed fields, separate authentication data, and discard the original. Do not persist or log the raw URI, including nested/query-string credentials. Do not accept arbitrary driver option objects from workspace files.

### Bind credential use to the destination

SecretStorage is extension-scoped, not workspace-scoped. A plain secret reference in a modifiable profile must not authorize sending its password to any host. Store/verify authorized driver, endpoint, username/auth mode, TLS identity policy, and execution environment with the secret record. Meaningful endpoint or trust-policy changes require deliberate reauthorization before reuse. Imported profiles get new IDs and no credential binding. Do not permit imported files to choose arbitrary secret keys.

Require a trusted workspace before connecting or reading workspace-provided configuration/certificate paths. Trust is a coarse gate; endpoint validation and explicit profile changes still matter. Do not connect automatically merely because a repository contains a connection definition.

Source: [Workspace Trust guide](https://code.visualstudio.com/api/extension-guides/workspace-trust).

### Protect transport and logging

Use TLS with certificate and hostname verification by default. Offer a custom CA for self-signed deployments. No automatic fallback to plaintext or certificate bypass on failure. Local no-TLS or certificate-bypass settings, if supported, must be explicit per-connection exceptions. For SQL Server, set encrypt explicitly and trustServerCertificate false. For pg, normalize SSL URI parameters so they cannot silently replace the intended verification settings.

Read secrets only in the host credential service; deliver credentials only to the selected trusted adapter worker over IPC. Do not put them into command-line arguments, process environment variables, globalState/workspaceState, webview state/messages, telemetry, diagnostic dumps, or connection-profile exports. A driver needs the actual authentication material, so downloaded adapter code is trusted executable code, not a credential-isolated sandbox.

Prefer structured error mapping over dumping raw driver configurations/errors. Redact known credential fields and URI credentials in logs. Query history is a separate exposure: users can type passwords into arbitrary SQL. Provide history disable/clear controls, exclude extension-generated authentication SQL, and do not promise regex redaction can recognize every secret in user SQL.

Delete saved credentials when forgetting/removing a profile, report deletion failures, and provide a way to retry cleanup. Updating a saved password must not leave old credentials silently active. Reconnection must never automatically replay SQL writes.

## Downloadable adapter plan

Keep one extension and four optional adapter artifacts; SQLite remains included. CI resolves exact dependency versions, builds self-contained releases, retains required notices/assets, and publishes a trusted or signed manifest. The extension validates compatibility and integrity, downloads to globalStorageUri, and installs atomically with rollback. No npm, compiler, or user-installed Node runtime is needed for these default JavaScript driver choices. Validate actual extension-host Node requirements, including transitive dependencies.

Measure complete compressed artifact size, installed size, startup cost, and memory. Do not use a root package's npm unpackedSize as final download size. Run artifacts in local and remote extension hosts; driver packages are not Settings Sync content.

## Implementation and validation sequence

1. Add typed server profiles and the host-only credential service, keeping SQLite behavior intact. Test that persistence, logs, webview messages, exports, and failures do not expose injected sentinel passwords; test credential destination binding and missing/locked storage.
2. Implement PostgreSQL as the first optional downloaded adapter. Exercise verified TLS, custom CA, authentication failure, exact numbers, duplicate columns, metadata, bounded queries, cancellation, and explicit session/transaction state.
3. Add MySQL and MariaDB with shared UI utilities but independent connector/auth testing. Verify DDL implicit commits, supported table engines, safe editing eligibility, multi-result handling, and disconnect/cancellation semantics rather than assuming SQLite-style rollback.
4. Prototype direct Tedious sessions, including temp tables across executions, USE/SET, SQL BEGIN/COMMIT/ROLLBACK, messages, cancellation, GO handling, and generated parameterized edits. Add SQL Server once these pass.
5. Run connection tests under local desktop, SSH, WSL, and containers; cover offline driver install, failed downloads, mismatched bundles, and Linux credential-store guidance.

Use real database instances for adapter conformance. Do not equate a passing SELECT 1 with support for safe editing, transactions, streaming, or cloud authentication. Database permissions enforce true read-only access; a UI switch or SQL prefix classifier is not a security boundary.
