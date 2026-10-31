import { expect, it } from "vitest";

import { compareResults } from "./compareResults";
it("aligns captured rows by composite keys and marks absence without rerunning SQL", () => {
  const result = compareResults(
    {
      kind: "table",
      columns: ["tenant", "id", "name"],
      rows: [
        [1, 2, "before"],
        [1, 3, "removed"],
      ],
    },
    {
      kind: "table",
      columns: ["tenant", "id", "name"],
      rows: [
        [1, 4, "added"],
        [1, 2, "after"],
      ],
      truncated: true,
    },
    ["tenant", "id"],
  );
  expect(result.left.rows.map((r) => r.present)).toEqual([true, true, false]);
  expect(result.right.rows.map((r) => r.present)).toEqual([true, false, true]);
  expect(result.truncated).toBe(true);
});
it("refuses missing, duplicate, or nonunique matching keys", () => {
  const table = { kind: "table" as const, columns: ["id"], rows: [[1], [1]] };
  expect(() => compareResults(table, table, ["id"])).toThrow("not unique");
  expect(() => compareResults(table, table, ["missing"])).toThrow("unambiguous");
  expect(() => compareResults(table, table, [])).toThrow("Choose");
});
