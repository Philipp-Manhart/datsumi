import { describe, expect, it } from "vitest";

import { oracleStatement } from "./oracleStatement";

describe("Oracle statement normalization", () => {
  it.each([
    ["SELECT 1 FROM dual;", "SELECT 1 FROM dual"],
    ["SELECT 1 FROM dual; -- note", "SELECT 1 FROM dual -- note"],
    ["SELECT 1 FROM dual; /* note */", "SELECT 1 FROM dual /* note */"],
    ["SELECT 'literal;--note' FROM dual", "SELECT 'literal;--note' FROM dual"],
    ["SELECT q'[it's;--literal]' FROM dual;", "SELECT q'[it's;--literal]' FROM dual"],
    ["-- comment\nBEGIN NULL; END;\n/", "-- comment\nBEGIN NULL; END;"],
    [
      "/* comment */ DECLARE n NUMBER; BEGIN n:=1; END;",
      "/* comment */ DECLARE n NUMBER; BEGIN n:=1; END;",
    ],
  ])("handles %s", (source, expected) => {
    expect(oracleStatement(source)).toBe(expected);
  });
});
