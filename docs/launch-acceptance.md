# First-publication acceptance

This is an unpublished project. Do not require upgrade certification or a previous private VSIX before validating a fresh installation.

The implementation gates are formatting, lint, types, unit/component and disposable database tests, native VS Code workflows, real rendered-webview keyboard/accessibility-tree checks, dependency/secret scans, verified platform archives, current/minimum fresh VSIX installation, notices and package verification. See [testing](testing.md) and the generated test-results reports.

The local gate records **localChecksPassed** and an exact artifact identity. Publication approval is separate: the maintainer confirms publisher ownership and copy, public documentation is reachable, private security reporting is enabled, and the reviewed source/artifact hashes match. [PUBLISHING.md](../PUBLISHING.md) gives the exact workflow. No script publishes or changes visibility automatically.

Datsumi is designed for Windows, macOS and Linux desktop VS Code. The [platform audit](platform-audit.md) records what can be established from source/contract tests and official native payloads on the available machine. Tests must never claim foreign native execution took place when it did not. Extra desktop runs and human assistive-technology feedback are useful follow-ups, not fictitious completed certifications.

Live Neon, Supabase and Turso/libSQL account exercises are explicitly in [TODO.md](../TODO.md). Local fixtures cover core protocols; provider-specific authentication, token policies and routing remain deployment-dependent.

Use synthetic data for screenshots and acceptance exercises. Never publish private credentials, user databases or unredacted history. The canonical product copy is apps/extension/README.md; actual screenshots live in apps/extension/media. The root README adds contributor entry points. Third-party code and assets retain their notices while Datsumi's own source/assets use MIT.
