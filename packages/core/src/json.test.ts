import { describe, expect, it } from "vitest";

import { formatJson, jsonEntries } from "./json";
describe("lossless JSON inspection", () => {
  it("formats tokens without rounding exact numbers or changing strings", () => {
    const text = '{"large":9223372036854775807,"decimal":123.12345678901234567890,"text":"a\\nb"}';
    const formatted = formatJson(text);
    expect(formatted).toContain("9223372036854775807");
    expect(formatted).toContain("123.12345678901234567890");
    expect(formatted).toContain('"a\\nb"');
    expect(jsonEntries(text).children[0]?.raw).toBe("9223372036854775807");
  });
  it("rejects comments, trailing commas, incomplete JSON, and multiple roots", () => {
    for (const text of ['{"a":1,}', "/* comment */ {}", '{"a":', "{} {}"])
      expect(() => formatJson(text)).toThrow("Invalid JSON");
  });
  it("uses escaped JSON pointers for nested keys and arrays", () => {
    const tree = jsonEntries('{"a/b~":[{"x":null}]}');
    expect(tree.children[0]?.children[0]?.children[0]?.path).toBe("/a~1b~0/0/x");
  });
});
