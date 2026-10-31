import { describe, it, expect } from "vitest";

import { displayValue, documentFields, expiryLabel } from "./documentValues";
describe("readable BSON and Redis values", () => {
  it("displays exact BSON numbers and identifiers without changing source JSON", () => {
    const text =
      '{"_id":{"$oid":"000000000000000000000001"},"count":{"$numberLong":"9007199254740993"},"total":{"$numberDecimal":"12345678901234567890.12"},"created":{"$date":{"$numberLong":"1767225600000"}}}';
    const fields = documentFields(text);
    expect(fields.map(displayValue)).toEqual([
      "000000000000000000000001",
      "9007199254740993",
      "12345678901234567890.12",
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(fields[1]?.raw).toBe('{"$numberLong":"9007199254740993"}');
    expect(displayValue(undefined)).toBe("—");
    expect(expiryLabel(65000)).toBe("1m 5s");
    expect(expiryLabel(-1)).toBe("No expiry");
  });
});
