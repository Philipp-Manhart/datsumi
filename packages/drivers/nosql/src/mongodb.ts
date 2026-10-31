import { randomUUID } from "node:crypto";

import type { DataRecord } from "@datsumi/core";
import { BSON, MongoClient, type Document, type FindCursor } from "mongodb";

import type { NoSqlConfiguration } from "./configuration";
import type { NoSqlDatabase } from "./worker";
const stringify = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
function object(text: string): Document {
  const value: unknown = BSON.EJSON.parse(text, { relaxed: false });
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as Document;
}
function safeFilter(value: unknown): void {
  if (Array.isArray(value)) value.forEach(safeFilter);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (["$where", "$function", "$accumulator", "$out", "$merge"].includes(key))
        throw new Error("Server-side JavaScript and write pipelines are unavailable.");
      safeFilter(item);
    }
}
export async function connectMongo(
  config: NoSqlConfiguration,
  password: string,
): Promise<NoSqlDatabase> {
  const uri = new URL(config.endpoint);
  const servername = uri.hostname.replace(/^\[|\]$/g, "");
  if (config.tunnelPort) {
    if (uri.protocol !== "mongodb:")
      throw new Error(
        "MongoDB SSH connections require a direct mongodb:// URL, not SRV discovery.",
      );
    uri.hostname = "127.0.0.1";
    uri.port = String(config.tunnelPort);
    uri.searchParams.set("directConnection", "true");
  }
  const client = new MongoClient(uri.toString(), {
    ...(config.tunnelPort ? { servername, directConnection: true } : {}),
    ...(config.username ? { auth: { username: config.username, password } } : {}),
    tls: uri.searchParams.get("tls") !== "false",
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    maxPoolSize: 1,
    promoteLongs: false,
    promoteValues: false,
  });
  await client.connect();
  const db = client.db(decodeURIComponent(uri.pathname.slice(1)));
  await db.command({ ping: 1 });
  const cursors = new Map<
    string,
    { resource: string; filter: string; cursor: FindCursor<Document> }
  >();
  const validateResource = (name: string) => {
    if (!name || name.includes("\0") || name.startsWith("system."))
      throw new Error("Choose a user collection.");
    return db.collection(name);
  };
  return {
    async resources() {
      return (await db.listCollections({}, { nameOnly: true }).toArray())
        .filter((c) => !c.name.startsWith("system."))
        .map((c) => ({
          id: c.name,
          label: c.name,
          kind: "collection" as const,
          hasChildren: false,
        }));
    },
    async browse(request) {
      const filter = request.filter || "{}";
      let cursor: FindCursor<Document>;
      if (request.cursor) {
        const saved = cursors.get(request.cursor);
        if (!saved || saved.resource !== request.resource || saved.filter !== filter)
          throw new Error("Page cursor expired. Refresh this collection.");
        cursors.delete(request.cursor);
        cursor = saved.cursor;
      } else {
        const query = object(filter);
        safeFilter(query);
        cursor = validateResource(request.resource)
          .find(query, { maxTimeMS: 10000, batchSize: request.limit })
          .sort({ _id: 1 });
      }
      const records: DataRecord[] = [];
      let bytes = 0;
      try {
        for (let i = 0; i < request.limit && (await cursor.hasNext()); i++) {
          const doc = await cursor.next();
          if (!doc) break;
          const text = stringify(doc),
            size = Buffer.byteLength(text);
          if (size > 1024 * 1024 || bytes + size > 4 * 1024 * 1024) {
            await cursor.close();
            return {
              records,
              note: "Capture stopped before an oversized document. Narrow the filter; no document was shortened or edited.",
            };
          }
          bytes += size;
          records.push({
            id: stringify(doc._id),
            text,
            editable: !config.readOnly,
            type: "BSON document",
          });
        }
        if (await cursor.hasNext()) {
          if (cursors.size >= 10) {
            const oldest = cursors.keys().next().value!;
            await cursors.get(oldest)!.cursor.close();
            cursors.delete(oldest);
          }
          const token = randomUUID();
          cursors.set(token, { resource: request.resource, filter, cursor });
          return {
            records,
            cursor: token,
            note: "Canonical Extended JSON preserves BSON types. Sampled fields are not a fixed schema.",
          };
        }
        await cursor.close();
        return { records, note: "Canonical Extended JSON preserves BSON types." };
      } catch (error) {
        await cursor.close().catch(() => {});
        throw error;
      }
    },
    async change(request, apply) {
      if (config.readOnly) throw new Error("Connection is read-only.");
      const original = object(request.original),
        next = object(request.text);
      if (
        !("_id" in original) ||
        stringify(original._id) !== request.id ||
        stringify(next._id) !== request.id
      )
        throw new Error("Document identity cannot change.");
      const collection = validateResource(request.resource);
      const preview = `Replace document ${request.id} in ${request.resource}, only if the complete original still matches.\n${stringify(next)}`;
      if (!apply) return preview;
      const result = await collection.replaceOne(
        { _id: original._id, $expr: { $eq: ["$$ROOT", { $literal: original }] } },
        next,
      );
      if (Number(result.matchedCount) !== 1)
        throw new Error(
          "Document changed or was removed. Nothing was overwritten; refresh and compare.",
        );
      return "Document updated.";
    },
    async execute(request) {
      const spec = object(request.text);
      safeFilter(spec);
      if (typeof spec.collection !== "string")
        throw new Error(
          'Use {"collection":"name","filter":{}} or {"collection":"name","pipeline":[]}',
        );
      const collection = validateResource(spec.collection);
      const cursor = Array.isArray(spec.pipeline)
        ? collection.aggregate(spec.pipeline, { maxTimeMS: 10000, allowDiskUse: false })
        : collection
            .find(spec.filter ?? {}, { projection: spec.projection, maxTimeMS: 10000 })
            .sort(spec.sort ?? { _id: 1 });
      const documents: string[] = [];
      let bytes = 0;
      try {
        for await (const doc of cursor) {
          const text = stringify(doc);
          bytes += Buffer.byteLength(text);
          if (documents.length >= 100 || bytes > 4 * 1024 * 1024)
            return { kind: "value", value: { documents, truncated: true } };
          documents.push(text);
        }
      } finally {
        await cursor.close();
      }
      return { kind: "value", value: { documents, truncated: false } };
    },
    async close() {
      await client.close();
    },
  };
}
