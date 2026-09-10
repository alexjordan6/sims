/**
 * Uniform grid for neighbour queries. Rebuild each tick (cheap), then query(x, y, r).
 * Pick a cell size ~= the largest query radius you use.
 */
export class SpatialGrid<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();
  private readonly cols: number;

  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly cellSize: number,
  ) {
    this.cols = Math.ceil(width / cellSize) + 1;
  }

  private key(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  clear(): void {
    this.cells.clear();
  }

  rebuild(items: Iterable<T>): void {
    this.clear();
    for (const it of items) this.insert(it);
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) this.cells.set(k, (bucket = []));
    bucket.push(item);
  }

  /** All items within radius r of (x, y). Excludes `self` if given. Allocates a new array. */
  query(x: number, y: number, r: number, self?: T): T[] {
    const out: T[] = [];
    this.forEachInRadius(x, y, r, (it) => {
      if (it !== self) out.push(it);
    });
    return out;
  }

  /** Allocation-free variant. */
  forEachInRadius(x: number, y: number, r: number, fn: (item: T, distSq: number) => void): void {
    const r2 = r * r;
    const minX = Math.floor((x - r) / this.cellSize);
    const maxX = Math.floor((x + r) / this.cellSize);
    const minY = Math.floor((y - r) / this.cellSize);
    const maxY = Math.floor((y + r) / this.cellSize);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const it of bucket) {
          const dx = it.x - x;
          const dy = it.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(it, d2);
        }
      }
    }
  }
}
