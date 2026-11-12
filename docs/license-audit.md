# License audit

Datsumi's own source, documentation and original logo assets are MIT-licensed; see the root LICENSE and the copy included in the VSIX. Third-party components retain their licenses. No database server is included in the extension.

The build inventories actual esbuild inputs for host/workers/native wrappers, Rollup/Vite modules for the webview, and the Tailwind CSS input. It records name/version/SPDX identifiers and full license/NOTICE text alongside each distributable. Packaging verification checks those inventories against the VSIX.

The current shipped client graph uses MIT, ISC, BSD variants, Apache-2.0, Unlicense, and Oracle's `(Apache-2.0 OR UPL-1.0)` licenses. Codicons font/icons are CC-BY-4.0 with Microsoft attribution and the unmodified full notice. These components are not declared MIT merely because the application is MIT. Oracle's dual permissive licensing is documented [upstream](https://node-oracledb.readthedocs.io/en/latest/license.html); Codicons licensing is in its [upstream repository](https://github.com/microsoft/vscode-codicons).

The former MariaDB client was LGPL-2.1-or-later. It has been removed in favor of the already shipped MIT-licensed mysql2 transport, while retaining the MariaDB dialect and real-server tests. No LGPL MariaDB client may appear in the VSIX inventory. This simplifies distribution obligations rather than attempting to relicense the old connector.

Some upstream npm packages omit standalone notices. Pinned copies/provenance:

- node-redis/@redis 6.3.0: existing upstream release LICENSE under packages/drivers/nosql/notices.
- Turso serverless 1.4.1: existing upstream LICENSE; npm gitHead `d064d97544f940e7198e4635f8c9212bf80385a0`.
- libSQL client/core 0.18.0: upstream LICENSE at `9496c782af413f6380235c7f5d0c97b5371f49b7` in tursodatabase/libsql-client-ts.
- libSQL isomorphic-ws 0.1.5: upstream LICENSE at `87331abc53d4e77deb2f3d6384438d4804a07e0a` in libsql/isomorphic-ts.
- promise-limit 2.7.0: npm/upstream commit `5b911ce33253ec0a7ea9cf079d8c0434efbe3244` declares ISC and author Tim Macfarlane, but has no license file. The retained notice explicitly records that provenance, author attribution and the standard ISC permission text; it is not represented as an upstream-supplied file.

Missing text or an unreviewed license fails the build. Version upgrades require checking upstream notices and policy exceptions again. The build's explicit allowlist is a maintenance control, not a legal certification.

Development dependencies and database containers are not bundled into the extension. Their licenses/EULAs still govern development use: in particular the Oracle and SQL Server fixture images, and Redis/MongoDB server distributions, retain their own terms. License identifiers for server software are distinct from those for the client libraries. Do not redistribute server images as part of Datsumi.
