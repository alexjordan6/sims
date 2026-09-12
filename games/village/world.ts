import type { Rng } from '@shared/index';
import { TILE, COLS, ROWS } from './config';

export type TileKind = 'grass' | 'tree' | 'tilled' | 'crop' | 'house' | 'barracks';

export interface House {
  tx: number;
  ty: number;
  residents: number; // count of villagers who call this home
}

export interface Tile {
  kind: TileKind;
  /** crop growth 0..cropDays; mature when >= cropDays */
  stage: number;
  /** trees: chop progress accumulated by workers */
  work: number;
  /** visual variant (grass/tree frame choice), picked when the tile is set */
  v: number;
  house?: House;
}

export interface TilePos { tx: number; ty: number }

export const BLOCKING: Record<TileKind, boolean> = {
  grass: false, tilled: false, crop: false, tree: true, house: true, barracks: true,
};

export class World {
  tiles: Tile[] = [];
  houses: House[] = [];
  barracks: TilePos[] = [];
  /** tile indices changed since the renderer last drained this */
  dirty = new Set<number>();

  constructor(public readonly cols = COLS, public readonly rows = ROWS) {
    for (let i = 0; i < cols * rows; i++) { this.tiles.push({ kind: 'grass', stage: 0, work: 0, v: (i * 7919) % 97 }); this.dirty.add(i); }
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }
  get(tx: number, ty: number): Tile | undefined {
    return this.inBounds(tx, ty) ? this.tiles[ty * this.cols + tx] : undefined;
  }
  set(tx: number, ty: number, kind: TileKind): Tile {
    const i = ty * this.cols + tx;
    const t = this.tiles[i];
    t.kind = kind; t.stage = 0; t.work = 0; t.house = undefined; t.v = (t.v + 31) % 97;
    this.dirty.add(i);
    return t;
  }
  isBlocked(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return !t || BLOCKING[t.kind];
  }

  /** Pixel centre of a tile. */
  static center(tx: number, ty: number): { x: number; y: number } {
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
  static toTile(x: number, y: number): TilePos {
    return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
  }

  placeHouse(tx: number, ty: number): House {
    const t = this.set(tx, ty, 'house');
    const h: House = { tx, ty, residents: 0 };
    t.house = h;
    this.houses.push(h);
    return h;
  }
  placeBarracks(tx: number, ty: number): void {
    this.set(tx, ty, 'barracks');
    this.barracks.push({ tx, ty });
  }

  /** Iterate all tiles matching a predicate. */
  *find(pred: (t: Tile, tx: number, ty: number) => boolean): Generator<TilePos> {
    for (let ty = 0; ty < this.rows; ty++)
      for (let tx = 0; tx < this.cols; tx++)
        if (pred(this.tiles[ty * this.cols + tx], tx, ty)) yield { tx, ty };
  }

  /** Nearest tile (by squared pixel distance from x,y) matching pred. */
  nearest(x: number, y: number, pred: (t: Tile, tx: number, ty: number) => boolean): TilePos | null {
    let best: TilePos | null = null, bd = Infinity;
    for (const pos of this.find(pred)) {
      const c = World.center(pos.tx, pos.ty);
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = pos; }
    }
    return best;
  }

  /**
   * BFS path on the 4-grid from `from` to `to`. If `to` is blocked, the path ends on a
   * passable tile adjacent to it. Returns tile positions excluding `from`; [] if unreachable/already there.
   */
  bfs(from: TilePos, to: TilePos): TilePos[] {
    const n = this.cols * this.rows;
    const start = from.ty * this.cols + from.tx;
    const goal = to.ty * this.cols + to.tx;
    const goalBlocked = this.isBlocked(to.tx, to.ty);
    if (start === goal) return [];
    const prev = new Int32Array(n).fill(-1);
    prev[start] = start;
    const queue = [start];
    const dirs = [1, -1, this.cols, -this.cols];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const cx = cur % this.cols, cy = (cur / this.cols) | 0;
      if (goalBlocked && Math.abs(cx - to.tx) + Math.abs(cy - to.ty) === 1) return this.unwind(prev, start, cur);
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!this.inBounds(nx, ny)) continue;
        const ni = cur + dirs[d];
        if (prev[ni] !== -1) continue;
        if (ni === goal && !goalBlocked) { prev[ni] = cur; return this.unwind(prev, start, ni); }
        if (this.isBlocked(nx, ny)) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    return [];
  }

  private unwind(prev: Int32Array, start: number, end: number): TilePos[] {
    const out: TilePos[] = [];
    for (let i = end; i !== start; i = prev[i]) out.push({ tx: i % this.cols, ty: (i / this.cols) | 0 });
    return out.reverse();
  }

  /** Starting map: scattered tree clusters, one house, a tilled patch, a barracks. */
  generate(rng: Rng): void {
    for (let k = 0; k < 14; k++) {
      const cx = rng.int(1, this.cols - 2), cy = rng.int(1, this.rows - 2);
      for (let i = 0; i < 6; i++) {
        const tx = cx + rng.int(-2, 2), ty = cy + rng.int(-2, 2);
        if (this.inBounds(tx, ty) && this.get(tx, ty)!.kind === 'grass') this.set(tx, ty, 'tree');
      }
    }
    const hx = (this.cols / 2) | 0, hy = (this.rows / 2) | 0;
    // clear the village centre
    for (let ty = hy - 3; ty <= hy + 3; ty++)
      for (let tx = hx - 5; tx <= hx + 5; tx++) this.set(tx, ty, 'grass');
    this.placeHouse(hx - 3, hy - 2);
    this.placeBarracks(hx + 4, hy - 2);
    for (let ty = hy; ty <= hy + 2; ty++)
      for (let tx = hx - 1; tx <= hx + 1; tx++) {
        const t = this.set(tx, ty, 'crop');
        t.stage = rng.int(0, 2);
      }
  }
}
