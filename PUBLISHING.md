# Publish Datsumi

Datsumi is an MIT-licensed project. This workflow prepares a public release without previous-version upgrade prerequisites, GitHub Actions, or access to private cloud accounts.

## 1. Validate a clean source commit

Install Node.js 24+, the Bun version in package.json, Docker Compose, OpenSSL, Python 3, and desktop VS Code. Native UI checks need a display; on headless Linux, use Xvfb. See docs/testing.md for environment details.

```sh
bun install --frozen-lockfile
bun run check
```

Review and commit the intended source, then run:

```sh
DATSUMI_TEST_HEADLESS=1 bun run release:check
```

The release command packages a fresh VSIX and records `localChecksPassed`, the source commit, exact artifact SHA-256, native/current/minimum installation evidence, UI checks, platform-artifact audit and benchmark results. It never labels these local checks as publication approval. No old VSIX download or upgrade baseline is required.

On Windows, use `$env:DATSUMI_TEST_HEADLESS="1"` in PowerShell before `bun run release:check`. Set VSCODE_EXECUTABLE to Code.exe or the full code.cmd path for a nonstandard installation. Linux x64 fetches checksum-pinned test tools/minimum VS Code automatically; other development platforms can use the documented trusted executable overrides. This does not affect extension end-user requirements.

## 2. Review the listing and public repository

The Marketplace page is **apps/extension/README.md**; the repository README has matching copy and repository-relative images. It states the actual supported engines, requirements, free MIT licensing, no Pro edition, and privacy behavior. `bun run screenshots` regenerates actual UI screenshots using an isolated synthetic database on Linux/X11; inspect them before committing. Never use production data or credentials.

The extension identity is **philipp-manhart.datsumi**, display name **Datsumi — Database Explorer**. Sign in to [Marketplace publisher management](https://marketplace.visualstudio.com/manage/publishers/) and confirm that you own **philipp-manhart** before publishing. Publisher ownership cannot be inferred from a package.json string or GitHub login. Resolve any name/identity issue before the first upload.

For the requested public repository, use GitHub repository Settings → General → Change repository visibility → Public when the source is ready. This command-line workflow does not silently change visibility. Check README, source, MIT license, privacy and support links anonymously. Then enable private vulnerability reporting in Settings → Code security and verify the Report a vulnerability form before announcing or uploading the extension. Do not use public issues for vulnerability details.

## 3. Record publication approval separately

Copy **publication-approval.example.json** to **publication-approval.json** (ignored by Git). Fill the exact commit and VSIX checksum from the successful local report, your reviewer name, and the publisher/listing checks after reviewing them; set approved to true only when that review is complete.

```sh
bun run publication:check
```

The command independently checks the local report, current commit, artifact checksum, anonymous public documentation, private-reporting status and explicit maintainer attestation. It writes test-results/publication.json. Pending account/public-repository setup is reported as pending, not mistaken for a failed database implementation. `--offline` can inspect the local evidence but cannot approve public links or security reporting.

Live cloud-account validation and extra native desktop/screen-reader feedback remain follow-up work in **TODO.md**. They do not require contributors to supply credentials or own several computers before contributing.

## 4. Upload the exact verified VSIX

The default package script creates a regular Marketplace release with no Preview label or pre-release channel flag. In publisher management choose **New extension → Visual Studio Code** for the first upload (or the existing extension's upload action afterward), and upload **apps/extension/datsumi-<version>.vsix** from the successful report. Confirm the regular release channel and the rendered README/images, then publish. Keep the checksum/report with the release. Do not rebuild between approval and upload.

Create a source tag and GitHub release pointing to that same commit, and attach the identical VSIX/checksum plus validation report. The local scripts do not push, publish, create accounts, save publishing tokens, or alter repository visibility. A custom domain and publisher verification badge are optional; they are not prerequisites for publishing this extension.

To publish a preview intentionally, use a distinct version, set the manifest Preview label, and package with `--pre-release`. Microsoft requires different version numbers for regular and pre-release uploads; an existing pre-release cannot be overwritten as a regular release with the same version.
