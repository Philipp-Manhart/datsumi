# Follow-up validation

Datsumi is an unpublished project. Previous-version upgrade certification is not a release requirement. This list records useful follow-up work without presenting unperformed tests as passes.

## Live cloud accounts

- [ ] Neon: direct/pooler endpoints, verified TLS, reconnect and role permissions on a disposable database.
- [ ] Supabase: direct/session-pooler endpoints, IPv4 routing, TLS, credentials and editing permissions. Transaction-pooler mode remains unsupported.
- [ ] Hosted Turso/libSQL: current hosted engine behavior, token expiry/rotation, reconnect and reviewed writes.
- [ ] Oracle cloud/TCPS wallets and SQL Server enterprise authentication where explicitly supported later.

Local protocol fixtures cover the supported core behavior. Provider-specific features and account policies are separate from wire-protocol compatibility. These account checks are follow-up tasks, not a reason to require contributors' private credentials.

## Additional environments and usability

- [ ] Run the existing native smoke suite on Windows/macOS when hardware or a suitable test service is available. Until then, retain the source/contract and official native-artifact audit evidence.
- [ ] Gather feedback from keyboard/screen-reader users; automated browser accessibility-tree tests cannot substitute for a person's assistive-technology experience.
- [ ] Test enterprise proxies and remote/WSL/container credential backends in representative deployments.
- [ ] Observe first-time users completing connect → query → copy → review → commit; prioritize confusing behavior over adding adapters.

Publication account setup and the public security-reporting channel are tracked separately in PUBLISHING.md.
