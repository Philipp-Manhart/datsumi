# Datsumi pre-publication security review

Date: 2026-10-31. Release: 0.1.0.

## Scope

Reviewed the extension host/webview boundary, IPC workers, connection parsing, credentials and SSH trust, database TLS options, query/edit/export paths, driver/native downloads and archive extraction, dependency graph, CI configuration, and files/history selected for GitHub publication. This was a source and dependency review with targeted regression tests, not an independent penetration test or certification.

## Findings and remediation

| Finding                                                                                                               | Remediation                                                                                                                                          | Evidence                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Vulnerable Zod validation dependency (GHSA-mrhx-c7xc-m3w5)                                                            | Pin Zod 4.6.6                                                                                                                                        | Full dependency audit; protocol and webview boundary tests                                                                                 |
| Vulnerable transitive MSAL Node dependency (GHSA-xcx6-jx8p-x3h5)                                                      | Pin Azure Identity 4.14.1, which requires patched MSAL Node 7.1+                                                                                     | Lockfile and real SQL Server connection tests; Datsumi uses password authentication, not the affected auth-code flow                       |
| Additional development dependency advisories                                                                          | Update Vitest, Vite, source-map-js, undici and qs; override minimatch to 11.0.1 because the packaging tool still requests the affected major version | Full dependency audit and actual VSIX packaging exercise the updated toolchain                                                             |
| SQLite workers inherited unrelated extension-host environment values, including potential API tokens and NODE_OPTIONS | Use the same minimal environment allowlist as the other workers                                                                                      | Regression test launches a real worker with a canary token and Node preload configured in the parent, and proves neither reaches the child |
| Deleted or in-flight keychain values could be reused if a credential backend returned stale data                      | Revoke credentials in memory before deletion and ignore revoked reads; only explicitly supplied replacement credentials are accepted                 | Tests cover stale backend reads, an in-flight read and deletion failure                                                                    |
| CI actions were referenced by movable version tags                                                                    | Pin checkout, setup-node and setup-bun to their reviewed tag commit hashes                                                                           | Workflow source; future updates remain explicit                                                                                            |
| Publication ignore rules did not cover common credential/database artifacts outside samples                           | Ignore dotenv files, private keys, local database files and logs                                                                                     | Git publication inventory and secret scan                                                                                                  |

## Verified boundaries

- Saved credential binding includes the destination, driver, configuration, execution environment and SSH settings. Tokens/passwords are separate from persisted profiles. Forget disconnects and removes credentials.
- Host-side review state and native confirmation gate staged writes; adapters use bound parameters and optimistic original-value checks. MongoDB rejects server-side JavaScript and write aggregation stages; Redis edits use fixed compare-and-set Lua.
- TLS verification stays enabled by default; SSH host-key changes fail closed. URL option allowlists reject certificate-bypass options and credentials embedded in persisted endpoints.
- CSP disables remote resources and inline scripts. React renders database values as text. Only bundled webview assets are in local resource roots. Webview requests are validated by Zod.
- Executable driver/native artifacts are checked against extension-owned catalogs before loading; downloads reject redirects; extraction is restricted to pinned regular files. Worker environments and arguments do not carry database secrets.
- Export destinations are chosen through native dialogs, and full-table exports avoid overwriting connected database files and replace the destination after successful completion.

## Validation record

Run `bun run check`, `DATSUMI_TEST_HEADLESS=1 bun run test:all`, `bun audit --json`, and `bun run package:extension`. The complete suite covers SQLite, DuckDB, PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, MongoDB and Redis against real engines. The libSQL/Turso transports are tested against a local authenticated libSQL server; this does not validate the newer hosted Turso engine or every cloud offering.

A checksum-verified Gitleaks 8.30.1 scans the Git history and the exact staged publication tree with redacted reports. Known sample/test credentials are deliberately disposable and loopback-only; no live credentials or local databases belong in the repository. Runtime-generated SSH keys and JWTs remain in temporary test directories.

Completed release checks:

- Formatting, lint and type checking: passed; 229 unit/component/local-worker tests passed.
- Grouped real SQL adapters/SSH: 68 core and 19 extended tests passed; 13 engine/group-specific cases skipped intentionally across both invocations.
- MongoDB/Redis: 15 tests passed, including SSH cases.
- libSQL/Turso official HTTP clients: 18 tests passed against the authenticated local libSQL server.
- Native VS Code workflows passed for connection setup, credential reuse/Forget, SQL providers and history, plus SSH and a 12,001-row clipboard regression. Automatic popup/workbench-focus checks were explicitly skipped in headless mode.
- Full `bun audit --json`: no known vulnerabilities reported in the installed production or development dependency graph.
- Gitleaks 8.30.1: no leaks found in Git history or the staged publication snapshot.
- VSIX packaging: passed; the final manifest identifies `philipp-manhart.datsumi` 0.1.0 and all eleven optional driver sizes/hashes verify against the bundled catalog.

An initial mixed-engine native run intermittently failed a Forget Credentials prompt assertion. The credential service was hardened against stale/revoked backend reads, native query selection was made deterministic, and the complete grouped suite then passed. The full suite now uses the same core/extended isolation as CI. Dependency scans report only known published advisories and do not establish that packages or database servers are vulnerability-free.

## Remaining limitations

- SQL/database commands intentionally run with the database user's permissions. Server features may access extension-host or server files/networks. Workers are not a security sandbox.
- Query text/history and exports can contain confidential values; history is opt-out, retained locally, and can be cleared. Exact spreadsheet transfer preserves formula-like strings rather than modifying data silently.
- Native credential storage protection depends on VS Code's backend. Protect remote extension hosts and operating-system accounts.
- Hosted cloud authentication/rotation, Oracle TCPS wallets/client certificates, private endpoint routing and platform combinations outside the test matrix need separate deployment validation.

Sources: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [MSAL advisory](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5). Other dependency advisories are resolved in the lockfile and can be rechecked using `bun audit --json`.
