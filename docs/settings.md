# Customizing Datsumi

Open **Settings**, search `@ext:philipp-manhart.datsumi`, or search `Datsumi`. Settings are grouped into Results, SQL Editor, History & Privacy, Connections, Export and Advanced. VS Code's theme, editor font and native SQL editor settings remain authoritative; there is no second theme/font system.

| Setting                                     | Default     | Effect                                                                                                                                |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `datsumi.results.defaultPageSize`           | 100         | New table/result page size, 25–500. Existing saved per-table choices win. Select-all copy still includes the entire available result. |
| `datsumi.results.density`                   | comfortable | Comfortable or compact result cells.                                                                                                  |
| `datsumi.results.showDataTypes`             | true        | Show/hide type labels under column names. Copy never includes types.                                                                  |
| `datsumi.results.nullDisplay`               | NULL        | Display label only, up to 24 characters. Copied NULL remains an empty field.                                                          |
| `datsumi.results.reuseTabs`                 | true        | Reuse the active unpinned result on the same connection.                                                                              |
| `datsumi.sql.format.keywordCase`            | upper       | Upper, lower or preserved keyword case; literals remain unchanged.                                                                    |
| `datsumi.sql.format.linesBetweenQueries`    | 1           | Blank lines between statements, 0–3.                                                                                                  |
| `datsumi.sql.completion.enabled`            | true        | Datsumi keyword/schema completion. Other completion extensions are independent.                                                       |
| `datsumi.history.enabled`                   | true        | Store query history locally, unencrypted.                                                                                             |
| `datsumi.history.limit`                     | 200         | Recent queries; favorites remain subject to age and byte limits.                                                                      |
| `datsumi.history.retentionDays`             | 30          | Expire history, including favorites. Zero disables age expiry.                                                                        |
| `datsumi.history.maxStorageMiB`             | 5           | Overall serialized history budget, including favorites.                                                                               |
| `datsumi.history.recordProduction`          | false       | User-only opt-in for production-labeled connection history.                                                                           |
| `datsumi.history.disabledConnections`       | []          | Connection IDs excluded from history; also available in connection context menus.                                                     |
| `datsumi.connections.defaultCredentialMode` | session     | User-only initial choice: session, ask or save securely.                                                                              |
| `datsumi.export.spreadsheetSafe`            | false       | Prefix formula-like CSV text with an apostrophe. Exact TSV clipboard and JSON do not change.                                          |
| `datsumi.drafts.recoveryEnabled`            | false       | User-only opt-in to unencrypted local SQL table-draft recovery. Never auto-applies.                                                   |
| `datsumi.drafts.retentionDays`              | 7           | Saved draft lifetime, 1–30 days; also bounded to ten 1 MiB drafts.                                                                    |
| `datsumi.drivers.downloadBaseUrl`           | empty       | Advanced User-only HTTPS artifact host. Normally leave empty for bundled workers.                                                     |

Result appearance changes apply to open views. Initial defaults apply to new views/forms; an existing table's saved page size remains intact. Use **Clear Query History** and **Clear Saved Edit Drafts** for deletion. History expiry is enforced on loading/using history; draft expiry is enforced when reading/saving drafts. These are local retention controls, not secure erasure guarantees for backups or the OS.

Connection access is separate from global Settings. SQLite/DuckDB file read-only mode is enforced by their engines. For server SQL connections **Disable grid editing** only blocks Datsumi's staged edits: editor SQL retains the account's permissions. Use a database-enforced read-only account when all writes must be prohibited. TLS verification and edit confirmation cannot be disabled through a convenience preference.
