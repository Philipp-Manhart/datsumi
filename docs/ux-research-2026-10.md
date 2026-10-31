# Focused UX and non-SQL expansion review

Reviewed 2026-10-26 against the local implementation and official product sites. Recommendations and complexity assessments below are engineering judgments, not measured user demand or delivery estimates. This is research only; no recommended feature was implemented as part of this review.

## What competing clients emphasize

- **JetBrains DataGrip / IntelliJ database tools:** context-aware SQL assistance, multiple data views, history/recovery, result comparisons, environment colors, quick object navigation, and execution plans. The useful pattern here is supporting the full debugging loop without losing context. Sources: [feature overview](https://lp.jetbrains.com/datagrip/features-overview/), [data views](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html), [query workflow](https://lp.jetbrains.com/datagrip/running-queries/), [connection organization](https://lp.jetbrains.com/datagrip/databases/).
- **DB Pro:** record inspector with JSON/SQL views, comparison of selected records, automatic history, saved queries, tags, and a global action bar. Its dashboards and collaboration are broader than this extension's current scope. Sources: [inspector](https://www.dbpro.app/features/inspector), [history](https://www.dbpro.app/features/query-history), [power features](https://www.dbpro.app/features/power-features).
- **Beekeeper Studio:** spreadsheet interaction, typed cell editing, staged changes, JSON editing, foreign-key links, and quick table navigation. Sources: [home](https://www.beekeeperstudio.io/), [data browser](https://www.beekeeperstudio.io/features/table-data). Some marketing pages disagree about import availability; treat these as promoted concepts, not a verified edition/platform matrix.
- **TablePlus:** inline editing, filters, SQL change review, safe mode, and Open Anything. These closely match the focused product direction. Source: [product site](https://tableplus.com/).
- **DBeaver:** broad data/SQL editors and metadata exploration, with more administration, cloud integrations, and NoSQL support in commercial offerings. Breadth is useful context, but not a target checklist. Source: [Community/PRO overview](https://dbeaver.io/).

## What already exists here

The extension already has per-connection query history, SQL files for saved work, result tabs, captured-result sorting/search/paging, table-side filtering, record inspection, JSON pretty-printing/copying, CSV/JSON export, staged CRUD with confirmation and conflict checks, schema relationships, related-row navigation, and SQL completion/formatting providers.

History currently retains 200 entries globally across the workspace and filters its picker by connection. Entries have SQL, timestamp, duration, and optional error; there is no row count, pinning, date/status filter, per-entry deletion, or dedicated history browser. Selecting an entry restores SQL without executing it.

JSON support is currently formatted text in the inspector, rather than a searchable/collapsible document viewer and structured editing workflow. The existing JSON.parse/JSON.stringify display path can round oversized numeric literals: preserve original text and adopt lossless formatting before offering JSON round-trip editing.

The most important existing UX risk is reliability: native smoke runs have exposed inconsistent formatter/focus behavior. Passing provider tests does not establish that automatic suggestions reliably appear in the real editor.

## Recommended priorities

### 1. Make the current loop dependable

- Reproduce and fix actual typing/formatter behavior in a focused native editor, including inherited settings, SQL-file connection binding, and error positioning. Add foreign-key JOIN suggestions, schema/type hover, and Go to Definition incrementally.
- Show connection identity and environment consistently. Use an explicit PROD label plus optional color; color alone is insufficient. Make the execution destination clear in review/confirmation.
- Show shared-session transaction state: autocommit, open transaction, failed/aborted transaction, and unknown after cancellation/disconnection. Commit/Rollback controls apply to the entire connection, not only one result tab. Expose driver-reported state instead of guessing from the last SQL string.
- Preserve column widths/visibility/order, filters, page size, and diagram positions across reopening. Save view configuration, not large captured result sets by default.

### 2. History and saved queries

Add a compact native history tree or searchable picker with SQL preview, timestamp, connection, duration, returned/affected row counts, completion/error/cancellation status, and filters. Record executed user statements; do not mix automatic metadata requests into the same default view. Distinguish rows captured from total rows when capped.

Offer pin/favorite, Open in Editor, Copy, Save as .sql, and Delete. Favorites should reference ordinary workspace SQL files rather than create a second opaque query store. Default activation opens SQL; explicit Run remains separate. Add configurable retention and per-connection opt-out. SQL text and error strings can themselves contain secrets; SecretStorage protects saved connection credentials, not SQL history.

### 3. Proper JSON and value editing

Use the existing inspector with Fields / JSON / Raw modes. Add expand/collapse, path search, copy value/path/document, validation, and visible truncation. A JSON cell gets an explicit Open JSON Editor action using VS Code's native JSON editor. Editing stages a cell change; it does not write on Save without review. Show a before/after diff and reuse conflict detection and commit confirmation.

Preserve SQL NULL versus JSON null versus empty text. Preserve exact numeric literals and BSON types where applicable. Support user-requested JSON interpretation for TEXT columns, not automatic rewriting of every string that happens to parse. Full-value fetches must state that they reflect current data rather than the old result snapshot.

### 4. Comparison and editing polish

Start with Compare Selected Records, then Compare Result A/B. Match by a chosen primary/composite key, show changed fields only, and mark added/removed rows. When rows lack unique keys, request a matching rule rather than treating display position as identity. Comparisons operate on captured data and clearly report truncation/incomplete coverage. Use VS Code's diff editor for raw JSON/text comparisons.

Add cell-edit undo/redo, individual revert, spreadsheet paste with a preview, and clearer conflict resolution. Do not persist pending values silently: draft recovery stores sensitive data and needs an explicit retention choice. Server DDL may auto-commit; a later schema editor cannot promise the same atomic rollback as staged row edits.

### 5. Faster navigation and easier connections

Add Quick Open Database Object through native Quick Pick, plus favorite/recent tables and schema filters. Expose existing Related Rows closer to foreign-key cells with Back navigation. No second application-wide command palette is needed.

Accept connection URLs with a masked input and structured preview. Separate any password into SecretStorage before persisting the profile. Show Test Connection and actionable TLS/auth/host errors. Add managed SSH tunneling after the basic connection experience; reuse existing forwarded endpoints initially. Cloud poolers need explicit compatibility checks for session state, temporary tables, and transactions.

### Later, only when demanded

Actual server DDL retrieval, improved plans, and keyset paging would help users who outgrow the first workflow. Tiny selection aggregates (count/sum/min/max) are useful; distinguish selected/captured rows from full-table aggregates. Avoid building dashboards, schedulers, account/role management, cross-engine migrations, full visual schema design, team sync, or another AI chat interface at this stage.

## Non-SQL expansion

Driver connection code is only part of the work. Each database also needs suitable resources, query language, paging, value encoding, cancellation, editing semantics, and conformance tests. Reuse verified worker installation and credential infrastructure, but not SQL assumptions.

### MongoDB — first document database; medium-to-high effort

Use the official `mongodb` driver. Initial scope: databases/collections, Find filter/projection/sort/limit, cursor-based browsing, an aggregation pipeline editor, and document inspection. Atlas is supported by that driver, not a separate engine. Start read-only; add reviewed writes with identity and optimistic conflict checks. Do not evaluate arbitrary pasted JavaScript in the extension host. Canonical Extended JSON preserves ObjectId, dates, Decimal128, and 64-bit types. Sampled fields are suggestions, not an authoritative schema. [Driver](https://www.mongodb.com/docs/drivers/node/current/), [Extended JSON](https://www.mongodb.com/docs/drivers/node/current/data-formats/extended-json/).

### Redis — second, or first for a cache-heavy audience; medium effort initially

Use `redis` / node-redis, the recommended official Node client. Build a key browser with pattern filtering, type, TTL, bounded value views, and typed string/hash/list/set/sorted-set editors. SCAN is incremental, can return duplicates or empty batches, and is not a stable numbered page of keys. Writes must explicitly preserve or change TTL and handle concurrent changes. Cluster routing and broader command coverage increase scope. [Client](https://redis.io/docs/latest/develop/clients/nodejs/), [SCAN semantics](https://redis.io/docs/latest/commands/scan/).

### Elasticsearch / OpenSearch — later, audience dependent; medium-to-high effort

Offer index/mapping exploration, JSON query requests, hits and aggregation inspection. Use each product's official client and test them separately rather than promising interchangeable behavior. API-key authentication, server/client versions, search pagination, and AWS signing affect scope. Begin read-only; cluster administration adds little to the core developer workflow. [Elasticsearch client](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript), [OpenSearch client](https://docs.opensearch.org/latest/clients/javascript/index/).

### DynamoDB — later for AWS users; high effort for good UX

Use AWS SDK v3 with selected AWS profiles/SSO and short-lived credentials where available. Show account/region/table/index context and key-aware querying. Query requires a partition-key value, so it cannot behave like an arbitrary SQL filter. Make Scan an explicit separate action; expose cursor paging and capacity/cost implications. Add conditional writes before editing. Existing restricted worker environments will need deliberate credential-provider support. [Query model](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html), [AWS credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html).

### Neo4j — only with demonstrated demand; high effort

The official `neo4j-driver` and Cypher execution are straightforward compared with a useful bounded graph explorer. The existing ER diagram shows schema relationships; it is not a graph-data renderer. Data graph results need node/edge properties, incremental neighborhood expansion, query limits, and layout state. [Driver](https://neo4j.com/docs/javascript-manual/current/).

## Architecture and sequence

Core types already declare document/key-value families and table/graph/value results. The actual browsing/editing contract and most of the UI remain table-oriented. Introduce document and key-value operations plus cursor tokens, lossless typed values, and driver capabilities for available views, editing, transactions, and relationships. Hide unsupported actions instead of mapping everything onto SQL tables. Do not assume that every adapter supports atomic multi-item batches or identical cancellation guarantees.

Recommended order: reliability and transaction clarity → history/favorites and JSON inspector → persistent preferences, quick navigation and comparisons → connection URL UX → MongoDB → Redis. Cloud-provider presets that use an existing SQL protocol can arrive independently: Neon exposes standard PostgreSQL connection URIs, although pooled endpoints still need session-behavior validation. [Neon connection URI](https://api-docs.neon.tech/reference/getconnectionuri).
