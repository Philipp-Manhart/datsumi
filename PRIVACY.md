# Privacy and network behavior

Datsumi does not send application usage analytics or query contents to a Datsumi backend. There is no Datsumi account or cloud sync service. VS Code itself, installed extensions, database servers, OS credential services and third-party download hosts have their own behavior and policies.

## What is stored

- Connection profiles: non-secret destination/settings in VS Code workspace extension storage.
- Passwords/tokens: session memory, or VS Code SecretStorage when **Save securely** is selected. Storage failures do not fall back to plaintext. Duplicated profiles do not inherit secrets. Destination edits require explicitly entered credentials.
- SSH trust: approved host-key fingerprints in extension storage. Private keys are read from the extension host or agent; key contents/passphrases are not saved by Datsumi.
- Query history: unencrypted local query text, connection labels, timing, counts and error excerpts. History is enabled by default, expires after 30 days and is bounded by count and 5 MiB by default. Favorites expire and count toward the byte budget. Production-labeled connections are excluded unless enabled in User Settings. Use **Clear Query History** to remove entries.
- Pending results/edits: memory only by default. Optional table-draft recovery stores unencrypted originals/changed values locally, at most ten 1 MiB drafts, with a seven-day default expiry. It is off by default and can only be enabled in User Settings. Restoring never executes writes. **Clear Saved Edit Drafts** removes persisted drafts; disabling recovery clears them. A saved draft file is also unencrypted.
- View preferences: column sizes/order/visibility, paging/filtering and diagram positions, stored locally.
- Clipboard/exports/backups: only when invoked. These may contain sensitive data; the OS clipboard or other applications may retain it. New export/backup/draft files use private POSIX permissions; Windows uses the destination's ACL inheritance. Exact TSV copying preserves formula-like values. Optional spreadsheet-safe CSV export changes those text values explicitly.

Local means the extension host: Remote SSH, WSL or a container may store data and run database clients on that remote system. VS Code storage/SecretStorage protection depends on that host and backend.

## Network requests

Connections send credentials and requested queries to the chosen database or SSH endpoint. Verified TLS is the default for supported secure transports. Explicit plaintext URLs/TLS-disabled connections are unencrypted. Database commands can trigger server-side network/file access under database permissions.

JavaScript workers are included in the VSIX and installed offline by default. An optional User-only driver download URL must match the extension-owned checksums. DuckDB native support downloads a pinned archive from the npm registry, verifies it and installs it locally; npm is not required. Installers do not send query data. Development test/release commands may download pinned tools, database images and native artifacts from their upstream hosts; they use generated fixture credentials.

Redacted diagnostics include product/runtime/engine/platform and transport categories, not raw server errors, credentials, destination hostnames, queries or database values. Review any additional logs or screenshots yourself before sharing them.
