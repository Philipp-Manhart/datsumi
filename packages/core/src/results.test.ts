import { describe, expect, it } from "vitest";

import { compareCells } from "./index";

describe("captured value ordering", () => {
  it("compares mixed numeric types without losing integer precision", () => {
    expect(
      compareCells({ type: "integer", value: "9007199254740993" }, 9007199254740992),
    ).toBeGreaterThan(0);
    expect(
      compareCells({ type: "integer", value: "-9223372036854775808" }, -9007199254740991),
    ).toBeLessThan(0);
    expect(compareCells({ type: "integer", value: "2" }, 2)).toBe(0);
    expect(
      compareCells(
        { type: "float", value: "Infinity" },
        { type: "integer", value: "9223372036854775807" },
      ),
    ).toBeGreaterThan(0);
  });
  it("orders nulls before numbers, then text and binary previews", () => {
    expect(compareCells(null, -1)).toBeLessThan(0);
    expect(compareCells(2, "1")).toBeLessThan(0);
    expect(compareCells("", "a")).toBeLessThan(0);
    expect(compareCells("z", { type: "blob", hex: "00", bytes: 1 })).toBeLessThan(0);
  });
});
