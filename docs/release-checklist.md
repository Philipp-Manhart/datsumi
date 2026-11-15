# Local release checklist

Use [PUBLISHING.md](../PUBLISHING.md) for the complete first-publication workflow.

- Start from a reviewed, clean source commit; use the frozen dependency lockfile.
- Run `DATSUMI_TEST_HEADLESS=1 bun run release:check` (or use the equivalent environment setup in your shell).
- Keep the generated source commit, exact VSIX hash and installed/native/UI/platform evidence together. Local success is recorded as **localChecksPassed**, never as automatic publication approval.
- Review Marketplace copy, screenshots, MIT/dependency notices, support/privacy links and publisher ownership.
- For publication, make the intended GitHub source/docs public and verify private vulnerability reporting, then complete the separately bound maintainer attestation and `bun run publication:check`.
- Upload the exact verified pre-release VSIX and tag its matching source commit.

For development evidence use `--allow-dirty`; it never approves a clean release artifact. This unpublished project has no previous-version upgrade gate or private baseline artifact dependency. GitHub Actions and automatic hooks are intentionally absent.

Cloud account exercises and extra native desktop/assistive-technology feedback are tracked in [TODO.md](../TODO.md). No local check can fabricate a Windows/macOS runtime result on Linux; the platform audit records source/contract and official binary integrity evidence explicitly.
