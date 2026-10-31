import { describe, it, expect } from "vitest";

import {
  layoutSchema,
  cardHeight,
  separatePositions,
  relationshipPath,
  type LayoutTable,
} from "./schemaLayout";
const table = (name: string, targets: string[] = [], columns = 5): LayoutTable => ({
  name,
  columns: Array.from({ length: columns }, () => ({})),
  foreignKeys: targets.map((target) => ({ target })),
});
describe("responsive schema packing", () => {
  it("uses wide space for disconnected tables rather than one tall column", () => {
    const tables = Array.from({ length: 9 }, (_, index) => table(`table${index}`));
    const wide = layoutSchema(tables, 2000, 900),
      narrow = layoutSchema(tables, 800, 900);
    const height = (points: ReturnType<typeof layoutSchema>) =>
      Math.max(...tables.map((node) => points[node.name]!.y + cardHeight(node)));
    expect(new Set(Object.values(wide).map((point) => point.x)).size).toBeGreaterThan(3);
    expect(height(wide)).toBeLessThan(height(narrow));
    expect(height(wide)).toBeLessThan(600);
  });
  it("keeps related tables together and avoids overlap for branches and cycles", () => {
    const tables = [
      table("customers"),
      table("orders", ["customers"]),
      table("items", ["orders", "products"]),
      table("products"),
      table("view"),
      table("empty"),
      table("a", ["b"]),
      table("b", ["a"]),
    ];
    const points = layoutSchema(tables, 1600, 800);
    expect(points.orders!.x).toBeGreaterThan(points.customers!.x);
    expect(points.items!.x).toBeGreaterThan(points.orders!.x);
    for (let i = 0; i < tables.length; i++)
      for (let j = i + 1; j < tables.length; j++) {
        const a = tables[i]!,
          b = tables[j]!,
          pa = points[a.name]!,
          pb = points[b.name]!;
        const overlap =
          pa.x < pb.x + 300 &&
          pa.x + 300 > pb.x &&
          pa.y < pb.y + cardHeight(b) &&
          pa.y + cardHeight(a) > pb.y;
        expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    expect(layoutSchema(tables, 1600, 800)).toEqual(points);
  });
});

it("keeps dependency direction for tall tables without overlapping cards", () => {
  const tables = [
    table("customers", [], 20),
    table("products", [], 12),
    table("orders", ["customers"]),
    table("items", ["orders", "products"]),
  ];
  const points = layoutSchema(tables, 1600, 600);
  expect(points.orders!.x).toBeGreaterThan(points.customers!.x);
  expect(points.items!.x).toBeGreaterThan(points.products!.x);
  expect(points.items!.x).toBeGreaterThan(points.orders!.x);
});
it("routes long relationships outside intervening cards", () => {
  const path = relationshipPath({ x: 760, y: 0 }, { x: 0, y: 0 }, 80, 80, [
    { point: { x: 0, y: 0 }, height: 200 },
    { point: { x: 380, y: 0 }, height: 200 },
    { point: { x: 760, y: 0 }, height: 200 },
  ]);
  expect(path).toContain("V 224");
  expect(path).toContain("H 324");
  expect(relationshipPath({ x: 380, y: 0 }, { x: 0, y: 0 }, 80, 80, [])).toContain(" C ");
});

it("uses measured card heights and repairs overlapping saved positions", () => {
  const tables = [
    table("customers", [], 8),
    table("products", [], 5),
    table("orders", ["customers"]),
    table("items", ["orders", "products"]),
  ];
  const measured = { customers: 700, products: 550, orders: 400, items: 300 };
  const automatic = layoutSchema(tables, 1800, 800, measured);
  const saved = { ...automatic, products: { ...automatic.orders! } };
  const result = separatePositions(tables, saved, measured);
  for (let i = 0; i < tables.length; i++)
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]!,
        b = tables[j]!,
        pa = result[a.name]!,
        pb = result[b.name]!;
      const overlap =
        pa.x < pb.x + 300 &&
        pa.x + 300 > pb.x &&
        pa.y < pb.y + measured[b.name as keyof typeof measured] &&
        pa.y + measured[a.name as keyof typeof measured] > pb.y;
      expect(overlap, `${a.name} intersects ${b.name}`).toBe(false);
    }
});
