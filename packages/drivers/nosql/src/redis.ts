import type { DataRecord } from "@datsumi/core";
import { createClient, RESP_TYPES } from "redis";

import type { NoSqlConfiguration } from "./configuration";
import type { NoSqlDatabase } from "./worker";
import { confirmedWrite } from "./writeOutcome";
const stringCas = `if redis.call('TYPE', KEYS[1]).ok ~= 'string' or redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') return 1`;
const hashCas = `
if redis.call('TYPE', KEYS[1]).ok ~= 'hash' then return 0 end
local old=cjson.decode(ARGV[1]); local new=cjson.decode(ARGV[2]); local n=0
for k,v in pairs(old) do n=n+1; if redis.call('HGET',KEYS[1],k) ~= v then return 0 end end
if redis.call('HLEN',KEYS[1]) ~= n then return 0 end
local updates={}; local removals={}
for k,v in pairs(new) do table.insert(updates,k); table.insert(updates,v) end
for k,v in pairs(old) do if new[k] == nil then table.insert(removals,k) end end
if not redis.acl_check_cmd('HSET',KEYS[1],unpack(updates)) then return -1 end
if #removals>0 and not redis.acl_check_cmd('HDEL',KEYS[1],unpack(removals)) then return -2 end
redis.call('HSET',KEYS[1],unpack(updates))
if #removals>0 then redis.call('HDEL',KEYS[1],unpack(removals)) end
return 1`;

function hash(text: string): Record<string, string> {
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !Object.keys(value).length ||
    Object.keys(value).length > 100 ||
    Object.values(value).some((v) => typeof v !== "string")
  )
    throw new Error("Hash must be a nonempty JSON object with at most 100 string fields.");
  return value as Record<string, string>;
}
export async function connectRedis(
  config: NoSqlConfiguration,
  password: string,
): Promise<NoSqlDatabase> {
  const url = new URL(config.endpoint);
  const servername = url.hostname.replace(/^\[|\]$/g, "");
  if (config.tunnelPort) {
    url.hostname = "127.0.0.1";
    url.port = String(config.tunnelPort);
  }
  const client = createClient({
    url: url.toString(),
    ...(config.username ? { username: config.username } : {}),
    ...(password ? { password } : {}),
    socket: {
      ...(config.tunnelPort && url.protocol === "rediss:" ? { servername } : {}),
      connectTimeout: 10000,
      reconnectStrategy: false,
    },
  });
  client.on("error", () => {});
  await client.connect();
  await client.ping();
  const binary = client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  const read = async (key: string): Promise<DataRecord | undefined> => {
    const type = await client.type(key);
    if (type === "none") return;
    const ttl = await client.pTTL(key);
    if (type !== "string") {
      const size = await client.memoryUsage(key).catch(() => null);
      if (size === null || size > 1024 * 1024)
        return {
          id: key,
          type,
          ttl,
          editable: false,
          text:
            size === null
              ? "Safe inspection requires MEMORY USAGE permission for structured values."
              : `Structured value uses ${size} bytes; inspection is limited to 1 MiB.`,
        };
    }
    let text: string,
      editable = false;
    if (type === "string") {
      const length = await client.strLen(key),
        bytes = (await binary.getRange(key, 0, 1024 * 1024 - 1)) ?? Buffer.alloc(0);
      text = bytes.toString("utf8");
      editable = length <= 1024 * 1024 && Buffer.from(text).equals(bytes);
      if (!editable)
        text = `Read-only binary/large preview (${length} bytes):\n${bytes.subarray(0, 256).toString("hex")}`;
    } else if (type === "hash") {
      const length = await client.hLen(key);
      if (length <= 100) {
        text = JSON.stringify(await client.hGetAll(key));
        editable = Buffer.byteLength(text) <= 1024 * 1024;
      } else
        text = JSON.stringify({
          note: `Read-only hash with ${length} fields; first scan batch`,
          ...(await client.hScan(key, "0", { COUNT: 100 })),
        });
    } else if (type === "list")
      text = JSON.stringify({
        length: await client.lLen(key),
        first100: await client.lRange(key, 0, 99),
      });
    else if (type === "set")
      text = JSON.stringify({
        size: await client.sCard(key),
        scan: await client.sScan(key, "0", { COUNT: 100 }),
      });
    else if (type === "zset")
      text = JSON.stringify({
        size: await client.zCard(key),
        first100: await client.zRangeWithScores(key, 0, 99),
      });
    else text = JSON.stringify({ type, note: "Use a dedicated tool for this value type." });
    if (Buffer.byteLength(text) > 1024 * 1024) {
      text = "Value exceeds the 1 MiB inspection limit. Use a dedicated Redis tool.";
      editable = false;
    }
    return { id: key, text, type, ttl, editable: editable && !config.readOnly };
  };
  return {
    async resources() {
      return [
        {
          id: "keys",
          label: "Keys",
          kind: "collection",
          hasChildren: false,
          description: "Pattern search · SCAN",
        },
      ];
    },
    async browse(request) {
      if (request.resource !== "keys" || (request.cursor && !/^\d+$/.test(request.cursor)))
        throw new Error("Invalid key cursor.");
      const scanned = await client.scan(request.cursor ?? "0", {
        MATCH: request.filter || "*",
        COUNT: request.limit,
      });
      const records: DataRecord[] = [];
      let bytes = 0;
      for (const key of [...new Set(scanned.keys)].slice(0, 500)) {
        const item = await read(key);
        if (item) {
          bytes += Buffer.byteLength(item.text);
          if (bytes > 4 * 1024 * 1024) break;
          records.push(item);
        }
      }
      const omitted = scanned.keys.length - records.length;
      return {
        records,
        ...(scanned.cursor !== "0" ? { cursor: scanned.cursor } : {}),
        note: `SCAN is a live incremental search, not a snapshot. Batches can be empty or repeat keys. TTL is shown in milliseconds.${omitted > 0 ? ` ${omitted} keys were omitted by capture limits or changed during this batch; narrow the pattern.` : ""}`,
      };
    },
    async change(request, apply) {
      if (config.readOnly || request.resource !== "keys")
        throw new Error("Key editing unavailable.");
      const current = await read(request.id);
      if (!current?.editable || !["string", "hash"].includes(current.type ?? ""))
        throw new Error("Only complete strings and small hashes can be edited.");
      if (current.type === "hash") {
        hash(request.original);
        hash(request.text);
      }
      if (!apply)
        return `Update ${current.type} key ${JSON.stringify(request.id)} only if the original value still matches. Existing TTL is preserved.\n${request.text}`;
      const result = await confirmedWrite(() =>
        client.eval(current.type === "string" ? stringCas : hashCas, {
          keys: [request.id],
          arguments: [request.original, request.text],
        }),
      );
      if (result === -1 || result === -2)
        throw new Error(
          "Hash update permission denied before writing. No fields changed; grant the required HSET/HDEL permissions before reviewing again.",
        );
      if (result !== 1)
        throw new Error(
          "Key changed, expired, or was removed. Nothing was overwritten; refresh and compare.",
        );
      return "Key updated; expiry preserved.";
    },
    async execute(request) {
      const spec: unknown = JSON.parse(request.text);
      if (!spec || typeof spec !== "object" || !("key" in spec) || typeof spec.key !== "string")
        throw new Error('Use {"key":"name"} to inspect a key.');
      return { kind: "value", value: (await read(spec.key)) ?? { note: "Key does not exist." } };
    },
    async close() {
      client.destroy();
    },
  };
}
