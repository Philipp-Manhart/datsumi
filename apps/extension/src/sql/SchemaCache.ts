import type { DatabaseResource } from "@datsumi/core";
import { parseResource, qualifiedName } from "@datsumi/driver-sql/dialect";

import type { SqlColumn, SqlTable } from "./completion";

type Resources = (connectionId: string, parentId?: string) => Promise<readonly DatabaseResource[]>;
interface CachedSchema {
  expires: number;
  tables: Promise<readonly DatabaseResource[]>;
  columns: Map<string, Promise<readonly SqlColumn[]>>;
}

/** Connection-scoped metadata; completion cancellation never closes a database session. */
export class SchemaCache {
  private readonly cache = new Map<string, CachedSchema>();
  constructor(private readonly resources: Resources) {}
  invalidate(connectionId?: string): void {
    if (connectionId) this.cache.delete(connectionId);
    else this.cache.clear();
  }
  async get(connectionId: string, requested: readonly string[]): Promise<readonly SqlTable[]> {
    let cached = this.cache.get(connectionId);
    if (!cached || cached.expires <= Date.now()) {
      cached = {
        expires: Date.now() + 15000,
        tables: this.resources(connectionId),
        columns: new Map(),
      };
      this.cache.set(connectionId, cached);
    }
    const schema = cached;
    let resources: readonly DatabaseResource[];
    try {
      resources = await schema.tables;
    } catch (error) {
      if (this.cache.get(connectionId) === schema) this.cache.delete(connectionId);
      throw error;
    }
    const requestedNames = new Set(requested.map((name) => name.toLowerCase()));
    return Promise.all(
      resources
        .filter((resource) => resource.kind === "table" || resource.kind === "view")
        .map(async (resource) => {
          let columns: readonly SqlColumn[] = [];
          if (
            requestedNames.has(resource.label.toLowerCase()) ||
            [...requestedNames].some((name) => resource.label.toLowerCase().endsWith("." + name))
          ) {
            let promise = schema.columns.get(resource.id);
            if (!promise) {
              promise = this.resources(connectionId, resource.id)
                .then((items) =>
                  items
                    .filter((item) => item.kind === "column")
                    .map((item) => ({
                      name: item.label,
                      ...(item.description ? { detail: item.description } : {}),
                    })),
                )
                .catch(() => {
                  schema.columns.delete(resource.id);
                  return [];
                });
              schema.columns.set(resource.id, promise);
            }
            columns = await promise;
          }
          return {
            name: resource.label,
            ...(() => {
              try {
                if (!resource.schema) return {};
                const id = parseResource(resource.id);
                return { baseName: id.name, schema: id.schema };
              } catch {
                return {};
              }
            })(),
            insertText: (() => {
              try {
                if (!resource.schema) return undefined;
                const id = parseResource(resource.id);
                return qualifiedName("postgres", id.name, id.schema);
              } catch {
                return undefined;
              }
            })(),
            kind: resource.kind === "view" ? ("view" as const) : ("table" as const),
            columns,
          };
        }),
    );
  }
}
