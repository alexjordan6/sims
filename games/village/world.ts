import type { Rng } from '@shared/index';
import { TILE, COLS, ROWS, BUILDING_HP, HEARTH_WOOD, ITEM, GNOME_HOME, p, CROP_KINDS, type Calling, type FoodKind, type BuildingKind } from './config';
export type { BuildingKind } from './config';
import { tickItem, hop, type Item, type ItemKind } from './items';

export type DefenseKind = 'wall' | 'gate' | 'stairs';
export interface Defense extends TilePos { kind: DefenseKind; hp: number; maxHp: number; open: boolean }
/** 'bush', 'mushroom', 'hazel', 'garlic' and 'burdock' are wild food: they stay put, get picked (by hand, or unit by unit by gnomes) and regrow (see Tile.stage / Tile.left) */
export type TileKind = 'grass' | 'tree' | 'sapling' | 'tilled' | 'crop' | 'bush' | 'mushroom' | 'hazel' | 'garlic' | 'burdock' | BuildingKind | DefenseKind;

/** Footprint per building kind; (tx, ty) is the top-left, the door sits on the bottom row at `door`. */
export const BUILDINGS: Record<BuildingKind, { w: number; h: number; door: number; name: string }> = {
  house: { w: 4, h: 4, door: 2, name: 'House' },
  barracks: { w: 4, h: 4, door: 1, name: 'Barracks' },
  granary: { w: 3, h: 2, door: 1, name: 'Granary' },
  woodyard: { w: 3, h: 2, door: 1, name: 'Woodyard' },
  tavern: { w: 4, h: 4, door: 1, name: 'The Copper Acorn' },
  lair: { w: 5, h: 4, door: 2, name: "The Ogre's Lair" },
  gnomehouse: { w: 2, h: 2, door: 0, name: 'Gnome House' },
};
export const MAX_LEVEL = 3;
/** ground a building can go on (flattened when it goes up) */
export const BUILDABLE: ReadonlySet<TileKind> = new Set<TileKind>(['grass', 'sapling', 'tilled', 'bush', 'mushroom', 'hazel', 'garlic', 'burdock']);
/** tile kinds that remember which crop they carry (sown, or the last thing harvested) */
export const CROP_GROUND: ReadonlySet<TileKind> = new Set<TileKind>(['crop', 'tilled']);
/** what a wild tile yields, and the pile kind it makes */
export const WILD_FOOD: Partial<Record<TileKind, FoodKind>> = { bush: 'berry', mushroom: 'mushroom', hazel: 'hazelnut', garlic: 'garlic', burdock: 'burdock' };
/** ground a training pen can be painted on */
export const PEN_GROUND: ReadonlySet<TileKind> = new Set<TileKind>(['grass', 'tilled']);

export interface Building {
  kind: BuildingKind;
  tx: number;
  ty: number;
  level: number;
  /** houses: count of villagers who call this home */
  residents: number;
  /** houses: sim time of the next birth roll (see VillageScene.tickBirths) */
  nextBirth?: number;
  /** barracks: arrows left in the tower's chest */
  ammo?: number;
  /** barracks: seconds until the tower may fire again */
  fireCd?: number;
  /** barracks: the "out of arrows" warning has been posted since the last restock */
  dryWarned?: boolean;
  /** structure left; 0 is a ruin. The lair has none and can't be hurt. */
  hp: number;
  maxHp: number;
  /** wrecked: the footprint stays, but the building does nothing until the hammer rebuilds it */
  ruined?: boolean;
  /** an "under attack" alarm has been raised for it this raid */
  alarmed?: boolean;
  /** nights of firewood stacked by the hearth (buildings without a hearth keep 0) */
  firewood: number;
  /** a wild place, not the village's: no hearth, no fog sight, no raider cares, until it is found */
  wild?: boolean;
  /** the hearth burned last night; a cold building stalls births, drill, regen and meals */
  warm: boolean;
}
export function buildingMaxHp(b: { kind: BuildingKind; level: number }): number { return Math.round((BUILDING_HP[b.kind][b.level] ?? 0) * p.buildingHpMul); }
export function hasHearth(b: { kind: BuildingKind }): boolean { return HEARTH_WOOD[b.kind][1] > 0; }
/** wood one night costs this building */
export function hearthCost(b: { kind: BuildingKind; level: number }): number { return Math.round((HEARTH_WOOD[b.kind][b.level] ?? 0) * p.hearthMul); }
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
  /** crops: growth 0..cropDays (mature when >=); saplings: days toward a tree; trees: age in days (old growth at OLD_GROWTH_DAYS); wild food: days since picked bare */
  stage: number;
  /** wild food: units still on a ripe plant after gnomes took some (unset = the full yield) */
  left?: number;
  /** crops and tilled soil: the crop sown here (soil keeps the memory so farmers replant the same) */
  food?: FoodKind;
  /** trees: chop progress accumulated by workers; buildings: upgrade hammering */
  work: number;
  /** visual variant (grass/tree frame choice), picked when the tile is set */
  v: number;
  /** the building this tile belongs to, if any */
  building?: Building;
  /** for buildings: which footprint cell this tile is (col + row * w), for rendering */
  part?: number;
  defense?: Defense;
  biome?: 'meadow' | 'woodland' | 'deepwood';
  trail?: boolean;
  /** long grass: slows anyone wading through it (see p.grassSlow) until the sword mows it; never grows back */
  tall?: boolean;
  /** painted training pen this tile belongs to (grass or soil underneath) */
  pen?: Calling;
}

export interface TilePos { tx: number; ty: number }

export const BLOCKING: Record<TileKind, boolean> = {
  grass: false, tilled: false, crop: false, sapling: false, bush: false, mushroom: false, hazel: false, garlic: false, burdock: false, tree: true, house: true, barracks: true, granary: true, woodyard: true,
  tavern: true, lair: true, gnomehouse: true, wall: true, gate: false, stairs: false,
};

export class World {
  tiles: Tile[] = [];
  buildings: Building[] = [];
  defenses = new Map<number, Defense>();
  /** the Ogre's home, far out in the woods; found through the fog */
  lair: Building | null = null;
  denseForests = false;
  revision = 0;
  treeCount = 0;
  /** tile indices changed since the renderer last drained this */
  dirty = new Set<number>();
  /** painted pen tiles by kind (tile indices) and the food piled on them */
  pens = new Map<Calling, Set<number>>();
  /** things lying on the ground: thrown food, dropped armfuls, loot */
  items: Item[] = [];
  private nextItemId = 1;

  constructor(public readonly cols = COLS, public readonly rows = ROWS) {
    for (let i = 0; i < cols * rows; i++) { this.tiles.push({ kind: 'grass', stage: 0, work: 0, v: (i * 7919) % 97 }); this.dirty.add(i); }
  }

  get houses(): Building[] { return this.buildings.filter((b) => b.kind === 'house'); }
  /** gnome families live apart: their own cottages, never a human house */
  get gnomeHouses(): Building[] { return this.buildings.filter((b) => b.kind === 'gnomehouse' && !b.wild); }
  /** the toadstool cottage out in the woods, until the head walks into its glade and claims it */
  get wildGnomeHouse(): Building | undefined { return this.buildings.find((b) => b.kind === 'gnomehouse' && b.wild); }
  /** every roof a family can be raised under: houses and gnome houses */
  get familyHouses(): Building[] { return this.buildings.filter((b) => (b.kind === 'house' || b.kind === 'gnomehouse') && !b.wild); }
  /** buildings the village can use (everything but the Ogre's lair) */
  get villageBuildings(): Building[] { return this.buildings.filter((b) => b.kind !== 'lair' && !b.wild); }
  /** standing barracks: a ruined one sponsors nothing, fires nothing and forges nothing */
  get barracks(): Building[] { return this.buildings.filter((b) => b.kind === 'barracks' && !b.ruined); }
  get allBarracks(): Building[] { return this.buildings.filter((b) => b.kind === 'barracks'); }
  get granary(): Building | undefined { return this.buildings.find((b) => b.kind === 'granary'); }
  get woodyard(): Building | undefined { return this.buildings.find((b) => b.kind === 'woodyard'); }
  /** The best barracks level in the village (0 if none). */
  get barracksLevel(): number { return this.barracks.reduce((m, b) => Math.max(m, b.level), 0); }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }
  get(tx: number, ty: number): Tile | undefined {
    return this.inBounds(tx, ty) ? this.tiles[ty * this.cols + tx] : undefined;
  }
  /** Change a tile. Refuses to touch building tiles: a wrecked building keeps its footprint (see `Building.ruined`). */
  set(tx: number, ty: number, kind: TileKind): Tile {
    const i = ty * this.cols + tx;
    const t = this.tiles[i];
    if ((t.building || t.defense) && !this.stamping) return t;
    if (t.kind === 'tree') this.treeCount--;
    if (kind === 'tree') this.treeCount++;
    // paths only go stale when walkability changes: tilling, planting and harvesting don't re-path anyone
    // (fortifications always count: a closed gate blocks enemies even though the tile kind doesn't)
    const fort = (k: TileKind) => k === 'wall' || k === 'gate' || k === 'stairs';
    if (BLOCKING[t.kind] !== BLOCKING[kind] || fort(t.kind) || fort(kind)) this.revision++;
    t.kind = kind; t.stage = 0; t.work = 0; t.building = undefined; t.part = undefined; t.tall = undefined; t.v = (t.v + 31) % 97;
    // a pen dies with its ground: a building, tree or crop on the tile takes it out of the pen (and its pile)
    if (t.pen && !PEN_GROUND.has(kind)) { this.pens.get(t.pen)?.delete(i); t.pen = undefined; }
    if (!CROP_GROUND.has(kind)) t.food = undefined;
    this.dirty.add(i);
    return t;
  }

  // ---- training pens ------------------------------------------------------------------------
  /** Paint (or with null / the same kind, erase) a pen tile. Only open ground takes paint. */
  paintPen(tx: number, ty: number, kind: Calling | null): boolean {
    const t = this.get(tx, ty), i = ty * this.cols + tx;
    if (!t || t.building || t.defense || !PEN_GROUND.has(t.kind)) return false;
    if (kind === t.pen) kind = null;
    if (t.pen) this.pens.get(t.pen)?.delete(i);
    t.pen = kind ?? undefined; t.tall = undefined; // the rope goes up over trampled earth
    if (kind) { if (!this.pens.has(kind)) this.pens.set(kind, new Set()); this.pens.get(kind)!.add(i); }
    this.dirty.add(i);
    return true;
  }
  penTiles(kind?: Calling): number[] {
    if (kind) return [...(this.pens.get(kind) ?? [])];
    return [...this.pens.values()].flatMap((set) => [...set]);
  }
  private nearestOf(x: number, y: number, idx: Iterable<number>): TilePos | null {
    let best: TilePos | null = null, bd = Infinity;
    for (const i of idx) {
      const tx = i % this.cols, ty = (i / this.cols) | 0, c = World.center(tx, ty);
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = { tx, ty }; }
    }
    return best;
  }
  /** Nearest pen tile of a kind (any kind when omitted). */
  nearestPen(x: number, y: number, kind?: Calling): TilePos | null { return this.nearestOf(x, y, this.penTiles(kind)); }
  // ---- long grass ---------------------------------------------------------------------------
  /** Mow a tile of long grass. Walkability is unchanged, so no path goes stale. */
  cutGrass(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    if (!t || t.kind !== 'grass' || !t.tall) return false;
    t.tall = undefined; this.dirty.add(ty * this.cols + tx);
    return true;
  }
  /** Is the tile under a pixel position long grass? */
  tallAt(x: number, y: number): boolean {
    const t = this.get(Math.floor(x / TILE), Math.floor(y / TILE));
    return t?.kind === 'grass' && !!t.tall;
  }
  /** Speed multiplier for a body at a pixel position: p.grassSlow in long grass, 1 anywhere else. */
  slowAt(x: number, y: number): number { return this.tallAt(x, y) ? p.grassSlow : 1; }
  // ---- items on the ground ------------------------------------------------------------------
  /** Put an item in the world at a pixel position (resting, unless it is launched or hopped afterwards). */
  dropItem(kind: ItemKind, n: number, x: number, y: number, food?: FoodKind, rng?: Rng): Item {
    const it: Item = { id: this.nextItemId++, kind, food: kind === 'food' ? food : undefined, n, x, y, z: 0, vx: 0, vy: 0, vz: 0, rest: true, age: 0 };
    this.items.push(it);
    if (rng) hop(it, rng);
    return it;
  }
  removeItem(it: Item): void { const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); }
  /** what stops a rolling item: the map edge and anything an enemy can't walk through (walls, trees, buildings, closed gates) */
  private itemBlocked = (x: number, y: number, z: number): boolean => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), t = this.get(tx, ty);
    if (!t) return true;
    if (t.kind === 'tree') return z < ITEM.treeHeight; // lobbed over the crown
    return this.isBlocked(tx, ty, true);
  };
  tickItems(dt: number): void { for (const it of this.items) tickItem(it, dt, this.itemBlocked); }
  /** Is this item lying inside a pen of that kind? */
  inPen(it: { x: number; y: number }, pen: Calling): boolean { return this.get(Math.floor(it.x / TILE), Math.floor(it.y / TILE))?.pen === pen; }
  /** Resting food items inside a pen (all kinds, or one). */
  penItems(pen: Calling, kind?: FoodKind): Item[] { return this.items.filter((it) => it.rest && it.kind === 'food' && (!kind || it.food === kind) && this.inPen(it, pen)); }
  penFoodTotal(pen: Calling, kind?: FoodKind): number { return this.penItems(pen, kind).reduce((n, it) => n + it.n, 0); }
  /** The nearest resting food item lying inside the pen. */
  nearestPenItem(x: number, y: number, pen: Calling): Item | null {
    let best: Item | null = null, bd = Infinity;
    for (const it of this.items) {
      if (!it.rest || it.kind !== 'food' || !this.inPen(it, pen)) continue;
      const d = (it.x - x) ** 2 + (it.y - y) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  /** The nearest resting meat lying outside any pen (what a gnome goes to fetch), among those `ok` allows. */
  nearestWildMeat(x: number, y: number, ok: (it: Item) => boolean = () => true): Item | null {
    let best: Item | null = null, bd = Infinity;
    for (const it of this.items) {
      if (!it.rest || it.kind !== 'food' || it.food !== 'meat' || it.n <= 0 || !ok(it)) continue;
      if (this.get(Math.floor(it.x / TILE), Math.floor(it.y / TILE))?.pen) continue;
      const d = (it.x - x) ** 2 + (it.y - y) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  /** The nearest resting food item within `r` tiles of a building's centre (a gnome house's yard). */
  nearestYardItem(x: number, y: number, b: Building, r: number): Item | null {
    const c = buildingCenter(b), cx = c.tx * TILE, cy = c.ty * TILE, rr = (r * TILE) ** 2;
    let best: Item | null = null, bd = Infinity;
    for (const it of this.items) {
      if (!it.rest || it.kind !== 'food' || (it.x - cx) ** 2 + (it.y - cy) ** 2 > rr) continue;
      const d = (it.x - x) ** 2 + (it.y - y) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  /** Resting food lying in a building's yard, in units. */
  yardFoodTotal(b: Building, r: number): number {
    const c = buildingCenter(b), cx = c.tx * TILE, cy = c.ty * TILE, rr = (r * TILE) ** 2;
    return this.items.reduce((n, it) => n + (it.rest && it.kind === 'food' && (it.x - cx) ** 2 + (it.y - cy) ** 2 <= rr ? it.n : 0), 0);
  }
  /** The whole pen this tile belongs to: every same-kind pen tile reachable through neighbours (4-connected). */
  penRegion(tx: number, ty: number): number[] {
    const kind = this.get(tx, ty)?.pen;
    if (!kind) return [];
    const start = ty * this.cols + tx, seen = new Set<number>([start]), out = [start];
    for (let qi = 0; qi < out.length; qi++) {
      const i = out[qi], cx = i % this.cols, cy = (i / this.cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * this.cols + nx;
        if (seen.has(k) || this.get(nx, ny)?.pen !== kind) continue;
        seen.add(k); out.push(k);
      }
    }
    return out;
  }
  /** Resting items within r px of a point. */
  itemsNear(x: number, y: number, r: number): Item[] { return this.items.filter((it) => it.rest && (it.x - x) ** 2 + (it.y - y) ** 2 <= r * r); }
  /** Items lying on a tile. */
  itemsOn(tx: number, ty: number): Item[] { return this.items.filter((it) => Math.floor(it.x / TILE) === tx && Math.floor(it.y / TILE) === ty); }
  /** Sow a crop: the tile becomes a growing crop of that kind. */
  sow(tx: number, ty: number, kind: FoodKind): Tile { const t = this.set(tx, ty, 'crop'); t.food = kind; return t; }
  private stamping = false;
  markDirty(tx: number, ty: number): void {
    this.dirty.add(ty * this.cols + tx);
  }
  isBlocked(tx: number, ty: number, enemy = false, elevated = false): boolean {
    const t = this.get(tx, ty);
    if (elevated) return !t?.defense;
    if (t?.defense) return t.kind === 'wall' || (t.kind === 'gate' && enemy && !t.defense.open);
    return !t || BLOCKING[t.kind];
  }

  placeDefense(kind: DefenseKind, tx: number, ty: number): Defense | null {
    if (!BUILDABLE.has(this.get(tx, ty)?.kind ?? 'tree')) return null;
    const t = this.set(tx, ty, kind);
    const hp = kind === 'gate' ? p.gateHp : p.wallHp;
    const d: Defense = { kind, tx, ty, hp, maxHp: hp, open: false };
    t.defense = d;
    this.defenses.set(ty * this.cols + tx, d);
    return d;
  }
  /** Open or bar a gate. Goes through here so cached paths know walkability changed. */
  setGateOpen(d: Defense, open: boolean): void {
    if (d.open === open) return;
    d.open = open; this.revision++; this.markDirty(d.tx, d.ty);
  }
  damageDefense(d: Defense, damage: number): boolean {
    d.hp = Math.max(0, d.hp - damage);
    this.markDirty(d.tx, d.ty);
    if (d.hp) return false;
    this.get(d.tx, d.ty)!.defense = undefined;
    this.defenses.delete(d.ty * this.cols + d.tx);
    this.set(d.tx, d.ty, 'grass');
    return true;
  }

  /** Pixel centre of a tile. */
  static center(tx: number, ty: number): { x: number; y: number } {
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
  static toTile(x: number, y: number): TilePos {
    return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
  }

  /** Segment visibility; arrows from battlements clear the rampart but buildings and trees stop them. */
  lineClear(a: { x: number; y: number }, b: { x: number; y: number }, aboveWall = false): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(dist / 4);
    for (let i = 1; i < steps; i++) {
      const q = World.toTile(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
      const t = this.get(q.tx, q.ty);
      if (aboveWall && t?.defense) continue;
      if (this.isBlocked(q.tx, q.ty, true)) return false;
    }
    return true;
  }

  /** Can a building of `kind` go here? The footprint may cover grass, stumps/saplings and bare soil (they get cleared) — not trees, crops or buildings. */
  canBuild(kind: BuildingKind, tx: number, ty: number): boolean {
    const f = BUILDINGS[kind];
    if (ty < 1) return false;
    for (let dy = 0; dy < f.h; dy++)
      for (let dx = 0; dx < f.w; dx++)
        if (!BUILDABLE.has(this.get(tx + dx, ty + dy)?.kind ?? 'tree')) return false;
    return !this.isBlocked(tx + f.door, ty + f.h);
  }

  place(kind: BuildingKind, tx: number, ty: number): Building {
    // the builders leave one night's wood by the hearth
    const hp = buildingMaxHp({ kind, level: 1 });
    const b: Building = { kind, tx, ty, level: 1, residents: 0, hp, maxHp: hp, firewood: HEARTH_WOOD[kind][1] > 0 ? p.hearthStart : 0, warm: true };
    if (kind === 'barracks') { b.ammo = p.towerStart; b.fireCd = 0; }
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
  /** Take a building down: its footprint goes back to grass and it leaves the roster. */
  remove(b: Building): void {
    const f = BUILDINGS[b.kind];
    this.stamping = true;
    for (let dy = 0; dy < f.h; dy++)
      for (let dx = 0; dx < f.w; dx++) if (this.get(b.tx + dx, b.ty + dy)?.building === b) this.set(b.tx + dx, b.ty + dy, 'grass');
    this.stamping = false;
    this.buildings = this.buildings.filter((o) => o !== b);
    this.refresh(b);
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
  /**
   * The last search that failed: the whole region it could reach. While nothing walkable has
   * changed, any search from inside that region to a tile outside it fails too — answered at once
   * instead of flooding the map again (a dozen rats outside a wall used to flood it every second).
   */
  private lastFlood: { revision: number; enemy: boolean; elevated: boolean; reached: Int32Array } | null = null;

  bfs(from: TilePos, to: TilePos, enemy = false, elevated = false): TilePos[] {
    if (!this.inBounds(from.tx, from.ty) || !this.inBounds(to.tx, to.ty)) return [];
    const n = this.cols * this.rows;
    const start = from.ty * this.cols + from.tx;
    const goal = to.ty * this.cols + to.tx;
    const goalBlocked = this.isBlocked(to.tx, to.ty, enemy, elevated);
    if (start === goal) return [];
    const f = this.lastFlood;
    if (f && f.revision === this.revision && f.enemy === enemy && f.elevated === elevated && f.reached[start] !== -1) {
      const near = (i: number) => i >= 0 && i < n && f.reached[i] !== -1;
      const reachable = near(goal) || (goalBlocked && (near(goal - 1) || near(goal + 1) || near(goal - this.cols) || near(goal + this.cols)));
      if (!reachable) return [];
    }
    const prev = new Int32Array(n).fill(-1);
    prev[start] = start;
    // A* keeps long journeys cheap: only expand promising tiles, using a binary heap.
    const costs = new Float64Array(n).fill(Infinity);
    costs[start] = 0;
    const queue: { i: number; score: number }[] = [];
    const push = (i: number, score: number) => {
      let k = queue.length; queue.push({ i, score });
      while (k > 0) { const p = (k - 1) >> 1; if (queue[p].score <= score) break; queue[k] = queue[p]; k = p; }
      queue[k] = { i, score };
    };
    const pop = () => {
      const first = queue[0], last = queue.pop()!;
      if (queue.length) {
        let k = 0;
        while (k * 2 + 1 < queue.length) {
          let c = k * 2 + 1;
          if (c + 1 < queue.length && queue[c + 1].score < queue[c].score) c++;
          if (last.score <= queue[c].score) break;
          queue[k] = queue[c]; k = c;
        }
        queue[k] = last;
      }
      return first.i;
    };
    push(start, 0);
    const dirs = [1, -1, this.cols, -this.cols];
    while (queue.length) {
      const cur = pop();
      const cx = cur % this.cols, cy = (cur / this.cols) | 0;
      if (cur === goal) return this.unwind(prev, start, cur);
      if (goalBlocked && Math.abs(cx - to.tx) + Math.abs(cy - to.ty) === 1) return this.unwind(prev, start, cur);
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!this.inBounds(nx, ny)) continue;
        const ni = cur + dirs[d];
        if (this.isBlocked(nx, ny, enemy, elevated)) continue;
        const cost = costs[cur] + 1;
        if (cost >= costs[ni]) continue;
        costs[ni] = cost;
        prev[ni] = cur;
        push(ni, cost + Math.abs(nx - to.tx) + Math.abs(ny - to.ty));
      }
    }
    this.lastFlood = { revision: this.revision, enemy, elevated, reached: prev };
    return [];
  }

  private unwind(prev: Int32Array, start: number, end: number): TilePos[] {
    const out: TilePos[] = [];
    for (let i = end; i !== start; i = prev[i]) out.push({ tx: i % this.cols, ty: (i / this.cols) | 0 });
    return out.reverse();
  }

  /** Starting map: tree clusters, a house, a barracks, the field, and the two supply buildings. */
  generate(rng: Rng, fieldW = 3): void {
    this.denseForests = rng.chance(0.65);
    // Broad overlapping forest regions leave meadows between them; some seeds have only open groves.
    const groves = Array.from({ length: this.denseForests ? 22 : 12 }, () => ({
      x: rng.int(8, this.cols - 9), y: rng.int(8, this.rows - 9), rx: rng.int(14, 34), ry: rng.int(12, 25),
    }));
    for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.cols; tx++) {
      const t = this.get(tx, ty)!;
      let density = 0;
      for (const g of groves) density = Math.max(density, 1 - ((tx - g.x) / g.rx) ** 2 - ((ty - g.y) / g.ry) ** 2);
      t.biome = this.denseForests && density > 0.35 ? 'deepwood' : density > 0 ? 'woodland' : 'meadow';
      const chance = t.biome === 'deepwood' ? 0.78 : t.biome === 'woodland' ? 0.2 : 0.018;
      if (rng.chance(chance)) this.set(tx, ty, 'tree').stage = rng.int(0, 12);
    }
    const hx = (this.cols / 2) | 0, hy = (this.rows / 2) | 0;
    // Connected woodland trails cross the entire map, so a dense seed cannot seal off a region.
    const clearTrail = (x: number, y: number) => {
      for (let d = -1; d <= 1; d++) if (this.inBounds(x + d, y)) { const t = this.set(x + d, y, 'grass'); t.trail = true; }
    };
    for (let y = 0; y < this.rows; y++) {
      clearTrail(hx, y);
      for (const base of [32, this.cols - 33]) clearTrail(base + Math.round(Math.sin(y / 13) * 4), y);
    }
    for (const base of [hy, 24, this.rows - 25]) for (let x = 0; x < this.cols; x++) {
      const y = base === hy ? hy : base + Math.round(Math.sin(x / 17) * 4);
      for (let d = -1; d <= 1; d++) if (this.inBounds(x, y + d)) { const t = this.set(x, y + d, 'grass'); t.trail = true; }
    }
    // clear the village centre
    for (let ty = hy - 7; ty <= hy + 4; ty++)
      for (let tx = hx - 11; tx <= hx + 10; tx++) this.set(tx, ty, 'grass');
    this.placeHouse(hx - 9, hy - 5);
    this.placeBarracks(hx + 5, hy - 5);
    const half = Math.floor(fieldW / 2);
    // the starting field: a row of each crop
    for (let ty = hy + 1; ty <= hy + 3; ty++)
      for (let tx = hx - half; tx <= hx + half; tx++) {
        const t = this.sow(tx, ty, CROP_KINDS[(ty - hy - 1) % CROP_KINDS.length]);
        t.stage = rng.int(0, 2);
      }
    this.place('granary', hx + half + 2, hy + 1);
    this.place('woodyard', hx - 9, hy + 1);
    // A small reliable starter grove; the wider seed still determines the wilderness.
    for (let y = hy + 8; y < hy + 12; y++) for (let x = hx - 8; x < hx - 3; x++) {
      if (!this.get(x, y)?.trail && rng.chance(0.65)) this.set(x, y, 'tree').stage = rng.int(0, 10);
    }
    // The Ogre's lair: 55-85 tiles out, on a cleared patch in the woods, reachable on foot.
    const f = BUILDINGS.lair;
    for (let attempt = 0; attempt < 400 && !this.lair; attempt++) {
      const ang = rng.range(0, Math.PI * 2), dist = rng.range(55, 85);
      const tx = Math.round(hx + Math.cos(ang) * dist), ty = Math.round(hy + Math.sin(ang) * dist * 0.75);
      if (tx < 4 || ty < 4 || tx + f.w > this.cols - 4 || ty + f.h + 2 > this.rows - 4) continue;
      if ((this.get(tx + 2, ty + 1)?.biome ?? 'meadow') === 'meadow' && attempt < 300) continue; // prefer the woods
      for (let dy = -1; dy <= f.h + 1; dy++) for (let dx = -1; dx <= f.w; dx++) this.set(tx + dx, ty + dy, 'grass');
      if (!this.bfs({ tx: tx + f.door, ty: ty + f.h }, { tx: hx, ty: hy }).length) continue;
      this.lair = this.place('lair', tx, ty);
    }
    // The gnomes' toadstool cottage: hidden out in the woods, well away from the lair, with a clearing and a fairy
    // ring of mushrooms. It stays `wild` — no hearth, no fog sight, nobody's business — until the head finds it.
    const gf = BUILDINGS.gnomehouse;
    let den: Building | null = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const ang = rng.range(0, Math.PI * 2), dist = rng.range(GNOME_HOME.minDist, GNOME_HOME.maxDist);
      const tx = Math.round(hx + Math.cos(ang) * dist), ty = Math.round(hy + Math.sin(ang) * dist * 0.75);
      if (tx < 5 || ty < 5 || tx + gf.w > this.cols - 5 || ty + gf.h + 2 > this.rows - 5) continue;
      if (this.lair && Math.hypot(this.lair.tx - tx, this.lair.ty - ty) < GNOME_HOME.clear) continue;
      // a little clearing for the cottage and its ring
      for (let dy = -2; dy <= gf.h + 2; dy++) for (let dx = -2; dx <= gf.w + 1; dx++) this.set(tx + dx, ty + dy, 'grass');
      if (!this.bfs({ tx: tx + gf.door, ty: ty + gf.h }, { tx: hx, ty: hy }).length) continue;
      den = this.place('gnomehouse', tx, ty);
      den.wild = true;
      // the fairy ring: mushrooms scattered on the grass around the cottage, ripe from the first day
      for (let n = 0, tries = 0; n < GNOME_HOME.ringTiles && tries < 60; tries++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(2.2, 3.4);
        const mx = Math.round(tx + gf.w / 2 + Math.cos(a) * r), my = Math.round(ty + gf.h / 2 + Math.sin(a) * r * 0.8);
        if (this.get(mx, my)?.kind !== 'grass') continue;
        this.set(mx, my, 'mushroom').stage = 99; n++;
      }
      break;
    }
    // Wild food in the woods (after the lair, so older seeds keep their layout): berry bushes at the forest edge, mushrooms in the shade of old growth
    for (let ty = 1; ty < this.rows - 1; ty++) for (let tx = 1; tx < this.cols - 1; tx++) {
      const t = this.get(tx, ty)!;
      if (t.kind !== 'grass' || t.trail || t.biome === 'meadow' || Math.abs(tx - hx) < 14 && Math.abs(ty - hy) < 10) continue;
      const near = this.treeNeighbours(tx, ty);
      if (!near) continue;
      if (rng.chance(0.035)) this.set(tx, ty, 'bush').stage = 99;
      else if (near >= 3 && rng.chance(0.05)) this.set(tx, ty, 'mushroom').stage = 99;
      else if (near <= 2 && rng.chance(0.02)) this.set(tx, ty, 'hazel').stage = 99;
    }
    // the gnomes' other finds: wild garlic dotted over the meadow, burdock along the trails
    for (let ty = 1; ty < this.rows - 1; ty++) for (let tx = 1; tx < this.cols - 1; tx++) {
      const t = this.get(tx, ty)!;
      if (t.kind !== 'grass' || t.trail || Math.abs(tx - hx) < 14 && Math.abs(ty - hy) < 10) continue;
      const byTrail = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.get(tx + dx, ty + dy)?.trail);
      if (byTrail && rng.chance(0.08)) this.set(tx, ty, 'burdock').stage = 99;
      else if (t.biome === 'meadow' && rng.chance(0.012)) this.set(tx, ty, 'garlic').stage = 99;
    }
    // Long grass over the whole wilderness (last, so older seeds keep their layouts): the village clearing, the
    // trails and the lair's patch stay short, with a few short tiles scattered for texture. It never grows back.
    const l = this.lair;
    for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.cols; tx++) {
      const t = this.get(tx, ty)!;
      if (t.kind !== 'grass' || t.trail) continue;
      if (tx >= hx - 11 && tx <= hx + 10 && ty >= hy - 7 && ty <= hy + 4) continue;
      if (l && tx >= l.tx - 1 && tx <= l.tx + f.w && ty >= l.ty - 1 && ty <= l.ty + f.h + 1) continue;
      if (den && tx >= den.tx - 2 && tx <= den.tx + gf.w + 1 && ty >= den.ty - 2 && ty <= den.ty + gf.h + 2) continue; // the gnomes keep their glade trimmed
      if (rng.chance(0.06)) continue;
      t.tall = true; this.dirty.add(ty * this.cols + tx);
    }
  }
}
