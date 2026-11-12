import { describe, expect, it } from "vitest";

import { clipboardTsv } from "./clipboard";

describe("Excel clipboard text", () => {
  it("copies only values, preserving empty cells, exact numbers and headers on request", () => {
    const rows = [
      [
        "2026-04-01 00:00:00",
        { type: "integer" as const, value: "9007199254740993" },
        "8705.63",
        null,
        "",
        false,
      ],
    ];
    expect(clipboardTsv(["day", "orders", "revenue", "null", "empty", "flag"], rows)).toBe(
      "2026-04-01 00:00:00\t9007199254740993\t8705.63\t\t\tfalse",
    );
    expect(clipboardTsv(["day", "orders", "revenue", "null", "empty", "flag"], rows, true)).toBe(
      "day\torders\trevenue\tnull\tempty\tflag\r\n2026-04-01 00:00:00\t9007199254740993\t8705.63\t\t\tfalse",
    );
  });
  it("quotes tabs, line breaks and quotes without replacing data", () => {
    expect(
      clipboardTsv(
        ["a"],
        [
          ["a\tb", "one\ntwo", 'say "hi"'],
          ["plain", "", null],
        ],
      ),
    ).toBe('"a\tb"\t"one\ntwo"\t"say ""hi"""\r\nplain\t\t');
  });
  it("refuses truncated previews instead of copying UI annotations", () => {
    expect(() => clipboardTsv(["text"], [[{ type: "text", value: "abc", length: 100 }]])).toThrow(
      "shortened",
    );
    expect(() => clipboardTsv(["blob"], [[{ type: "blob", hex: "00", bytes: 100 }]])).toThrow(
      "shortened",
    );
    expect(clipboardTsv(["blob"], [[{ type: "blob", hex: "00ff", bytes: 2 }]])).toBe("00ff");
  });
});

it("keeps exact TSV unchanged while offering a separate spreadsheet-safe text transformation", async () => {
  const { spreadsheetText } = await import("./clipboard");
  for (const value of ["=SUM(A1:A2)", "+cmd", "-cmd", "@SUM(A1)", " \t=1+1", "\n=1+1"]) {
    expect(spreadsheetText(value, true)).toBe("'" + value);
    expect(spreadsheetText(value, false)).toBe(value);
    expect(clipboardTsv(["x"], [[value]])).not.toContain("'" + value);
  }
});

it("preserves rectangular structure for wide multi-page transfers", () => {
  const columns = Array.from({ length: 80 }, (_, i) => `column_${i}`);
  const rows = Array.from({ length: 1201 }, (_, r) => columns.map((_, c) => `${r}:${c}`));
  const text = clipboardTsv(columns, rows, true),
    lines = text.split("\r\n");
  expect(lines).toHaveLength(1202);
  expect(lines[0]?.split("\t")).toEqual(columns);
  expect(lines.at(-1)?.split("\t")).toHaveLength(80);
  expect(lines.at(-1)?.split("\t").at(-1)).toBe("1200:79");
});
