import { describe, expect, it } from "vitest";

import { columnSize } from "./columnSize";

describe("column sizing", () => {
  const measure = (text: string) => text.length * 8;
  it("fits headers, types and values while keeping very long values manageable", () => {
    expect(columnSize("id", "INT", ["1"], measure)).toBe(80);
    expect(columnSize("customer_name", "TEXT", ["Alex"], measure)).toBe(152);
    expect(columnSize("name", "TEXT", ["A considerably longer customer name"], measure)).toBe(304);
    expect(columnSize("json", "JSON", ["x".repeat(100000)], measure)).toBe(640);
    expect(columnSize("a", "a_very_long_data_type", [], measure)).toBe(192);
  });
});
