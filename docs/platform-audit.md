# Desktop portability audit

VS Code's JavaScript extension APIs are portable, but extensions that use native binaries, filesystems, subprocesses or OS credential stores also have platform-specific behavior. Datsumi is designed for Windows, macOS and Linux desktop/workspace extension hosts.

## What is checked from this workspace

- SQL/NoSQL clients use cross-platform JavaScript transports and workers launched with Node child_process.fork, not shell commands. Paths and URIs use Node/VS Code APIs. Worker environments retain Windows SystemRoot while excluding arbitrary host credentials and Node preloads.
- SSH supports key files on the extension host, Unix agents and the Windows OpenSSH named pipe. User-entered key paths must be absolute or use the documented home expansion.
- File publication uses Node filesystem APIs and atomic replacement. Windows file locks can reject an operation safely; private POSIX modes are not a promise about Windows ACLs.
- DuckDB has pinned official archives for Linux glibc/musl x64/arm64, Windows x64/arm64 and macOS x64/arm64. `bun run platform:check` downloads all eight and verifies archive integrity, exact expected files, per-file hashes and licenses without executing foreign-platform code.
- Platform selection and Windows/macOS launcher/path construction have contract tests. The Windows developer launcher invokes Code.exe and its CLI module directly, keeping paths with spaces out of a command shell.
- The webview uses platform-neutral DOM keyboard events, both Ctrl/Meta modifiers and VS Code theme tokens. Native rendered-webview tests check selection, text inputs, menus, editors, dropdowns and the accessibility tree on the available Linux desktop.

## Evidence and its limits

`test-results/platform-audit.json` records verified artifacts. The installed/runtime and UI reports record actual local OS and VS Code versions. Native Windows/macOS execution cannot be proven by running their binaries on Linux; source and contract inspection plus official payload verification provide compatibility evidence, not fabricated native test results. Additional native desktop runs are follow-up tasks in TODO.md, not an upgrade certification gate for this unpublished project.

End users need neither npm nor a system Node/compiler. Native support runs on the extension host, including remote hosts. VS Code web/virtual/untrusted workspaces are outside the supported runtime.
