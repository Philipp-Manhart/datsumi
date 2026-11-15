# Security policy

Datsumi is a database client. Only run SQL/commands you trust, and use database accounts with the least privileges needed. A worker process is a cancellation and fault-isolation boundary, not an operating-system sandbox: SQL features can access files or networks available to the extension host.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Philipp-Manhart/datsumi/security/advisories/new). Please do not include vulnerability details, exploit steps, tokens or database contents in a public issue. If the reporting form is unavailable, do not disclose details publicly; the maintainer must restore a private reporting channel before publication. See PUBLISHING.md for the maintainer setup check.

## Protections

- Passwords and tokens use VS Code SecretStorage or session memory. They are excluded from saved connection profiles, process arguments and worker environments. Credential reuse is bound to connection settings and execution environment; storage failures never fall back to plaintext.
- Database TLS verifies certificates by default. Disabling TLS is explicit. SSH pins host-key fingerprints after native confirmation, rejects changed keys, and keeps database certificate identity through tunnels.
- Webviews have a restrictive Content Security Policy, nonce-protected scripts and restricted local resource roots. Messages are schema-validated; staged data edits require host-side review and native confirmation. Explicit queries use the database account’s permissions.
- Optional drivers and DuckDB native packages are pinned by hashes and sizes. Downloads require HTTPS and reject redirects. Native archive extraction accepts only expected regular files.
- Database operations require a trusted workspace. Workers receive an allowlisted environment rather than arbitrary host credentials or Node preload configuration.

## Limits

Query text/history, copied data and exports may contain sensitive information and are not encrypted by Datsumi. History can be disabled or cleared. Raw CSV/TSV values are preserved; spreadsheet applications may interpret formula-like strings. Review untrusted data before opening it in a spreadsheet. Use read-only server accounts when writes must be prohibited; UI protections do not replace server permissions. Explicit plaintext database URLs are unencrypted. Secrets on a remote extension host depend on that host and VS Code's credential backend.

See [the current support and validation matrix](docs/support-matrix.md), [privacy statement](PRIVACY.md), and [the historical release audit](docs/archive/security-audit.md) for the scope and evidence of the pre-publication review. An automated or source review cannot guarantee the absence of vulnerabilities.
