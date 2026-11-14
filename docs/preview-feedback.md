# Preview tester checklist

Use synthetic data or a disposable copy of a development database. Include OS/architecture, VS Code version, Datsumi version and **Copy Redacted Connection Diagnostics** with feedback. Never share real credentials or customer data.

1. Install the VSIX in a fresh VS Code profile. Find the single Add Connection action without instructions, connect to SQLite or a development server and open a table.
2. Write a query, check keyword/table/column completion, format explicitly using Datsumi and run it. Can you identify the active connection and find results/history?
3. Copy across multiple pages into a spreadsheet. Try Ctrl/Cmd+A, Shift+A and C while focused in the grid, then repeat in the search box to confirm normal text selection. Check headers, NULL/empty values, tabs/newlines and large integers.
4. Stage several edits, cancel the commit confirmation, then commit after review. Create a concurrent edit to cause a conflict. Confirm no partial batch was applied and the draft remains.
5. Disconnect or close a view with pending edits and an open transaction. Save a draft before ending the session. Reload and verify the connection/history/preferences; try opt-in recovery separately.
6. Test keyboard-only dropdowns, menus, inspectors and grid selection. Repeat with a high-contrast theme, zoom and a screen reader; report the exact control/focus issue.
7. Try invalid credentials, a bad TLS certificate and a slow/unreachable endpoint. Error messages should explain the next action without exposing secrets.

Report where you got stuck, the action you expected to find, and the smallest synthetic reproduction. A clean screenshot is useful; review it for paths, hostnames, tokens and private data before sharing. Do not send security details to a public issue. See SECURITY.md for private reporting.
