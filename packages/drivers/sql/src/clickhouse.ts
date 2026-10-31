import { randomUUID } from "node:crypto";
/* oxlint-disable no-await-in-loop -- Consume streamed result lines in order. */
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { connect as tcpConnect } from "node:net";
import { createInterface } from "node:readline";
import { connect as tlsConnect } from "node:tls";

import { createClient } from "@clickhouse/client";

import { Capture, type Backend } from "./backend";
import type { ServerConfiguration } from "./configuration";

export async function connect(
  config: ServerConfiguration & { password: string },
): Promise<Backend> {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  let agent: HttpAgent | undefined;
  if (config.tunnelPort) {
    if (config.tls === "verify") {
      const secure = new HttpsAgent({ keepAlive: true });
      secure.createConnection = () =>
        tlsConnect({
          host: "127.0.0.1",
          port: config.tunnelPort!,
          servername: config.host,
          rejectUnauthorized: true,
          ...(config.ca ? { ca: config.ca } : {}),
        });
      agent = secure;
    } else {
      agent = new HttpAgent({ keepAlive: true });
      agent.createConnection = () => tcpConnect({ host: "127.0.0.1", port: config.tunnelPort! });
    }
  }
  const client = createClient({
    ...(agent ? { http_agent: agent } : {}),
    url: `${config.tls === "verify" ? "https" : "http"}://${host}:${config.port}`,
    username: config.username,
    password: config.password,
    database: config.database,
    session_id: randomUUID(),
    max_open_connections: 1,
    request_timeout: 120000,
    ...(config.ca ? { tls: { ca_cert: Buffer.from(config.ca) } } : {}),
    clickhouse_settings: {
      output_format_json_quote_64bit_integers: 1,
      output_format_json_quote_decimals: 1,
    },
  });
  try {
    const check = await client.query({ query: "SELECT 1", format: "JSONCompactEachRow" });
    await check.json();
  } catch (error) {
    await client.close();
    agent?.destroy();
    throw error;
  }
  return {
    async run(text, values = [], captureAll = false) {
      const params = Object.fromEntries(values.map((value, index) => [`p${index}`, value]));
      // default_format does not rewrite SQL or append FORMAT after a user's statement.
      const result = await client.exec({
        query: text.trim().replace(/;\s*$/, ""),
        query_params: params,
        clickhouse_settings: { default_format: "JSONCompactEachRowWithNamesAndTypes" },
      });
      const capture = new Capture(captureAll);
      let names: string[] | undefined, types: string[] | undefined;
      const lines = createInterface({ input: result.stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          const row: unknown = JSON.parse(line);
          if (!Array.isArray(row))
            throw new Error("Unsupported ClickHouse result format. Remove the FORMAT clause.");
          if (!names) {
            if (!row.every((value) => typeof value === "string"))
              throw new Error("Invalid result column names.");
            names = row;
          } else if (!types) {
            if (!row.every((value) => typeof value === "string") || row.length !== names.length)
              throw new Error("Invalid result column types.");
            types = row;
            capture.fields(names.map((name, index) => ({ name, dataType: types![index]! })));
          } else capture.row(row);
        }
        if (names && !types) throw new Error("Incomplete ClickHouse result metadata.");
      } finally {
        lines.close();
        result.stream.destroy();
      }
      return capture.results;
    },
    async transactionState() {
      return "unsupported";
    },
    async inTransaction() {
      return false;
    },
    async close() {
      await client.close();
      agent?.destroy();
    },
  };
}
