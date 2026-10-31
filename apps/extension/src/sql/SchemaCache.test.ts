import type { DatabaseResource } from "@datsumi/core";
import { describe, expect, it, vi } from "vitest";

import { SchemaCache } from "./SchemaCache";

describe("completion schema cache", () => {
  it("keeps connections isolated, deduplicates requests and refreshes invalidated metadata", async () => {
    const resources = vi.fn<
      (connection: string, parent?: string) => Promise<readonly DatabaseResource[]>
    >(async (connection, parent) =>
      parent
        ? [{ id: `${parent}:id`, label: `${connection}_id`, kind: "column", hasChildren: false }]
        : [{ id: connection, label: `${connection}_table`, kind: "table", hasChildren: true }],
    );
    const cache = new SchemaCache(resources);
    const [one, duplicate, two] = await Promise.all([
      cache.get("one", ["one_table"]),
      cache.get("one", ["one_table"]),
      cache.get("two", ["two_table"]),
    ]);
    expect(one).toEqual(duplicate);
    expect(one[0]?.columns[0]?.name).toBe("one_id");
    expect(two[0]?.columns[0]?.name).toBe("two_id");
    expect(resources).toHaveBeenCalledTimes(4);
    cache.invalidate("one");
    await cache.get("one", ["one_table"]);
    expect(resources).toHaveBeenCalledTimes(6);
    await cache.get("two", ["two_table"]);
    expect(resources).toHaveBeenCalledTimes(6);
  });
  it("does not load every table's columns when only completing table names", async () => {
    const resources = vi.fn<
      (connection: string, parent?: string) => Promise<readonly DatabaseResource[]>
    >(async () => [{ id: "table", label: "customers", kind: "table", hasChildren: true }]);
    const cache = new SchemaCache(resources);
    expect(await cache.get("one", [])).toEqual([{ name: "customers", kind: "table", columns: [] }]);
    expect(resources).toHaveBeenCalledExactlyOnceWith("one");
  });
});
