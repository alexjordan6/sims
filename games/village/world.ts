import { Rng } from '@shared/index';
import { TILE, COLS, ROWS, PLAINS, BUILDING_HP, HEARTH_WOOD, ITEM, GNOME_HOME, YARD, p, type DishKind, type FoodKind, type BuildingKind, type StartKind } from './config';
export type { BuildingKind } from './config';
import { tickItem, hop, type Item, type ItemKind } from './items';
import type { Gear } from './pack';

export type DefenseKind = 'wall' | 'gate' | 'stairs';
export interface Defense extends TilePos { kind: DefenseKind; hp: number; maxHp: number; open: boolean }
/** 'bush', 'mushroom', 'hazel', 'garlic' and 'burdock' are wild food: they stay put, get picked (by hand, or unit by unit by gnomes) and regrow (see Tile.stage / Tile.left) */
export type TileKind = 'grass' | 'tree' | 'sapling' | 'tilled' | 'crop' | 'bush' | 'mushroom' | 'hazel' | 'garlic' | 'burdock' | 'thicket' | BuildingKind | DefenseKind;
/** Thicket: walkable, but it slows and tears at whoever is in it, and costs this many steps to path through (see bfs). */
export const THICKET_PATH_COST = 9;
/** What thicket creeps over: open ground, fields and forage. Never trees, buildings or defenses. */
export const THICKET_PREY: ReadonlySet<TileKind> = new Set<TileKind>(['grass', 'tilled', 'crop', 'sapling', 'bush', 'mushroom', 'hazel', 'garlic', 'burdock']);

/** Footprint per building kind; (tx, ty) is the top-left, the door sits on the bottom row at `door`. */
export const BUILDINGS: Record<BuildingKind, { w: number; h: number; door: number; name: string }> = {
  house: { w: 4, h: 4, door: 2, name: 'House' },
  barracks: { w: 4, h: 4, door: 1, name: 'Barracks' },
  granary: { w: 3, h: 2, door: 1, name: 'Granary' },
  woodyard: { w: 3, h: 2, door: 1, name: 'Woodyard' },
  tavern: { w: 4, h: 4, door: 1, name: 'The Copper Acorn' },
  lair: { w: 5, h: 4, door: 2, name: "The Ogre's Lair" },
  gnomehouse: { w: 2, h: 2, door: 0, name: 'Gnome House' },
  warren: { w: 4, h: 3, door: 1, name: 'Gnome Warren' },
  cookpot: { w: 3, h: 3, door: 1, name: 'The Great Pot' },
};
export const MAX_LEVEL = 3;
/** ground a building can go on (flattened when it goes up) */
export const BUILDABLE: ReadonlySet<TileKind> = new Set<TileKind>(['grass', 'sapling', 'tilled', 'bush', 'mushroom', 'hazel', 'garlic', 'burdock']);
/** tile kinds that remember which crop they carry (sown, or the last thing harvested) */
export const CROP_GROUND: ReadonlySet<TileKind> = new Set<TileKind>(['crop', 'tilled']);
/** what a wild tile yields, and the pile kind it makes */
export const WILD_FOOD: Partial<Record<TileKind, FoodKind>> = { bush: 'berry', mushroom: 'mushroom', hazel: 'hazelnut', garlic: 'garlic', burdock: 'burdock' };

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
  /** barracks: gear parked in the chest — spare clubs waiting to be broken down, pieces you are not wearing */
  stash?: Gear[];
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
  /** the great pot: raw food thrown in and waiting to be cooked, and the servings standing ready in it */
  stock?: Partial<Record<FoodKind, number>>;
  servings?: Partial<Record<DishKind, number>>;
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
  biome?: 'meadow' | 'woodland' | 'deepwood' | 'plain';
  trail?: boolean;
  /** long grass: slows anyone wading through it (see p.grassSlow) until the sword mows it; never grows back */
  tall?: boolean;
}

export interface TilePos { tx: number; ty: number }

/** A beehive in a tree's canopy, keyed in World.hives by its tile index. It dies with its tree. */
export interface Hive {
  tx: number; ty: number;
  /** seconds before the hive settles enough to be woken again */
  angry: number;
}

export const BLOCKING: Record<TileKind, boolean> = {
  grass: false, tilled: false, crop: false, sapling: false, bush: false, mushroom: false, hazel: false, garlic: false, burdock: false, thicket: false, tree: true, house: true, barracks: true, granary: true, woodyard: true,
  tavern: true, lair: true, gnomehouse: true, warren: true, cookpot: true, wall: true, gate: false, stairs: false,
};

export class World {
  tiles: Tile[] = [];
  buildings: Building[] = [];
  defenses = new Map<number, Defense>();
  /** beehives by tile index: a side table rather than a Tile field, the way defenses work */
  hives = new Map<number, Hive>();
  /** the Ogre's home, far out in the woods; found through the fog */
  lair: Building | null = null;
  /** the open plains carved on a large map: battlefields, each with a war band camped on it (centre and half-axes in tiles) */
  plains: { tx: number; ty: number; rx: number; ry: number }[] = [];
  /** where the lost tools lie: the axe by a stump, the hammer in a ruined hut, the hoe in an overgrown field */
  toolCaches: { tool: 'axe' | 'hammer' | 'hoe'; site: 'stump' | 'hut' | 'field'; tx: number; ty: number }[] = [];
  /** the gnome start's cottage in the clearing (see generate), so the scene needn't go looking for it */
  gnomeStart: Building | null = null;
  denseForests = false;
  revision = 0;
  treeCount = 0;
  /** tiles of long grass still standing: the ceiling on skulks (see VillageScene.tickSkulks) */
  tallCount = 0;
  /** tile indices changed since the renderer last drained this */
  dirty = new Set<number>();
  /** things lying on the ground: thrown food, dropped armfuls, loot */
  items: Item[] = [];
  private nextItemId = 1;

  constructor(public readonly cols = COLS, public readonly rows = ROWS) {
    for (let i = 0; i < cols * rows; i++) { this.tiles.push({ kind: 'grass', stage: 0, work: 0, v: (i * 7919) % 97 }); this.dirty.add(i); }
  }

  hiveAt(tx: number, ty: number): Hive | undefined { return this.hives.get(ty * this.cols + tx); }
  get houses(): Building[] { return this.buildings.filter((b) => b.kind === 'house'); }
  /** gnome families live apart: their own cottages, never a human house */
  /** where gnomes live: toadstool cottages and warrens */
  get gnomeHouses(): Building[] { return this.buildings.filter((b) => (b.kind === 'gnomehouse' || b.kind === 'warren') && !b.wild); }
  get warrens(): Building[] { return this.buildings.filter((b) => b.kind === 'warren'); }
  /** the toadstool cottage out in the woods, until the head walks into its glade and claims it */
  get wildGnomeHouse(): Building | undefined { return this.buildings.find((b) => b.kind === 'gnomehouse' && b.wild); }
  /** every roof a family can be raised under: houses and gnome houses */
  get familyHouses(): Building[] { return this.buildings.filter((b) => (b.kind === 'house' || b.kind === 'gnomehouse' || b.kind === 'warren') && !b.wild); }
  /** buildings the village can use (everything but the Ogre's lair) */
  get villageBuildings(): Building[] { return this.buildings.filter((b) => b.kind !== 'lair' && !b.wild); }
  /** standing barracks: a ruined one sponsors nothing, fires nothing and forges nothing */
  get barracks(): Building[] { return this.buildings.filter((b) => b.kind === 'barracks' && !b.ruined); }
  get allBarracks(): Building[] { return this.buildings.filter((b) => b.kind === 'barracks'); }
  /** the great pot in the village square */
  get cookpot(): Building | undefined { return this.buildings.find((b) => b.kind === 'cookpot'); }
  get granary(): Building | undefined { return this.buildings.find((b) => b.kind === 'granary'); }
  get woodyard(): Building | undefined { return this.buildings.find((b) => b.kind === 'woodyard'); }
  /** standing granaries and woodyards: a ruin keeps nobody in work (see VillageScene.callingCap) */
  get granaries(): Building[] { return this.buildings.filter((b) => b.kind === 'granary' && !b.ruined && !b.wild); }
  get woodyards(): Building[] { return this.buildings.filter((b) => b.kind === 'woodyard' && !b.ruined && !b.wild); }
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
    if (t.kind === 'tree') { this.treeCount--; this.hives.delete(i); } // a hive cannot outlive its tree
    if (t.tall) this.tallCount--;
    if (kind === 'tree') this.treeCount++;
    // paths only go stale when walkability changes: tilling, planting and harvesting don't re-path anyone
    // (fortifications always count: a closed gate blocks enemies even though the tile kind doesn't)
    const fort = (k: TileKind) => k === 'wall' || k === 'gate' || k === 'stairs';
    if (BLOCKING[t.kind] !== BLOCKING[kind] || fort(t.kind) || fort(kind) || t.kind === 'thicket' || kind === 'thicket') this.revision++;
    if (t.kind === 'thicket') this.thicketCount--;
    if (kind === 'thicket') this.thicketCount++;
    t.kind = kind; t.stage = 0; t.work = 0; t.building = undefined; t.part = undefined; t.tall = undefined; t.v = (t.v + 31) % 97;
    if (!CROP_GROUND.has(kind)) t.food = undefined;
    this.dirty.add(i);
    return t;
  }

  // ---- long grass ---------------------------------------------------------------------------
  /** Mow a tile of long grass. Walkability is unchanged, so no path goes stale. */
  cutGrass(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    if (!t || t.kind !== 'grass' || !t.tall) return false;
    t.tall = undefined; this.tallCount--; this.dirty.add(ty * this.cols + tx);
    return true;
  }
  /** Mow every tile on the map. The census is a field, so nothing may clear `tall` behind its back. */
  mowAll(): void {
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i].tall) { this.tiles[i].tall = undefined; this.dirty.add(i); }
    this.tallCount = 0;
  }
  /** Is the tile under a pixel position long grass? */
  tallAt(x: number, y: number): boolean {
    const t = this.get(Math.floor(x / TILE), Math.floor(y / TILE));
    return t?.kind === 'grass' && !!t.tall;
  }
  /** Speed multiplier for a body at a pixel position: thicket drags hardest, long grass less, open ground not at all. */
  slowAt(x: number, y: number): number {
    const t = this.get(Math.floor(x / TILE), Math.floor(y / TILE));
    if (t?.kind === 'thicket') return p.thicketSlow;
    return t?.kind === 'grass' && t.tall ? p.grassSlow : 1;
  }
  /** Is the tile under a pixel position thicket? */
  thicketAt(x: number, y: number): boolean { return this.get(Math.floor(x / TILE), Math.floor(y / TILE))?.kind === 'thicket'; }
  /** thicket tiles on the map, kept in step by set() */
  thicketCount = 0;
  /**
   * Cut at a tile of thicket. `hits` is how many blows clear it (the axe takes one, the sword two):
   * the work is remembered on the tile, so a second swing finishes what the first began.
   * Returns true when the tile is cleared to open ground.
   */
  cutThicket(tx: number, ty: number, hits: number): boolean {
    const t = this.get(tx, ty);
    if (!t || t.kind !== 'thicket') return false;
    if (++t.work < hits) { this.dirty.add(ty * this.cols + tx); return false; }
    this.set(tx, ty, 'grass');
    return true;
  }
  // ---- items on the ground ------------------------------------------------------------------
  /** Put an item in the world at a pixel position (resting, unless it is launched or hopped afterwards). */
  dropItem(kind: ItemKind, n: number, x: number, y: number, food?: FoodKind, rng?: Rng): Item {
    // scrap falls on scrap: a battlefield of a thousand dead is a few dozen piles to walk over, not a thousand
    if (kind === 'scrap') for (const o of this.items) if (o.kind === 'scrap' && o.rest && (o.x - x) ** 2 + (o.y - y) ** 2 <= (1.5 * TILE) ** 2) { o.n += n; return o; }
    const it: Item = { id: this.nextItemId++, kind, food: kind === 'food' ? food : undefined, n, x, y, z: 0, vx: 0, vy: 0, vz: 0, rest: true, age: 0 };
    this.items.push(it);
    if (rng) hop(it, rng);
    return it;
  }
  removeItem(it: Item): void { const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); }
  /** what stops a rolling item: the map edge and anything an enemy can't walk through (walls, trees, buildings, closed gates) */
  itemBlocked = (x: number, y: number, z: number): boolean => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), t = this.get(tx, ty);
    if (!t) return true;
    if (t.kind === 'tree') return z < ITEM.treeHeight; // lobbed over the crown
    if (t.kind === 'cookpot') return false; // solid to walk into, open to throw into: that is the whole point of it
    return this.isBlocked(tx, ty, true);
  };
  tickItems(dt: number): void { for (const it of this.items) tickItem(it, dt, this.itemBlocked); }
  /** Is this spot inside a home's yard, where the food thrown to its children lies? */
  inYard(x: number, y: number, r = YARD): boolean {
    const rr = (r * TILE) ** 2;
    for (const b of this.familyHouses) {
      const c = buildingCenter(b);
      if ((c.tx * TILE - x) ** 2 + (c.ty * TILE - y) ** 2 <= rr) return true;
    }
    return false;
  }
  /** The nearest resting meat lying outside every home's yard (what a gnome goes to fetch), among those `ok` allows. */
  nearestWildMeat(x: number, y: number, ok: (it: Item) => boolean = () => true): Item | null {
    let best: Item | null = null, bd = Infinity;
    for (const it of this.items) {
      if (!it.rest || it.kind !== 'food' || it.food !== 'meat' || it.n <= 0 || !ok(it)) continue;
      if (this.inYard(it.x, it.y)) continue; // a child's dinner is not forage
      const d = (it.x - x) ** 2 + (it.y - y) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  /** The nearest resting food item within `r` tiles of a building's centre (its yard). */
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
  yardFoodTotal(b: Building, r: number, kind?: FoodKind): number {
    const c = buildingCenter(b), cx = c.tx * TILE, cy = c.ty * TILE, rr = (r * TILE) ** 2;
    return this.items.reduce((n, it) => n + (it.rest && it.kind === 'food' && (!kind || it.food === kind) && (it.x - cx) ** 2 + (it.y - cy) ** 2 <= rr ? it.n : 0), 0);
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

  /** A* searches route() may still run this tick (see beginTick); a request past it is refused and retried next tick. */
  pathBudget = 12;
  /** how often each goal was asked for this tick, and the distance fields built for popular goals */
  private demand = new Map<string, number>();
  private fields = new Map<string, { revision: number; dist: Float32Array; x0: number; y0: number; w: number; h: number }>();
  /** A new tick: the path budget refills and demand starts again. */
  beginTick(budget = 12): void { this.pathBudget = budget; this.budgetAt = performance.now(); this.demand.clear(); if (this.fields.size > 24) this.fields.clear(); }
  /** when the budget was last refilled: a caller that never runs the scene's tick (a test stepping agents) still gets one a frame */
  private budgetAt = 0;
  /**
   * A path for a walker, with a crowd in mind. When three or more walkers want the same goal this tick (a
   * regiment, a thousand gnomes at the head's heels), one distance field is built outward from the goal and
   * every one of them just walks downhill on it. Anything else is an A* search drawn from the tick's budget;
   * null means the budget is spent, so ask again next tick. Same result shape as bfs().
   */
  route(from: TilePos, to: TilePos, enemy = false, elevated = false): TilePos[] | null {
    if (!this.inBounds(from.tx, from.ty) || !this.inBounds(to.tx, to.ty)) return [];
    const key = `${to.tx},${to.ty},${enemy ? 1 : 0}${elevated ? 1 : 0}`;
    const asked = (this.demand.get(key) ?? 0) + 1;
    this.demand.set(key, asked);
    let f = this.fields.get(key);
    if (f && f.revision !== this.revision) { this.fields.delete(key); f = undefined; }
    if (!f && asked >= 3) { f = this.buildField(to, enemy, elevated); this.fields.set(key, f); }
    if (f) { const p = this.descend(f, from, to); if (p) return p; }
    if (this.pathBudget <= 0 && performance.now() - this.budgetAt > 20) this.beginTick();
    if (this.pathBudget <= 0) return null;
    this.pathBudget--;
    return this.bfs(from, to, enemy, elevated, true);
  }
  /** Distance (in steps, thorns costing extra) from every tile within 40 of `to` back to it. */
  private buildField(to: TilePos, enemy: boolean, elevated: boolean): { revision: number; dist: Float32Array; x0: number; y0: number; w: number; h: number } {
    const R = 40, x0 = Math.max(0, to.tx - R), y0 = Math.max(0, to.ty - R), x1 = Math.min(this.cols - 1, to.tx + R), y1 = Math.min(this.rows - 1, to.ty + R);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, dist = new Float32Array(w * h).fill(Infinity);
    const heap: number[] = [], hd: number[] = [];
    const push = (i: number, d: number) => { heap.push(i); hd.push(d); let k = heap.length - 1; while (k > 0) { const pp = (k - 1) >> 1; if (hd[pp] <= hd[k]) break; [heap[pp], heap[k]] = [heap[k], heap[pp]]; [hd[pp], hd[k]] = [hd[k], hd[pp]]; k = pp; } };
    const pop = () => { const i = heap[0], d = hd[0], li = heap.pop()!, ld = hd.pop()!; if (heap.length) { heap[0] = li; hd[0] = ld; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && hd[a] < hd[m]) m = a; if (b < heap.length && hd[b] < hd[m]) m = b; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; [hd[m], hd[k]] = [hd[k], hd[m]]; k = m; } } return [i, d] as const; };
    const seed = (tx: number, ty: number) => { const i = (ty - y0) * w + (tx - x0); dist[i] = 0; push(i, 0); };
    // a blocked goal (a building, a tree) is reached from beside it, as bfs does
    if (this.isBlocked(to.tx, to.ty, enemy, elevated)) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tx = to.tx + dx, ty = to.ty + dy; if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1 && !this.isBlocked(tx, ty, enemy, elevated)) seed(tx, ty); } }
    else seed(to.tx, to.ty);
    while (heap.length) {
      const [i, d] = pop();
      if (d > dist[i]) continue;
      const cx = (i % w) + x0, cy = ((i / w) | 0) + y0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || this.isBlocked(nx, ny, enemy, elevated)) continue;
        const ni = (ny - y0) * w + (nx - x0), nd = d + (this.tiles[ny * this.cols + nx].kind === 'thicket' ? THICKET_PATH_COST : 1);
        if (nd < dist[ni]) { dist[ni] = nd; push(ni, nd); }
      }
    }
    return { revision: this.revision, dist, x0, y0, w, h };
  }
  /** Walk downhill on a field from `from` toward its goal: up to 24 steps, or null when `from` is off the field or cut off. */
  private descend(f: { dist: Float32Array; x0: number; y0: number; w: number; h: number }, from: TilePos, to: TilePos): TilePos[] | null {
    const at = (tx: number, ty: number) => tx < f.x0 || ty < f.y0 || tx >= f.x0 + f.w || ty >= f.y0 + f.h ? Infinity : f.dist[(ty - f.y0) * f.w + (tx - f.x0)];
    if (from.tx === to.tx && from.ty === to.ty) return [];
    let cx = from.tx, cy = from.ty, d = at(cx, cy);
    // standing on a blocked tile (a doorway, a wall top) the walker's own tile has no distance: start from its best neighbour
    if (!isFinite(d)) { let best = Infinity; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) best = Math.min(best, at(cx + dx, cy + dy)); if (!isFinite(best)) return null; d = best + 1; }
    const path: TilePos[] = [];
    for (let k = 0; k < 24 && d > 0; k++) {
      let bx = cx, by = cy, bd = d;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nd = at(cx + dx, cy + dy); if (nd < bd) { bd = nd; bx = cx + dx; by = cy + dy; } }
      if (bx === cx && by === cy) break;
      cx = bx; cy = by; d = bd; path.push({ tx: cx, ty: cy });
    }
    return path;
  }

  bfs(from: TilePos, to: TilePos, enemy = false, elevated = false, capped = false): TilePos[] {
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
    // Scratch arrays the size of the map, reused from search to search: a tile counts as visited only when
    // its stamp is this search's, so a search costs the tiles it touches, not the whole map (on the large
    // map, allocating and filling two fresh arrays each search cost more than most searches themselves).
    const sc = this.scratch?.stamp.length === n ? this.scratch : (this.scratch = { stamp: new Uint32Array(n), prev: new Int32Array(n), costs: new Float64Array(n), gen: 0 });
    if (++sc.gen >= 0xffffffff) { sc.stamp.fill(0); sc.gen = 1; }
    const gen = sc.gen, stamp = sc.stamp, prev = sc.prev, costs = sc.costs;
    stamp[start] = gen; prev[start] = start;
    // A* keeps long journeys cheap: only expand promising tiles, using a binary heap.
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
    // a walker's search for somewhere unreachable would flood the whole map (thirty milliseconds on the large
    // one): capped, it gives up after forty tiles of searching per tile of distance and calls it no way.
    // (Reachability checks — generation, spawning — search to the end.)
    let expand = capped ? Math.min(30000, Math.max(6000, 40 * (Math.abs(to.tx - from.tx) + Math.abs(to.ty - from.ty)))) : Infinity;
    while (queue.length) {
      if (--expand < 0) return [];
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
        const cost = costs[cur] + (this.tiles[ni].kind === 'thicket' ? THICKET_PATH_COST : 1); // thorns: worth a long way round
        if (stamp[ni] === gen && cost >= costs[ni]) continue;
        stamp[ni] = gen;
        costs[ni] = cost;
        prev[ni] = cur;
        push(ni, cost + Math.abs(nx - to.tx) + Math.abs(ny - to.ty));
      }
    }
    // a search that found no way flooded everything it could reach: remember that region
    const reached = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) if (stamp[i] === gen) reached[i] = prev[i];
    this.lastFlood = { revision: this.revision, enemy, elevated, reached };
    return [];
  }

  /** A*'s working arrays, kept between searches (see bfs) */
  private scratch: { stamp: Uint32Array; prev: Int32Array; costs: Float64Array; gen: number } | null = null;

  private unwind(prev: Int32Array, start: number, end: number): TilePos[] {
    const out: TilePos[] = [];
    for (let i = end; i !== start; i = prev[i]) out.push({ tx: i % this.cols, ty: (i / this.cols) | 0 });
    return out.reverse();
  }

  /**
   * Starting map: tree clusters, a house, a barracks, the field, and the two supply buildings.
   * In the 'gnome' start there is no house or field — a toadstool cottage stands in the
   * clearing instead, and the hidden one out in the woods is left ungenerated (there is nothing left
   * to discover). The supply buildings stand either way: hauling and storage work the same.
   */
  /**
   * Extra wild food on top of what the seed already grew, and a handful within sight of the village so
   * there is something to throw in the pot on day one. It draws from its own bag of numbers rather than
   * the world's, so turning `wildDensity` up adds plants without moving a single tree, trail or lair —
   * every seeded layout (and every check that leans on one) stays exactly where it was.
   */
  /** the seed this world was generated from, for features that need their own numbers (see scatterMoreWild) */
  seed = 0;
  private scatterMoreWild(hx: number, hy: number): void {
    const extra = p.wildDensity - 1;
    if (extra <= 0) return;
    const rng = new Rng(this.seed ^ 0x5eed10);
    const open = (tx: number, ty: number) => {
      const t = this.get(tx, ty);
      return !!t && t.kind === 'grass' && !t.trail && !t.building && !t.defense;
    };
    // Out in the woods: more of whatever that ground would have grown anyway, and weighted hard toward
    // what the pot actually wants. Hazel is the one wild plant no recipe calls for, so the extra growth
    // is nearly all mushrooms, berries, garlic and burdock — what you forage should be worth cooking.
    for (let ty = 1; ty < this.rows - 1; ty++) for (let tx = 1; tx < this.cols - 1; tx++) {
      if (Math.abs(tx - hx) < 14 && Math.abs(ty - hy) < 10) continue; // the clearing is the village's
      if (!open(tx, ty)) continue;
      const near = this.treeNeighbours(tx, ty);
      const t = this.get(tx, ty)!;
      // mushroom and burdock are the scarce pair (deep shade and bare ground), and between them they
      // are the whole stew, so they get the heaviest hand; meadow garlic is everywhere and needs none
      if (near >= 3) { if (rng.chance(0.16 * extra)) this.set(tx, ty, 'mushroom').stage = 99; }
      else if (near) { if (rng.chance(0.07 * extra)) this.set(tx, ty, rng.chance(0.88) ? 'bush' : 'hazel').stage = 99; }
      else if (t.biome === 'meadow') { if (rng.chance(0.02 * extra)) this.set(tx, ty, 'garlic').stage = 99; }
      else if (rng.chance(0.09 * extra)) this.set(tx, ty, 'burdock').stage = 99;
    }
    // and a ring of it just beyond the clearing, within an early walk of the pot — ingredients only
    for (let n = 0, tries = 0; n < Math.round(14 * p.wildDensity) && tries < 900; tries++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(11, 20);
      const tx = Math.round(hx + Math.cos(a) * r), ty = Math.round(hy + Math.sin(a) * r * 0.8);
      if (!open(tx, ty)) continue;
      this.set(tx, ty, rng.chance(0.4) ? 'burdock' : rng.chance(0.5) ? 'garlic' : rng.chance(0.5) ? 'bush' : 'mushroom').stage = 99;
      n++;
    }
  }

  generate(rng: Rng, fieldW = 3, start: StartKind = 'village', seed = 0): void {
    this.seed = seed;
    this.denseForests = rng.chance(0.65);
    // Broad overlapping forest regions leave meadows between them; some seeds have only open groves.
    const big = (this.cols * this.rows) / (240 * 160); // 1 on the classic map: its seeds keep their layouts
    const groves = Array.from({ length: Math.round((this.denseForests ? 22 : 12) * (big > 1 ? big * 0.7 : 1)) }, () => ({
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
      for (const base of big > 1 ? [32, Math.round(this.cols / 4), Math.round(this.cols * 3 / 4), this.cols - 33] : [32, this.cols - 33]) clearTrail(base + Math.round(Math.sin(y / 13) * 4), y);
    }
    for (const base of big > 1 ? [hy, 24, Math.round(this.rows / 4), Math.round(this.rows * 3 / 4), this.rows - 25] : [hy, 24, this.rows - 25]) for (let x = 0; x < this.cols; x++) {
      const y = base === hy ? hy : base + Math.round(Math.sin(x / 17) * 4);
      for (let d = -1; d <= 1; d++) if (this.inBounds(x, y + d)) { const t = this.set(x, y + d, 'grass'); t.trail = true; }
    }
    // clear the village centre
    for (let ty = hy - 7; ty <= hy + 4; ty++)
      for (let tx = hx - 11; tx <= hx + 10; tx++) this.set(tx, ty, 'grass');
    // the barracks stands in both starts: its places are what the village may raise warriors into, and a
    // gnome band opens with three. Only the house is the village start's own (gnomes live under a toadstool).
    if (start === 'village') this.placeHouse(hx - 9, hy - 5);
    this.placeBarracks(hx + 5, hy - 5);
    const half = Math.floor(fieldW / 2);
    // the starting field: a row of each crop. The gnome start sows nothing, but still draws — this loop
    // is the block's only rng consumer, so skipping the draws would shift the whole wilderness downstream.
    for (let ty = hy + 1; ty <= hy + 3; ty++)
      for (let tx = hx - half; tx <= hx + half; tx++) {
        rng.int(0, 2); // nothing is sown at the start: the hoe and seeds come later (the draw stays, so the wilderness downstream does not move)
      }
    // the great pot in the middle of the village, in both starts: older than the houses round it
    this.place('cookpot', hx - 1, hy - 3);
    this.place('granary', hx + half + 2, hy + 1);
    this.place('woodyard', hx - 9, hy + 1);
    // the gnome start's own cottage: yours from the first frame, where the house would have stood
    if (start === 'gnome') this.gnomeStart = this.place('gnomehouse', hx - 8, hy - 4);
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
    // (the gnome start already lives in one, so there is nothing out there left to find)
    const gf = BUILDINGS.gnomehouse;
    let den: Building | null = null;
    for (let attempt = 0; start === 'village' && attempt < 400; attempt++) {
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
    this.scatterMoreWild(hx, hy);
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
      t.tall = true; this.tallCount++; this.dirty.add(ty * this.cols + tx);
    }
    this.growThickets(hx, hy);
    if (big > 1) this.carvePlains(hx, hy);
    this.scatterHomeForage(hx, hy);
    this.placeToolCaches(hx, hy);
  }

  /**
   * The tools lost in the flight, each left lying where it fell: the axe by an old stump just beyond the
   * thorns (22-32 tiles out), the hammer in a ruined hut (40-60), the hoe in an overgrown field (50-75;
   * the far two up to half as far again on the large map). Each on a small clearing a walk from the
   * square, clear of the lair and the gnomes' glade. Its own bag of numbers, so nothing else moves.
   */
  private placeToolCaches(hx: number, hy: number): void {
    const rng = new Rng(this.seed ^ 0x700150), far = (this.cols * this.rows) / (240 * 160) > 1 ? 1.5 : 1;
    const from = this.nearest((hx + 0.5) * TILE, (hy + 0.5) * TILE, (_t, tx, ty) => !this.isBlocked(tx, ty)) ?? { tx: hx, ty: hy };
    const plan = [
      { tool: 'axe' as const, site: 'stump' as const, r: [22, 32], clear: 1 },
      { tool: 'hammer' as const, site: 'hut' as const, r: [40, 60 * far], clear: 2 },
      { tool: 'hoe' as const, site: 'field' as const, r: [50, 75 * far], clear: 3 },
    ];
    const den = this.buildings.find((b) => b.kind === 'gnomehouse' && b.wild);
    for (const c of plan) {
      for (let tries = 0; tries < 300; tries++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(c.r[0], c.r[1]);
        const tx = Math.round(hx + Math.cos(a) * r), ty = Math.round(hy + Math.sin(a) * r * 0.75);
        if (tx < 8 || ty < 8 || tx > this.cols - 9 || ty > this.rows - 9) continue;
        if (this.lair && Math.hypot(this.lair.tx - tx, this.lair.ty - ty) < 14) continue;
        if (den && Math.hypot(den.tx - tx, den.ty - ty) < 12) continue;
        if (this.toolCaches.some((q) => Math.hypot(q.tx - tx, q.ty - ty) < 12)) continue;
        let clash = false;
        for (let dy = -c.clear; dy <= c.clear && !clash; dy++) for (let dx = -c.clear; dx <= c.clear; dx++) { const t = this.get(tx + dx, ty + dy); if (!t || t.building || t.defense) { clash = true; break; } }
        if (clash) continue;
        // a little clearing; an old field keeps its long grass, a hut and a stump are trodden down
        for (let dy = -c.clear; dy <= c.clear; dy++) for (let dx = -c.clear; dx <= c.clear; dx++) {
          const t = this.get(tx + dx, ty + dy)!;
          if (t.kind !== 'grass' && !t.trail) this.set(tx + dx, ty + dy, 'grass');
          const g = this.get(tx + dx, ty + dy)!;
          if (c.site !== 'field' && g.tall) { g.tall = undefined; this.tallCount--; this.dirty.add((ty + dy) * this.cols + tx + dx); }
        }
        if (!this.bfs(from, { tx, ty }).length) continue; // somewhere a walk from the square reaches
        const at = World.center(tx, ty), it = this.dropItem('gear', 1, at.x, at.y);
        it.gear = { kind: 'tool', tool: c.tool };
        this.toolCaches.push({ tool: c.tool, site: c.site, tx, ty });
        break;
      }
    }
  }

  /**
   * Wild food by the door: clumps of ripe mushrooms, burdock, garlic and berry bushes 9-14 tiles from the
   * village centre, inside the thorns, so the first stews (mushroom and burdock) and roasts (meat and
   * garlic) need no cutting and no farm. Off buildings, doors, trails and anything blocked. Its own bag of
   * numbers, last of all, so nothing else moves.
   */
  private scatterHomeForage(hx: number, hy: number): void {
    const mul = Math.max(0, p.homeForage);
    if (mul <= 0) return;
    const rng = new Rng(this.seed ^ 0x40fa6e);
    const doors = new Set(this.buildings.map((b) => { const d = doorstep(b); return d.ty * this.cols + d.tx; }));
    const free = (tx: number, ty: number) => {
      const t = this.get(tx, ty);
      if (!t || t.kind !== 'grass' || t.trail || t.building || t.defense || doors.has(ty * this.cols + tx)) return false;
      // keep a step clear of every building, so nobody's door or yard is choked with bushes
      for (const b of this.buildings) { const f = BUILDINGS[b.kind]; if (tx >= b.tx - 1 && tx <= b.tx + f.w && ty >= b.ty - 1 && ty <= b.ty + f.h) return false; }
      return true;
    };
    // where a walker in the village starts from: the first open tile at the centre
    const from = this.nearest((hx + 0.5) * TILE, (hy + 0.5) * TILE, (_t, tx, ty) => !this.isBlocked(tx, ty)) ?? { tx: hx, ty: hy };
    const want: [TileKind, number][] = [['mushroom', 10], ['burdock', 6], ['garlic', 8], ['bush', 8]];
    for (const [kind, n0] of want) {
      let left = Math.round(n0 * mul);
      for (let tries = 0; left > 0 && tries < 400; tries++) {
        // a clump: a centre on the ring, and its neighbours
        const a = rng.range(0, Math.PI * 2), r = rng.range(9, 14);
        const cx = Math.round(hx + Math.cos(a) * r), cy = Math.round(hy + Math.sin(a) * r * 0.8);
        const size = Math.min(left, rng.int(2, 4));
        for (let k = 0, put = 0; k < 12 && put < size; k++) {
          const tx = cx + rng.int(-1, 1), ty = cy + rng.int(-1, 1);
          if (!free(tx, ty) || Math.hypot(tx - hx, ty - hy) > 15) continue;
          if (!this.bfs(from, { tx, ty }).length) continue; // not walled in by the grove or the buildings
          this.set(tx, ty, kind).stage = 99; put++; left--;
        }
      }
    }
  }

  /**
   * The large map's battlefields: broad open plains out beyond the old country, cleared of wood, thorn
   * and long grass so blocks of hundreds can wheel and charge on them. Short turf, a lone tree here and
   * there, and a trail to each one. Last, and from its own bag of numbers, so nothing else moves.
   */
  private carvePlains(hx: number, hy: number): void {
    const rng = new Rng(this.seed ^ 0x9a1a5);
    for (let tries = 0; this.plains.length < PLAINS.count && tries < 400; tries++) {
      const tx = rng.int(30, this.cols - 31), ty = rng.int(26, this.rows - 27);
      const rx = rng.int(PLAINS.rx[0], PLAINS.rx[1]), ry = rng.int(PLAINS.ry[0], PLAINS.ry[1]);
      if (Math.hypot(tx - hx, (ty - hy) * 1.3) < PLAINS.minDist) continue; // out beyond the old country
      if (tx - rx < 2 || ty - ry < 2 || tx + rx > this.cols - 3 || ty + ry > this.rows - 3) continue;
      if (this.plains.some((q) => Math.hypot((q.tx - tx) / (q.rx + rx), (q.ty - ty) / (q.ry + ry)) < 0.9)) continue; // overlapping a little is fine
      const l = this.lair;
      if (l && Math.hypot((l.tx - tx) / (rx + 6), (l.ty - ty) / (ry + 6)) < 1) continue;
      if (this.buildings.some((b) => b.kind === 'gnomehouse' && Math.hypot((b.tx - tx) / (rx + 6), (b.ty - ty) / (ry + 6)) < 1)) continue;
      this.plains.push({ tx, ty, rx, ry });
      // a ragged edge: the wood thins out over the last fifth rather than stopping at a line
      for (let y = ty - ry; y <= ty + ry; y++) for (let x = tx - rx; x <= tx + rx; x++) {
        const t = this.get(x, y);
        if (!t || t.building || t.defense) continue;
        const e = ((x - tx) / rx) ** 2 + ((y - ty) / ry) ** 2;
        if (e > 1 || (e > 0.64 && rng.chance((e - 0.64) / 0.36))) continue;
        if (t.kind === 'tree' || t.kind === 'thicket' || t.kind === 'sapling' || t.kind === 'hazel' || t.kind === 'bush' || t.kind === 'mushroom') {
          if (t.kind === 'tree' && rng.chance(0.004)) continue; // a lone tree standing out on the plain
          this.set(x, y, 'grass');
        }
        const g = this.get(x, y)!;
        g.biome = 'plain';
        if (g.tall) { g.tall = undefined; this.tallCount--; this.dirty.add(y * this.cols + x); }
      }
      // a road in from the nearest trail, so each plain can be marched to
      const toward = { tx: hx, ty: hy };
      for (let k = 0, x = tx, y = ty; k < 400; k++) {
        const t = this.get(x, y);
        if (!t || (t.trail && ((x - tx) / rx) ** 2 + ((y - ty) / ry) ** 2 > 1)) break;
        for (let d = -1; d <= 1; d++) for (const [ax, ay] of [[x + d, y], [x, y + d]]) {
          const q = this.get(ax, ay);
          if (!q || q.building || q.defense) continue;
          if (q.kind !== 'grass') this.set(ax, ay, 'grass');
          const g = this.get(ax, ay)!; g.trail = true;
          if (g.tall) { g.tall = undefined; this.tallCount--; this.dirty.add(ay * this.cols + ax); }
        }
        if (Math.abs(toward.tx - x) > Math.abs(toward.ty - y)) x += Math.sign(toward.tx - x); else y += Math.sign(toward.ty - y);
      }
    }
  }

  /**
   * Thicket patches in the wild, a few of them near enough the village to come creeping in. Out of their
   * own bag of numbers, and last of all, so no older seeded layout moves.
   */
  private growThickets(hx: number, hy: number): void {
    this.growThornRing(hx, hy);
    const rng = new Rng(this.seed ^ 0x7b1c4e7);
    const patches = Math.round(p.thicketPatches);
    for (let n = 0, tries = 0; n < patches && tries < patches * 40; tries++) {
      // the first few close in (15-28 tiles out), the rest anywhere in the wild
      const close = n < Math.ceil(patches / 4);
      const a = rng.range(0, Math.PI * 2), r = close ? rng.range(15, 28) : rng.range(30, 90);
      const cx = Math.round(hx + Math.cos(a) * r), cy = Math.round(hy + Math.sin(a) * r * 0.75);
      if (!this.inBounds(cx, cy) || !THICKET_PREY.has(this.get(cx, cy)!.kind) || this.get(cx, cy)!.trail) continue;
      if (Math.abs(cx - hx) < 14 && Math.abs(cy - hy) < 10) continue; // the village clearing starts clear
      // a blob of 6-18 tiles grown out from the seed, never over a trail
      const size = rng.int(6, 18), grown: TilePos[] = [{ tx: cx, ty: cy }];
      this.set(cx, cy, 'thicket');
      for (let k = 0; k < size * 6 && grown.length < size; k++) {
        const from = grown[rng.int(0, grown.length - 1)];
        const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(0, 3)];
        const q = { tx: from.tx + dx, ty: from.ty + dy }, t = this.get(q.tx, q.ty);
        if (!t || !THICKET_PREY.has(t.kind) || t.trail || t.building || t.defense) continue;
        if (Math.abs(q.tx - hx) < 14 && Math.abs(q.ty - hy) < 10) continue; // the village clearing starts clear
        this.set(q.tx, q.ty, 'thicket'); grown.push(q);
      }
      n++;
    }
  }
  /**
   * The thorn ring: a ragged band of thicket all the way round the village, just beyond the clearing. The
   * trails run through it in open lanes (until it creeps over them), and everything else — the woods, the
   * forage, the wild — lies on the far side. Cutting out through it is the village's first labour, and
   * keeping it back is a labour for every day after. Its own bag of numbers, so nothing else moves.
   */
  private growThornRing(hx: number, hy: number): void {
    const band = Math.round(p.thicketRing);
    if (band <= 0) return;
    const rng = new Rng(this.seed ^ 0x7b1c41e);
    // a lumpy edge: a few slow waves round the circle, so the ring bulges in and thins out
    const ph = [rng.range(0, 7), rng.range(0, 7), rng.range(0, 7), rng.range(0, 7)];
    const inner = (a: number) => 16 + 1.6 * Math.sin(3 * a + ph[0]) + 1.1 * Math.sin(5 * a + ph[1]);
    const thick = (a: number) => band + 1.5 * Math.sin(2 * a + ph[2]) + 1.2 * Math.sin(7 * a + ph[3]);
    const l = this.lair, den = this.buildings.find((b) => b.kind === 'gnomehouse');
    const R = 16 + 2.7 + band + 2.7 + 1;
    for (let ty = Math.floor(hy - R); ty <= hy + R; ty++) for (let tx = Math.floor(hx - R); tx <= hx + R; tx++) {
      const t = this.get(tx, ty);
      // grass and the old wood go under it; forage is left standing in pockets, a prize for cutting in to
      if (!t || !(t.kind === 'grass' || t.kind === 'tree') || t.trail || t.building || t.defense) continue;
      if (Math.abs(tx - hx) < 14 && Math.abs(ty - hy) < 10) continue; // the village clearing starts clear
      if (l && tx >= l.tx - 3 && tx <= l.tx + 6 && ty >= l.ty - 3 && ty <= l.ty + 6) continue;
      if (den && Math.abs(tx - den.tx) < 6 && Math.abs(ty - den.ty) < 6) continue;
      const dx = tx - hx, dy = (ty - hy) / 0.75, e = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const r0 = inner(a), r1 = r0 + thick(a);
      if (e < r0 || e > r1) continue;
      const rim = r1 - e; // the inner edge is a hedge; the outer edge frays into the wood
      if (rim < 1 && !rng.chance(0.55)) continue;
      if (t.kind === 'tree' && rng.chance(0.12)) continue; // it chokes the old wood here, but a few trunks stand through it
      this.set(tx, ty, 'thicket');
    }
  }
  /**
   * A day's creep: each thicket tile may take one neighbouring tile of grass, field or forage. Fields
   * and forage it takes are lost to it, so the village has every reason to keep the axe busy.
   * `rng` is the scene's own thicket stream, so the creep never shifts births, raids or anything else.
   */
  spreadThicket(rng: Rng, chance: number, spared: (tx: number, ty: number) => boolean): TilePos[] {
    const took: TilePos[] = [];
    if (chance <= 0 || !this.thicketCount) return took;
    const from: TilePos[] = [];
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i].kind === 'thicket') from.push({ tx: i % this.cols, ty: (i / this.cols) | 0 });
    for (const q of from) {
      if (!rng.chance(chance)) continue;
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(0, 3)];
      const tx = q.tx + dx, ty = q.ty + dy, t = this.get(tx, ty);
      if (!t || !THICKET_PREY.has(t.kind) || t.building || t.defense || spared(tx, ty)) continue;
      this.set(tx, ty, 'thicket'); took.push({ tx, ty });
    }
    return took;
  }
}
