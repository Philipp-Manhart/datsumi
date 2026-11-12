# Publication readiness review — 2026-11-11

Decision: hold the next public extension release until the data-integrity and read-only findings below are resolved. Open sourcing also needs a deliberate license choice and complete bundled notices. The existing test suite is substantial; it needs targeted safety regressions, not a replacement framework or more database adapters.

Scope: local working tree including uncommitted 0.1.1/0.1.2 work; extension host, webviews, protocol, shared SQL layer and engine transports, credentials/TLS/SSH, installers, history/export, build/packaging, test runners, dependency graph and Git history. This is a source review with isolated reproductions, not an independent penetration test. No live database or supplied production credential was used.

## Domain checks

Checked registry registration data on 2026-11-11. Interpret the request as the separate suffixes `.f`, `.dev`, `.io`, `.com` and `.org`; `.app` is included as another product-oriented option.

| Domain      | Observed result                           | Evidence                                                                                                                                          |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| datsumi.dev | No registration record; appears available | [Google Registry RDAP](https://pubapi.registry.google/rdap/domain/datsumi.dev), HTTP 404                                                          |
| datsumi.io  | No registration record; appears available | [Identity Digital RDAP](https://rdap.identitydigital.services/rdap/domain/datsumi.io), HTTP 404; `whois.nic.io` also returned `Domain not found.` |
| datsumi.com | Registered                                | [Verisign RDAP](https://rdap.verisign.com/com/v1/domain/datsumi.com), HTTP 200                                                                    |
| datsumi.org | No registration record; appears available | [Public Interest Registry RDAP](https://rdap.publicinterestregistry.org/rdap/domain/datsumi.org), HTTP 404                                        |
| datsumi.app | No registration record; appears available | [Google Registry RDAP](https://pubapi.registry.google/rdap/domain/datsumi.app), HTTP 404                                                          |
| datsumi.f   | Not a delegated top-level domain          | [IANA root-zone TLD list](https://data.iana.org/TLD/tlds-alpha-by-domain.txt)                                                                     |

Recommendation: `datsumi.dev` as the primary site, optionally `datsumi.app` as a redirect. No-record responses do not establish a standard registration price, exclude a reserved/premium name, or reserve the domain. Confirm availability and renewal price at the registrar before buying. No domain was purchased. Domain registration is also separate from name/trademark clearance.

## Changes made in this review

- Removed `.github/workflows/database-tests.yml`, the only GitHub Actions workflow in the working tree.
- Updated the root README and testing guide to describe local release checks instead of claiming Actions runs them.
- Preserved all test scripts, fixtures and safeguards. No replacement CI, background automation or Git hooks were installed.
- Left the dated October security review intact as historical evidence; it is not a description of the current release configuration.

These are local changes. Nothing was committed, pushed, published, or made public. The workflow still exists on GitHub's current branch until its deletion is pushed. Old workflow runs are not erased by deleting the source file.

## Release blockers: extension safety and distribution

### R1 — High: read-only server connections can execute writes

Evidence: `packages/drivers/sql/src/database.ts:71` forwards editor SQL to `backend.run()` without enforcing `config.readOnly`; the flag gates schema editability and staged grid writes instead. The form calls this setting **Read-only connection**.

Confirmed against disposable real MySQL and libSQL servers. With `ServerDatabase` configured `readOnly: true`, MySQL accepted an UPDATE, and libSQL accepted CREATE TABLE and INSERT. These used writable fixture accounts, demonstrating that the client setting supplies no protection for editor SQL. SQLite and DuckDB have separate engine-level read-only file handling; the finding is about the shared server SQL path.

Before release: either implement and test database-enforced read-only sessions/roles where available, clearly explaining their limits, or immediately rename the existing control to **Disable grid editing — editor SQL still uses your account permissions**. Do not advertise it as database-wide read-only. A SQL keyword blacklist is not a reliable security boundary; procedures/functions and session settings can have side effects. Recommend actual read-only database accounts when writes must be impossible.

Required tests: raw INSERT/UPDATE/DELETE/DDL and multi-statement requests with the setting enabled, including stored procedures, transactions, reconnect, and credentials with genuinely restricted server permissions.

### R2 — High: temporary-table shadowing invalidates atomic-edit guarantees

Evidence: catalog introspection reports permanent table engine/key metadata (`catalog.ts`); `ServerDatabase.schema()` trusts InnoDB metadata at `database.ts:174`; `changes()` runs the generated batch against session-resolved identifiers and reports rollback on a zero-row conflict (`database.ts:382`). Captured-result editing also infers origins from SELECT text and output names (`apps/extension/src/results/editableResult.ts:58`).

Confirmed against a real disposable MySQL 8.4 server:

1. Create a permanent `customers` table using InnoDB.
2. Create a session temporary table of the same name using MEMORY, with the same columns and initial values.
3. Introspection sees the permanent InnoDB table and marks the resource editable, while SELECT/UPDATE resolve to the temporary MEMORY table, including schema-qualified references.
4. Stage two updates: the first matches; the second uses a stale original value.
5. The adapter reports that the batch was rolled back, but the first temporary row remains changed because MEMORY is not transactional.

Observed output:

```text
Temporary MEMORY table inferred as editable from permanent InnoDB metadata: true
Reported: Edit conflict ... The batch was rolled back; your draft is retained.
Actual temporary row after reported rollback: edited
```

A separate in-memory SQLite reproduction of the shared layer also demonstrates the danger of inferring a permanent source from an unqualified SELECT when a temporary object shadows it. This is not a claim that the remote libSQL fixture supports temporary tables: its server rejected CREATE TEMP TABLE. The concrete shipped-engine rollback failure above is MySQL.

Before release: establish the actual session-resolved target, identity and transactional capability before enabling/applying edits. Fail closed when temporary objects or search-path/catalog changes make that proof unavailable. Merely adding a schema prefix does not solve the demonstrated MySQL case. Treat unknown commit/rollback outcomes honestly rather than asserting nothing changed. Apply the protection to table browsing/editing as well as captured results.

Required tests: MySQL and MariaDB nontransactional temporary-table shadowing, same-named tables across schemas/catalogs, temporary objects, changed search paths, and duplicate/nonunique keys. Assert the stored values after failure, not only the reported error.

### R3 — Blocker for open source: no project license

The root has no project LICENSE file, and `apps/extension/package.json` declares `UNLICENSED`; the inspected VSIX does too. Making the repository public does not supply an open-source license. [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains this distinction.

Choose a license before opening the repository. MIT is a straightforward permissive option; Apache-2.0 is another deliberate choice if its terms fit the project. Add the chosen license at the root and include it in the extension package, set consistent manifest SPDX identifiers, and decide whether the logo/name have separate usage rules. No license was chosen on the owner's behalf.

### R4 — Blocker for distribution: webview dependency notices are incomplete

The inspected 0.1.2 VSIX includes CORE, Codicons, Dagre and engine notices, but no React/react-dom/scheduler/Tailwind notices. Its webview JS/CSS also contains no full MIT permission notice. `apps/extension/esbuild.mjs` collects the host's esbuild inputs and adds selected webview notices manually; that does not inventory the complete Vite dependency graph.

Before release: generate notices from the actual bundled webview inputs as well as host/workers/native artifacts. Include full required license/copyright text, retain upstream NOTICE files, and verify the final VSIX rather than just node_modules. Add a packaging assertion that each shipped third-party component has a recorded license/notice. Recheck any native artifacts separately.

## Security hardening before broad adoption

1. **Protect the test executable cache.** `packages/drivers/sql/test/run-remote.mjs:16` uses a predictable shared `/tmp/datsumi-libsql-<version>` location and trusts an existing `sqld` based only on `access()`. The downloaded archive is hashed, but a cached executable is not revalidated before execution. This is a developer-machine local pre-seeding/tampering risk, not an end-user installer finding. Use a user-owned private cache, reject unexpected ownership/symlinks, and verify the executable on reuse. Test a tampered cache. Production driver/native installers already verify their cached artifacts.
2. **Make data retention explicit.** History is plaintext and enabled by default, including SQL text and error excerpts. Existing per-connection opt-out/clear controls are useful; add a short first-use explanation, optional expiry and an overall byte budget. Favor opt-in history for production connections. Do not claim arbitrary SQL can be perfectly redacted automatically.
3. **Offer spreadsheet-safe export separately from exact copy.** Existing TSV intentionally preserves values, including formula-like strings. Preserve the requested exact Excel copy workflow; add an explicit safe-export option for untrusted datasets and tests for `=`, `+`, `-`, `@`, leading whitespace and embedded delimiters. Document that quoting alone does not neutralize spreadsheet formulas.
4. **Private file permissions.** Export functions use default creation permissions. On a common Unix umask this can leave newly exported sensitive data readable by other local users. Prefer mode 0600 for new export/temporary files, preserve intentional existing-file permissions where appropriate, and document Windows ACL behavior. Test success, cancellation and failure cleanup.
5. **Bound installation waits.** `DriverInstaller.download()` has size/hash checks and rejects redirects, but no default timeout; DuckDB's native installer already has one. Add a bounded timeout, cancellation and retry UX, including stalled-body tests. Apply finite waits and download size limits to maintenance runners too.
6. **Publish a privacy/network statement and a working security contact.** Describe saved profiles, SecretStorage, history, clipboard/exports, database traffic, optional registry downloads, Remote SSH execution location and any diagnostics. I found no application telemetry sender in the reviewed host/webview paths; keep that explicit and recheck dependencies before claiming no telemetry. Verify private vulnerability reporting is enabled when the repository becomes public; provide an alternative private contact.

These are scoped findings and hardening recommendations. Workers remain trusted code with the extension host user's filesystem/network access; they are not an OS sandbox. The existing SECURITY.md states that correctly.

## User-facing improvements worth prioritizing

- **Explain why editing is unavailable.** Show whether the reason is a read-only role, disabled grid editing, no primary key, generated/shortened data, an ambiguous result, an open transaction, or an unsupported engine. Provide a concrete next action. ClickHouse should remain explicitly excluded from transactional grid claims.
- **Edit and duplicate connection profiles.** Allow changing host/database/TLS/access settings without deleting and recreating the connection; invalidate/reconfirm credentials and SSH trust bindings when the destination changes. Keep secrets out of copied profiles. Add actionable token-expiry, TLS and SSH errors with a redacted “Copy diagnostics” action.
- **Do not lose pending work silently.** Table-panel disposal currently discards staged state. Give a close/reload warning where the VS Code API permits; offer explicit opt-in local draft recovery or an exportable change draft. Recovery must never automatically write to a database and needs a retention policy.
- **Make the active target unmistakable.** Keep connection/database/environment and transaction state visible next to Run and Commit, especially for production. An environment color is useful context, not an access-control boundary.
- **Harden large-result behavior.** Keep the existing full-copy budget and cancellation; stress-test wide rows, multi-megabyte cells, 10,000+ rows, 1,000 staged edits and large schemas. Add progressive loading/virtualization only where measurements show stalls. Prefer seek/keyset paging where offset paging becomes expensive; clearly separate snapshots from live paged data.
- **Polish keyboard/accessibility behavior.** Test real Cmd/Ctrl selection/copy, menus, focus return, contrast and screen-reader navigation in a focused VS Code window on macOS, Windows and Linux. Provider-level tests do not prove native shortcut routing or suggestion popup behavior.
- **Finish SQLite basics before adding engines.** Explicit create-database and backup actions are more useful than another adapter; use the SQLite backup API rather than copying a live WAL database file. Then consider safe projected-result editing and better dialect-specific SQL completion.

Do not prioritize dashboards, administration consoles, schedulers, AI chat, a visual migration designer or additional databases before these issues are resolved.

## Developer/repository improvements

1. Add a short CONTRIBUTING.md: exact tool versions, clean install, F5 debug flow, small test commands, full local release procedure, adapter contract, how to reproduce a bug safely, and rules against uploading credentials/customer data. Add bug/feature templates and a support policy if useful; these do not require Actions.
2. Add a local release-check command combining frozen-lockfile install, formatting/lint/types/unit tests, all real database/native suites, dependency/secret scans, VSIX packaging and artifact verification. It should produce a saved checklist/report and require an intentional invocation. No automatic hooks or GitHub workflows are needed.
3. Record a truthful support matrix: tested server versions, driver features, OS/CPU combinations, VS Code/Node minimums, authentication, SSH and data-type limits. libSQL/Turso transports are tested against libSQL; that is not a live hosted-new-Turso certification. Verify Neon/Supabase against the actual hosted services before claiming provider certification. Test Oracle TCPS on a real listener before claiming that deployment has integration coverage.
4. Pin container fixture images by digest or exact patch versions and update intentionally. Compose currently includes movable tags such as `postgres:17`, `mysql:8.4` and SQL Server `2022-latest`; “pinned” in old documentation overstates reproducibility.
5. Split the largest modules along real responsibilities: DataGrid.tsx is about 1,540 lines and extension.ts about 985. Extract selection/clipboard, edit-draft/review state and connection/command registration with behavior tests first. Avoid replacing working abstractions or adding a broad framework.
6. Add focused coverage reporting for security-critical paths and adapter capabilities. Favor assertions about database state, no-write-before-review, rollback, credential destination binding, hostile IPC, redaction and artifact verification over a global 100% line-coverage goal. Add small property/fuzz cases for URLs, identifiers, SQL origin inference and JSON/BSON round trips.
7. Separate current docs from dated research. The README still mixes old release introductions and partially stale limits; the October audit has older test counts and historical Actions claims. Keep historical reviews dated and link them from a concise current capability/release page.
8. Publish the source that actually built the artifact: review the existing uncommitted work, commit/tag it, build from that clean checkout, inspect VSIX contents, and attach checksums. Decide Marketplace publisher/repository visibility separately. Do not make the repository public until the license and secret/notice checks are complete. [VS Code publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) covers the publisher/manifest/README requirements; no Actions workflow is necessary to run vsce locally.

## Validation performed today

- `bun run check`: passed; 246 unit/component/local-worker tests across 44 files. Lint still reports warnings; passing does not mean warning-free.
- `DATSUMI_TEST_HEADLESS=1 bun run test:all`: passed. In addition to those 246 tests: 68 core SQL, 20 extended SQL, 15 MongoDB/Redis, and 20 libSQL/Turso tests passed — **369 automated test cases total**. Fourteen engine/group-specific cases were intentionally skipped across the SQL groups.
- Native VS Code checks passed for setup, credential lifecycle, SQL providers, history, SSH, SQLite/DuckDB, and 12,001-row clipboard behavior. Automatic popup/workbench-focus checks were explicitly skipped in headless mode. These are not fresh Windows/macOS runs.
- `bun audit --json`: `{}` — no known advisories reported by the configured audit source at check time.
- Checksum-verified Gitleaks 8.30.1: no findings in Git history or a snapshot of all current tracked/unignored source files. Scanner reports were redacted. No tracked .pem/.key/.env/database/VSIX files were found by the publication inventory check.
- Existing `apps/extension/datsumi-0.1.2.vsix` inspected: no source/test/private-key/database/source-map payloads; expected worker and notice layout present. Project-license and webview-notice gaps described above remain.
- Isolated additional MySQL reproduction confirmed the temporary-table rollback failure and editor-SQL read-only bypass. An isolated authenticated libSQL reproduction also confirmed the read-only bypass. These adversarial cases are not yet regression tests in the passing suite.

Passing existing tests does not clear the reproduced safety findings. This review made the requested Actions removal and documentation updates, not the functional fixes listed above. No new extension release was published.
