import type { Rng } from '@shared/index';
import { TILE, COLS, ROWS, type Calling } from './config';

export type TileKind = 'grass' | 'tree' | 'sapling' | 'tilled' | 'crop' | 'house' | 'barracks' | 'granary' | 'woodyard';
export type BuildingKind = 'house' | 'barracks' | 'granary' | 'woodyard';

/** Footprint per building kind; (tx, ty) is the top-left, the door sits on the bottom row at `door`. */
export const BUILDINGS: Record<BuildingKind, { w: number; h: number; door: number; name: string }> = {
  house: { w: 4, h: 4, door: 1, name: 'House' },
  barracks: { w: 4, h: 4, door: 1, name: 'Barracks' },
  granary: { w: 3, h: 2, door: 1, name: 'Granary' },
  woodyard: { w: 3, h: 2, door: 1, name: 'Woodyard' },
};
export const MAX_LEVEL = 3;
/** ground a building can go on (flattened when it goes up) */
export const BUILDABLE: ReadonlySet<TileKind> = new Set<TileKind>(['grass', 'sapling', 'tilled']);

export interface Building {
  kind: BuildingKind;
  tx: number;
  ty: number;
  level: number;
  /** houses: count of villagers who call this home */
  residents: number;
  /** houses: what its children are raised to be (farmers when unset); 'soldier' needs barracks sponsorship */
  calling?: Calling;
  /** houses: children eat a double ration and count as well fed */
  hearty?: boolean;
}
/** Houses are buildings; kept as a named type because half the sim talks about "home". */
export type House = Building;

/** The walkable tile just outside a building's door. */
export function doorstep(b: Building): TilePos {
  const f = BUILDINGS[b.kind];
  return { tx: b.tx + f.door, ty: b.ty + f.h };
}
/** Centre of a building, in tiles (fractional). */
export function buildingCenter(b: Building): TilePos {
  const f = BUILDINGS[b.kind];
  return { tx: b.tx + f.w / 2, ty: b.ty + f.h / 2 };
}
/** The row of tiles just below a building (where supply buildings show their stock). */
export function yardOf(b: Building): TilePos[] {
  const f = BUILDINGS[b.kind];
  return Array.from({ length: f.w }, (_, i) => ({ tx: b.tx + i, ty: b.ty + f.h }));
}

export interface Tile {
  kind: TileKind;
  /** crops: growth 0..cropDays (mature when >=); saplings: days toward a tree; trees: age in days (old growth at OLD_GROWTH_DAYS) */
  stage: number;
  /** trees: chop progress accumulated by workers; buildings: upgrade hammering */
  work: number;
  /** visual variant (grass/tree frame choice), picked when the tile is set */
  v: number;
  /** the building this tile belongs to, if any */
  building?: Building;
  /** for buildings: which footprint cell this tile is (col + row * w), for rendering */
  part?: number;
}

export interface TilePos { tx: number; ty: number }

export const BLOCKING: Record<TileKind, boolean> = {
  grass: false, tilled: false, crop: false, sapling: false, tree: true, house: true, barracks: true, granary: true, woodyard: true,
};

export class World {
  tiles: Tile[] = [];
  buildings: Building[] = [];
  /** tile indices changed since the renderer last drained this */
  dirty = new Set<number>();

  constructor(public readonly cols = COLS, public readonly rows = ROWS) {
    for (let i = 0; i < cols * rows; i++) { this.tiles.push({ kind: 'grass', stage: 0, work: 0, v: (i * 7919) % 97 }); this.dirty.add(i); }
  }

  get houses(): Building[] { return this.buildings.filter((b) => b.kind === 'house'); }
  get barracks(): Building[] { return this.buildings.filter((b) => b.kind === 'barracks'); }
  get granary(): Building | undefined { return this.buildings.find((b) => b.kind === 'granary'); }
  get woodyard(): Building | undefined { return this.buildings.find((b) => b.kind === 'woodyard'); }
  /** The best barracks level in the village (0 if none). */
  get barracksLevel(): number { return this.barracks.reduce((m, b) => Math.max(m, b.level), 0); }
  /** Houses a barracks can sponsor: one per level, summed over every barracks (+ any bonus). */
  sponsorship(bonusPerBarracks = 0): number { return this.barracks.reduce((n, b) => n + b.level + bonusPerBarracks, 0); }
  get swornHouses(): Building[] { return this.houses.filter((h) => h.calling === 'soldier'); }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }
  get(tx: number, ty: number): Tile | undefined {
    return this.inBounds(tx, ty) ? this.tiles[ty * this.cols + tx] : undefined;
  }
  /** Change a tile. Refuses to touch building tiles: buildings are never destroyed. */
  set(tx: number, ty: number, kind: TileKind): Tile {
    const i = ty * this.cols + tx;
    const t = this.tiles[i];
    if (t.building && !this.stamping) return t;
    t.kind = kind; t.stage = 0; t.work = 0; t.building = undefined; t.part = undefined; t.v = (t.v + 31) % 97;
    this.dirty.add(i);
    return t;
  }
  private stamping = false;
  markDirty(tx: number, ty: number): void {
    this.dirty.add(ty * this.cols + tx);
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

  /** Can a building of `kind` go here? The footprint may cover grass, stumps/saplings and bare soil (they get cleared) — not trees, crops or buildings. */
  canBuild(kind: BuildingKind, tx: number, ty: number): boolean {
    const f = BUILDINGS[kind];
    if (ty < 1) return false;
    for (let dy = 0; dy < f.h; dy++)
      for (let dx = 0; dx < f.w; dx++)
        if (!BUILDABLE.has(this.get(tx + dx, ty + dy)?.kind ?? 'tree')) return false;
    return true;
  }

  place(kind: BuildingKind, tx: number, ty: number): Building {
    const b: Building = { kind, tx, ty, level: 1, residents: 0 };
    const f = BUILDINGS[kind];
    this.stamping = true;
    for (let dy = 0; dy < f.h; dy++)
      for (let dx = 0; dx < f.w; dx++) {
        const t = this.set(tx + dx, ty + dy, kind);
        t.part = dx + dy * f.w;
        t.building = b;
      }
    this.stamping = false;
    this.buildings.push(b);
    return b;
  }
  placeHouse(tx: number, ty: number): Building { return this.place('house', tx, ty); }
  placeBarracks(tx: number, ty: number): Building { return this.place('barracks', tx, ty); }

  /** Repaint a building (after a level change). */
  refresh(b: Building): void {
    const f = BUILDINGS[b.kind];
    for (let dy = -1; dy <= f.h; dy++)
      for (let dx = 0; dx < f.w; dx++) if (this.inBounds(b.tx + dx, b.ty + dy)) this.markDirty(b.tx + dx, b.ty + dy);
  }

  /** Trees in the 8 tiles around (tx, ty). */
  treeNeighbours(tx: number, ty: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && this.get(tx + dx, ty + dy)?.kind === 'tree') n++;
    return n;
  }

  /** Size of the connected grove (trees and saplings, 8-connected) containing (tx, ty), counting at most `cap`. */
  groveSize(tx: number, ty: number, cap = 200): number {
    const start = this.get(tx, ty);
    if (!start || (start.kind !== 'tree' && start.kind !== 'sapling')) return 0;
    const seen = new Set<number>([ty * this.cols + tx]);
    const queue = [[tx, ty]];
    for (let qi = 0; qi < queue.length && seen.size < cap; qi++) {
      const [cx, cy] = queue[qi];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy, k = ny * this.cols + nx;
          if ((!dx && !dy) || seen.has(k)) continue;
          const t = this.get(nx, ny);
          if (t && (t.kind === 'tree' || t.kind === 'sapling')) { seen.add(k); queue.push([nx, ny]); }
        }
    }
    return seen.size;
  }

  /** Iterate all tiles matching a predicate. */
  *find(pred: (t: Tile, tx: number, ty: number) => boolean): Generator<TilePos> {
    for (let ty = 0; ty < this.rows; ty++)
      for (let tx = 0; tx < this.cols; tx++)
        if (pred(this.tiles[ty * this.cols + tx], tx, ty)) yield { tx, ty };
  }

  count(pred: (t: Tile) => boolean): number {
    let n = 0;
    for (const t of this.tiles) if (pred(t)) n++;
    return n;
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

  /** Starting map: tree clusters, a house, a barracks, the field, and the two supply buildings. */
  generate(rng: Rng, fieldW = 3): void {
    for (let k = 0; k < 72; k++) {
      const cx = rng.int(1, this.cols - 2), cy = rng.int(1, this.rows - 2);
      for (let i = 0; i < 6; i++) {
        const tx = cx + rng.int(-2, 2), ty = cy + rng.int(-2, 2);
        if (this.inBounds(tx, ty) && this.get(tx, ty)!.kind === 'grass') this.set(tx, ty, 'tree').stage = rng.int(0, 10);
      }
    }
    const hx = (this.cols / 2) | 0, hy = (this.rows / 2) | 0;
    // clear the village centre
    for (let ty = hy - 7; ty <= hy + 4; ty++)
      for (let tx = hx - 11; tx <= hx + 10; tx++) this.set(tx, ty, 'grass');
    this.placeHouse(hx - 9, hy - 5);
    this.placeBarracks(hx + 5, hy - 5);
    const half = Math.floor(fieldW / 2);
    for (let ty = hy + 1; ty <= hy + 3; ty++)
      for (let tx = hx - half; tx <= hx + half; tx++) {
        const t = this.set(tx, ty, 'crop');
        t.stage = rng.int(0, 2);
      }
    this.place('granary', hx + half + 2, hy + 1);
    this.place('woodyard', hx - 9, hy + 1);
  }
}
