import { describe, it, expect } from "vitest";

import { parseCsv, serializeResult } from "./serialization";
describe("CSV and captured-result interchange", () => {
  it("parses BOMs, quoted commas, embedded line breaks and escaped quotes", () => {
    expect(
      parseCsv('\uFEFFid,name\r\n1,"two, words"\r\n2,"line\nbreak"\r\n3,"say ""hi"""\r\n'),
    ).toEqual([
      ["id", "name"],
      ["1", "two, words"],
      ["2", "line\nbreak"],
      ["3", 'say "hi"'],
    ]);
    expect(() => parseCsv("a,b\n1")).toThrow(/record/i);
    expect(() => parseCsv('a\n"unclosed')).toThrow(/quote/i);
  });
  it("preserves duplicate column names and exact values in JSON snapshots and escapes CSV", () => {
    const table = {
      kind: "table" as const,
      columns: ["same", "same"],
      rows: [
        [{ type: "integer" as const, value: "9007199254740993" }, 'a,"b"\nc'],
        [null, ""],
      ],
    };
    expect(JSON.parse(serializeResult(table, "json"))).toEqual({
      columns: ["same", "same"],
      rows: table.rows,
      truncated: false,
    });
    expect(parseCsv(serializeResult(table, "csv"))[1]?.[1]).toBe('a,"b"\nc');
  });
});
