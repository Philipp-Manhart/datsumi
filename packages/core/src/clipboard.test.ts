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
