# Preview launch acceptance

Datsumi 0.3 is a preview. Local automated evidence is necessary but does not certify every deployment. Do not add database adapters until the initial preview has user feedback.

## Automated local gates

`bun run release:check` requires a clean commit and runs the complete existing database/native suite, audit and secret scans, VSIX verification, installed-package lifecycle acceptance on current VS Code and the declared minimum, and synthetic result benchmarks. Keep reports and VSIX SHA-256 together. No GitHub Actions are used.

The installed-package runner installs the real distributable in isolated profiles. Test fixtures are staged under the installed extension only to share VS Code's extension-scoped API for instrumentation; production assets/entrypoints are never replaced. A normal-session harness is used because VS Code test mode uses ephemeral storage and cannot prove persistence. VS Code 1.146+ shared application storage is also redirected into the isolated fixture; user-data-dir alone is insufficient on those versions. Completion markers are mandatory because a successful CLI exit alone does not prove an assertion passed. The upgrade baseline must match the published v0.1.0 asset SHA-256. Set `DATSUMI_TEST_PREVIOUS_VSIX` when that baseline is elsewhere. Download it from the authenticated private GitHub release before running the gate.

`bun run test:minimum` uses checksum-pinned VS Code 1.138.0 on Linux x64. On other platforms set `DATSUMI_TEST_MINIMUM_CODE` to a trusted CLI for that exact version. `VSCODE_EXECUTABLE` selects the current runtime. These commands do not modify the normal VS Code profile.

`bun run benchmark:results` records synthetic long, wide and nested-JSON capture/sort/copy measurements. RSS deltas are indicative, include runtime allocation/GC effects, and are not maximum-memory guarantees. Retained snapshots have a 128 MiB serialized-data budget; captures/clipboard have separate limits. No data is silently evicted. Copy cancellation leaves the existing clipboard intact.

## Manual/platform acceptance before advertising support

Record OS, architecture, VS Code version, VSIX checksum and result for each row. An untested row is not a pass.

| Check                                                                                             | Linux x64                                            | Windows x64/arm64       | macOS x64/arm64         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- | ----------------------- |
| Fresh installed VSIX and minimum/current VS Code                                                  | Local automated gate                                 | Requires target machine | Requires target machine |
| Upgrade/reload/reinstall: profiles, preferences, history and secure credentials                   | Local automated gate                                 | Requires target machine | Requires target machine |
| Focused Cmd/Ctrl+A, Shift+A and C; input fields retain native selection                           | Manual focus review plus native clipboard tests      | Required                | Required                |
| Arrow/Shift selection, dropdown keyboard, Escape, screen reader and high contrast                 | Required                                             | Required                | Required                |
| DuckDB native install, paths with spaces/Unicode, SSH keys and credential backend                 | Local native fixtures; manual desktop review         | Required                | Required                |
| Slow network, disconnect mid-query/commit, read-only accounts, invalid TLS, cancelled copy/export | Automated regression coverage plus manual acceptance | Required                | Required                |

Use a synthetic development database. Stage multiple edits, simulate a conflict, cancel confirmation, and confirm no writes. Interrupt COMMIT acknowledgement: the outcome must be treated as unknown, no automatic retry occurs, drafts remain, and subsequent staged writes require disconnect/reconnect and fresh inspection. The client cannot determine whether a server committed after acknowledgement was lost.

Close/disconnect with pending edits and an open transaction. Confirm warnings explain drafts and transaction consequences. Recovery is opt-in; closing native panels cannot always be prevented. Save required drafts before ending the session.

Hosted Neon/Supabase/Turso, Oracle TCPS/wallets, provider token rotation, corporate proxies and remote/WSL/container credential backends need their own account/environment acceptance. Local protocol fixtures cannot certify these.

## Public launch operations

1. Confirm a working private vulnerability reporting channel before changing repository visibility. The current private-repository API returns 404; reporting is not verified. Do not invite sensitive public reports as a substitute.
2. Decide repository visibility explicitly. Check README/privacy/support links anonymously after public access is enabled. Offline Help and Privacy remains available inside the VSIX independently.
3. Verify Marketplace publisher ownership. Package the preview with `vsce package --pre-release` and upload the exact verified artifact through publisher management; preserve its checksum. Do not rebuild between validation and upload. No stored publishing credential, automated workflow or publication is created by the release gate.
4. Tag the reviewed source and attach the matching artifact/checksum and validation reports to the release. Version 0.3.* is reserved here for the preview channel; future stable/pre-release versions must remain distinct.
5. Invite a small group of testers. Ask them to complete connect → query → copy → stage → review → commit on synthetic data and report confusing behavior. Prioritize data integrity, installation, accessibility and discoverability before feature growth.

Screenshots must show the actual installed extension with synthetic data, never a user's existing workspace or credentials. `bun run screenshots` supports Linux/X11 with ImageMagick import and xprop. Inspect generated images before adding them to the Marketplace README. Other desktops require manual captures.
