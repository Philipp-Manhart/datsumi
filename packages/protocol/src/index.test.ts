import { describe, expect, it } from "vitest";

import { cellValueSchema, webviewRequestSchema } from "./index";

describe("webview boundary", () => {
  it("rejects invalid page bounds and unknown commands", () => {
    expect(
      webviewRequestSchema.safeParse({ type: "table/page", offset: 0, limit: 100 }).success,
    ).toBe(true);
    for (const value of [
      { type: "table/page", offset: -1, limit: 100 },
      { type: "table/page", offset: 0, limit: 10000 },
      { type: "table/page", offset: 0.5, limit: 100 },
      { type: "ready", protocolVersion: 2 },
      { type: "query/execute", text: "DROP TABLE test" },
    ])
      expect(webviewRequestSchema.safeParse(value).success).toBe(false);
  });
  it("accepts tagged SQLite values and rejects non-JSON values", () => {
    expect(cellValueSchema.parse({ type: "integer", value: "9223372036854775807" })).toEqual({
      type: "integer",
      value: "9223372036854775807",
    });
    expect(cellValueSchema.safeParse(1n).success).toBe(false);
    expect(cellValueSchema.safeParse(Infinity).success).toBe(false);
  });
});
