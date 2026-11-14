# Local release checklist

GitHub Actions and automatic Git hooks are intentionally absent. Release verification is an explicit local command:

```sh
bun install --frozen-lockfile
DATSUMI_TEST_HEADLESS=1 bun run release:check
```

Start from a reviewed clean commit. The command installs the frozen dependency graph, runs all unit/component/real-database/native suites, audits dependencies, scans Git history and the exact source snapshot for secrets, builds the VSIX, validates inventories/catalog hashes/license/private-file exclusions and writes a SHA-256 sidecar. It then validates the installed VSIX on current/minimum VS Code, upgrade/reload/reinstall and runs synthetic result benchmarks. Its report is saved under ignored test-results/release. Every failing gate stops the run.

For development use `bun run release:check --allow-dirty`; its report always has releaseReady=false. Review and commit first, then rerun to approve a clean artifact. A clean report is evidence for that local commit/platform, not hosted-provider or cross-platform certification. Keep report/checksums with the release record. Use Python 3, Docker Compose, OpenSSL, VS Code/display and a functioning credential backend; see testing.md. Linux x64 downloads checksum-pinned Gitleaks automatically into a private verified cache. On other platforms set GITLEAKS_BIN to a trusted Gitleaks 8.30.1+ executable. libSQL's fixture similarly needs a trusted SQLD override outside Linux x64.

Before uploading:

- Check the version/changelog, MIT project license, current notices and privacy/support links.
- Resolve every reproduced data-integrity/security blocker; passing unrelated tests is insufficient.
- Test the actual platform(s) being advertised, including focused native keyboard/clipboard and credentials. Record skipped checks honestly.
- Test hosted accounts and Oracle TCPS separately if claiming those deployments. Never put their credentials in issues, source or logs.
- Inspect that all Actions workflow deletions are committed. To remove workflows from GitHub, push that deletion; deleting local files does not disable remote workflows or erase old runs.
- Build/tag the reviewed source, verify the artifact checksum, then upload that exact VSIX. Repository visibility, Marketplace publisher setup and private vulnerability reporting are separate deliberate remote actions.
- Enable GitHub private vulnerability reporting and verify the reporting link before making the repository public. Do not publish vulnerability details into a public issue while setting it up.

The release script never pushes, tags, changes repository visibility, creates a Marketplace publisher or publishes an extension automatically.

See [preview launch acceptance](launch-acceptance.md) for installed test prerequisites and manual platform/provider/publication gates. A clean local report does not override those gates.
