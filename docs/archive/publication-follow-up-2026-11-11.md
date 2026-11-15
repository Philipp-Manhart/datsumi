# Publication follow-up — 11 November 2026

This follows the historical [readiness review](publication-readiness-2026-11-11.md). The repository remains private. No Marketplace publication or visibility change is part of this update.

## Release blockers addressed

- **R1: honest server access controls.** Server connections now say “Disable grid editing” and explain that editor SQL retains database-account permissions. Use a server-enforced read-only account to prohibit all SQL writes. File database read-only controls remain engine-enforced.
- **R2: safe edit targets.** MySQL/MariaDB reject temporary-table shadows, acquire metadata protection during application and recheck the permanent table's InnoDB engine before writing. Real-server regressions assert rejected edits leave values intact. Captured server results require an unambiguous, schema-qualified direct table selection; unsupported results explain why editing is unavailable.
- **R3: project license.** Original project source/assets now use MIT. The LGPL MariaDB connector was replaced by the existing mysql2 transport, with real MariaDB validation. Third-party components retain their own terms.
- **R4: distributable notices.** Build-generated component inventories include host, workers, native wrappers, webview and CSS inputs. Full license notices accompany them. Missing or unreviewed licenses stop the build, and packaging verifies notice coverage. See [license audit](../license-audit.md).

## Other implemented improvements

Driver download timeouts, private verified development-tool caches, private export/draft creation, opt-in spreadsheet-safe CSV, SQLite online backup and exclusive creation, connection edit/duplicate/diagnostics, actionable connection errors, bounded history retention and opt-in draft recovery are implemented. Saved drafts are unencrypted and never apply automatically. Sensitive history/credential/recovery defaults are User-only settings; workspaces cannot opt users into them.

Settings are grouped in the native VS Code Settings UI; [the settings reference](../settings.md) describes defaults and limits. The README, contributor, privacy, support and security documentation explain current behavior rather than promising every deployment is certified.

GitHub Actions workflows were removed from source. Issue templates remain. The explicit [local release gate](../release-checklist.md) runs formatting, lint, type checking, unit/component tests, disposable real-database and native extension tests, dependency audit, redacted secret scans, build and package verification. It records the source commit and refuses to approve a dirty tree.

## Remaining release acceptance

Linux local/container tests cover the current adapter families, including PostgreSQL, MySQL, MariaDB, SQL Server, ClickHouse, Oracle, MongoDB, Redis, SQLite, DuckDB, libSQL and Turso protocol behavior. Neon and Supabase share PostgreSQL code; local preset tests are not live hosted-service certification.

Before public launch, independently validate Windows/macOS native installation, credentials, keyboard focus/clipboard and file permissions, live hosted-provider accounts and Oracle TCPS if advertised. Headless native checks intentionally omit focus-dependent interactive checks. Consult the release report and [support matrix](../support-matrix.md) for evidence rather than interpreting skipped checks as passes.

Push the workflow deletion before expecting remote Actions to disappear. Verify GitHub private vulnerability reporting before making the repository public; its status could not be verified for the private repository. Marketplace publisher setup, public visibility, release tags and uploads remain deliberate release operations. No security audit can guarantee absence of defects.
