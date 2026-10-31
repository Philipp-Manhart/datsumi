/** Fit the loaded page, with room for padding, sorting and the resize handle. */
export function columnSize(
  name: string,
  dataType: string,
  values: readonly string[],
  measure: (text: string) => number,
): number {
  let size = Math.max(measure(name) + 48, measure(dataType) + 24, 80);
  for (const value of values) {
    for (const line of value.slice(0, 1000).split(/\r?\n/))
      size = Math.max(size, measure(line) + 24);
    if (size >= 640) return 640;
  }
  return Math.min(640, Math.ceil(size));
}
