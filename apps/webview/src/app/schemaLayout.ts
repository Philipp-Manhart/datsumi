import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
export interface LayoutTable {
  name: string;
  columns: readonly unknown[];
  foreignKeys: readonly { target: string }[];
}
export interface Point {
  x: number;
  y: number;
}
const width = 300,
  gap = 80,
  stride = width + gap + 24;
export const cardHeight = (table: LayoutTable) => 96 + table.columns.length * 25;
/** Lay out connected tables in layers, then pack disconnected groups into free space. */
export function layoutSchema(
  tables: readonly LayoutTable[],
  viewportWidth: number,
  _viewportHeight: number,
  measured: Readonly<Record<string, number>> = {},
): Record<string, Point> {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const adjacent = new Map(tables.map((table) => [table.name, new Set<string>()]));
  for (const table of tables)
    for (const key of table.foreignKeys)
      if (byName.has(key.target) && key.target !== table.name) {
        adjacent.get(table.name)!.add(key.target);
        adjacent.get(key.target)!.add(table.name);
      }
  const unseen = new Set(byName.keys()),
    components: LayoutTable[][] = [];
  while (unseen.size) {
    const queue = [unseen.values().next().value!],
      component: LayoutTable[] = [];
    unseen.delete(queue[0]!);
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i]!;
      component.push(byName.get(name)!);
      for (const next of adjacent.get(name)!) if (unseen.delete(next)) queue.push(next);
    }
    components.push(component);
  }
  const groups = components
    .map((component) => {
      const graph = new graphlib.Graph({ multigraph: true });
      graph.setGraph({
        rankdir: "LR",
        ranker: "network-simplex",
        nodesep: gap,
        ranksep: gap + 24,
        edgesep: 20,
        marginx: 0,
        marginy: 0,
      });
      graph.setDefaultEdgeLabel(() => ({}));
      const names = new Set(component.map((table) => table.name));
      for (const table of component)
        graph.setNode(table.name, { width, height: measured[table.name] ?? cardHeight(table) });
      for (const table of component)
        table.foreignKeys.forEach((key, index) => {
          if (names.has(key.target))
            graph.setEdge(key.target, table.name, {}, `${table.name}:${index}`);
        });
      dagreLayout(graph);
      const points: Record<string, Point> = {};
      let right = 0,
        bottom = 0,
        area = 0;
      for (const table of component) {
        const node = graph.node(table.name);
        const height = measured[table.name] ?? cardHeight(table);
        points[table.name] = { x: node.x - width / 2, y: node.y - height / 2 };
        right = Math.max(right, node.x + width / 2);
        bottom = Math.max(bottom, node.y + height / 2);
        area += width * height;
      }
      return {
        points,
        span: Math.max(1, Math.ceil((right + gap) / stride)),
        height: bottom + gap,
        area,
      };
    })
    .sort((a, b) => b.area - a.area);
  const columns = Math.max(
    1,
    Math.floor((viewportWidth - 48 + gap) / stride),
    ...groups.map((group) => group.span),
  );
  const skyline = Array.from({ length: columns }, () => 0),
    result: Record<string, Point> = {};
  for (const group of groups) {
    let best = 0,
      base = Infinity;
    for (let col = 0; col <= columns - group.span; col++) {
      const height = Math.max(...skyline.slice(col, col + group.span));
      if (height < base) {
        base = height;
        best = col;
      }
    }
    for (const [name, point] of Object.entries(group.points))
      result[name] = { x: point.x + best * stride, y: point.y + base };
    for (let col = best; col < best + group.span; col++) skyline[col] = base + group.height;
  }
  return result;
}

/** Recover stale saved coordinates and settle dragged cards without intersection. */
export function separatePositions(
  tables: readonly LayoutTable[],
  desired: Record<string, Point>,
  measured: Readonly<Record<string, number>> = {},
): Record<string, Point> {
  const result: Record<string, Point> = {};
  for (const table of tables) {
    const wanted = desired[table.name] ?? { x: 0, y: 0 };
    const point = { x: Math.max(0, wanted.x), y: Math.max(0, wanted.y) };
    const height = measured[table.name] ?? cardHeight(table);
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of tables) {
        const placed = result[other.name];
        if (!placed) continue;
        const otherHeight = measured[other.name] ?? cardHeight(other);
        if (
          point.x < placed.x + width + 20 &&
          point.x + width + 20 > placed.x &&
          point.y < placed.y + otherHeight + 24 &&
          point.y + height + 24 > placed.y
        ) {
          point.y = placed.y + otherHeight + 24;
          moved = true;
        }
      }
    }
    result[table.name] = point;
  }
  return result;
}

/** Route a long relationship around cards instead of drawing through intervening tables. */
export function relationshipPath(
  from: Point,
  to: Point,
  sourceY: number,
  targetY: number,
  cards: readonly { point: Point; height: number }[],
  lane = 0,
): string {
  const self = from.x === to.x;
  if (self) {
    const x = from.x + width,
      outside = x + 32 + (lane % 4) * 12;
    return `M ${x} ${sourceY} H ${outside} V ${targetY === sourceY ? targetY + 28 : targetY} H ${x}`;
  }
  const direction = to.x > from.x ? 1 : -1;
  const x1 = from.x + (direction > 0 ? width : 0),
    x2 = to.x + (direction > 0 ? 0 : width);
  const minX = Math.min(x1, x2),
    maxX = Math.max(x1, x2);
  const blocked = cards.some(
    ({ point, height }) =>
      point.x > Math.min(from.x, to.x) &&
      point.x < Math.max(from.x, to.x) &&
      point.x < maxX &&
      point.x + width > minX &&
      point.y < Math.max(sourceY, targetY) + 8 &&
      point.y + height > Math.min(sourceY, targetY) - 8,
  );
  if (!blocked) {
    const bend = (Math.abs(x2 - x1) / 2) * direction;
    return `M ${x1} ${sourceY} C ${x1 + bend} ${sourceY}, ${x2 - bend} ${targetY}, ${x2} ${targetY}`;
  }
  const start = x1 + direction * 24,
    end = x2 - direction * 24;
  const left = Math.min(start, end),
    right = Math.max(start, end);
  const clear = (y: number) =>
    y >= 16 &&
    !cards.some(
      ({ point, height }) =>
        point.x < right && point.x + width > left && point.y - 12 < y && point.y + height + 12 > y,
    );
  const candidates = [
    sourceY,
    targetY,
    (sourceY + targetY) / 2,
    ...cards.flatMap(({ point, height }) => [
      point.y - 24 - (lane % 3) * 8,
      point.y + height + 24 + (lane % 3) * 8,
    ]),
  ];
  candidates.sort(
    (a, b) =>
      Math.abs(sourceY - a) +
        Math.abs(targetY - a) -
        (Math.abs(sourceY - b) + Math.abs(targetY - b)) ||
      Math.abs(a - (sourceY + targetY) / 2) - Math.abs(b - (sourceY + targetY) / 2),
  );
  const corridor =
    candidates.find(clear) ??
    Math.max(...cards.map(({ point, height }) => point.y + height)) + 28 + (lane % 6) * 12;
  return `M ${x1} ${sourceY} H ${start} V ${corridor} H ${end} V ${targetY} H ${x2}`;
}
