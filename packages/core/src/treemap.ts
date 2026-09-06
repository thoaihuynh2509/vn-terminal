/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000).
 *
 * Pure and dependency-free so the geometry can be tested directly — a treemap
 * that overlaps or leaves gaps is very hard to spot by eye but trivial to catch
 * with an assertion.
 */
export interface Box<T> { item: T; x: number; y: number; w: number; h: number }

function worst(row: number[], side: number): number {
  const sum = row.reduce((s, v) => s + v, 0);
  if (sum <= 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Lays `items` into a `w`×`h` rectangle at (`x`,`y`), with area proportional to
 * `weight`. Items are laid out in the order given — sort before calling.
 */
export function squarify<T>(
  items: { item: T; weight: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
): Box<T>[] {
  const positive = items.filter((i) => i.weight > 0);
  const total = positive.reduce((s, i) => s + i.weight, 0);
  if (!positive.length || total <= 0 || w <= 0 || h <= 0) return [];

  // Rescale weights into area units of the target rectangle.
  const scale = (w * h) / total;
  let rest = positive.map((i) => ({ item: i.item, area: i.weight * scale }));

  const out: Box<T>[] = [];
  let cx = x, cy = y, cw = w, ch = h;

  while (rest.length) {
    const vertical = cw >= ch;
    const side = vertical ? ch : cw;

    // Grow the row while the aspect ratio keeps improving.
    const row = [rest[0]];
    let i = 1;
    while (
      i < rest.length &&
      worst([...row.map((r) => r.area), rest[i].area], side) <= worst(row.map((r) => r.area), side)
    ) {
      row.push(rest[i]);
      i++;
    }

    const sum = row.reduce((s, r) => s + r.area, 0);
    const thickness = side > 0 ? sum / side : 0;
    let off = vertical ? cy : cx;

    for (const r of row) {
      const len = thickness > 0 ? r.area / thickness : 0;
      out.push(
        vertical
          ? { item: r.item, x: cx, y: off, w: thickness, h: len }
          : { item: r.item, x: off, y: cy, w: len, h: thickness },
      );
      off += len;
    }

    if (vertical) { cx += thickness; cw -= thickness; }
    else { cy += thickness; ch -= thickness; }
    rest = rest.slice(row.length);
  }
  return out;
}
