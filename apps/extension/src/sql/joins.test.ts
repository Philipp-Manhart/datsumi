import type { TableInfo } from "@datsumi/core";
import { expect, it } from "vitest";

import { sqlContext } from "./completion";
import { joinSuggestions } from "./joins";
const table = (name: string): TableInfo => ({
  name,
  resourceId: name,
  kind: "table",
  editable: true,
  ddl: "",
  columns: [],
  indexes: [],
  foreignKeys: [],
});
it("suggests FK joins using aliases and composite keys", () => {
  const customers = table("customers"),
    orders = {
      ...table("orders"),
      foreignKeys: [
        {
          id: 0,
          target: "customers",
          columns: ["tenant", "customer_id"],
          targetColumns: ["tenant", "id"],
          onDelete: "NO ACTION",
          onUpdate: "NO ACTION",
        },
      ],
    };
  const text = "SELECT * FROM customers c JOIN ord";
  const suggestions = joinSuggestions(sqlContext(text, text.length), [customers, orders], "sqlite");
  expect(suggestions[0]?.insertText).toBe(
    '"orders" ON "orders"."tenant" = "c"."tenant" AND "orders"."customer_id" = "c"."id"',
  );
});
it("does not invent joins without declared foreign keys", () => {
  const text = "SELECT * FROM customers JOIN ord";
  expect(
    joinSuggestions(sqlContext(text, text.length), [table("customers"), table("orders")], "sqlite"),
  ).toEqual([]);
});
