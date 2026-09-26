import { STACK, SKULK, STASH_SLOTS, type BulkKind } from './config';
import { isImplement, IMPLEMENTS, TOOL_NAME, Pack, type Gear, type EquipmentSlot, isBulk, slotName } from './pack';
import Phaser from 'phaser';
import { SimScene, launch, button, getGui, Rng, SpatialGrid } from '@shared/index';
import { launch as throwItem, type Item } from './items';
import { World, WILD_FOOD, doorstep, buildingCenter, buildingMaxHp, hasHearth, hearthCost, BUILDINGS, MAX_LEVEL, BUILDABLE, type DefenseKind, type Building, type BuildingKind, type Tile, type TilePos, type Hive } from './world';
import { Villager, Raider, Player, Mover, Arrow, TOOLS, type Role, type Tool, type Order } from './agents';
import { DEFENSE_COST, WALL_HEIGHT } from './config';
import { Interior } from './interior';
import { Rat, Snatcher, Brute, Shaman, Ogre, Wrecker, Bolt, Troll, Skulk, waveComposition } from './enemies';
import { Boar, Swarm, type Sounder } from './wildlife';
import { Fog } from './fog';
import { p, TILE, COLS, ROWS, ZOOM, COST, BOAR, RUN, SAPLING_DAYS, SEED_BASE, SEED_PER_NEIGHBOUR, SHELTERED_SAPLING_DAYS, OLD_GROWTH_DAYS, CAPS, UPGRADE_COST, HOUSE_BEDS, GNOME_BEDS, GNOME_YARD, ORDER, LEVEL_PERKS, PEN_NAME, TROLL, HIVE, ITEM, FOODS, FOOD_KINDS, RAW_KINDS, DISHES, RECIPES, zeroFood, isDish, foodCount, hasInterior, type Recipe, type DishKind, DIET_STAT_NAME, type DietStat, type FoodKind, ARMOR, ARMOR_BARRACKS_LEVEL, SCRAP_DROP, DYES, PLUMES, TOWER, REPAIR, DISMANTLE, WEAPONS, type Calling, type ArmorSlot, type WeaponSlot } from './config';
import { Meta, type Mods, type RenownBreakdown } from './meta';
import { Renderer, preloadArt } from './render';
import { UI } from './ui/ui';
import { weaponMul } from './characters';
import { AdaptiveSpawner } from './adaptive-spawn';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

export type EventKind = 'birth' | 'grow' | 'soldier' | 'raid' | 'death' | 'build' | 'info' | 'food' | 'wood';
export interface GameEvent { kind: EventKind; text: string; toast: boolean; day: number }
/** Things the sim reports for the renderer to animate; drained every frame. */
export type FxEvent =
  | { kind: 'hit'; attacker: Mover; target: Mover; dmg: number; crit: boolean; killed: boolean; streak?: number; ux?: number; uy?: number; push?: number }
  | { kind: 'telegraph'; who: Mover; ms: number }
  | { kind: 'miss'; who: Mover }
  | { kind: 'slowmo' }
  | { kind: 'tool'; tool: 'hoe' | 'axe' | 'seed' | 'hammer'; tx: number; ty: number; who?: Mover }
  | { kind: 'death'; who: Mover; x: number; y: number }
  | { kind: 'boss'; who: Mover }
  | { kind: 'swing'; who: Mover; dx: number; dy: number; stage: number }
  | { kind: 'cast'; who: Mover }
  | { kind: 'impact'; x: number; y: number }
  | { kind: 'upgrade'; building: Building }
  | { kind: 'hearts'; who: Mover }
  | { kind: 'melee'; who: Mover; x: number; y: number }
  | { kind: 'arrow'; who: Mover }
  /** a handful of food lobbed from the basket onto a pen tile */
  | { kind: 'thud'; who: Mover }
  | { kind: 'snore'; x: number; y: number }
  | { kind: 'deposit'; x: number; y: number; text: string; colour: string }
  /** a tile of long grass mown by the sword: clippings fly */
  | { kind: 'cut'; x: number; y: number }
  /** the long grass stirs where something unseen moves */
  | { kind: 'rustle'; x: number; y: number }
  /** a swarm of bees on the wing: a handful of motes at (x, y), pushed every frame while it flies */
  | { kind: 'bees'; x: number; y: number }
  | { kind: 'ruin'; building: Building }
  | { kind: 'demolish'; building: Building }
  /** the Ogre's ground slam (also his crash into a wall): shockwave of radius r */
  | { kind: 'smash'; who: Mover; x: number; y: number; r: number }
  /** the Ogre lowers his head and rushes along (ux, uy) */
  | { kind: 'charge'; who: Mover; ux: number; uy: number }
  /** the head tucks and rolls along (ux, uy) */
  | { kind: 'roll'; who: Mover; ux: number; uy: number; ms: number };

export type Screen = 'title' | 'playing' | 'paused' | 'over' | 'won';

export class VillageScene extends SimScene {
  readonly adaptive = new AdaptiveSpawner();
  private adaptiveEnemies = new Set<Raider>();

  tickAdaptiveSpawns(dt: number): void {
    for (const enemy of this.adaptiveEnemies) if (enemy.dead) this.adaptiveEnemies.delete(enemy);
    const pl = this.player;
    this.adaptive.tick(dt, pl.hp, this.screen === 'playing' && !this.paused && !pl.dead && !pl.hidden && !this.interior.active,
      this.adaptiveEnemies.size, p, n => {
        let spawned = 0;
        for (let attempt = 0; attempt < n * 12 && spawned < n; attempt++) {
          const angle = this.rng.range(0, Math.PI * 2), radius = this.rng.range(p.adaptiveRadius, p.adaptiveRadius + 4) * TILE;
          const tile = World.toTile(pl.x + Math.cos(angle) * radius, pl.y + Math.sin(angle) * radius);
          if (!this.world.inBounds(tile.tx, tile.ty) || this.world.isBlocked(tile.tx, tile.ty, true)) continue;
          const pos = World.center(tile.tx, tile.ty);
          if (Math.hypot(pos.x - pl.x, pos.y - pl.y) < p.adaptiveRadius * TILE) continue;
          const enemy = new Raider(pos.x, pos.y, { hpMul: this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul });
          enemy.lairBound = true; // Does not hold up raid completion or Warlord victory.
          enemy.huntPlayer = true;
          this.adaptiveEnemies.add(this.spawn(enemy));
          spawned++;
        }
        return spawned;
      });
  }

  neighborRadius = 130; // soldier aggro radius = largest grid query

  world!: World;
  player!: Player;
  /** the granary, by kind of food; `food` is the total (its setter keeps the old callers working: gains land in wheat, spending drains the fullest kind first) */
  pantry: Record<FoodKind, number> = zeroFood();
  get food(): number { let n = 0; for (const k of FOOD_KINDS) n += this.pantry[k]; return n; }
  set food(v: number) {
    let delta = v - this.food;
    if (delta >= 0) { this.pantry.wheat += delta; return; }
    while (delta < -1e-9) {
      const k = this.fullestKind();
      if (!k) { break; }
      const take = Math.min(this.pantry[k], -delta);
      this.pantry[k] -= take; delta += take;
    }
    for (const k of FOOD_KINDS) if (this.pantry[k] < 1e-9) this.pantry[k] = 0;
  }
  /**
   * The kind rations come out of: whatever the granary holds most of, raw before cooked — nobody hands
   * out the gnomes' stew while there is wheat in the bin. Null only when the granary is truly empty.
   */
  fullestKind(): FoodKind | null {
    const most = (kinds: readonly FoodKind[]): FoodKind | null => {
      let best: FoodKind | null = null, bn = 0;
      for (const k of kinds) if (this.pantry[k] > bn) { bn = this.pantry[k]; best = k; }
      return best;
    };
    return most(RAW_KINDS) ?? most(DISHES);
  }
  wood = 0;
  arrows = 30;
  /** scrap iron looted from raiders; forges iron and steel armor */
  scrap = 0;
  /** the ARMORY panel's current wearer, or null when closed */
  armoryFor: Mover | null = null;
  /** the barracks whose chest the open armory restocks */
  armoryChest: Building | null = null;
  /** the gnome whose pouch is open, if any: `UI.renderPouch` draws it beside the head's pack */
  pouchOf: Villager | null = null;
  /** the COOKING panel's cottage, or null when the panel is closed */
  cookingAt: Building | null = null;
  /** the one dish still warming the head: a new meal replaces the last, and sim time runs it out */
  buff: { stat: Exclude<DietStat, 'care'>; mul: number; until: number; dish: FoodKind } | null = null;
  interior = new Interior(this);
  posting: Villager | null = null;
  /** the shaman wand's squad: fighters picked with the left button; orders go to them (or to everyone when empty) */
  squad: Villager[] = [];
  /** a marquee being dragged with the wand, in world pixels */
  drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  day = 1;
  /** 0..1 within the day; night around 0.8..0.2 */
  dayTime = 0.3;
  raidActive = false;
  screen: Screen = 'title';
  selected: Mover | null = null;
  /** a building picked with X / right-click / tap */
  selectedBuilding: Building | null = null;
  /** the inspector can also show a tile (crop, tree, pen, wall…) or a thing lying on the ground */
  selectedTile: TilePos | null = null;
  selectedItem: Item | null = null;
  journal: GameEvent[] = [];
  fx: FxEvent[] = [];
  private static buttonsMade = false;
  stats = { peakPop: 0, soldiersRaised: 0, childrenRaised: 0, starsTotal: 0, raidsRepelled: 0, raidersKilled: 0, bossesSlain: 0, buildingsLost: 0, boarsHunted: 0 };
  /** persists across runs (localStorage) */
  meta = new Meta();
  /** this run's modifiers, compiled from the equipped boons */
  mods: Mods = this.meta.mods();
  boss: Raider | null = null;
  /** the Ogre, asleep in his lair until night */
  ogre: Ogre | null = null;
  /** the boar families out in the woods (wildlife.ts) */
  sounders: Sounder[] = [];
  /** ids of meat items a gnome is already on its way to */
  meatClaims = new Set<number>();
  /** the fog of war: what has been seen */
  fog!: Fog;
  lairFound = false;
  /** the gnomes' cottage has been found: their family is yours and the GNOME HOUSE tool is unlocked */
  gnomesFound = false;
  /** standing order for the gnomes: at their head's heels (the default) or off foraging. Toggled by H, inherited by gnomes coming of age. */
  gnomesFollow = true;
  /** set when the run ends */
  result: { won: boolean; renown: RenownBreakdown } | null = null;

  private nameIdx = 0;
  private hovered: Mover | null = null;
  private view?: Renderer;
  private ui?: UI;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  /** camera follows the player when the world is bigger than the viewport (phones) */
  following = false;

  // the kernel sizes its grid from W/H; in resize mode the viewport varies, the world does not
  /** true on frames where the renderer repainted tiles (the minimap follows) */
  get tilesChanged(): boolean { return this.view?.tilesChanged ?? false; }
  get W(): number { return COLS * TILE; }
  get H(): number { return ROWS * TILE; }

  /** Agents need the world for pushes to respect walls. */
  spawn<T extends { id: number }>(agent: T): T {
    (agent as unknown as Mover).world = this.world;
    return super.spawn(agent as unknown as Parameters<SimScene['spawn']>[0]) as unknown as T;
  }

  /** Brief slow motion for a big moment (real-time 0.5 s), then back to the speed the player had. */
  slowMo(): void {
    if (this.slowUntil) return;
    const prev = this.speed;
    this.speed = 0.2;
    this.fx.push({ kind: 'slowmo' });
    this.slowUntil = window.setTimeout(() => { if (this.speed === 0.2) this.speed = prev; this.slowUntil = 0; }, 500);
  }
  private slowUntil = 0;

  /** Days from seed to harvest for this run (boons can shorten it); each crop adds its own days on top. */
  get cropDays(): number {
    return Math.max(1, p.cropDays + this.mods.cropDaysDelta);
  }
  cropDaysOf(t: { food?: FoodKind }): number { return Math.max(1, this.cropDays + FOODS[t.food ?? 'wheat'].days); }
  isRipe(t: { kind: string; stage: number; food?: FoodKind }): boolean { return t.kind === 'crop' && t.stage >= this.cropDaysOf(t); }
  /** Food one harvest of this crop gives (the cropYield slider and boons, plus the crop's own offset). */
  cropYieldOf(kind: FoodKind): number { return Math.max(1, this.mods.cropYield + FOODS[kind].yield); }
  /** Days a picked bush / mushroom patch takes to bear again. */
  regrowDays(kind: FoodKind): number { return Math.max(1, Math.round(FOODS[kind].days * p.wildRegrowMul)); }
  /** Units still on a wild plant: the full yield once regrown, less what gnomes have taken; 0 while bare. */
  wildLeft(t: { kind: string; stage: number; left?: number }): number { const k = WILD_FOOD[t.kind as keyof typeof WILD_FOOD]; return k && this.wildRipe(t) ? t.left ?? FOODS[k].yield : 0; }
  /** Take up to `n` units off the plant at (tx, ty); when it is bare it starts regrowing. Returns what was taken. */
  pickWild(tx: number, ty: number, n: number): number {
    const t = this.world.get(tx, ty);
    if (!t) return 0;
    const left = this.wildLeft(t), take = Math.min(n, left);
    if (take <= 0) return 0;
    if (take >= left) { t.stage = 0; delete t.left; } else t.left = left - take;
    this.world.markDirty(tx, ty);
    return take;
  }
  wildRipe(t: { kind: string; stage: number }): boolean { const k = WILD_FOOD[t.kind as keyof typeof WILD_FOOD]; return !!k && t.stage >= this.regrowDays(k); }

  /** Next raid day; the warlord's day caps the schedule. Infinity when nobody is coming (p.peaceful). */
  get nextRaidDay(): number {
    if (p.peaceful) return Infinity;
    const first = p.firstRaidDay, every = this.raidEvery;
    const next = this.day < first ? first : first + (Math.floor((this.day - first) / every) + 1) * every;
    return Math.min(next, p.bossDay);
  }
  /** Is `day` a raid day (the warlord's day aside)? */
  isRaidDay(day: number): boolean { return !p.peaceful && day >= p.firstRaidDay && day < p.bossDay && (day - p.firstRaidDay) % this.raidEvery === 0; }

  // ---- setup ----------------------------------------------------------------

  preload(): void {
    preloadArt(this);
  }

  setup(): void {
    this.adaptive.reset();
    this.adaptiveEnemies.clear();
    this.interior.leave();
    this.posting = null;
    this.squad = []; this.drag = null;
    this.arrows = 30; this.feverWas = null;
    this.scrap = 0;
    this.armoryFor = null;
    this.pouchOf = null;
    this.cookingAt = null;
    this.buff = null;
    this.mods = this.meta.mods();
    this.world = new World();
    this.world.generate(this.rng, this.mods.fieldWide ? 5 : 3, p.gnomeStart ? 'gnome' : 'village');
    for (const k of FOOD_KINDS) this.pantry[k] = 0;
    this.food = this.mods.startFood;
    this.wood = this.mods.startWood;
    if (this.world.granary) this.world.granary.level = this.mods.startGranaryLevel;
    if (this.world.woodyard) this.world.woodyard.level = this.mods.startWoodyardLevel;
    this.day = 1;
    this.dayTime = 0.3;
    this.raidActive = false;
    this.selected = null;
    this.selectedBuilding = null;
    this.journal = [];
    this.fx = [];
    if (this.slowUntil) { clearTimeout(this.slowUntil); this.slowUntil = 0; }
    if (this.speed < 1) this.speed = 1;
    this.stats = { peakPop: 0, soldiersRaised: 0, childrenRaised: 0, starsTotal: 0, raidsRepelled: 0, raidersKilled: 0, bossesSlain: 0, buildingsLost: 0, boarsHunted: 0 };
    this.boss = null;
    this.ogre = this.world.lair ? this.spawn(new Ogre(this.world.lair)) : null;
    this.sounders = []; this.meatClaims.clear();
    this.spawnSounders();
    this.spawnTrolls();
    this.spawnHives();
    this.lairFound = false;
    this.gnomesFound = p.gnomeStart; // you already keep a toadstool cottage: the craft needs no finding
    this.gnomesFollow = true; // every run starts with them at your heels (reset() does not re-run the field initialiser)
    this.fog?.reset();
    this.result = null;
    this.nameIdx = this.rng.int(0, NAMES.length - 1);

    const home = p.gnomeStart ? this.world.gnomeStart! : this.world.houses[0];
    const door = doorstep(home);
    const c = World.center(door.tx, door.ty);
    this.player = this.spawn(new Player(c.x + (p.gnomeStart ? 0 : TILE * 3), c.y + TILE));
    this.player.keys = this.wasd;
    this.player.maxHp += this.mods.playerHpBonus;
    this.player.hp = this.player.maxHp;

    // the founders are young adults: a few days past coming of age, well short of growing old
    const grown = this.adultAge + 3;
    if (p.gnomeStart) {
      // a gnome couple and nothing else. The Legacy boons that hand out soldiers and second families are
      // skipped on purpose: addVillager makes anyone homed in a cottage a gnome, so they'd arrive wrong.
      this.foundGnomes(home);
    } else {
      // Start with a small working village and two defenders.
      this.addVillager(home, 'farmer', grown);
      this.addVillager(home, 'woodcutter', grown);
      this.addVillager(home, 'soldier', grown + 2);
      this.addVillager(home, 'soldier', grown + 2);
      for (let i = 0; i < this.mods.startSoldiers; i++) this.addVillager(home, 'soldier', grown + 2);
      if (this.mods.extraAdults > 0) {
        // a second family, in the nearest open 2x2 to the left of the first house
        const spot = [[-5, 0], [-6, 0], [5, 0], [0, 5], [-5, 5], [5, 5]].map(([dx, dy]) => ({ tx: home.tx + dx, ty: home.ty + dy })).find((q) => this.world.canBuild('house', q.tx, q.ty)) ?? { tx: home.tx - 3, ty: home.ty };
        const h2 = this.world.placeHouse(spot.tx, spot.ty);
        for (let i = 0; i < this.mods.extraAdults; i++) this.addVillager(h2, 'soldier', grown);
      }
    }
    const where = this.world.denseForests ? 'the deep woodland' : 'the open meadows';
    this.event('info', p.gnomeStart
      ? `A gnome family keeps house in ${where}. Forage what grows wild, then cook it at the pot inside — walk up into the door.`
      : `A new village in ${where}. Follow trails to explore. Build walls and stairs, then station archers.`);
  }

  /** Settle a boar family at (tx, ty): `n` boars on the free tiles around it. */
  foundSounder(tx: number, ty: number, n: number, young = false): Sounder {
    const sd: Sounder = { id: this.sounders.length + 1, home: { tx, ty }, members: [] };
    this.sounders.push(sd);
    for (let i = 0; i < n; i++) {
      let spot: TilePos = { tx, ty };
      for (let tries = 0; tries < 10; tries++) { const q = { tx: tx + this.rng.int(-2, 2), ty: ty + this.rng.int(-2, 2) }; if (!this.world.isBlocked(q.tx, q.ty, true)) { spot = q; break; } }
      const c = World.center(spot.tx, spot.ty);
      this.spawn(new Boar(c.x, c.y, sd, young));
    }
    return sd;
  }
  /** The map's sounders: BOAR.sounders families in the woods and meadows, well away from the village and each other. */
  private spawnSounders(): void {
    const hx = COLS / 2, hy = ROWS / 2;
    for (let k = 0; k < BOAR.sounders; k++) {
      for (let tries = 0; tries < 60; tries++) {
        const tx = this.rng.int(6, COLS - 7), ty = this.rng.int(6, ROWS - 7), t = this.world.get(tx, ty)!;
        if (t.kind !== 'grass' || t.trail || t.building || Math.hypot(tx - hx, ty - hy) < BOAR.minDist) continue;
        if (this.sounders.some((sd) => Math.hypot(sd.home.tx - tx, sd.home.ty - ty) < BOAR.spacing)) continue;
        if (this.world.lair && Math.hypot(this.world.lair.tx - tx, this.world.lair.ty - ty) < 14) continue;
        if (!this.world.bfs({ tx, ty }, { tx: hx, ty: hy }, true).length) continue;
        this.foundSounder(tx, ty, this.rng.int(BOAR.sounderSize[0], BOAR.sounderSize[1]));
        break;
      }
    }
  }
  /**
   * Scatter p.trolls of them over the wilderness. Solitary: no families, no homes, no registry — each is
   * simply an agent standing where it was put, and from there it prowls wherever it likes.
   */
  private spawnTrolls(): void {
    const hx = COLS / 2, hy = ROWS / 2;
    const rng = new Rng(this.seed ^ 0x7201);
    const placed: TilePos[] = [];
    for (let k = 0; k < p.trolls; k++) {
      for (let tries = 0; tries < 40; tries++) {
        const tx = rng.int(4, COLS - 5), ty = rng.int(4, ROWS - 5), t = this.world.get(tx, ty)!;
        if (t.building || this.world.isBlocked(tx, ty, true) || Math.hypot(tx - hx, ty - hy) < TROLL.minDist) continue;
        if (placed.some((q) => Math.hypot(q.tx - tx, q.ty - ty) < TROLL.spacing)) continue;
        if (this.world.lair && Math.hypot(this.world.lair.tx - tx, this.world.lair.ty - ty) < 8) continue;
        if (!this.world.bfs({ tx, ty }, { tx: hx, ty: hy }, true).length) continue; // one that can't reach you is no threat
        const c = World.center(tx, ty);
        this.spawn(new Troll(c.x, c.y));
        placed.push({ tx, ty });
        break;
      }
    }
  }
  /**
   * Hang p.hives beehives in old-growth canopies. Like the trolls these draw from their own stream off
   * the seed, so moving the slider does not reshuffle the rest of the world.
   */
  private spawnHives(): void {
    const hx = COLS / 2, hy = ROWS / 2;
    const rng = new Rng(this.seed ^ 0x81ee);
    const placed: TilePos[] = [];
    for (let k = 0; k < p.hives; k++) {
      for (let tries = 0; tries < 40; tries++) {
        const tx = rng.int(3, COLS - 4), ty = rng.int(3, ROWS - 4), t = this.world.get(tx, ty)!;
        if (!this.isOldGrowth(t)) continue; // only a full canopy can hide a hive
        if (Math.hypot(tx - hx, ty - hy) < HIVE.minDist) continue;
        if (placed.some((q) => Math.hypot(q.tx - tx, q.ty - ty) < HIVE.spacing)) continue;
        this.world.hives.set(ty * this.world.cols + tx, { tx, ty, angry: 0 });
        placed.push({ tx, ty });
        break;
      }
    }
  }

  /** seconds until the next sweep for bodies standing under a hive */
  private hiveT = 0;
  /** seconds until the next skulk may creep out of the grass */
  private skulkT = 0;
  /**
   * Wake any hive somebody is standing under. Scanning the handful of bodies against the hive map is far
   * cheaper than scanning the hives, and it mirrors how a boar notices someone treading on it.
   */
  /** Skulks abroad right now (they are lair-bound, so they never count towards a raid). */
  skulkCount(): number { let n = 0; for (const a of this.agents) if (a instanceof Skulk && !a.dead) n++; return n; }
  /** How many skulks the standing grass can sustain: mow it and the ceiling comes down with it. */
  skulkCap(): number { return Math.min(Math.round(p.skulks), Math.floor(this.world.tallCount / Math.max(1, p.skulkTiles))); }
  /**
   * One skulk creeps out of the long grass every p.skulkEvery seconds while the standing grass can
   * sustain it. Tiles are sampled rather than swept — the map is 200x200 and this runs all run long —
   * and nothing appears within SKULK.spawnDist of the head, so none of them lands in your lap.
   */
  private tickSkulks(dt: number): void {
    this.skulkT -= dt;
    if (this.skulkT > 0) return;
    this.skulkT = Math.max(0.5, p.skulkEvery);
    if (this.screen !== 'playing' || this.skulkCount() >= this.skulkCap()) return;
    const pl = this.player;
    for (let tries = 0; tries < 60; tries++) {
      const tx = this.rng.int(1, COLS - 2), ty = this.rng.int(1, ROWS - 2), t = this.world.get(tx, ty);
      if (!t?.tall || t.building || this.world.isBlocked(tx, ty, true)) continue;
      const c = World.center(tx, ty);
      if (Math.hypot(c.x - pl.x, c.y - pl.y) < SKULK.spawnDist * TILE) continue;
      this.spawn(new Skulk(c.x, c.y));
      return;
    }
  }
  private tickHives(dt: number): void {
    for (const h of this.world.hives.values()) if (h.angry > 0) h.angry -= dt;
    this.hiveT -= dt;
    if (this.hiveT > 0 || !this.world.hives.size) return;
    this.hiveT = 0.25;
    for (const a of this.agents) {
      if (!(a instanceof Mover) || a.dead || a.hidden || a.elevated) continue;
      // people and raiders disturb a hive; the wildlife that lives out here does not
      const meat = a instanceof Player || (a instanceof Villager && !a.carriedBy && a.role !== 'infant') || (a instanceof Raider && !(a instanceof Boar));
      if (!meat) continue;
      const pt = a.tile;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const h = this.world.hiveAt(pt.tx + dx, pt.ty + dy);
        if (!h || h.angry > 0) continue;
        if (Math.hypot((h.tx + 0.5) * TILE - a.x, (h.ty + 0.5) * TILE - a.y) > HIVE.perimeter) continue;
        this.wakeHive(h, a);
      }
    }
  }

  /** Out they come, after whoever disturbed them. */
  wakeHive(h: Hive, at: Mover): Swarm {
    h.angry = HIVE.patience + HIVE.calmAfter;
    const sw = this.spawn(new Swarm(h, at));
    if (at instanceof Player) this.event('raid', 'Bees! A hive above you — run, or get behind a door.', true);
    else if (at instanceof Villager) this.event('raid', `${at.name} disturbed a hive`);
    return sw;
  }

  /**
   * A hive comes down with its tree: the honey falls where it hung, and what is left of the swarm is
   * extremely cross about it. Called before the tile is felled, since World.set drops the hive.
   */
  knockDownHive(tx: number, ty: number, by: Mover | null): void {
    const h = this.world.hiveAt(tx, ty);
    if (!h) return;
    const c = World.center(tx, ty);
    this.world.dropItem('food', HIVE.honey, c.x, c.y, 'honey', this.rng);
    this.event('food', `The hive comes down — ${foodCount(HIVE.honey, 'honey')} in the grass, and the bees are furious.`, true);
    if (by) this.wakeHive(h, by); else h.angry = HIVE.calmAfter;
    this.world.hives.delete(ty * this.world.cols + tx);
  }

  /** Dawn among the trolls: one that is not hunting anybody licks its wounds. */
  private tickTrolls(): void {
    for (const a of this.agents) if (a instanceof Troll && !a.dead && !a.hunting) a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * TROLL.regen));
  }
  /** Dawn in the sounders: the young grow, the calm heal, and a family of two or more may gain a young one. */
  private tickSounders(): void {
    for (const sd of this.sounders) {
      sd.members = sd.members.filter((b) => !b.dead);
      for (const b of sd.members) { b.grow(); if (!b.provoked) b.hp = Math.min(b.maxHp, b.hp + Math.round(b.maxHp * BOAR.regen)); }
      const grown = sd.members.filter((b) => !b.young).length;
      if (grown >= 2 && sd.members.length < BOAR.sounderCap && this.rng.chance(p.boarBreed)) {
        const c = World.center(sd.home.tx, sd.home.ty);
        this.spawn(new Boar(c.x + this.rng.range(-8, 8), c.y + this.rng.range(-8, 8), sd, true));
      }
    }
  }

  /** The head walks into the glade: the cottage joins the village, its family comes out, and the craft is learned. */
  findGnomes(b: Building): void {
    b.wild = undefined;
    this.gnomesFound = true;
    this.foundGnomes(b);
    this.world.refresh(b);
    this.fx.push({ kind: 'upgrade', building: b });
    this.event('grow', 'You found the gnomes! Their cottage is yours, they fall in at your heels — and they will show you how to raise another. H sends them foraging.', true);
  }

  /** A new gnome house comes with its founders: a grown couple, who breed like any family. */
  foundGnomes(b: Building): [Villager, Villager] {
    const grown = this.adultAge + 3;
    return [this.addVillager(b, 'gnome', grown), this.addVillager(b, 'gnome', grown)];
  }

  private addVillager(home: (typeof this.world.houses)[number], role: Role, age: number): Villager {
    const d = doorstep(home);
    const c = World.center(d.tx, d.ty);
    const v = new Villager(c.x + this.rng.range(-4, 4), c.y + this.rng.range(-4, 4), home, role, age, NAMES[this.nameIdx++ % NAMES.length], this.mods);
    if (role === 'soldier') v.order = { kind: 'follow' };
    if (home.kind === 'gnomehouse') { v.gnome = true; v.followingPlayer = this.gnomesFollow; v.applyRole(this.mods); v.hp = v.maxHp; } // born under a toadstool: a gnome for life, and one of your train
    if (role === 'soldier') { v.barracksHp = this.world.barracksLevel >= 3 ? 30 : this.world.barracksLevel >= 2 ? 15 : 0; v.applyRole(this.mods); v.hp = v.maxHp; }
    // infants live in the nursery, unseen until they walk out
    if (role === 'infant') { v.hidden = true; v.indoors = home; const c = buildingCenter(home); v.x = c.tx * TILE; v.y = c.ty * TILE; }
    home.residents++;
    return this.spawn(v);
  }

  event(kind: EventKind, text: string, toast = false): void {
    this.journal.push({ kind, text, toast, day: this.day });
  }

  create(): void {
    const kb = this.input.keyboard!;
    this.wasd = kb.addKeys('W,A,S,D') as typeof this.wasd;
    // playtest buttons on the backtick panel (once: the scene is created a single time)
    if (!VillageScene.buttonsMade) {
      VillageScene.buttonsMade = true;
      button('reset spawn ramp', () => this.adaptive.reset(), 'Restart adaptive batch size and countdown; existing enemies remain.');
      const adaptiveScene = this;
      const adaptiveStatus = {
        get nextBatch() { return adaptiveScene.adaptive.nextBatch(p); },
        get alive() { return [...adaptiveScene.adaptiveEnemies].filter(e => !e.dead).length; },
        get state() {
          if (!p.adaptiveSpawns) return 'off';
          if (adaptiveScene.screen !== 'playing' || adaptiveScene.paused) return 'paused';
          if (adaptiveScene.player.dead || adaptiveScene.player.hidden || adaptiveScene.interior.active) return 'sheltered / inactive';
          if (adaptiveScene.player.hp <= p.adaptiveHp) return 'waiting for HP';
          if (this.alive >= p.adaptiveAliveCap) return 'enemy cap reached';
          return 'spawning in ' + Math.max(0, p.adaptiveEvery - adaptiveScene.adaptive.elapsed).toFixed(1) + 's';
        },
      };
      const adaptiveFolder = getGui().addFolder('adaptive status');
      adaptiveFolder.add(adaptiveStatus, 'state').listen().disable();
      adaptiveFolder.add(adaptiveStatus, 'nextBatch').listen().disable();
      adaptiveFolder.add(adaptiveStatus, 'alive').listen().disable();
      button('next day', () => { if (this.screen === 'playing') { this.day++; this.newDay(); } }, 'Jump to the next dawn: rations, hearths, births, raids on schedule.');
      button('spawn raid', () => { if (this.screen === 'playing') this.spawnRaid(); }, 'Start a raid now, sized for the current wave.');
      button('+50 wood', () => { this.wood = Math.min(this.woodCap, this.wood + 50); }, 'Wood into the woodyard, up to its cap.');
      button('+50 food', () => { this.food = Math.min(this.foodCap, this.food + 50); }, 'Food into the granary, up to its cap.');
      button('copy settings', () => this.copySettings(), 'Copies every slider as JSON — paste it into games/village/defaults.json to make it the new default.');
      button('+20 scrap', () => { this.scrap += 20; }, 'Scrap iron for iron and steel forging.');
    }
    // Stardew-style: C / left click = use tool, X / right click = check, E / Esc = menu, 1-8 or Tab / wheel = tools
    kb.on('keydown-C', () => this.interact());
    kb.on('keydown-X', () => {
      if (this.interior.active) { this.interior.act(); return; }
      if (this.checkNearby()) return;
      if (this.hovered) { this.select(this.hovered); return; }
      const b = this.facedBuilding() ?? this.world.get(this.player.tile.tx, this.player.tile.ty)?.building ?? null;
      if (b) this.selectBuilding(b); else this.select(null);
    });
    const closePanel = (): void => { if (this.cookingAt) this.openCooking(null); else if (this.pouchOf) this.openPouch(null); else if (this.armoryFor) this.openArmory(null); else this.togglePause(); };
    kb.on('keydown-E', closePanel);
    kb.on('keydown-ESC', closePanel);
    kb.on('keydown-V', () => this.openArmory(this.armoryFor ? null : this.player));
    kb.on('keydown-TAB', (e: KeyboardEvent) => { e.preventDefault?.(); this.player.cycleTool(e.shiftKey ? -1 : 1, this.locked); });
    kb.on('keydown-Q', () => this.player.cycleTool(1, this.locked));
    kb.on('keydown-F', () => this.cycleVariant());
    kb.on('keydown-M', () => this.toggleMute());
    kb.on('keydown-Z', () => this.cycleZoom());
    kb.on('keydown-H', (e: KeyboardEvent) => { if (!e.repeat) this.summonGnomes(); });

    super.create(); // creates gfx + hud, then calls reset() -> setup()
    kb.removeAllListeners('keydown-SPACE'); // Esc handles pause; Space is the dodge roll
    kb.on('keydown-SPACE', () => this.dodge());
    kb.on('keydown-G', () => this.tossLoad());
    kb.on('keydown-T', () => { if (this.screen === 'playing' && !this.paused) this.eat(); });
    // number keys pick tools; game speed moves to - / =
    kb.removeAllListeners('keydown-ONE'); kb.removeAllListeners('keydown-TWO'); kb.removeAllListeners('keydown-THREE');
    kb.on('keydown-MINUS', () => (this.speed = this.speed > 4 ? 4 : 1));
    kb.on('keydown-PLUS', () => (this.speed = this.speed < 4 ? 4 : 16));
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'].forEach((k, i) => kb.on(`keydown-${k}`, () => this.setTool(TOOLS[i])));
    // the kernel's R (restart) / N (new seed) are far too easy to hit mid-run: restart lives in the pause menu,
    // and R only works on the end screens where it means "new run"
    kb.removeAllListeners('keydown-R');
    kb.removeAllListeners('keydown-N');
    kb.on('keydown-R', () => { if (this.screen === 'over' || this.screen === 'won') this.startGame(); });
    this.hud.setVisible(false);

    this.view = new Renderer(this);
    this.fog = new Fog(this, 45);
    this.view.rebuild();
    this.ui = new UI(this);
    this.ui.mount();

    // hover / click on the map
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => this.onPointerMove(ptr));
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      if (this.posting) { const q = World.toTile(ptr.worldX, ptr.worldY + WALL_HEIGHT); this.assignPost(this.posting, q); return; }
      if (this.player.tool === 'wand' && this.screen === 'playing' && !this.interior.active) { this.wandDown(ptr, objs); return; }
      if (document.body.classList.contains('touch')) { this.pick(ptr, objs); return; }
      if (ptr.rightButtonDown()) { this.pick(ptr, objs); return; }
      if (this.screen !== 'playing') return;
      // left click: face the cursor and use the tool there
      const dx = ptr.worldX - this.player.x, dy = ptr.worldY - this.player.y;
      if (Math.hypot(dx, dy) > 4) this.player.facing = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      if (dx) this.player.dir = dx < 0 ? -1 : 1;
      this.interact();
    });
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => this.wandUp(ptr));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.player.cycleTool(dy > 0 ? 1 : -1, this.locked));
    this.input.on('gameout', () => { this.hovered = null; this.hoverTile = null; this.hoverPoint = null; this.ui?.tooltip(null); });

    this.scale.on('resize', () => this.fitCamera());
    // Phaser only watches the window; the stage can change on its own (drawer, orientation, layout)
    new ResizeObserver(() => this.scale.refresh()).observe(this.game.canvas.parentElement!);
    this.fitCamera();
    this.goTitle();
  }

  reset(newSeed?: number): void {
    this.ui?.inventory.cancel();
    super.reset(newSeed);
    this.view?.rebuild();
    this.ui?.clear();
    if (this.following) this.cameras.main.centerOn(this.player.x, this.player.y);
    if (this.screen !== 'title') { this.screen = 'playing'; this.paused = false; this.ui?.showScreen(null); }
  }

  /** Follow-camera zoom levels the player can cycle through on small screens. */
  static readonly ZOOMS = [1, 1.5, 2, 3, 4, 6, 8] as const;
  /** index into ZOOMS; null = automatic */
  zoomChoice: number | null = null;
  /** the zoom the camera should rest at; fx bumps zoom in briefly and always return here */
  baseZoom = 2;
  private cameraZoomSetting = p.cameraZoom;

  /**
   * The world is bigger than any normal screen, so the camera follows the player: 2x on
   * desktop, 1.5x on phones, multiplied by p.cameraZoom (default 2 for a closer view).
   * Z / the ZOOM button cycle ZOOMS. Only a huge display shows the whole map at once.
   */
  fitCamera(): void {
    const cam = this.cameras.main;
    cam.zoomEffect.reset(); // a zoom bump in flight would otherwise snap back to the old zoom
    const vw = this.scale.width, vh = this.scale.height;
    const fit = Math.min(vw / this.W, vh / this.H);
    if (fit >= 2 * p.cameraZoom && this.zoomChoice === null) {
      this.following = false;
      cam.removeBounds();
      this.baseZoom = Math.min(4, Math.floor(fit * 2) / 2);
      cam.setZoom(this.baseZoom);
      cam.centerOn(this.W / 2, this.H / 2);
      return;
    }
    const auto = (Math.min(vw, vh) < 500 ? 1.5 : 2) * p.cameraZoom;
    const zoom = this.zoomChoice === null ? auto : VillageScene.ZOOMS[this.zoomChoice];
    this.following = true;
    this.baseZoom = zoom;
    cam.setZoom(zoom);
    cam.setBounds(0, 0, this.W, this.H, true);
    if (this.player) cam.centerOn(this.player.x, this.player.y);
  }

  /** Cycle zoom presets (Z, or the touch zoom button). */
  cycleZoom(): void {
    const zooms: readonly number[] = VillageScene.ZOOMS;
    const next = zooms.findIndex((zoom) => zoom > this.baseZoom);
    this.zoomChoice = next < 0 ? 0 : next;
    this.fitCamera();
  }

  // ---- screens / flow -------------------------------------------------------

  startGame(seed?: number): void {
    this.screen = 'playing';
    if (seed !== undefined && seed !== this.seed) {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(seed >>> 0));
      window.history.replaceState(null, '', url);
    }
    this.reset(seed !== undefined ? seed >>> 0 : this.seed);
  }

  goTitle(): void {
    this.screen = 'title';
    this.paused = true;
    this.ui?.showScreen('title');
  }

  togglePause(): void {
    if (this.screen === 'playing') { this.screen = 'paused'; this.paused = true; this.ui?.showScreen('pause'); }
    else if (this.screen === 'paused') { this.screen = 'playing'; this.paused = false; this.ui?.showScreen(null); }
  }

  /** The run is over: bank renown and show the result. */
  private endRun(won: boolean): void {
    if (this.result) return;
    const renown = this.meta.bankRun({ won, day: this.day, raidersKilled: this.stats.raidersKilled, childrenRaised: this.stats.childrenRaised, stars: this.stats.starsTotal, bossesSlain: this.stats.bossesSlain });
    this.result = { won, renown };
    this.screen = won ? 'won' : 'over';
    this.paused = true;
    this.ui?.showScreen(this.screen);
  }

  /** Sound on/off (M). Returns the new muted state. */
  toggleMute(): boolean {
    return this.view?.fx.sfx.toggleMute() ?? true;
  }
  get muted(): boolean {
    return this.view?.fx.sfx.muted ?? true;
  }

  /** for cycleTool: skip what the head cannot yet make */
  private locked = (t: Tool) => !!this.toolLocked(t);
  /** Why a tool can't be picked up yet, or null. The gnomes' craft is learned by finding them. */
  toolLocked(tool: Tool): string | null {
    if (isImplement(tool) && !this.player.pack.hasTool(tool)) { const name = TOOL_NAME[tool].toLowerCase(); return `Recover or pick up ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`; }
    if ((tool === 'sword' && this.player.weapons.melee < 0) || (tool === 'bow' && this.player.weapons.bow < 0)) return 'Equip a weapon first';
    return tool === 'gnomehouse' && !this.gnomesFound ? 'You have never seen how a toadstool cottage is built' : null;
  }
  validateTool(): void { if (this.toolLocked(this.player.tool)) { this.player.tool = 'hands'; this.player.swing = null; } }
  equipped(slot: EquipmentSlot): Gear | null {
    const pl=this.player;
    if(slot==='melee'||slot==='bow') return pl.weapons[slot]<0?null:{kind:'weapon',slot,tier:pl.weapons[slot]};
    return pl.armor[slot]===0?null:{kind:'armor',slot,tier:pl.armor[slot]};
  }
  private wear(slot: EquipmentSlot, gear: Gear | null): void {
    if(slot==='melee'||slot==='bow') this.player.weapons[slot]=gear && gear.kind==='weapon'?gear.tier:-1;
    else this.player.armor[slot]=gear && gear.kind==='armor'?gear.tier:0;
    this.refitArmor(this.player); this.validateTool();
  }
  swapEquipment(index: number, slot: EquipmentSlot): boolean {
    if(index<0||index>=this.player.pack.slots.length)return false;
    const item=this.player.pack.at(index), old=this.equipped(slot);
    if(item && (isBulk(item)||item.kind==='tool'||item.slot!==slot))return false;
    this.player.pack.slots[index]=old; this.wear(slot,item as Gear|null); return true;
  }
  stowGear(gear: Gear): void {
    if(this.player.pack.put(gear)>=0)return;
    const it=this.world.dropItem('gear',1,this.player.x,this.player.y);it.gear={...gear};it.playerDropPending=true;
    this.event('info',slotName(gear)+' placed at your feet — pack full',true);
  }
  recoverBasicKit(): boolean {
    const pack=this.player.pack, missing: Gear[]=IMPLEMENTS.filter(t=>!pack.hasTool(t)).map(tool=>({kind:'tool',tool}));
    for(const slot of ['melee','bow'] as const) if(this.player.weapons[slot]<0 && pack.findSlot(g=>g.kind==='weapon'&&g.slot===slot)<0) missing.push({kind:'weapon',slot,tier:0});
    if(missing.length>pack.emptySlots){this.event('info','Recovery needs '+(missing.length-pack.emptySlots)+' more empty pack slots',true);return false;}
    for(const gear of missing)pack.put(gear);
    this.event('info',missing.length?'Basic kit recovered':'You already have the basic kit',true);return true;
  }
  clampThrow(aim: {x:number;y:number}): {x:number;y:number} {
    const pl=this.player,d=Math.hypot(aim.x-pl.x,aim.y-pl.y),k=Math.min(1,p.tossRange*TILE/(d||1));
    return {x:pl.x+(aim.x-pl.x)*k,y:pl.y+(aim.y-pl.y)*k};
  }
  dropPackItem(source: number | EquipmentSlot, aim: {x:number;y:number}): boolean {
    const slot=typeof source==='number'?this.player.pack.at(source):this.equipped(source);
    if(!slot)return false;
    if(typeof source==='number')this.player.pack.removeAt(source);else this.wear(source,null);
    const it=isBulk(slot)?this.world.dropItem(slot.kind,slot.n,this.player.x,this.player.y,slot.kind==='food'?slot.food:undefined):this.world.dropItem('gear',1,this.player.x,this.player.y);
    if(!isBulk(slot))it.gear={...slot};it.playerDropPending=true;
    throwItem(it,this.player,this.clampThrow(aim),this.rng);this.validateTool();return true;
  }
  setTool(tool: Tool): void {
    const why = this.toolLocked(tool);
    if (why) { this.event('build', why); return; }
    this.player.tool = tool;
  }

  select(m: Mover | null): void {
    this.selected = m;
    if (m) { this.selectedBuilding = null; this.selectedTile = null; this.selectedItem = null; }
    // picking a child you're standing next to is how you encourage them
    if (m instanceof Villager && m.role === 'kid' && this.screen === 'playing' && !this.encourageProblem(m)) this.encourage(m);
  }
  selectBuilding(b: Building | null): void {
    this.selectedBuilding = b;
    if (b) { this.selected = null; this.selectedTile = null; this.selectedItem = null; }
  }
  selectTile(q: TilePos | null): void {
    this.selectedTile = q && this.world.inBounds(q.tx, q.ty) ? { tx: q.tx, ty: q.ty } : null;
    if (this.selectedTile) { this.selected = null; this.selectedBuilding = null; this.selectedItem = null; }
  }
  selectItem(it: Item | null): void {
    this.selectedItem = it;
    if (it) { this.selected = null; this.selectedBuilding = null; this.selectedTile = null; }
  }
  /** Clear the inspector when what it showed is gone. */
  private tidySelection(): void {
    if (this.selectedItem && !this.world.items.includes(this.selectedItem)) this.selectedItem = null;
    if (this.selectedTile && this.world.get(this.selectedTile.tx, this.selectedTile.ty)?.building) { this.selectedBuilding = this.world.get(this.selectedTile.tx, this.selectedTile.ty)!.building!; this.selectedTile = null; }
  }
  /** Pick whatever is under the pointer: a person, else a thing on the ground, else a building, else the tile itself. */
  pick(ptr: { worldX: number; worldY: number }, objs: Phaser.GameObjects.GameObject[] = []): void {
    if (this.checkNearby(World.toTile(ptr.worldX, ptr.worldY))) return;
    const m = (objs[0]?.getData('agent') as Mover) ?? null;
    if (m) { this.select(m); return; }
    const near = this.world.itemsNear(ptr.worldX, ptr.worldY, 8).sort((a, b) => (a.x - ptr.worldX) ** 2 + (a.y - ptr.worldY) ** 2 - ((b.x - ptr.worldX) ** 2 + (b.y - ptr.worldY) ** 2))[0]
      ?? this.world.items.find((it) => !it.rest && Math.hypot(it.x - ptr.worldX, it.y - it.z - ptr.worldY) <= 8);
    if (near) { this.selectItem(near); return; }
    const q = World.toTile(ptr.worldX, ptr.worldY);
    const b = this.world.get(q.tx, q.ty)?.building ?? null;
    if (b) this.selectBuilding(b); else this.selectTile(q);
  }

  // ---- the inspector's take on tiles, pens and things on the ground -------------------------

  /** The connected pen a tile belongs to, and who is in it. */
  penCard(q: TilePos): { kind: Calling; tiles: number[]; kids: Villager[]; hungry: number; piles: string } | null {
    const kind = this.world.get(q.tx, q.ty)?.pen;
    if (!kind) return null;
    const tiles = this.world.penRegion(q.tx, q.ty), inRegion = new Set(tiles);
    const kids = this.villagers().filter((v) => v.role === 'kid' && v.pen === kind && !v.dead && inRegion.has(v.tile.ty * this.world.cols + v.tile.tx));
    const piles = FOOD_KINDS.map((k) => [k, this.world.items.filter((it) => it.rest && it.kind === 'food' && it.food === k && inRegion.has(Math.floor(it.y / TILE) * this.world.cols + Math.floor(it.x / TILE))).reduce((n, it) => n + it.n, 0)] as const)
      .filter(([, n]) => n > 0).map(([k, n]) => `${n % 1 ? n.toFixed(1) : n} ${FOODS[k].one}`).join(', ');
    return { kind, tiles, kids, hungry: kids.filter((v) => v.hungerDays > 0 || v.task.startsWith('hungry')).length, piles };
  }
  /** Repaint a whole pen as another kind (children there switch with it). */
  repaintPen(tiles: number[], kind: Calling): void {
    const cols = this.world.cols;
    for (const i of tiles) { const tx = i % cols, ty = (i / cols) | 0, t = this.world.get(tx, ty); if (t?.pen && t.pen !== kind) this.world.paintPen(tx, ty, kind); }
    for (const v of this.villagers()) if (v.role === 'kid' && v.pen && !this.world.pens.get(v.pen)?.size) v.pen = v.findPen(this);
    this.event('build', `The pen is now a ${PEN_NAME[kind]}`);
  }
  /** Erase a whole pen; its children go looking for another. */
  erasePen(tiles: number[]): void {
    const cols = this.world.cols;
    for (const i of tiles) { const tx = i % cols, ty = (i / cols) | 0; if (this.world.get(tx, ty)?.pen) this.world.paintPen(tx, ty, null); }
    this.event('build', 'Pen erased');
  }
  /** What farmers will sow on this soil next (the crop's plan for the tile). */
  setFieldPlan(q: TilePos, kind: FoodKind): void {
    const t = this.world.get(q.tx, q.ty);
    if (!t || (t.kind !== 'crop' && t.kind !== 'tilled')) return;
    t.food = kind; this.world.markDirty(q.tx, q.ty);
  }
  /** Connected battlements a set of stairs reaches (how much wall it serves). */
  stairsReach(q: TilePos): number {
    const w = this.world, d = w.get(q.tx, q.ty)?.defense;
    if (!d || d.kind !== 'stairs') return 0;
    const start = q.ty * w.cols + q.tx, seen = new Set<number>([start]), queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi], cx = i % w.cols, cy = (i / w.cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (cy + dy) * w.cols + cx + dx; if (!seen.has(k) && w.get(cx + dx, cy + dy)?.defense) { seen.add(k); queue.push(k); } }
    }
    return seen.size - 1;
  }

  /** Every slider's current value as the JSON defaults.json expects, onto the clipboard (or a prompt to copy from). */
  copySettings(): void {
    const live = p as unknown as Record<string, unknown>;
    const json = JSON.stringify(Object.fromEntries(Object.keys(live).map((k) => [k, live[k]])), null, 2);
    const done = () => this.event('info', 'Settings copied — paste them into games/village/defaults.json', true);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(done, () => window.prompt('Copy these settings:', json));
    else window.prompt('Copy these settings:', json);
  }
  /** F: the held tool's variant — the pen's kind, the crop the seeds sow, the food the basket takes; any other tool picks up the pen. */
  cycleVariant(): void {
    const pl = this.player;
    if (pl.tool === 'pen') pl.cyclePen();
    else if (pl.tool === 'seeds') pl.cycleCrop();
    else if (pl.tool === 'basket') pl.cycleBasket(this.pantry);
    else if (pl.tool === 'wand') this.orderFollow();
    else pl.tool = 'pen';
  }
  /** Age in days a child comes of age: the nursery, then the pen (Quick to Grow shortens it). */
  get adultAge(): number { return Math.max(p.infantDays + 0.1, p.infantDays + p.childDays + this.mods.adultAgeDelta); }
  /** Age from which a villager is an elder, and the age they pass away. */
  get elderAge(): number { return this.adultAge + p.adultDays; }
  get deathAge(): number { return this.elderAge + p.elderDays; }
  nearestBarracks(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.world.barracks) { const c = buildingCenter(b); const d = (c.tx * TILE - x) ** 2 + (c.ty * TILE - y) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }

  // ---- armory ---------------------------------------------------------------------------------

  /** Everyone who can wear armor: you and your soldiers. */
  wearers(): Mover[] {
    return [this.player as Mover, ...this.villagers().filter((v) => v.role === 'soldier' && !v.dead)];
  }
  /** Why `who` can't have the next tier in `slot` right now, or null. */
  craftProblem(who: Mover, slot: ArmorSlot): string | null {
    const next = who.armor[slot] + 1;
    const tier = ARMOR[slot].tiers[next];
    if (!tier) return 'already the best there is';
    if (slot === 'shield' && ((who instanceof Villager && who.weapon === 'bow') || (who instanceof Player && who.tool === 'bow'))) return 'a bow needs both hands';
    return this.forgeProblem(next, tier);
  }
  /** Why `who` can't have the next weapon tier in `slot` right now, or null. */
  weaponProblem(who: Mover, slot: WeaponSlot): string | null {
    const next = who.weapons[slot] + 1;
    const tier = WEAPONS[slot].tiers[next];
    if (!tier) return 'already the best there is';
    return this.forgeProblem(next, tier);
  }
  /** Forge a better weapon for a wearer; pays wood and scrap. */
  craftWeapon(who: Mover, slot: WeaponSlot): boolean {
    const why = this.weaponProblem(who, slot);
    if (why) { this.event('info', `Can't forge: ${why}`, true); return false; }
    const next = who.weapons[slot] + 1, tier = WEAPONS[slot].tiers[next];
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    if (who instanceof Player && who.weapons[slot]>=0) this.stowGear({kind:'weapon',slot,tier:who.weapons[slot]});
    who.weapons = { ...who.weapons, [slot]: next };
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: who.tile.tx, ty: who.tile.ty });
    this.event('build', `${who instanceof Player ? 'You' : (who as Villager).name} now carr${who instanceof Player ? 'y' : 'ies'} a ${tier.name.toLowerCase()}`, true);
    return true;
  }
  /** The forge rules armor and weapons share: a standing barracks of the tier's level, and the wood and scrap. */
  private forgeProblem(next: number, tier: { wood: number; scrap: number }): string | null {
    const need = ARMOR_BARRACKS_LEVEL[next];
    if (!this.world.barracks.length) return 'build a barracks first';
    if (this.world.barracksLevel < need) return `needs a Lv${need} barracks`;
    const cost = this.forgeCost(tier);
    if (this.wood < cost.wood) return `need ${cost.wood} wood (have ${this.wood | 0})`;
    if (this.scrap < cost.scrap) return `need ${cost.scrap} scrap iron (have ${this.scrap})`;
    return null;
  }
  /** Forge the next tier of a slot for a wearer; pays wood and scrap. */
  craftArmor(who: Mover, slot: ArmorSlot): boolean {
    const why = this.craftProblem(who, slot);
    if (why) { this.event('info', `Can't forge: ${why}`, true); return false; }
    const next = who.armor[slot] + 1, tier = ARMOR[slot].tiers[next];
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    if (who instanceof Player && who.armor[slot]>0) this.stowGear({kind:'armor',slot,tier:who.armor[slot]});
    who.armor = { ...who.armor, [slot]: next };
    this.refitArmor(who);
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: who.tile.tx, ty: who.tile.ty });
    this.event('build', `${who instanceof Player ? 'You' : (who as Villager).name} now wear${who instanceof Player ? '' : 's'} ${tier.name.toLowerCase()}`, true);
    return true;
  }
  /** Re-derive max HP after armor changes (soldiers via applyRole; the head keeps a base + bonus). */
  refitArmor(who: Mover): void {
    if (who instanceof Villager) { const frac = who.hp / who.maxHp; who.applyRole(this.mods); who.hp = Math.round(who.maxHp * frac); }
    else if (who instanceof Player) {
      const base = p.playerHp + this.mods.playerHpBonus;
      const frac = who.hp / who.maxHp;
      who.maxHp = base + (ARMOR.helmet.tiers[who.armor.helmet].hp + ARMOR.chest.tiers[who.armor.chest].hp + ARMOR.legs.tiers[who.armor.legs].hp + ARMOR.shield.tiers[who.armor.shield].hp);
      who.hp = Math.round(who.maxHp * frac);
    }
  }
  setDye(who: Mover, dye: number): void { who.dye = ((dye % DYES.length) + DYES.length) % DYES.length; }
  setHelmetStyle(who: Mover, style: number): void { who.helmetStyle = (Math.max(0, Math.min(2, style)) as 0 | 1 | 2); }
  setPlume(who: Mover, plume: number): void { who.plume = ((plume % PLUMES.length) + PLUMES.length) % PLUMES.length; }
  /** Open the armory (needs a barracks) for a wearer, or close it. */
  /** Open a gnome’s pouch (or close the open one). Only a grown gnome carries one. */
  openPouch(v: Villager | null): void {
    if (v && (!v.pouch || v.dead)) return;
    this.pouchOf = v;
    if (v) { this.openArmory(null); this.openCooking(null); }
    this.ui?.renderPouch();
  }
  openArmory(who: Mover | null, chest?: Building | null): void {
    if (who && !this.world.barracks.length) { this.event('info', 'Build a barracks to open an armory', true); return; }
    this.armoryFor = who;
    const sel = this.interior.building?.kind === 'barracks' ? this.interior.building : this.selectedBuilding?.kind === 'barracks' ? this.selectedBuilding : null;
    this.armoryChest = who ? chest ?? sel ?? this.nearestBarracks(this.player.x, this.player.y) : null;
    this.ui?.renderArmory();
  }

  // ---- the cooking pot --------------------------------------------------------------------

  /** Open the gnomes' pot in `b`, or close the panel. */
  openCooking(b: Building | null): void {
    this.cookingAt = b;
    this.ui?.renderCooking();
  }
  /** Why this dish can't be made right now, or null. */
  cookProblem(r: Recipe): string | null {
    const b = this.cookingAt;
    if (!b) return 'no pot here';
    if (b.ruined) return 'the cottage is in ruins — rebuild it with the hammer';
    if (!b.warm) return 'the hearth is cold — stock it with firewood and it lights at dawn';
    for (const [k, n] of Object.entries(r.needs) as [FoodKind, number][]) {
      const have = this.pantry[k];
      if (have < n) return `need ${foodCount(n, k)} (${Math.floor(have)} in store)`;
    }
    if (this.food >= this.foodCap) return 'the granary is full — upgrade it with the hammer';
    return null;
  }
  /** Spend the ingredients and put the servings in the granary. */
  cook(r: Recipe): boolean {
    const b = this.cookingAt;
    if (!b || this.cookProblem(r)) return false;
    // paid bin by bin rather than through `food`, whose setter would drain whatever the granary holds most of
    for (const [k, n] of Object.entries(r.needs) as [FoodKind, number][]) this.pantry[k] -= n;
    this.addFood(r.makes, r.dish);
    const c = buildingCenter(b);
    this.fx.push({ kind: 'deposit', x: c.tx * TILE, y: (b.ty + BUILDINGS[b.kind].h) * TILE - 6, text: `+${foodCount(r.makes, r.dish)}`, colour: FOODS[r.dish].colour });
    this.event('food', `${FOODS[r.dish].name} out of the pot — ${r.makes} servings. A child raised on it grows far past one raised on raw food.`, true);
    return true;
  }
  /** Eat one serving: a big meal now, and the dish's stat raised for a while. */
  /** What one unit of a food fills: meat and honey are worth two, a cooked dish three or four (Food.power). */
  hungerOf(kind: FoodKind): number { return FOODS[kind].power ?? 1; }
  /**
   * What T would eat: out of the pack first, the granary second; raw before cooked, and the most-held
   * of those — the same order fullestKind() spends the granary in. Raw before cooked so a routine meal
   * never burns a dish's buff; EAT ONE at the pot stays the way you spend one deliberately.
   */
  eatKind(): { kind: FoodKind; from: 'pack' | 'granary' } | null {
    const pick = (have: (k: FoodKind) => number) => {
      const most = (ks: readonly FoodKind[]) => { let best: FoodKind | null = null, n = 0; for (const k of ks) if (have(k) >= 1 && have(k) > n) { n = have(k); best = k; } return best; };
      return most(RAW_KINDS) ?? most(DISHES);
    };
    const inPack = pick((k) => this.player.carriedOf('food', k));
    if (inPack) return { kind: inPack, from: 'pack' };
    const g = this.world.granary;
    if (!g || g.ruined) return null; // a ruin feeds nobody
    const inBin = pick((k) => this.pantry[k]);
    return inBin ? { kind: inBin, from: 'granary' } : null;
  }
  /** Eat up to `units` of one food from wherever it is. A dish still heals and warms on top. */
  eatFood(kind: FoodKind, from: 'pack' | 'granary', units: number): boolean {
    const pl = this.player;
    const have = from === 'pack' ? pl.carriedOf('food', kind) : this.pantry[kind];
    // a dish is a deliberate spend, so it is never refused for want of room; raw food is
    const room = isDish(kind) ? Infinity : Math.max(0, p.hungerMax - pl.hunger);
    const want = Math.min(units, have, Math.max(1, Math.ceil(room / this.hungerOf(kind))));
    if (want < 1 || room <= 0) return false;
    const took = from === 'pack' ? pl.takeOut('food', want, kind) : want;
    if (took < 1e-9) return false;
    if (from === 'granary') this.pantry[kind] -= took; // bin by bin: `this.food -=` would drain fullestKind(), not the one we named
    pl.hunger = Math.min(p.hungerMax, pl.hunger + took * this.hungerOf(kind));
    this.fx.push({ kind: 'deposit', x: pl.x, y: pl.y - TILE, text: `+${Math.round(took * this.hungerOf(kind))}`, colour: FOODS[kind].colour });
    if (isDish(kind)) this.dishBuff(kind as DishKind);
    else this.event('food', `You eat ${foodCount(took, kind)}.`);
    return true;
  }
  /** The heal and the warm glow a cooked dish leaves behind. */
  private dishBuff(kind: DishKind): void {
    const r = RECIPES[kind], stat = FOODS[kind].stat as Exclude<DietStat, 'care'>;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + r.heal);
    this.buff = { stat, mul: 1 + r.buffAdd, until: this.simTime + r.buffSecs, dish: kind };
    this.event('food', `${FOODS[kind].name}: +${r.heal} HP and +${Math.round(r.buffAdd * 100)}% ${DIET_STAT_NAME[stat]} for ${r.buffSecs}s.`, true);
  }
  /** T: one meal of whatever eatKind() picks. Refuses a full belly rather than wasting the food. */
  eat(): boolean {
    if (!p.hunger || this.player.hunger >= p.hungerMax - 1e-9) return false;
    const pick = this.eatKind();
    return !!pick && this.eatFood(pick.kind, pick.from, Math.round(p.hungerMeal));
  }
  eatDish(kind: FoodKind): boolean {
    if (!isDish(kind) || this.pantry[kind] < 1) return false;
    return this.eatFood(kind, 'granary', 1);
  }
  /** What the head's last meal is still doing for `stat` (1 = nothing). */
  buffMul(stat: DietStat): number {
    const b = this.buff;
    return b && b.stat === stat && b.until > this.simTime ? b.mul : 1;
  }
  /** Seconds of the current dish left, 0 when there is none. */
  buffLeft(): number { return this.buff ? Math.max(0, this.buff.until - this.simTime) : 0; }
  /** Swings a tool needs, with a stew inside you. */
  workHits(base: number): number { return Math.max(1, Math.round(base / this.buffMul('work'))); }
  /** The line shown when the head stands at the pot. */
  cookHint(b: Building): string {
    if (!b.warm) return 'Cooking pot · the hearth is cold — stock the pile and it lights at dawn';
    const can = DISHES.filter((d) => { const was = this.cookingAt; this.cookingAt = b; const why = this.cookProblem(RECIPES[d]); this.cookingAt = was; return !why; });
    const held = DISHES.filter((d) => this.pantry[d] >= 1).map((d) => foodCount(this.pantry[d] | 0, d)).join(', ');
    return `Cooking pot · ${can.length ? `${can.length} dish${can.length === 1 ? '' : 'es'} you can make` : 'nothing you have the ingredients for'}${held ? ` · ${held} in store` : ''}`;
  }

  // ---- child rearing ----------------------------------------------------------------------

  /** Can the head encourage this child right now? null when yes, else the reason. */
  encourageProblem(kid: Villager): string | null {
    if (kid.role !== 'kid') return 'only children';
    if (kid.dead) return null;
    if (kid.hidden) return `${kid.name} is indoors`;
    if (kid.encouragedDay === this.day) return 'already today — come back tomorrow';
    if (Math.hypot(kid.x - this.player.x, kid.y - this.player.y) > 28) return 'walk over to them';
    return null;
  }
  /**
   * A moment with a child: the head stops for a second and a half, hearts, and the child gets a
   * care point for the day plus a day's worth of apprenticeship. During a raid it also sends them home.
   */
  encourage(kid: Villager): boolean {
    const why = this.encourageProblem(kid);
    if (why) { this.event('info', `Can't encourage ${kid.name}: ${why}`); return false; }
    kid.encouragedDay = this.day;
    if (kid.apprenticeAt(this)) kid.trained = Math.min(Villager.drillNeeded(this), kid.trained + 1);
    if (this.raidActive) kid.sentHome = true;
    this.player.busy = 1.5;
    this.player.vx = this.player.vy = 0;
    this.fx.push({ kind: 'hearts', who: kid });
    this.event('birth', `You encouraged ${kid.name}${this.raidActive ? ' — go inside!' : ''}`, false);
    return true;
  }
  /** The care checklist for today, as the UI shows it (what's true right now). */
  careToday(kid: Villager): { label: string; ok: boolean; note?: string }[] {
    const sibling = this.villagers().some((v) => v !== kid && v.role === 'kid' && v.home === kid.home && !v.dead);
    const parents = kid.parents.filter((q) => !q.dead).length;
    return [
      { label: 'Fed', ok: kid.hungerDays === 0 },
      { label: 'Well fed', ok: kid.ateDay >= this.day, note: 'ate from the pen today' },
      { label: 'Family', ok: parents >= 2, note: parents === 1 ? 'one parent' : parents === 0 ? 'no parents' : undefined },
      { label: 'Company', ok: sibling, note: 'another child at home' },
      { label: 'Warm', ok: kid.home.warm, note: kid.home.warm ? 'the hearth is lit' : 'their house is cold — stock its hearth' },
      { label: 'Home', ok: kid.home.level >= 2 && !kid.home.ruined && kid.home.warm, note: kid.home.ruined ? 'their house is in ruins' : 'house Lv2+' },
      { label: 'Attention', ok: kid.encouragedDay === this.day, note: 'encourage them' },
      { label: 'Safe', ok: kid.fledDay !== this.day, note: 'ran from raiders' },
    ];
  }
  /** Where a child runs when raiders come: the nearest house or barracks door. */
  nearestShelter(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.world.buildings) {
      if ((b.kind !== 'house' && b.kind !== 'barracks' && b.kind !== 'tavern' && b.kind !== 'gnomehouse') || b.ruined) continue;
      const d = doorstep(b), c = World.center(d.tx, d.ty), dd = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }

  hoverAgent(m: Mover | null): void {
    this.hovered = m;
  }

  /** tile under the mouse (null on touch / when the pointer left the canvas); drives cursor placement */
  hoverTile: TilePos | null = null;
  /** the exact point under the mouse, for throws and bow aiming */
  hoverPoint: { x: number; y: number } | null = null;

  /** Refresh from screen coordinates so a stationary mouse still aims correctly as the camera follows. */
  private bowAim(): { x: number; y: number } | null {
    if (!this.hoverPoint || document.body.classList.contains('touch')) return null;
    const ptr = this.input.activePointer;
    return this.cameras.main.getWorldPoint(ptr.x, ptr.y);
  }

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    if (this.drag) { this.drag.x1 = ptr.worldX; this.drag.y1 = ptr.worldY; }
    this.hoverTile = document.body.classList.contains('touch') ? null : { tx: Math.floor(ptr.worldX / TILE), ty: Math.floor(ptr.worldY / TILE) };
    this.hoverPoint = this.hoverTile ? { x: ptr.worldX, y: ptr.worldY } : null;
    if (!this.ui || (this.screen !== 'playing' && this.screen !== 'paused')) { this.ui?.tooltip(null); return; }
    const ev = ptr.event as MouseEvent;
    const m = this.hovered;
    if (m && !m.dead && !m.hidden) {
      const name = m instanceof Villager ? m.name : m instanceof Player ? 'You' : (m as Raider).name;
      const sub = m instanceof Villager ? m.role : m.task;
      this.ui.tooltip(`<div class="t">${name}</div><div class="d">${sub} · ${Math.max(0, m.hp)}/${m.maxHp} hp</div>`, ev.clientX, ev.clientY);
      return;
    }
    const tx = Math.floor(ptr.worldX / TILE), ty = Math.floor(ptr.worldY / TILE);
    const t = this.world.get(tx, ty);
    let html: string | null = null;
    const lying = this.itemsBlurb(tx, ty);
    switch (t?.kind) {
      case 'crop': { const fk = t.food ?? 'wheat'; html = `<div class="t">${this.isRipe(t) ? 'Ripe' : 'Growing'} ${FOODS[fk].name.toLowerCase()}</div><div class="d">${Math.min(t.stage, this.cropDaysOf(t))}/${this.cropDaysOf(t)} days · yields ${this.cropYieldOf(fk)} · ${FOODS[fk].blurb}</div>`; break; }
      case 'grass':
        if (lying) html = `<div class="t">On the ground</div><div class="d">${lying} · walk over it to pick it up</div>`;
        else if (t.tall) html = `<div class="t">Long grass</div><div class="d">slows everyone to ${Math.round(p.grassSlow * 100)}% — raiders too · swing the sword to mow it</div>`;
        break;
      case 'tilled': html = `<div class="t">Tilled soil</div><div class="d">${t.food ? `farmers will replant ${FOODS[t.food].name.toLowerCase()}; seeds sow something else` : 'plant with seeds, or a farmer will'}</div>`; break;
      case 'bush': case 'mushroom': case 'hazel': case 'garlic': case 'burdock': { const fk = WILD_FOOD[t.kind]!; html = `<div class="t">${FOODS[fk].name}${this.wildRipe(t) ? '' : ' (picked)'}</div><div class="d">${this.wildRipe(t) ? `ripe · ${this.wildLeft(t)} left · pick by hand, or the gnomes will` : `regrows in ${this.regrowDays(fk) - t.stage} days`} · ${FOODS[fk].blurb}</div>`; break; }
      case 'tree': {
        const old = this.isOldGrowth(t), grove = this.world.groveSize(tx, ty);
        const left = this.oldGrowthDays - t.stage;
        const age = old ? `old growth · yields ${this.treeYield(t)} wood` : `young · old growth in ${left} day${left === 1 ? '' : 's'} · yields ${this.treeYield(t)} wood`;
        html = `<div class="t">${old ? 'Old growth' : 'Tree'}</div><div class="d">${age} · grove of ${grove}${grove >= 200 ? '+' : ''} · spreads ${Math.round(this.seedChance(tx, ty) * 100)}%/day${t.work ? ` · ${t.work}/3 chopped` : ''}</div>`;
        break;
      }
      case 'sapling': {
        const days = this.saplingDays(tx, ty) - t.stage;
        html = `<div class="t">${t.stage < 2 ? 'Stump' : 'Sapling'}</div><div class="d">grows into a tree in ${days} day${days === 1 ? '' : 's'}${this.world.treeNeighbours(tx, ty) >= 2 ? ' · sheltered by the grove' : ''}</div>`;
        break;
      }
      case 'house': case 'barracks': case 'granary': case 'woodyard': case 'tavern': case 'gnomehouse': {
        const b = t.building!;
        html = `<div class="t">${this.buildingTitle(b)}</div><div class="d">${this.buildingBlurb(b)}</div>`;
        break;
      }
    }
    this.ui.tooltip(html, ev.clientX, ev.clientY);
  }

  // ---- simulation -----------------------------------------------------------

  tick(dt: number): void {
    if (this.screen !== 'playing') return;

    this.dayTime += dt / p.dayLength;
    if (this.dayTime >= 1) {
      this.dayTime -= 1;
      this.day++;
      this.newDay();
    }


    for (const a of this.agents) a.update(dt, this);
    this.separate();
    this.tickAges(dt);
    this.tickHunger(dt);
    this.tickBirths();
    this.world.tickItems(dt);
    this.validateTool();
    this.pickUpItems(dt);
    this.tidySelection();
    this.tickHives(dt);
    this.tickSkulks(dt);
    this.tickAdaptiveSpawns(dt);
    this.tickTowers(dt);
    for (const a of this.agents) if (a.dead) this.onDeath(a as Mover);
    this.removeDead();

    // finding the lair: the first time it comes into sight
    if (!this.lairFound && this.world.lair && this.fog) {
      const c = buildingCenter(this.world.lair);
      if (this.fog.visibleAt(c.tx * TILE, c.ty * TILE) > 0.5) { this.lairFound = true; this.event('raid', "You found the Ogre's lair. He sleeps by day."); }
    }
    // finding the gnomes: walk into their glade until the cottage itself comes into sight
    const den = this.world.wildGnomeHouse;
    if (den && this.fog) {
      const c = buildingCenter(den);
      if (this.fog.visibleAt(c.tx * TILE, c.ty * TILE) > 0.5) this.findGnomes(den);
    }
    if (this.raidActive && !this.agents.some((a) => a instanceof Raider && !a.lairBound)) {
      this.raidActive = false;
      this.stats.raidsRepelled++;
      this.slowMo();
      if (this.boss?.dead) { this.endRun(true); return; }
      this.event('raid', 'Raid repelled!', true);
    }
    // the head unloads by walking up to the woodyard / granary — or, with the basket out, fills it there
    if (!this.player.hidden) {
      const pt = this.player.tile;
      for (const b of [this.world.granary, this.world.woodyard]) {
        if (b && pt.tx >= b.tx - 1 && pt.tx <= b.tx + BUILDINGS[b.kind].w && pt.ty >= b.ty - 1 && pt.ty <= b.ty + BUILDINGS[b.kind].h) {
          if (b === this.world.granary && this.player.tool === 'basket') this.fillBasket(); else this.deposit(this.player, b);
        }
      }
    }
    this.stats.peakPop = Math.max(this.stats.peakPop, this.villagers().length);
    if (this.player.dead) { if (p.godMode) { this.player.dead = false; this.player.hp = this.player.maxHp; } else this.endRun(false); }
  }

  newDay(): void {
    // a night's rest — but not on an empty belly
    if (!p.hunger || this.player.hunger > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
    else this.event('food', 'You slept badly on an empty belly.', true);
    // crops grow
    this.world.tiles.forEach((t, i) => { if (t.kind === 'crop') { t.stage++; this.world.dirty.add(i); } });
    // stumps and saplings grow back; trees seed their neighbours
    const seeds: { tx: number; ty: number }[] = [];
    this.world.tiles.forEach((t, i) => {
      const tx = i % COLS, ty = (i / COLS) | 0;
      if (t.kind === 'sapling') {
        if (++t.stage >= this.saplingDays(tx, ty)) this.world.set(tx, ty, 'tree'); else this.world.dirty.add(i);
      } else if (WILD_FOOD[t.kind]) {
        if (++t.stage === this.regrowDays(WILD_FOOD[t.kind]!)) this.world.dirty.add(i); // bears again
      } else if (t.kind === 'tree') {
        if (++t.stage === this.oldGrowthDays) this.world.dirty.add(i); // grows tall
        // old growth shelters berries, mushrooms and hazels
        if (t.stage >= this.oldGrowthDays && this.rng.chance(p.wildSprout)) {
          const [dx, dy] = this.rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
          const n = this.world.get(tx + dx, ty + dy);
          if (n?.kind === 'grass' && !n.trail && !this.nearBuilding(tx + dx, ty + dy, 2)) { const roll = this.rng.range(0, 1); this.world.set(tx + dx, ty + dy, roll < 0.4 ? 'bush' : roll < 0.75 ? 'mushroom' : 'hazel').stage = 0; }
        }
        if (this.rng.chance(this.seedChance(tx, ty))) {
          const [dx, dy] = this.rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
          if (this.world.get(tx + dx, ty + dy)?.kind === 'grass') seeds.push({ tx: tx + dx, ty: ty + dy });
        }
      }
    });
    // forests spread until the map is about a third trees, but never into the village clearing
    const treeCap = Math.floor(COLS * ROWS * 0.3);
    let trees = this.world.count((t) => t.kind === 'tree' || t.kind === 'sapling');
    for (const q of seeds) {
      if (trees >= treeCap || this.world.get(q.tx, q.ty)?.kind !== 'grass' || this.world.get(q.tx, q.ty)?.trail || this.nearBuilding(q.tx, q.ty, 2)) continue;
      this.world.set(q.tx, q.ty, 'sapling').stage = 2;
      trees++;
    }
    this.warnedFull = false;
    this.tickSounders();
    this.tickTrolls();
    // the rumour: a direction to explore
    if (this.day === 2 && this.world.lair && !this.lairFound) {
      const l = this.world.lair, dx = l.tx + 2 - COLS / 2, dy = l.ty + 2 - ROWS / 2;
      const ns = Math.abs(dy) > Math.abs(dx) * 0.4 ? (dy < 0 ? 'north' : 'south') : '', ew = Math.abs(dx) > Math.abs(dy) * 0.4 ? (dx < 0 ? 'west' : 'east') : '';
      this.event('info', `The woodcutters whisper of a giant in the forest to the ${ns}${ns && ew ? '-' : ''}${ew}. He only walks at night.`);
    }
    // the gnomes: that they exist, never where. Their glade is the clue — walk into it.
    if (this.day === 3 && this.world.wildGnomeHouse) this.event('info', 'The children swear they saw a little red cap watching from the ferns.');

    this.burnHearths();
    // Baby Fever is judged on the larder as the day breaks, before anyone eats
    const fever = this.feverActive();
    if (this.mods.babyFever && this.feverWas !== null && fever !== this.feverWas) this.event('birth', fever ? 'Baby fever: full larders, and the village knows it.' : 'The surplus is gone — births return to normal.', true);
    this.feverWas = fever;

    // villagers: eat (pen children from their pile, everyone else from the granary), tally the children's day
    const villagers = this.villagers(), warnedPens = new Set<Calling>();
    for (const v of villagers) {
      if (v.role === 'infant') continue; // nursed: judged after the grown have eaten, below
      const ration = this.rationOf(v);
      let wellFed = false;
      if (v.role === 'kid') {
        // children eat nothing but what lands in a pen: yesterday's meal came off a pile, or it didn't
        if (p.kidFood <= 0 || v.ateDay >= this.day - 1) { v.hungerDays = 0; wellFed = true; }
        else if (++v.hungerDays >= p.kidStarveDays) { v.dead = true; v.hp = 0; v.starved = true; this.event('death', `${v.name} starved${v.gnome ? ' by the gnome house' : v.pen ? ` in the ${PEN_NAME[v.pen]}` : ' with no pen to eat in'}`, true); continue; }
        else if (v.gnome && !warnedPens.has('gnome' as Calling)) { warnedPens.add('gnome' as Calling); this.event('food', 'Gnome children are going hungry — throw food by their cottage', true); }
        else if (v.pen && !warnedPens.has(v.pen)) { warnedPens.add(v.pen); this.event('food', `Children in the ${PEN_NAME[v.pen]} are going hungry — toss food in`, true); }
        else if (!v.pen && !warnedPens.has('none' as Calling)) { warnedPens.add('none' as Calling); this.event('food', 'Children with no pen are going hungry — paint one and throw food in', true); }
      }
      else if (this.food >= ration) { this.food -= ration; v.hungerDays = 0; }
      else if (++v.hungerDays >= 3 + this.mods.starveDaysDelta) { v.dead = true; v.hp = 0; v.starved = true; this.event('death', `${v.name} starved`, true); continue; }
      else this.event('food', `${v.name} went hungry`);
      if (v.role === 'kid') {
        // yesterday's care, tallied at dawn: what they ate, who was around, where they live, whether you came by
        const fed = v.hungerDays === 0;
        const parents = v.parents.filter((q) => !q.dead).length;
        const sibling = villagers.some((o) => o !== v && o.role === 'kid' && o.home === v.home && !o.dead);
        let pts = (fed ? 1 : -1) + (wellFed ? 1 : 0) + (parents >= 2 ? 1 : 0) + (sibling ? 1 : 0) + (v.home.level >= 2 && !v.home.ruined && v.home.warm ? 1 : 0) - (v.home.ruined ? 1 : 0) + (v.home.warm ? 0 : p.coldKidCare) + (v.encouragedDay === this.day ? 1 : 0) - (v.fledDay === this.day ? 1 : 0);
        v.care += pts; v.careDays++;
        v.stars = v.starsNow();
      }
      if (this.mods.dawnHeal) v.hp = v.maxHp; // Second Wind: a night's rest heals everything
    }

    // infants are nursed: they eat only if a grown-up at home ate. A house where nobody was fed (or nobody is left) starves its nursery.
    let nurseryWarned = false;
    for (const v of villagers) {
      if (v.role !== 'infant' || v.dead) continue;
      const nursed = villagers.some((o) => o !== v && o.home === v.home && o.isAdult && !o.dead && o.hungerDays === 0);
      if (nursed) { v.hungerDays = 0; continue; }
      if (++v.hungerDays >= p.kidStarveDays) { v.dead = true; v.hp = 0; v.starved = true; this.event('death', `${v.name} starved in the nursery — nobody at home was fed`, true); continue; }
      if (!nurseryWarned) { nurseryWarned = true; this.event('food', `${v.name} goes hungry in the nursery — a fed grown-up at home nurses the infants`, true); }
    }

    // move-ins: adults from crowded houses take a spare room elsewhere
    for (const h of this.world.familyHouses) {
      if (!this.hasBed(h)) continue;
      const mover = villagers.find((v) => v.isAdult && !v.dead && v.home !== h && this.homesFor(v).includes(h) && villagers.filter((o) => o.home === v.home && o.isAdult).length > 2);
      if (mover) { mover.home.residents--; mover.home = h; h.residents++; this.event('info', `${mover.name} moved into a new house`); }
    }

    if (p.peaceful) {
      // nobody marches. The run still has a length: outlast the day the Warlord would have come.
      if (this.day >= p.bossDay) { this.event('raid', 'The Warlord never came. The village endures.', true); this.endRun(true); }
      return;
    }
    const warn = 1 + this.mods.warnDaysDelta;
    if (this.day === p.bossDay) this.spawnRaid(true);
    else if (this.isRaidDay(this.day)) this.spawnRaid();
    else if (this.day === p.bossDay - RUN.warnDays) this.event('raid', `The Warlord marches — he arrives in ${RUN.warnDays} days`, true);
    else if (this.isRaidDay(this.day + warn) || this.day + warn === p.bossDay) this.event('raid', warn > 1 ? `Scouts report raiders — they arrive in ${warn} days` : 'Raiders sighted — they arrive tomorrow', true);
  }

  // ---- the breeding program: nurseries, ages, pens ------------------------------------

  /** Cribs in a house's nursery: p.cribs, one more per level. */
  cribs(h: Building): number { return h.ruined ? 0 : p.cribs + h.level - 1; }
  infantsOf(h: Building): Villager[] { return this.villagers().filter((v) => v.role === 'infant' && v.home === h && !v.dead); }
  /** Beds in use: residents less the infants, who sleep in cribs. */
  bedsTaken(h: Building): number { return h.residents - this.infantsOf(h).length; }
  hasBed(h: Building): boolean { return this.bedsTaken(h) < this.beds(h); }
  /** Seconds until this house next rolls for a birth (0 when due). */
  birthIn(h: Building): number { return Math.max(0, (h.nextBirth ?? 0) - this.simTime); }
  /** Why no child will be born in this house right now, or null. */
  birthProblem(h: Building): string | null {
    if (h.ruined) return 'in ruins';
    if (!h.warm) return 'the hearth is cold';
    if (this.villagers().filter((v) => v.home === h && v.isAdult && !v.dead).length < 2) return 'needs a couple living here';
    if (this.infantsOf(h).length >= this.cribs(h)) return 'the nursery is full';
    if (this.food <= 10) return 'food to spare first';
    return null;
  }
  /** Every house rolls for a birth every p.birthEvery seconds: a couple, a warm hearth, a free crib, food to spare. */
  /** How much the head eats a day, for the HUD only — dailyRation() is the villagers' and must stay theirs. */
  headRation(): number { return p.hunger ? p.hungerPerDay : 0; }
  /** 0 fed, 1 getting hungry, 2 starving — so the warning fires once per crossing rather than once a frame. */
  private hungerWarned = 0;
  /**
   * The head's own belly. It empties as the day passes and an empty one costs HP — taken off `hp`
   * directly rather than through hit(), which floors at 1 (60 HP/s at this cadence), lets armor turn
   * the blow, and would have a hearty dish make you starve slower.
   */
  tickHunger(dt: number): void {
    const pl = this.player;
    if (!p.hunger) { pl.hunger = p.hungerMax; this.hungerWarned = 0; return; } // off: the belly stays full
    const days = dt / p.dayLength;
    // clamped against the slider every tick rather than cached, so dragging hungerMax takes mid-run
    pl.hunger = Math.max(0, Math.min(pl.hunger, p.hungerMax) - p.hungerPerDay * days);
    const stage = pl.hunger <= 0 ? 2 : pl.hunger <= p.hungerMax * 0.25 ? 1 : 0;
    if (stage !== this.hungerWarned) {
      if (stage > this.hungerWarned) this.event('food', stage === 2 ? 'You are starving — eat something (T)' : 'You are getting hungry — eat something (T)', true);
      this.hungerWarned = stage;
    }
    if (pl.hunger > 0 || p.godMode) return; // god mode starves without bleeding
    pl.hp -= p.starveHpPerDay * days;
    if (pl.hp <= 0) { pl.hp = 0; pl.dead = true; this.event('death', 'You starved.', true); }
  }

  tickBirths(): void {
    const fever = this.feverActive();
    for (const h of this.world.familyHouses) {
      if (h.nextBirth === undefined) h.nextBirth = this.simTime + this.rng.range(0, p.birthEvery);
      if (h.nextBirth > this.simTime) continue;
      h.nextBirth = this.simTime + p.birthEvery;
      if (this.birthProblem(h) || !this.rng.chance(this.birthChance(h, fever))) continue;
      const adults = this.villagers().filter((v) => v.home === h && v.isAdult && !v.dead);
      const kid = this.addVillager(h, 'infant', 0);
      kid.parents = [adults[0], adults[1]];
      if (this.infantsOf(h).length < this.cribs(h) && this.rng.chance(this.mods.twinChance)) {
        const twin = this.addVillager(h, 'infant', 0);
        twin.parents = [adults[0], adults[1]];
        this.event('birth', `Twins! ${kid.name} and ${twin.name} were born`);
      } else this.event('birth', `${kid.name} was born`);
    }
  }
  /** Everyone ages every tick; the stages turn as the thresholds pass. */
  tickAges(dt: number): void {
    const days = dt / p.dayLength;
    for (const v of this.villagers()) {
      if (v.dead) continue;
      v.age += days;
      if (v.role === 'infant') { if (v.age >= p.infantDays) this.leaveNursery(v); }
      else if (v.role === 'kid') { if (v.age >= this.adultAge) { v.comeOfAge(this); this.rehouse(v); } }
      else if (!v.elder) { if (v.age >= this.elderAge) { v.elder = true; v.applyRole(this.mods); this.event('info', `${v.name} has grown old`); } }
      else if (v.age >= v.deathAt(this)) { v.dead = true; v.hp = 0; this.event('death', `${v.name} passed away at ${Math.floor(v.age)}`); }
    }
  }
  /** An infant walks out of the house to the nearest pen (or plays by the door until one is painted). */
  leaveNursery(v: Villager): void {
    v.role = 'kid'; v.applyRole(this.mods); v.hp = v.maxHp;
    v.unhide(this);
    v.pen = v.gnome ? null : v.findPen(this);
    v.mealAt = this.simTime + p.dayLength / 4;
    v.ateDay = this.day;
    this.event('grow', v.gnome ? `${v.name} toddled out of the gnome house` : v.pen ? `${v.name} left the nursery for the ${PEN_NAME[v.pen]}` : `${v.name} left the nursery — no pen to train in`);
  }
  /** A new adult takes a bed near where they trained, else the least crowded house. */
  rehouse(v: Villager): void {
    const houses = this.homesFor(v).filter((h) => !h.ruined);
    if (!houses.length) return;
    const byDist = (h: Building) => { const c = buildingCenter(h); return (c.tx * TILE - v.x) ** 2 + (c.ty * TILE - v.y) ** 2; };
    const next = houses.filter((h) => this.hasBed(h)).sort((a, b) => byDist(a) - byDist(b))[0]
      ?? houses.sort((a, b) => (this.bedsTaken(a) - this.beds(a)) - (this.bedsTaken(b) - this.beds(b)))[0];
    if (next && next !== v.home) { v.home.residents--; v.home = next; next.residents++; }
  }
  /** The houses `v` may live in: gnomes keep to gnome houses, people to people's. */
  homesFor(v: Villager): Building[] { return v.gnome ? this.world.gnomeHouses : this.world.houses; }
  /** Walking up to the granary with the basket out takes food for the pens. */
  fillBasket(): void {
    const g = this.world.granary, pl = this.player;
    if (!g || g.ruined) return;
    // the basket holds one kind: the chosen one, or whatever is already in it; an empty choice falls back to the fullest bin
    const kind = pl.basketKind;
    const room = Math.min(STACK.food - pl.carriedOf('food', kind), pl.roomFor('food', kind));
    const take = pl.pickUp('food', Math.min(room, Math.floor(this.pantry[kind])), kind);
    if (take <= 0) return;
    this.pantry[kind] -= take;
    const c = buildingCenter(g);
    this.fx.push({ kind: 'deposit', x: c.tx * TILE, y: (g.ty + BUILDINGS[g.kind].h) * TILE - 6, text: `-${take} ${FOODS[kind].one}`, colour: FOODS[kind].colour });
  }
  /** Where a throw is aimed: the mouse, or a few tiles ahead on touch / keyboard. */
  get tossAim(): { x: number; y: number } {
    const pl = this.player;
    return this.hoverPoint ?? { x: pl.x + pl.facing.x * p.tossRange * TILE / 2, y: pl.y + pl.facing.y * p.tossRange * TILE / 2 };
  }
  /** Why the basket can't throw at the aim, or null. */
  tossProblem(aim = this.tossAim): string | null {
    const pl = this.player;
    if (pl.carriedOf('food', pl.basketKind) <= 0) return 'the basket is empty — walk up to the granary (or harvest by hand)';
    if (Math.hypot(aim.x - pl.x, aim.y - pl.y) > p.tossRange * TILE) return 'too far to throw';
    return null;
  }
  /** Put `n` of a kind into the world with a throw from the head's hands toward `aim`. */
  private hurl(kind: BulkKind, n: number, aim: { x: number; y: number }, food?: FoodKind): Item {
    const pl = this.player;
    const it = this.world.dropItem(kind, n, pl.x, pl.y, food);
    it.playerDropPending = true;
    throwItem(it, { x: pl.x, y: pl.y }, aim, this.rng);
    if (pl.x !== aim.x) pl.dir = aim.x < pl.x ? -1 : 1;
    return it;
  }
  /** Throw a handful from the basket: it flies at the aim, bounces and rolls, and lies where it stops. */
  toss(): Item | null {
    const aim = this.tossAim, why = this.tossProblem(aim);
    if (why) { this.event('food', why); return null; }
    const pl = this.player, food = pl.basketKind, n = pl.takeOut('food', p.tossSize, food);
    return this.hurl('food', n, aim, food);
  }
  /**
   * G: throw the whole armful — wood or food — wherever you are aiming, with any tool in hand. The
   * only other way to put a load down is to walk it to the woodyard or granary, and wood could not
   * be thrown at all before this.
   */
  tossLoad(): Item | null {
    if (this.screen !== 'playing' || this.interior.active) return null;
    const pl = this.player;
    const stack = pl.pack.bulk().reduce<ReturnType<typeof pl.pack.bulk>[number] | null>((best, b) => !best || b.n > best.n ? b : best, null);
    if (!stack) { this.event('info', 'No bulk supplies in your pack'); return null; }
    const aim = this.clampThrow(this.tossAim);
    pl.pack.removeAt(pl.pack.slots.indexOf(stack));
    return this.hurl(stack.kind, stack.n, aim, stack.kind === 'food' ? stack.food : undefined);
  }
  /** Items lying at the head's feet come along, whatever tool is in hand: scrap always, an armful one kind at a time. */
  pickUpItems(dt = 0): void {
    const pl = this.player, range = p.pickupRange * TILE;
    if (pl.hidden) return;
    for (const it of [...this.world.items]) {
      let d = Math.hypot(it.x-pl.x, it.y-pl.y);
      if (it.playerDropPending) { if (it.rest && d > Math.max(range, ITEM.reach)) it.playerDropPending = false; else continue; }
      if (!it.rest || !this.itemRoom(it)) continue;
      const q = World.toTile(it.x,it.y);
      const protectedFood = it.kind === 'food' && (this.world.gnomeHouses.some(h => Math.hypot(it.x-buildingCenter(h).tx*TILE,it.y-buildingCenter(h).ty*TILE)<=GNOME_YARD*TILE) || this.villagers().some(v=>v.eatingFrom===it));
      if (d > ITEM.reach && d <= range && !this.world.get(q.tx,q.ty)?.pen && !this.meatClaims.has(it.id) && !protectedFood) {
        let left = Math.min(p.pickupPull * dt, d - ITEM.reach);
        while (left > 0.001) {
          const step = Math.min(2,left), x=it.x+(pl.x-it.x)/d*step, y=it.y+(pl.y-it.y)/d*step;
          if (this.world.itemBlocked(x,y,0)) break;
          it.x=x;it.y=y;left-=step;d=Math.hypot(it.x-pl.x,it.y-pl.y);
        }
      }
      if (d > ITEM.reach + 0.001) continue;
      if (it.kind === 'gear') { if (it.gear && pl.pack.put(it.gear)>=0) this.world.removeItem(it); }
      else { const take = pl.pickUp(it.kind,it.n,it.food); it.n-=take; if(it.n<1e-9)this.world.removeItem(it); }
    }
  }
  itemRoom(it: Item): number { return it.kind === 'gear' ? (it.gear ? this.player.pack.emptySlots : 0) : this.player.roomFor(it.kind,it.food); }
  /** What is lying on a tile, in words. */
  itemsBlurb(tx: number, ty: number): string {
    const on = this.world.itemsOn(tx, ty);
    return on.map((it) => it.kind === 'gear' && it.gear ? slotName(it.gear) : `${it.n % 1 ? it.n.toFixed(1) : it.n} ${it.kind === 'scrap' ? 'scrap' : it.kind === 'wood' ? 'wood' : FOODS[it.food ?? 'wheat'].one}`).join(', ');
  }
  // ---- bodies ---------------------------------------------------------------------------------

  /** a fine grid just for body-to-body pushes (the main grid's cells are sized for aggro queries) */
  private bodies = new SpatialGrid<Mover>(COLS * TILE, ROWS * TILE, 12);
  /** Nobody stands inside anybody: overlapping bodies push apart, the lighter one giving way, and nobody is pushed into a wall. */
  separate(): void {
    if (!p.collide) return;
    const solid: Mover[] = [];
    for (const a of this.agents) {
      if (!(a instanceof Mover) || a.dead || a.hidden || a instanceof Arrow || a instanceof Bolt || a instanceof Swarm) continue;
      if (a instanceof Villager && (a.carriedBy || a.role === 'infant')) continue;
      if (a instanceof Player && a.roll) continue; // a roll goes through bodies — walls still stop it
      solid.push(a);
    }
    this.bodies.rebuild(solid);
    for (const a of solid) {
      this.bodies.forEachInRadius(a.x, a.y, a.radius + 6, (b, d2) => {
        if (b === a || b.id < a.id || b.elevated !== a.elevated) return; // each pair once
        const minD = a.radius + b.radius;
        if (d2 >= minD * minD) return;
        let d = Math.sqrt(d2), ux: number, uy: number;
        if (d < 0.01) { const ang = (a.id * 2.399 + b.id) % (Math.PI * 2); ux = Math.cos(ang); uy = Math.sin(ang); d = 0.01; } // dead centre: pick a direction
        else { ux = (b.x - a.x) / d; uy = (b.y - a.y) / d; }
        const overlap = minD - d, share = b.mass / (a.mass + b.mass);
        this.nudge(a, -ux * overlap * share, -uy * overlap * share);
        this.nudge(b, ux * overlap * (1 - share), uy * overlap * (1 - share));
      });
    }
  }
  /** Move a body by (dx, dy) unless that puts it in a blocked tile (then it stays and the other body takes the whole push next tick). */
  private nudge(m: Mover, dx: number, dy: number): void {
    const nx = m.x + dx, ny = m.y + dy, t = World.toTile(nx, ny);
    if (m instanceof Player ? !m.fits(nx, ny, this.world) : this.world.isBlocked(t.tx, t.ty, m.hostile, m.elevated)) return;
    m.x = nx; m.y = ny;
  }
  /** Is another child already eating from this pile (within reach of it)? */
  someoneEating(item: Item, notMe: Villager): boolean {
    for (const v of this.villagers()) if (v !== notMe && v.eatingFrom === item && !v.dead && Math.hypot(v.x - item.x, v.y - item.y) <= ITEM.eatReach) return true;
    return false;
  }

  /** Children in a pen and the food waiting on it. */
  penReport(kind: Calling): { kids: number; hungry: number; food: number; piles: string } {
    const kids = this.villagers().filter((v) => v.role === 'kid' && v.pen === kind && !v.dead);
    const piles = FOOD_KINDS.map((k) => [k, this.world.penFoodTotal(kind, k)] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n % 1 ? n.toFixed(1) : n} ${FOODS[k].one}`).join(', ');
    return { kids: kids.length, hungry: kids.filter((v) => v.hungerDays > 0 || v.task.startsWith('hungry')).length, food: this.world.penFoodTotal(kind), piles };
  }
  /** A child's diet so far and what it will give them, for the UI. */
  dietReport(v: Villager): { kinds: { kind: FoodKind; n: number; share: number }[]; bonuses: string } {
    const b = v.dietNow();
    const bonuses = (['hp', 'speed', 'work', 'dmg'] as const).filter((k) => b[k] > 0.004).map((k) => `+${Math.round(b[k] * 100)}% ${DIET_STAT_NAME[k]}`).join(' · ');
    return { kinds: FOOD_KINDS.map((kind) => ({ kind, n: v.diet[kind], share: Math.min(1, v.diet[kind] / Math.max(1, p.dietFull)) })), bonuses };
  }

  /** Days between raids (Long Peace stretches it). */
  get raidEvery(): number { return p.raidEvery + this.mods.raidEveryDelta; }

  spawnRaid(boss = false): void {
    const wave = Math.max(1, 1 + Math.floor((this.day - p.firstRaidDay) / this.raidEvery));
    const mix = waveComposition(wave, boss);
    // raids are big: every count grows by p.raidSizeMul (the enemies themselves are unchanged)
    for (const k of Object.keys(mix) as (keyof typeof mix)[]) if (mix[k]) mix[k] = Math.max(1, Math.round(mix[k] * p.raidSizeMul));
    // Scouts: every wave is a raider short (never below one); Hearsay: the Warlord's escort halves
    mix.raider = Math.max(1, mix.raider - this.mods.waveShrink);
    if (boss && this.mods.bossEscortMul < 1) for (const k of Object.keys(mix) as (keyof typeof mix)[]) mix[k] = Math.max(k === 'raider' ? 1 : 0, Math.floor(mix[k] * this.mods.bossEscortMul));
    if (mix.rat > 0) mix.rat = Math.max(10, mix.rat);
    const opts = { hpMul: (1 + p.waveHpGrowth * wave) * this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul, snatchDelayMul: this.mods.snatchDelayMul, noSnatch: this.mods.noSnatch, harmlessRats: this.mods.ratsHarmless };
    const side = this.rng.int(0, 3);
    const spawnAt = (): { x: number; y: number } => {
      // Raids approach from the wilderness frontier, not a several-minute walk from the far map edge.
      const hx = COLS / 2, hy = ROWS / 2;
      for (let attempt = 0; attempt < 100; attempt++) {
        const distance = this.rng.int(35, 48), along = this.rng.int(-22, 22);
        const tx = hx + (side === 0 ? -distance : side === 1 ? distance : along);
        const ty = hy + (side === 2 ? -distance : side === 3 ? distance : along);
        if (!this.world.isBlocked(tx, ty, true) && this.world.bfs({ tx, ty }, { tx: hx, ty: hy }, true).length) return World.center(tx, ty);
      }
      return World.center(hx, side === 2 ? hy - 35 : hy + 35);
    };
    const make: Record<keyof typeof mix, (x: number, y: number) => Raider> = {
      raider: (x, y) => new Raider(x, y, opts),
      rat: (x, y) => new Rat(x, y, opts),
      snatcher: (x, y) => new Snatcher(x, y, opts),
      brute: (x, y) => new Brute(x, y, opts),
      shaman: (x, y) => new Shaman(x, y, opts),
      wrecker: (x, y) => new Wrecker(x, y, opts),
    };
    for (const b of this.world.buildings) b.alarmed = false;
    const parts: string[] = [];
    for (const kind of Object.keys(mix) as (keyof typeof mix)[]) {
      const n = mix[kind];
      if (!n) continue;
      parts.push(`${n} ${kind}${n > 1 ? 's' : ''}`);
      for (let i = 0; i < n; i++) { const c = spawnAt(); this.spawn(make[kind](c.x, c.y)); }
    }
    if (boss) {
      const c = spawnAt();
      const w = this.spawn(new Raider(c.x, c.y, { ...opts, boss: true }));
      this.boss = w;
      this.fx.push({ kind: 'boss', who: w });
    }
    this.raidActive = true;
    this.cropsEatenThisRaid = false;
    const from = ['west', 'east', 'north', 'south'][side];
    if (boss) this.event('raid', `THE WARLORD ATTACKS from the ${from} with ${parts.join(', ')}!`, true);
    else this.event('raid', `RAID! ${parts.join(', ')} from the ${from}`, true);
  }

  // ---- hooks called by enemies ----------------------------------------------

  private cropsEatenThisRaid = false;
  cropEaten(): void {
    if (this.cropsEatenThisRaid) return;
    this.cropsEatenThisRaid = true;
    this.event('food', 'Rats are gnawing the crops!', true);
  }
  childGrabbed(kid: Villager, by: Raider): void {
    this.event('raid', `A ${by.name.toLowerCase()} grabbed ${kid.name}!`, true);
  }
  childCarriedOff(kid: Villager, _by: Raider): void {
    kid.carriedBy = null;
    kid.dead = true;
    kid.hp = 0;
    kid.hungerDays = 99; // keeps onDeath from logging "was killed"
    this.event('death', `${kid.name} was carried off`, true);
  }


  private onDeath(a: Mover): void {
    this.fx.push({ kind: 'death', who: a, x: a.x, y: a.y });
    if (a === this.selected) this.selected = null;
    if (a === this.hovered) this.hovered = null;
    if (a instanceof Villager) this.squad = this.squad.filter((v) => v !== a);
    if (a instanceof Mover && a.load && a.load.n > 0 && !(a instanceof Player)) this.world.dropItem(a.load.kind, a.load.n, a.x, a.y, a.load.food, this.rng); // the armful falls where they fell
    if (a instanceof Villager && a.pouch) { // and the pouch spills beside it
      if (a === this.pouchOf) this.openPouch(null);
      for (const slot of a.pouch.slots) {
        if (!slot) continue;
        if (slot.kind === 'wood' || slot.kind === 'food' || slot.kind === 'scrap') this.world.dropItem(slot.kind, slot.n, a.x, a.y, slot.kind === 'food' ? slot.food : undefined, this.rng);
        else { const it = this.world.dropItem('gear', 1, a.x, a.y, undefined, this.rng); it.gear = slot; }
      }
      a.pouch.clear();
    }
    if (a instanceof Villager) {
      a.home.residents--;
      for (const k of this.villagers()) if (k.isChild && k.parents.includes(a)) k.care -= 1; // losing a parent
      if (a.hp <= 0 && !a.starved && a.age < a.deathAt(this)) this.event('death', `${a.name} the ${a.role} was killed`, true);
    } else if (a instanceof Boar) {
      // game, not an enemy: the meat lies where it fell for the head's hands or a gnome
      a.sounder.members = a.sounder.members.filter((b) => b !== a);
      if (a.hp <= 0) {
        this.stats.boarsHunted++;
        this.world.dropItem('food', a.meat, a.x, a.y, 'meat', this.rng);
        this.event('food', `A ${a.name.toLowerCase()} falls — ${a.meat} meat lies where it fell${a.sounder.members.length ? '' : '; the sounder is no more'}`);
      }
    } else if (a instanceof Skulk) {
      // no meat on one of these: it leaves the club it swung, or a single scrap off its trappings
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        if (this.rng.chance(p.skulkClub)) {
          const it = this.world.dropItem('gear', 1, a.x, a.y, undefined, this.rng);
          it.gear = { kind: 'weapon', slot: 'melee', tier: 0 };
        } else this.world.dropItem('scrap', 1, a.x, a.y, undefined, this.rng);
      }
    } else if (a instanceof Troll) {
      // a monster, but the meat is good: it lies where it fell for the head's hands or a gnome
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        this.world.dropItem('food', a.meat, a.x, a.y, 'meat', this.rng);
        this.event('raid', `A troll falls — ${a.meat} meat lies where it fell`);
      }
    } else if (a instanceof Raider) {
      if (a.carrying && !a.carrying.dead) { const kid = a.carrying; kid.carriedBy = null; a.carrying = null; this.event('grow', `${kid.name} was rescued!`, true); }
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        const scrap = (SCRAP_DROP as Record<string, number>)[a.kind] ?? 2;
        if (scrap > 0) this.world.dropItem('scrap', scrap, a.x, a.y, undefined, this.rng); // loot lies where the raider fell: walk over it
        // Bounty: spoils and a second wind for the village head
        if (this.mods.killWood) this.addWood(this.mods.killWood);
        if (this.mods.killFood) this.addFood(this.mods.killFood);
        if (this.mods.killHeal) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.mods.killHeal);
        if (a instanceof Ogre) {
          this.stats.bossesSlain++;
          a.lair.level = 3; this.world.refresh(a.lair); // the fire goes out
          this.slowMo();
          this.event('raid', 'The Ogre is slain! His lair falls silent.', true);
        } else this.event('raid', a.boss ? 'The Warlord has fallen!' : `${a.name} slain`, a.boss);
      }
    }
  }

  // ---- queries used by agents -----------------------------------------------

  villagers(): Villager[] {
    return this.agents.filter((a): a is Villager => a instanceof Villager);
  }

  /** Nearest enemy; rats are skipped unless `includeHarmless` (they're no threat to people). */
  nearestRaider(x: number, y: number, r: number, includeHarmless = false): Raider | null {
    let best: Raider | null = null, bd = Infinity;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (o instanceof Raider && !o.dead && (includeHarmless || !o.harmless) && d2 < bd) { bd = d2; best = o; }
    });
    return best;
  }

  /** What a soldier should go for: a snatcher carrying a child first (seen from further away), then real threats, rats last. Calm wild animals are nobody's business. */
  bestTarget(x: number, y: number, r: number): Raider | null {
    let best: Raider | null = null, bs = Infinity;
    this.grid.forEachInRadius(x, y, r * 2.5, (o, d2) => {
      if (o instanceof Raider && !o.dead && o.carrying && d2 < bs) { bs = d2; best = o; }
    });
    if (best) return best;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (!(o instanceof Raider) || o.dead || (o.wild && o.harmless)) return;
      const score = Math.sqrt(d2) - (o.carrying ? 120 : o.harmless ? -60 : 0);
      if (score < bs) { bs = score; best = o; }
    });
    return best;
  }

  /** Enemies currently targeting the player; following soldiers defend against these only. */
  attackingPlayer(x: number, y: number, r: number): Raider | null {
    let best: Raider | null = null, bestDistance = r * r;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (o instanceof Raider && o.isTargeting(this.player) && d2 < bestDistance) {
        best = o;
        bestDistance = d2;
      }
    });
    return best;
  }

  nearestSoldier(x: number, y: number, r: number): Villager | null {
    let best: Villager | null = null, bd = Infinity;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (o instanceof Villager && o.role === 'soldier' && !o.dead && !o.hidden && d2 < bd) { bd = d2; best = o; }
    });
    return best;
  }

  nearestChild(x: number, y: number): Villager | null {
    let best: Villager | null = null, bd = Infinity;
    for (const a of this.agents) {
      if (!(a instanceof Villager) || a.role !== 'kid' || a.dead || a.hidden || a.carriedBy) continue;
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  nearestVictim(x: number, y: number): Mover | null {
    let best: Mover | null = null, bd = Infinity;
    for (const a of this.agents) {
      if (!(a instanceof Villager) && a !== this.player) continue;
      const m = a as Mover;
      if (m.dead || m.hidden || (a instanceof Villager && a.carriedBy)) continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  pickCivilRole(): Role {
    return 'soldier';
  }

  // ---- buildings: beds, caps, upgrades ----------------------------------------------

  // ---- food and births --------------------------------------------------------

  /** What one villager eats from the granary at dawn: grown villagers only (infants are nursed, children eat from the pens). */
  rationOf(v: Villager): number {
    if (v.isChild) return 0; // infants are nursed, children eat only what lies in a pen or by the gnome house
    return p.foodPerDay * this.mods.foodPerDayMul;
  }
  /** Everyone's rations for one dawn. */
  dailyRation(): number { return this.villagers().reduce((n, v) => n + this.rationOf(v), 0); }
  /** Days the larder would last at today's population. */
  surplusDays(): number { const r = this.dailyRation(); return r > 0 ? this.food / r : Infinity; }
  /** Baby Fever: equipped, and the larder holds a real surplus. A bigger village needs a bigger larder to keep it. */
  feverActive(): boolean { return this.mods.babyFever && this.surplusDays() >= p.feverDays; }
  private feverWas: boolean | null = null; // null until the first dawn: only changes are announced
  /** Chance a couple in `h` has a child at dawn. */
  birthChance(h: Building, fever = this.feverActive()): number {
    return Math.min(0.95, p.birthChance + this.mods.birthBonus + (h.level >= 3 ? 0.15 : 0) + (fever ? p.feverBonus : 0));
  }

  /** Beds in a house: by level, or the Big Families boon if that is higher. */
  beds(h: Building): number {
    if (h.ruined) return 0;
    if (h.kind === 'gnomehouse') return Math.max(0, (GNOME_BEDS[h.level] ?? 3) + this.mods.bedBonus + p.bedBonus);
    return Math.max(0, Math.max(HOUSE_BEDS[h.level] ?? 4, this.mods.houseCap) + this.mods.bedBonus + p.bedBonus);
  }
  get foodCap(): number { return Math.round(CAPS[this.world.granary?.level ?? 1] * this.mods.capMul); }
  get woodCap(): number { return Math.round(CAPS[this.world.woodyard?.level ?? 1] * this.mods.capMul); }
  private warnedFull = false;


  /** Add to the stockpile, respecting storage; says so (once a day) when the store is full. */
  /** Hand a carried load in at its building: the stockpile takes it (up to the cap) and the arms are free. */
  deposit(m: Mover, at?: Building): void {
    for (const load of m.carriedLoads()) {
      const b = load.kind === 'food' ? this.world.granary : this.world.woodyard;
      if (!b || (at && at !== b) || b.ruined) continue;
      const room = load.kind === 'food' ? this.foodCap - this.food : load.kind === 'wood' ? this.woodCap - this.wood : Infinity;
      const take = m.takeOut(load.kind, Math.min(load.n, Math.max(0, room)), load.food);
      if (take <= 0) continue;
      if (load.kind === 'food') this.addFood(take, load.food);
      else if (load.kind === 'wood') this.addWood(take);
      else this.scrap += take;
      const c = buildingCenter(b);
      this.fx.push({ kind: 'deposit', x: c.tx * TILE, y: (b.ty + BUILDINGS[b.kind].h) * TILE - 6, text: '+' + take + ' ' + (load.kind === 'food' ? FOODS[load.food ?? 'wheat'].one : load.kind), colour: load.kind === 'wood' ? '#d9a566' : '#e8d59c' });
    }
  }
  /** Why the head can't pick up `kind` right now (arms full, or holding the other thing), or null. */
  loadProblem(kind: BulkKind, food?: FoodKind, n = 1): string | null {
    return this.player.roomFor(kind, food) >= n ? null : 'Your pack is full — unload supplies or drop an item';
  }
  addFood(n: number, kind: FoodKind = 'wheat'): void {
    const room = this.foodCap - this.food;
    if (n > room && !this.warnedFull) { this.warnedFull = true; this.event('food', 'The granary is full — upgrade it with the hammer', true); }
    this.pantry[kind] += Math.max(0, Math.min(room, n));
  }
  addWood(n: number): void {
    const room = this.woodCap - this.wood;
    if (n > room && !this.warnedFull) { this.warnedFull = true; this.event('wood', 'The woodyard is full — upgrade it with the hammer', true); }
    this.wood = Math.min(this.woodCap, this.wood + n);
  }

  buildingTitle(b: Building): string {
    return `${BUILDINGS[b.kind].name} Lv${b.level}${b.ruined ? ' · RUINED' : ''}`;
  }
  /** What the building does now, and what the next level adds. */
  buildingBlurb(b: Building): string {
    if (b.ruined) return `in ruins · nothing works until the hammer rebuilds it (${this.rebuildCost(b)} wood)`;
    const hearth = hasHearth(b) ? (b.warm ? ` · hearth ${hearthCost(b)} wood/night · ${b.firewood} night${b.firewood === 1 ? '' : 's'} stocked` : ` · COLD — ${b.firewood ? 'lit again at dawn' : 'the pile is empty'}`) : '';
    const now = b.kind === 'house' || b.kind === 'gnomehouse' ? `${this.bedsTaken(b)}/${this.beds(b)} beds · nursery ${this.infantsOf(b).length}/${this.cribs(b)}${b.level >= 3 ? ' · births +15%' : ''}`
      : b.kind === 'granary' ? `${this.food | 0}/${CAPS[b.level]} food (${FOOD_KINDS.filter((k) => this.pantry[k] >= 1).map((k) => `${this.pantry[k] | 0} ${FOODS[k].one}`).join(', ') || 'empty'}) · the harvest is carried here`
      : b.kind === 'woodyard' ? `${this.wood | 0}/${CAPS[b.level]} wood · chopped logs are carried here`
      : LEVEL_PERKS[b.kind][b.level];
    const next = b.level < MAX_LEVEL ? ` · next Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} (${this.upgradeCost(b)} wood, hammer)` : ' · max level';
    const hurt = b.maxHp && b.hp < b.maxHp ? ` · ${Math.ceil(b.hp)}/${b.maxHp} HP (hammer repairs)` : '';
    return now + hearth + next + hurt;
  }

  /** Why the hammer can't upgrade `b` right now, or null. */
  upgradeProblem(b: Building): string | null {
    if (b.kind === 'lair') return "The lair is not yours to improve";
    if (b.ruined) return `rebuild it first (${this.rebuildCost(b)} wood)`;
    if (b.level >= MAX_LEVEL) return `${BUILDINGS[b.kind].name} is already max level`;
    const cost = this.upgradeCost(b);
    if (this.wood < cost) return `need ${cost} wood (have ${this.wood | 0})`;
    return null;
  }

  /** Wood to take a building to its next level (Cheap Timber discounts it). */
  upgradeCost(b: Building): number { return p.freeBuild ? 0 : Math.round(UPGRADE_COST[b.kind][b.level] * this.mods.upgradeCostMul); }
  /** Wood to raise a new house or barracks (Master Builder halves it). */
  buildCost(kind: keyof typeof COST): number { return p.freeBuild ? 0 : Math.round(COST[kind] * this.mods.buildCostMul); }
  defenseCost(kind: DefenseKind): number { return p.freeBuild ? 0 : DEFENSE_COST[kind]; }
  /** What a forge tier costs after the slider (and free build). */
  forgeCost(tier: { wood: number; scrap: number }): { wood: number; scrap: number } { return p.freeBuild ? { wood: 0, scrap: 0 } : { wood: Math.round(tier.wood * p.forgeCostMul), scrap: Math.round(tier.scrap * p.forgeCostMul) }; }

  private upgrade(b: Building): void {
    const cost = this.upgradeCost(b);
    this.wood -= cost;
    b.level++;
    // sturdier with each level: the new structure is added on top of what's standing
    const max = buildingMaxHp(b); b.hp += max - b.maxHp; b.maxHp = max;
    this.world.refresh(b);
    this.fx.push({ kind: 'upgrade', building: b });
    this.event('build', `${BUILDINGS[b.kind].name} is now Lv${b.level} — ${LEVEL_PERKS[b.kind][b.level]}`, true);
  }

  // ---- building damage ------------------------------------------------------
  // Every building but the lair can be wrecked. A ruin keeps its footprint and does nothing until rebuilt.

  /** Hurt a building; true when this blow reduced it to a ruin. */
  damageBuilding(b: Building, dmg: number, by?: Raider): boolean {
    if (b.kind === 'lair' || b.ruined || !b.maxHp) return false;
    b.hp = Math.max(0, b.hp - dmg);
    this.world.refresh(b);
    if (!b.alarmed) { b.alarmed = true; this.event('raid', `${by ? `A ${by.name.toLowerCase()} is` : 'Raiders are'} tearing at the ${BUILDINGS[b.kind].name.toLowerCase()}!`, true); }
    if (b.hp > 0) return false;
    this.ruinBuilding(b);
    return true;
  }
  private ruinBuilding(b: Building): void {
    b.ruined = true; b.hp = 0;
    for (const v of this.villagers()) if (v.indoors === b) v.unhide(this);
    if (this.interior.building === b) this.interior.leave();
    this.stats.buildingsLost++;
    this.world.refresh(b);
    this.fx.push({ kind: 'ruin', building: b });
    this.event('raid', `The ${BUILDINGS[b.kind].name.toLowerCase()} has fallen to ruin — rebuild it with the hammer (${this.rebuildCost(b)} wood).`, true);
  }
  /** Wood to raise a ruin again: a share of what it cost to build. */
  rebuildCost(b: Building): number {
    const base = b.kind in COST ? COST[b.kind as keyof typeof COST] : REPAIR.rebuildDefault / REPAIR.rebuildFraction;
    return p.freeBuild ? 0 : Math.max(1, Math.round(base * REPAIR.rebuildFraction * this.mods.buildCostMul));
  }
  /** Wood back for taking `b` down: half of what went into it. Rubble is worth nothing. */
  demolishRefund(b: Building): number {
    if (b.ruined || !(b.kind in COST)) return 0;
    let spent: number = COST[b.kind as keyof typeof COST];
    for (let lv = 1; lv < b.level; lv++) spent += UPGRADE_COST[b.kind][lv];
    return Math.round(spent * DISMANTLE.refund);
  }
  /** Why `b` can't be demolished right now, or null. */
  demolishProblem(b: Building): string | null {
    if (!(b.kind in COST)) return 'only houses, barracks, gnome houses and the tavern can be taken down';
    if ((b.kind === 'house' || b.kind === 'gnomehouse') && this.villagers().some((v) => v.home === b && !v.dead) && !(b.kind === 'house' ? this.world.houses : this.world.gnomeHouses).some((h) => h !== b && !h.ruined)) return 'its tenants would have nowhere to live';
    return null;
  }
  /** Take a building down: tenants move to another house, anyone inside steps out, half the wood comes back. */
  demolish(b: Building): boolean {
    const why = this.demolishProblem(b);
    if (why) { this.event('build', `Can't demolish: ${why}.`); return false; }
    const refund = this.demolishRefund(b);
    for (const v of this.villagers()) {
      if (v.indoors === b) v.unhide(this);
      if (v.home !== b) continue;
      // the evicted take the nearest house with a spare bed, else the nearest house at all
      const houses = this.homesFor(v).filter((h) => h !== b && !h.ruined);
      const c = buildingCenter(b), byDist = (h: Building) => { const hc = buildingCenter(h); return (hc.tx - c.tx) ** 2 + (hc.ty - c.ty) ** 2; };
      const next = houses.filter((h) => this.hasBed(h)).sort((x, y) => byDist(x) - byDist(y))[0] ?? houses.sort((x, y) => byDist(x) - byDist(y))[0];
      if (next) { b.residents--; v.home = next; next.residents++; }
    }
    if (this.interior.building === b) this.interior.leave();
    if (this.selectedBuilding === b) this.selectedBuilding = null;
    this.world.remove(b);
    this.wood += refund;
    this.fx.push({ kind: 'demolish', building: b });
    this.event('build', `Took down the ${BUILDINGS[b.kind].name.toLowerCase()}${refund ? ` — ${refund} wood recovered` : ''}`, true);
    return true;
  }
  /** Why the hammer can't mend `b` right now, or null. */
  repairProblem(b: Building): string | null {
    if (b.kind === 'lair') return 'The lair is not yours to mend';
    if (b.ruined) { const cost = this.rebuildCost(b); return this.wood < cost ? `need ${cost} wood to rebuild (have ${this.wood | 0})` : null; }
    if (b.hp >= b.maxHp) return 'nothing to repair';
    if (this.wood < 1) return 'need 1 wood';
    return null;
  }
  /** Hammer blow on a hurt building: rebuild a ruin for its rebuild cost, or trade 1 wood for `REPAIR.perWood` HP. */
  repairBuilding(b: Building): boolean {
    const why = this.repairProblem(b);
    if (why) { this.event('build', why); return false; }
    if (b.ruined) {
      this.wood -= this.rebuildCost(b);
      b.ruined = false; b.hp = b.maxHp; b.alarmed = false;
      this.world.refresh(b);
      this.fx.push({ kind: 'upgrade', building: b });
      this.event('build', `The ${BUILDINGS[b.kind].name.toLowerCase()} stands again.`, true);
      return true;
    }
    this.wood--; b.hp = Math.min(b.maxHp, b.hp + REPAIR.perWood);
    this.world.refresh(b);
    return true;
  }
  /** Standing buildings (never the lair) an enemy at `from` can walk to, nearest first; `kinds` narrows it. */
  reachableBuildings(from: TilePos, kinds?: readonly BuildingKind[]): Building[] {
    const fx = (from.tx + 0.5) * TILE, fy = (from.ty + 0.5) * TILE;
    const out: { b: Building; d: number }[] = [];
    for (const b of this.world.buildings) {
      if (b.kind === 'lair' || b.wild || b.ruined || (kinds && !kinds.includes(b.kind))) continue;
      const f = BUILDINGS[b.kind];
      const adjacent = from.tx >= b.tx - 1 && from.tx <= b.tx + f.w && from.ty >= b.ty - 1 && from.ty <= b.ty + f.h;
      if (!adjacent && !this.world.bfs(from, doorstep(b), true).length) continue;
      const c = buildingCenter(b);
      out.push({ b, d: (c.tx * TILE - fx) ** 2 + (c.ty * TILE - fy) ** 2 });
    }
    return out.sort((a, z) => a.d - z.d).map((o) => o.b);
  }

  // ---- player actions -------------------------------------------------------

  /**
   * H / the whistle button. Gnomes trail their head by default (`gnomesFollow`), so the first press sends
   * them off foraging; the next calls the ones within 20 tiles back to your heels. The standing order sticks,
   * so gnomes coming of age fall in with the rest (see `Villager.comeOfAge`).
   */
  summonGnomes(): void {
    if (this.screen !== 'playing' || this.paused || this.interior.active) return;
    const adults = this.villagers().filter(v => v.role === 'gnome' && !v.dead);
    const following = adults.filter(v => v.followingPlayer);
    if (following.length) {
      this.gnomesFollow = false;
      for (const v of following) v.followPlayer(this, false);
      this.event('info', 'The gnomes go off foraging. H or CALL GNOMES brings them back.', true);
      return;
    }
    const nearby = adults.filter(v => !v.hidden && !v.carriedBy && v.dist(this.player) <= 20 * TILE);
    if (nearby.length) this.gnomesFollow = true; // a call nobody heard changes no standing order
    for (const v of nearby) v.followPlayer(this, true);
    this.event('info', nearby.length ? `${nearby.length} gnome${nearby.length === 1 ? ' answers' : 's answer'} your call. H or SEND FORAGING puts them back to work.` : 'No grown gnomes within calling distance (20 tiles).', true);
  }

  shoot(who: Mover, dx: number, dy: number, dmg: number): boolean {
    if(who.weapons.bow<0)return false;
    if (this.arrows <= 0) { who.task = 'out of arrows'; if (who === this.player) this.event('info', 'Out of arrows. Craft a bundle at the barracks.'); return false; }
    const len = Math.hypot(dx, dy) || 1;
    who.aim = { x: dx / len, y: dy / len }; who.dir = dx < 0 ? -1 : 1;
    this.arrows--; who.attackCd = 0.65;
    this.spawn(new Arrow(who.x, who.y, dx / len, dy / len, dmg, who, len > 2 ? len : who.elevated ? 220 : 170));
    this.fx.push({ kind: 'arrow', who });
    return true;
  }
  craftArrows(): void {
    if (!this.world.barracks.length || this.wood < 2) { this.event('info', 'A barracks and 2 wood are needed for 10 arrows.', true); return; }
    this.wood -= 2; this.arrows += 10; this.event('wood', 'Fletched 10 arrows for the shared quiver.');
  }

  // ---- barracks towers ------------------------------------------------------
  // Every barracks looses arrows at raiders in range from its own chest; the chest is refilled with wood inside.

  towerRange(b: Building): number { return p.towerRange + (b.level - 1) * TOWER.rangePerLevel; }
  towerCap(b: Building): number { return p.towerCap + (b.level - 1) * TOWER.capPerLevel; }
  towerDmg(b: Building): number { return p.towerDmg + (b.level - 1) * TOWER.dmgPerLevel; }
  towerCenter(b: Building): { x: number; y: number } { const c = buildingCenter(b); return { x: c.tx * TILE, y: c.ty * TILE }; }
  /** Where a shot leaves the roof: just past the footprint along the aim, so the arrow's own sweep doesn't die on the barracks tiles. */
  private towerMuzzle(b: Building, ux: number, uy: number): { x: number; y: number } {
    const c = this.towerCenter(b);
    let d = 0;
    for (; d < TILE * 4; d += 4) { const q = World.toTile(c.x + ux * d, c.y + uy * d); if (this.world.get(q.tx, q.ty)?.building !== b) break; }
    return { x: c.x + ux * (d + 2), y: c.y + uy * (d + 2) };
  }
  tickTowers(dt: number): void {
    if (!p.towerFires) return;
    for (const b of this.world.barracks) {
      b.fireCd = Math.max(0, (b.fireCd ?? 0) - dt);
      if (b.fireCd > 0 || !(b.ammo ?? 0)) continue;
      const c = this.towerCenter(b), range = this.towerRange(b);
      // nearest raider with a clear line from the roof (trees and buildings are cover, walls are not);
      // no fog test: the barracks is itself a sight source, and fog is only painted for the camera's view
      const inRange: { r: Raider; d2: number }[] = [];
      this.grid.forEachInRadius(c.x, c.y, range, (o, d2) => { if (o instanceof Raider && !o.dead && !o.harmless) inRange.push({ r: o, d2 }); });
      inRange.sort((a, z) => a.d2 - z.d2);
      let shot: { t: Raider; m: { x: number; y: number }; ux: number; uy: number } | null = null;
      for (const { r: t } of inRange) {
        const len = Math.hypot(t.x - c.x, t.y - c.y) || 1, ux = (t.x - c.x) / len, uy = (t.y - c.y) / len;
        const m = this.towerMuzzle(b, ux, uy);
        if (this.world.lineClear(m, t, true)) { shot = { t, m, ux, uy }; break; }
      }
      if (!shot) continue;
      const { m, ux, uy } = shot;
      const arrow = this.spawn(new Arrow(m.x, m.y, ux, uy, this.towerDmg(b), null, range + 24));
      this.fx.push({ kind: 'arrow', who: arrow });
      b.ammo!--; b.fireCd = p.towerCd;
      if (!b.ammo && !b.dryWarned) { b.dryWarned = true; this.event('raid', 'The barracks tower is out of arrows — restock at its chest.', true); }
    }
  }
  /** The gear parked in a barracks chest, made on first use. */
  /** Move one slot between two packs (the head's and a gnome's pouch). Bulk stacks where it fits; gear needs an empty slot. */
  movePackSlot(from: Pack, i: number, to: Pack, j?: number): boolean {
    const item = from.at(i);
    if (!item || from === to) return false;
    if (isBulk(item)) {
      const took = to.add(item.kind, item.n, item.kind === 'food' ? item.food : undefined);
      if (took <= 0) return false;
      item.n -= took;
      if (item.n < 1e-9) from.removeAt(i);
      return true;
    }
    const at = j !== undefined && !to.at(j) ? j : to.slots.indexOf(null);
    if (at < 0) return false;
    to.slots[at] = item;
    from.removeAt(i);
    return true;
  }
  stashOf(b: Building): Gear[] { return (b.stash ??= []); }
  /** Move pack slot `i` into `b`'s chest. Gear only — supplies belong in the granary and woodyard. */
  storeGear(i: number, b: Building): boolean {
    const slot = this.player.pack.at(i);
    if (!slot || isBulk(slot)) { this.event('info', 'The chest takes equipment, not supplies', true); return false; }
    const stash = this.stashOf(b);
    if (stash.length >= STASH_SLOTS) { this.event('info', 'The chest is full', true); return false; }
    this.player.pack.removeAt(i);
    stash.push(slot);
    this.validateTool();
    return true;
  }
  /** Take chest item `i` back into the pack. */
  takeGear(i: number, b: Building): boolean {
    const stash = this.stashOf(b), gear = stash[i];
    if (!gear) return false;
    if (this.player.pack.put(gear) < 0) { this.event('info', 'No room in your pack', true); return false; }
    stash.splice(i, 1);
    return true;
  }
  /**
   * What breaking a piece down returns. A club is just shaped wood; anything forged gives back half
   * of what it cost. Implements are never broken down — losing the hammer to a stray click is the
   * one mistake the village cannot recover from on its own.
   */
  salvageYield(g: Gear): { wood: number; scrap: number } | null {
    if (g.kind === 'tool') return null;
    if (g.tier <= 0) return { wood: SKULK.clubWood, scrap: 0 };
    const tier = g.kind === 'weapon' ? WEAPONS[g.slot].tiers[g.tier] : ARMOR[g.slot].tiers[g.tier];
    if (!tier) return null;
    const paid = this.forgeCost(tier);
    return { wood: Math.floor(paid.wood / 2), scrap: Math.floor(paid.scrap / 2) };
  }
  /** Why chest item `i` can't be broken down, or null. */
  salvageProblem(b: Building, i: number): string | null {
    const g = this.stashOf(b)[i];
    if (!g) return 'nothing there';
    if (b.ruined) return 'the barracks is in ruins';
    const got = this.salvageYield(g);
    if (!got) return 'a tool is worth more whole';
    if (got.wood > this.woodCap - this.wood) return 'the woodyard is full — it would be broken up for nothing';
    return null;
  }
  /** Break chest item `i` down into the stockpiles. */
  salvage(b: Building, i: number): boolean {
    const why = this.salvageProblem(b, i);
    if (why) { this.event('info', `Can't break that down: ${why}`, true); return false; }
    const stash = this.stashOf(b), g = stash[i], got = this.salvageYield(g)!;
    stash.splice(i, 1);
    if (got.wood) this.addWood(got.wood);
    if (got.scrap) this.scrap += got.scrap;
    const c = this.towerCenter(b);
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: b.tx, ty: b.ty });
    this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: `+${got.wood} wood${got.scrap ? ` +${got.scrap} scrap` : ''}`, colour: '#d9a566' });
    this.event('wood', `Broke down a ${slotName(g).toLowerCase()} — +${got.wood} wood${got.scrap ? `, +${got.scrap} scrap` : ''}.`);
    return true;
  }
  /** Break down every club in the chest in one go — what you do after a night of skulks. */
  salvageClubs(b: Building): number {
    let n = 0;
    for (let i = this.stashOf(b).length - 1; i >= 0; i--) {
      const g = this.stashOf(b)[i];
      if (g.kind === 'weapon' && g.tier <= 0 && this.salvage(b, i)) n++;
    }
    if (!n) this.event('info', 'No clubs in the chest', true);
    return n;
  }
  /** Why the tower chest can't be restocked right now, or null. */
  restockProblem(b: Building): string | null {
    if ((b.ammo ?? 0) >= this.towerCap(b)) return 'the chest is full';
    if (this.wood < TOWER.restockWood) return `need ${TOWER.restockWood} wood (have ${this.wood | 0})`;
    return null;
  }
  /** Put a bundle of arrows in a barracks' chest for wood. */
  restockTower(b: Building): boolean {
    const why = this.restockProblem(b);
    if (why) { this.event('info', `Can't restock: ${why}`, true); return false; }
    this.wood -= TOWER.restockWood;
    b.ammo = Math.min(this.towerCap(b), (b.ammo ?? 0) + TOWER.restockArrows); b.dryWarned = false;
    const c = this.towerCenter(b);
    this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: `+${TOWER.restockArrows} arrows`, colour: '#ffe066' });
    this.event('wood', `Stocked the tower chest · ${b.ammo} / ${this.towerCap(b)} arrows.`);
    return true;
  }
  /** Arrows across every barracks chest, for the HUD. */
  towerAmmo(): { ammo: number; cap: number } {
    let ammo = 0, cap = 0;
    for (const b of this.world.barracks) { ammo += b.ammo ?? 0; cap += this.towerCap(b); }
    return { ammo, cap };
  }

  // ---- hearths --------------------------------------------------------------
  // Houses, barracks and taverns burn a night of firewood at dawn. Woodcutters keep the piles stocked;
  // a pile that runs dry leaves the building cold for the day: no births, no drill, no regen, no meals.

  /** standing buildings with a hearth */
  hearthBuildings(): Building[] { return this.world.buildings.filter((b) => hasHearth(b) && !b.ruined && !b.wild); }
  /** Dawn: every hearth burns one night, or goes cold. */
  private burnHearths(): void {
    let burned = 0; const cold: string[] = [];
    for (const b of this.hearthBuildings()) {
      if (!p.hearths) { b.warm = true; continue; } // debug: nothing burns, nothing is cold
      if (b.firewood > 0) { b.firewood--; b.warm = true; burned += hearthCost(b); }
      else { b.warm = false; cold.push(BUILDINGS[b.kind].name.toLowerCase()); }
      this.world.refresh(b);
    }
    for (const b of this.world.buildings) if (b.ruined || !hasHearth(b)) b.warm = false;
    if (cold.length) this.event('wood', `Hearths burned ${burned} wood · cold today: ${cold.join(', ')}. Woodcutters stock the piles; the card can too.`, true);
    else if (burned) this.event('wood', `Hearths burned ${burned} wood through the night.`);
  }
  /** Why the village pile can't stock `b`'s hearth right now, or null. */
  stockProblem(b: Building): string | null {
    if (!hasHearth(b)) return 'no hearth here';
    if (b.ruined) return 'rebuild it first';
    if (b.firewood >= p.hearthNights) return 'the pile is full';
    const cost = p.freeBuild ? 0 : hearthCost(b);
    if (this.wood < cost) return `need ${cost} wood (have ${this.wood | 0})`;
    return null;
  }
  /** Stack a night's wood by the hearth from the village pile. */
  stockHearth(b: Building): boolean {
    const why = this.stockProblem(b);
    if (why) { this.event('info', `Can't stock the hearth: ${why}`, true); return false; }
    this.wood -= p.freeBuild ? 0 : hearthCost(b); b.firewood++;
    const c = this.towerCenter(b);
    this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: '+1 night', colour: '#ffb060' });
    return true;
  }
  /** The hearth a woodcutter with `load` wood should serve first: an empty pile before a low one, nearest first; null when every pile is full. */
  hearthNeeding(x: number, y: number, load: number): Building | null {
    let best: Building | null = null, bs = Infinity;
    for (const b of this.hearthBuildings()) {
      if (b.firewood >= p.hearthNights || hearthCost(b) > load) continue;
      const d = doorstep(b), c = World.center(d.tx, d.ty);
      const score = Math.hypot(c.x - x, c.y - y) + b.firewood * 400; // an empty pile is worth a long walk
      if (score < bs) { bs = score; best = b; }
    }
    return best;
  }
  /** A carried load becomes nights of firewood, as many as fit; whatever is left stays in the arms for the woodyard. */
  stockFromLoad(b: Building, m: Mover): number {
    if (!hasHearth(b) || b.ruined) return 0;
    const cost = hearthCost(b);
    if (cost <= 0) return 0;
    let nights = 0;
    while (b.firewood < p.hearthNights && m.carriedOf('wood') >= cost) { m.takeOut('wood', cost); b.firewood++; nights++; }
    if (nights) { const c = this.towerCenter(b); this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: `+${nights} night${nights > 1 ? 's' : ''}`, colour: '#ffb060' }); }
    return nights;
  }
  /** For the HUD: how many hearths are stocked for tonight. */
  hearthReport(): { stocked: number; total: number; nightly: number } {
    const hs = this.hearthBuildings();
    return { stocked: hs.filter((b) => b.firewood > 0).length, total: hs.length, nightly: hs.reduce((n, b) => n + hearthCost(b), 0) };
  }
  equipSoldier(v: Villager, weapon: 'sword' | 'bow'): void {
    if (v.role !== 'soldier' || v.dead) return;
    v.weapon = weapon; v.attack = null; v.clearGoal();
  }
  reachableStairs(m: Mover, post?: TilePos): TilePos | null {
    const candidates = [...this.world.defenses.values()].filter(d => d.kind === 'stairs').sort((a, b) => m.dist(World.center(a.tx, a.ty)) - m.dist(World.center(b.tx, b.ty)));
    for (const q of candidates) {
      const ground = m.dist(World.center(q.tx, q.ty)) < 3 || this.world.bfs(m.tile, q, false, m.elevated).length > 0;
      if (ground && (!post || (post.tx === q.tx && post.ty === q.ty) || this.world.bfs(q, post, false, true).length > 0)) return q;
    }
    return null;
  }
  assignPost(v: Villager, q: TilePos): boolean {
    if (!this.world.get(q.tx, q.ty)?.defense || !this.reachableStairs(v, q)) { this.event('info', 'Choose a wall top connected to reachable stairs.', true); return false; }
    if (this.villagers().some(o => o !== v && o.post?.tx === q.tx && o.post?.ty === q.ty)) { this.event('info', 'That post is already occupied.', true); return false; }
    v.post = q; v.order = null; this.equipSoldier(v, 'bow'); this.posting = null;
    this.event('soldier', `${v.name} is taking an archer post.`, true); return true;
  }
  // ---- the shaman wand: a squad and its orders ------------------------------------------------

  /** Everyone the wand can command: grown soldiers on their feet (gnomes forage; they don't fight). */
  fighters(): Villager[] { return this.villagers().filter((v) => this.commandable(v)); }
  commandable(v: Villager): boolean { return !v.dead && v.isAdult && v.role === 'soldier'; }
  /** Who an order goes to: the squad, or everyone when nobody is picked. */
  recipients(): Villager[] { return this.squad.length ? this.squad.filter((v) => this.commandable(v)) : this.fighters(); }
  selectSquad(list: Villager[], add = false): void {
    const picked = list.filter((v) => this.commandable(v));
    if (add) for (const v of picked) { const i = this.squad.indexOf(v); if (i >= 0) this.squad.splice(i, 1); else this.squad.push(v); }
    else this.squad = picked;
    // one fighter picked: the card shows them; a squad is described in the hint bar instead
    if (this.squad.length === 1) this.select(this.squad[0]);
  }
  /** Everyone standing inside a world-space box (any corner order). */
  selectBox(x0: number, y0: number, x1: number, y1: number, add = false): void {
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    this.selectSquad(this.fighters().filter((v) => !v.hidden && v.x >= l && v.x <= r && v.y >= t && v.y <= b), add);
  }
  clearSquad(): void { this.squad = []; }
  private giveOrder(v: Villager, order: Order | null): void { v.order = order; v.post = null; v.clearGoal(); }
  private wandFx(x: number, y: number, text: string): void {
    this.fx.push({ kind: 'deposit', x, y, text, colour: '#78d8f0' });
    this.fx.push({ kind: 'cast', who: this.player });
  }
  /** Send the squad to a spot: one free tile each, the spot first, then the ring around it. */
  orderHold(tx: number, ty: number): Villager[] {
    const who = this.recipients();
    if (!who.length) return who;
    const w = this.world, free = (q: TilePos) => w.inBounds(q.tx, q.ty) && !w.isBlocked(q.tx, q.ty);
    const spots: TilePos[] = [];
    for (let r = 0; spots.length < who.length && r <= ORDER.spread + Math.ceil(who.length / 8); r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const q = { tx: tx + dx, ty: ty + dy };
        if (free(q) && !spots.some((o) => o.tx === q.tx && o.ty === q.ty)) spots.push(q);
      }
    if (!spots.length) { this.event('info', 'Nowhere to stand there.'); return []; }
    // nearest fighter takes the centre, and so on outward
    const sorted = [...who].sort((a, b) => a.dist(World.center(tx, ty)) - b.dist(World.center(tx, ty)));
    sorted.forEach((v, i) => this.giveOrder(v, { kind: 'hold', ...spots[Math.min(i, spots.length - 1)] }));
    this.wandFx((tx + 0.5) * TILE, ty * TILE, 'HOLD');
    return sorted;
  }
  orderAttack(m: Raider): Villager[] {
    const who = this.recipients();
    for (const v of who) this.giveOrder(v, { kind: 'attack', target: m });
    if (who.length) this.wandFx(m.x, m.y - 12, 'ATTACK');
    return who;
  }
  /** F with the wand: the squad shadows the head; pressed again, they hold where they stand. */
  orderFollow(): Villager[] {
    const who = this.recipients();
    const following = who.length > 0 && who.every((v) => v.order?.kind === 'follow');
    for (const v of who) this.giveOrder(v, following ? { kind: 'hold', ...v.tile } : { kind: 'follow' });
    if (who.length) this.wandFx(this.player.x, this.player.y - 14, following ? 'HOLD' : 'FOLLOW');
    return who;
  }
  /** Man the wall: the clicked battlement to the nearest fighter, the rest to free connected wall tops nearby. */
  orderPost(q: TilePos): Villager[] {
    const who = this.recipients();
    if (!who.length) return [];
    const taken = (t: TilePos) => this.villagers().some((o) => o.post?.tx === t.tx && o.post?.ty === t.ty);
    const tops = [...this.world.defenses.values()].filter((d) => d.kind === 'wall').sort((a, b) => Math.hypot(a.tx - q.tx, a.ty - q.ty) - Math.hypot(b.tx - q.tx, b.ty - q.ty));
    const sorted = [...who].sort((a, b) => a.dist(World.center(q.tx, q.ty)) - b.dist(World.center(q.tx, q.ty)));
    const posted: Villager[] = [];
    for (const v of sorted) {
      const spot = tops.find((t) => !taken(t) && !posted.some((o) => o.post?.tx === t.tx && o.post?.ty === t.ty) && this.reachableStairs(v, t));
      if (!spot) break;
      v.order = null; v.post = spot; v.clearGoal(); this.equipSoldier(v, 'bow'); posted.push(v);
    }
    if (!posted.length) this.event('info', 'No free battlement with connected stairs there.', true);
    else this.wandFx((q.tx + 0.5) * TILE, q.ty * TILE - WALL_HEIGHT, 'POST');
    return posted;
  }
  /** Back to patrol: no order, no post. */
  release(): void { for (const v of this.recipients()) this.giveOrder(v, null); }
  /** The wand's pointer: left picks (a click or a marquee), right orders; touch does both with one finger. */
  private wandDown(ptr: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]): void {
    const m = (objs[0]?.getData('agent') as Mover | undefined) ?? null;
    const touch = document.body.classList.contains('touch');
    if (ptr.rightButtonDown() || (touch && !(m instanceof Villager && this.commandable(m)))) { this.wandOrder(ptr, m); return; }
    if (m instanceof Villager && this.commandable(m)) { this.selectSquad([m], (ptr.event as MouseEvent).shiftKey || touch); return; }
    this.drag = { x0: ptr.worldX, y0: ptr.worldY, x1: ptr.worldX, y1: ptr.worldY };
  }
  private wandUp(ptr: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const add = (ptr.event as MouseEvent).shiftKey;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 6) this.selectBox(d.x0, d.y0, d.x1, d.y1, add);
    else if (!add) this.clearSquad();
  }
  /** What the right button means: a raider = attack, a wall top = post, anywhere else = hold there. */
  private wandOrder(ptr: { worldX: number; worldY: number }, m: Mover | null): void {
    if (m instanceof Raider && !m.dead) { this.orderAttack(m); return; }
    const top = World.toTile(ptr.worldX, ptr.worldY + WALL_HEIGHT);
    if (this.world.get(top.tx, top.ty)?.defense?.kind === 'wall') { this.orderPost(top); return; }
    const q = World.toTile(ptr.worldX, ptr.worldY);
    const spot = !this.world.isBlocked(q.tx, q.ty) ? q : this.world.nearest(ptr.worldX, ptr.worldY, (_t, tx, ty) => !this.world.isBlocked(tx, ty));
    if (spot) this.orderHold(spot.tx, spot.ty);
  }

  rescueFallenGuards(): void {
    for (const m of this.agents as Mover[]) if (m.elevated && !this.world.get(m.tile.tx, m.tile.ty)?.defense) {
      const q = this.world.nearest(m.x, m.y, (_t, tx, ty) => !this.world.isBlocked(tx, ty));
      if (q) { Object.assign(m, World.center(q.tx, q.ty)); m.elevated = false; m.clearGoal(); if (m instanceof Villager) m.post = null; }
    }
  }
  /** Where a wall/gate/stairs would go: the pointed-at tile (walls are placed where you point, even behind other walls), else the tile ahead. */
  defenseTarget(): TilePos {
    return this.hoverTile ?? this.player.faced;
  }
  /** Why a defense can't be built at `q` right now, or null. */
  defenseProblem(kind: DefenseKind, q: TilePos): string | null {
    const t = this.player.tile, cost = this.defenseCost(kind);
    if (Math.max(Math.abs(q.tx - t.tx), Math.abs(q.ty - t.ty)) > VillageScene.BUILD_REACH) return `Too far — build within ${VillageScene.BUILD_REACH} tiles of you`;
    if (this.wood < cost) return `Need ${cost} wood for construction`;
    const tile = this.world.get(q.tx, q.ty);
    if (tile?.defense) return `There is already a ${tile.defense.kind} here`;
    if (!BUILDABLE.has(tile?.kind ?? 'tree')) return 'Clear trees and crops before building defenses';
    if (this.world.buildings.some(b => { const d = doorstep(b); return d.tx === q.tx && d.ty === q.ty; })) return 'Leave the doorway clear';
    if ((this.agents as Mover[]).some(m => !m.hidden && !m.dead && m.tile.tx === q.tx && m.tile.ty === q.ty)) return 'Place the wall beside people, not beneath them';
    return null;
  }
  buildDefense(kind: DefenseKind): void {
    const q = this.defenseTarget(), cost = this.defenseCost(kind);
    const why = this.defenseProblem(kind, q);
    if (why) { this.event('build', why + '.'); return; }
    if (this.world.placeDefense(kind, q.tx, q.ty)) { this.wood -= cost; this.fx.push({ kind: 'tool', tool: 'hammer', ...q }); }
  }
  /** Context action: use a nearby doorway, stairs, or gate. Both mouse and touch use this path. */
  checkNearby(point?: TilePos): boolean {
    if (this.screen !== 'playing') return false;
    if (this.interior.active) { this.interior.act(); return true; }
    const pl = this.player;
    const q = point ?? this.target;
    const d = this.world.get(q.tx, q.ty)?.defense ?? this.world.get(pl.tile.tx, pl.tile.ty)?.defense;
    if (d && pl.dist(World.center(d.tx, d.ty)) < 28) {
      if (d.kind === 'stairs') { Object.assign(pl, World.center(d.tx, d.ty)); pl.elevated = !pl.elevated; pl.clearGoal(); return true; }
      if (d.kind === 'gate' && !pl.elevated) { this.world.setGateOpen(d, !d.open); this.event('build', d.open ? 'Gate open to everyone — enemies can enter.' : 'Gate guarded — allies can pass, enemies must break it.'); return true; }
    }
    return false;
  }

  /** The building whose doorstep the player is standing on, if any (entered by walking up into the door). */
  doorAt(): Building | null {
    const pt = this.player.tile;
    return this.world.buildings.find((b) => {
      if (!hasInterior(b.kind) || b.ruined) return false; // a ruin has no door to push
      const d = doorstep(b);
      return d.tx === pt.tx && d.ty === pt.ty;
    }) ?? null;
  }
  /** seconds the player has been pushing up into a door */
  doorT = 0;
  /**
   * Walking up into a door enters the building: you have to be on its doorstep, facing the
   * door, and hold up for a beat (so brushing past a house never drops you inside).
   */
  pushDoor(dt: number, pushingUp: boolean): void {
    if (this.player.elevated) { this.doorT = 0; return; }
    const b = pushingUp ? this.doorAt() : null;
    if (!b) { this.doorT = 0; return; }
    this.doorT += dt;
    if (this.doorT >= 0.15) { this.doorT = 0; this.interior.enter(b); }
  }

  /** How far from the player the mouse can place a building, in tiles. */
  static readonly BUILD_REACH = 6;

  /**
   * Top-left of the footprint a new building would take. With a mouse nearby, the footprint
   * follows the pointer (the hovered tile becomes the door tile). Otherwise it sits one whole
   * tile in front of the player's own tile, so the player can never be inside it.
   */
  buildAnchor(kind: BuildingKind = this.player.build === 'none' ? 'house' : this.player.build): { tx: number; ty: number } {
    const { w, h, door } = BUILDINGS[kind];
    const pt = this.player.tile, d = this.player.facing;
    const hv = this.hoverTile;
    if (hv && Math.max(Math.abs(hv.tx - pt.tx), Math.abs(hv.ty - pt.ty)) <= VillageScene.BUILD_REACH) {
      return { tx: hv.tx - door, ty: hv.ty - h + 1 }; // door on the hovered tile
    }
    const half = Math.floor(w / 2) - 1;
    if (d.y > 0) return { tx: pt.tx - half, ty: pt.ty + 1 };
    if (d.y < 0) return { tx: pt.tx - half, ty: pt.ty - h };
    if (d.x > 0) return { tx: pt.tx + 1, ty: pt.ty - half };
    return { tx: pt.tx - w, ty: pt.ty - half };
  }
  /** Is the current build anchor following the mouse (vs. sitting in front of the player)? */
  get cursorPlacing(): boolean {
    const hv = this.hoverTile, pt = this.player.tile;
    return !!hv && Math.max(Math.abs(hv.tx - pt.tx), Math.abs(hv.ty - pt.ty)) <= VillageScene.BUILD_REACH;
  }

  /** Why a building can't go at `a`, or null if it can. */
  buildProblem(a: { tx: number; ty: number }, kind: BuildingKind = this.player.build === 'none' ? 'house' : this.player.build): string | null {
    const { w, h } = BUILDINGS[kind];
    const locked = this.toolLocked(kind as Tool);
    if (locked) return locked;
    if (!this.world.canBuild(kind, a.tx, a.ty)) return `Need ${w}x${h} of open ground (no trees, crops or buildings)`;
    if (this.agents.some((m) => m instanceof Raider && !m.dead && this.insideFootprint(m, a, kind))) return 'A raider is in the way';
    return null;
  }
  private insideFootprint(m: Mover, a: { tx: number; ty: number }, kind: BuildingKind): boolean {
    const { w, h } = BUILDINGS[kind];
    return !m.hidden && m.x >= a.tx * TILE && m.x < (a.tx + w) * TILE && m.y >= a.ty * TILE && m.y < (a.ty + h) * TILE;
  }
  /** After a building goes up, anyone standing in it (you included) steps out onto the doorstep. */
  private stepOut(b: Building): void {
    const d = doorstep(b), c = World.center(d.tx, d.ty);
    for (const m of this.agents as Mover[]) {
      if (m instanceof Raider || !this.insideFootprint(m, b, b.kind)) continue;
      m.x = c.x; m.y = c.y; m.vx = m.vy = 0;
      m.clearGoal();
    }
  }

  // ---- groves: trees shelter each other and age into old growth ------------------------------

  /** A tree's daily chance to seed a neighbour: lone trees barely spread, a grove spreads fast. */
  seedChance(tx: number, ty: number): number {
    return (SEED_BASE + SEED_PER_NEIGHBOUR * Math.min(4, this.world.treeNeighbours(tx, ty))) * this.mods.seedMul;
  }
  /** Days a sapling at (tx, ty) needs: quicker with two or more trees around it. */
  saplingDays(tx: number, ty: number): number {
    return this.world.treeNeighbours(tx, ty) >= 2 ? Math.max(1, SHELTERED_SAPLING_DAYS + this.mods.shelteredDaysDelta) : SAPLING_DAYS;
  }
  /** Days a tree takes to become old growth (Old Growth boon shortens it). */
  get oldGrowthDays(): number { return Math.max(1, OLD_GROWTH_DAYS + this.mods.oldGrowthDaysDelta); }
  isOldGrowth(t: Tile): boolean { return t.kind === 'tree' && t.stage >= this.oldGrowthDays; }
  /** Wood a tree pays when felled. */
  treeYield(t: Tile): number { return (this.isOldGrowth(t) ? p.oldYield + this.mods.oldYieldBonus : p.treeYield) + this.mods.treeYieldBonus; }

  /** Is (tx, ty) within `pad` tiles of any building footprint (including its yard)? */
  nearBuilding(tx: number, ty: number, pad: number): boolean {
    return this.world.buildings.some((b) => {
      const f = BUILDINGS[b.kind];
      return tx >= b.tx - pad && tx < b.tx + f.w + pad && ty >= b.ty - pad && ty < b.ty + f.h + 1 + pad;
    });
  }

  /** How far from the player's tile the mouse can aim a tool (Chebyshev), in tiles. */
  static readonly TOOL_REACH = 1;
  /** Is the mouse aiming the tool (hovering a tile within reach)? */
  get cursorAiming(): boolean {
    const hv = this.hoverTile, pt = this.player.tile;
    const reach = this.player.tool === 'basket' ? p.tossRange : VillageScene.TOOL_REACH;
    return !!hv && Math.max(Math.abs(hv.tx - pt.tx), Math.abs(hv.ty - pt.ty)) <= reach;
  }
  /** The tile a tool acts on: the hovered tile when it's next to you (mouse), else the tile you face. */
  get target(): TilePos {
    return this.cursorAiming ? this.hoverTile! : this.player.faced;
  }
  /** flatten-in-progress bookkeeping: the tile being hammered/flattened resets when you move on */
  private workTile: TilePos | null = null;
  private workOn(tx: number, ty: number): void {
    if (this.workTile && (this.workTile.tx !== tx || this.workTile.ty !== ty)) {
      const prev = this.world.get(this.workTile.tx, this.workTile.ty);
      if (prev && (prev.kind === 'tilled' || prev.building || prev.defense)) { prev.work = 0; this.world.markDirty(this.workTile.tx, this.workTile.ty); }
    }
    this.workTile = { tx, ty };
  }

  /** The building in front of the player (or under the mouse when aiming), if any. */
  facedBuilding(): Building | null {
    const t = this.world.get(this.target.tx, this.target.ty);
    return t?.building ?? null;
  }

  /** Space: a dodge roll, whatever tool is held — it is movement, not a weapon. */
  dodge(): void {
    if (this.screen !== 'playing' || this.interior.active) return;
    const r = this.player.pressRoll();
    if (r) this.fx.push({ kind: 'roll', who: this.player, ux: r.ux, uy: r.uy, ms: p.rollTime * 1000 });
  }

  /** Use the equipped tool on the faced tile (or swing the sword). */
  interact(): void {
    if (this.screen !== 'playing') return;
    this.validateTool();
    if (this.interior.active) { this.interior.act(); return; }
    const pl = this.player;
    if (pl.busy > 0) return;
    if (pl.tool === 'hands' && this.checkNearby()) return;
    if (pl.elevated && pl.tool !== 'bow' && pl.tool !== 'sword' && pl.tool !== 'hands') { this.event('info', 'Use the stairs to return to ground level first.'); return; }
    const { tx, ty } = this.target;
    const t = this.world.get(tx, ty);
    if (pl.tool !== 'sword') this.workOn(tx, ty); // acting elsewhere abandons a half-done flatten / upgrade

    switch (pl.tool) {
      case 'bow': {
        if (pl.attackCd > 0) return;
        const aim = this.bowAim();
        const auto = !aim ? this.bestTarget(pl.x, pl.y, 165) : null;
        this.shoot(pl, aim ? aim.x - pl.x : auto ? auto.x - pl.x : pl.facing.x, aim ? aim.y - pl.y : auto ? auto.y - pl.y : pl.facing.y, Math.round(14 * weaponMul(pl.weapons, 'bow') * this.mods.playerDmgMul * this.buffMul('dmg')));
        return;
      }
      case 'wall': case 'gate': case 'stairs': this.buildDefense(pl.tool); return;
      case 'pen': {
        if (this.world.paintPen(tx, ty, pl.penKind)) this.fx.push({ kind: 'tool', tool: 'hoe', tx, ty });
        else this.event('build', 'Pens go on open grass or soil');
        return;
      }
      case 'basket': this.toss(); return;
      case 'sword': {
        const stage = pl.pressAttack();
        if (stage >= 0) this.fx.push({ kind: 'swing', who: pl, dx: pl.facing.x, dy: pl.facing.y, stage });
        return;
      }
      case 'house':
      case 'tavern':
      case 'gnomehouse':
      case 'barracks': {
        const a = this.buildAnchor(pl.tool);
        const why = this.buildProblem(a, pl.tool);
        if (why) { this.event('build', why); return; }
        if (this.wood < this.buildCost(pl.tool)) { this.event('build', `Need ${this.buildCost(pl.tool)} wood for a ${BUILDINGS[pl.tool].name.toLowerCase()}`); return; }
        this.wood -= this.buildCost(pl.tool);
        const b = this.world.place(pl.tool, a.tx, a.ty);
        this.stepOut(b);
        if (b.kind === 'gnomehouse') this.foundGnomes(b);
        this.fx.push({ kind: 'tool', tool: 'hammer', tx: a.tx + 1, ty: a.ty + BUILDINGS[pl.tool].h - 1 });
        this.event('build', `Built a ${BUILDINGS[pl.tool].name.toLowerCase()}`, true);
        return;
      }
      case 'hammer': {
        if (t?.defense) {
          this.fx.push({ kind: 'tool', tool: 'hammer', tx, ty });
          // a hurt wall is mended; a sound one is taken down after a few more blows (half its cost back)
          if (t.defense.hp < t.defense.maxHp) { if (this.wood < 1) return; this.wood--; t.defense.hp = Math.min(t.defense.maxHp, t.defense.hp + p.wallRepair); return; }
          if (++t.work < DISMANTLE.hits) return;
          const refund = Math.round(this.defenseCost(t.kind as DefenseKind) * DISMANTLE.refund), name = t.kind;
          this.world.damageDefense(t.defense, Infinity); this.rescueFallenGuards();
          this.wood += refund; this.event('build', `Took down the ${name}${refund ? ` — ${refund} wood recovered` : ''}`);
          return;
        }
        const b = this.facedBuilding();
        this.fx.push({ kind: 'tool', tool: 'hammer', tx, ty });
        if (!b || !t) return;
        // a hurt building is mended before it is improved
        if (b.kind !== 'lair' && (b.ruined || b.hp < b.maxHp)) { this.repairBuilding(b); return; }
        const why = this.upgradeProblem(b);
        if (why) { this.event('build', why); return; }
        if (++t.work >= this.workHits(this.mods.hammerHits)) { t.work = 0; this.upgrade(b); }
        return;
      }
      case 'hoe':
        if (t?.kind === 'grass') this.world.set(tx, ty, 'tilled');
        else if (t?.kind === 'sapling') this.world.set(tx, ty, 'grass'); // dig out a stump
        else if (t?.kind === 'tilled') { // flattening soil is deliberate: three hits on the same tile
          if (++t.work >= this.workHits(3)) this.world.set(tx, ty, 'grass');
        }
        this.fx.push({ kind: 'tool', tool: 'hoe', tx, ty });
        return;
      case 'seeds':
        if (t?.kind === 'tilled') { this.world.sow(tx, ty, pl.cropKind); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        else if (t?.kind === 'grass') { this.world.set(tx, ty, 'sapling'); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        return;
      case 'axe':
        if (t?.kind === 'tree') {
          const why = this.loadProblem('wood', undefined, p.playerTreeYield);
          if (why) { this.event('wood', why + '.'); return; }
          // the head clears ground; the real wood comes in on woodcutters' backs
          if (++t.work >= this.workHits(3)) { this.knockDownHive(tx, ty, this.player); this.world.set(tx, ty, 'sapling'); this.player.pickUp('wood', p.playerTreeYield); }
          else this.world.dirty.add(ty * COLS + tx);
        } else if (t?.kind === 'sapling') this.world.set(tx, ty, 'grass'); // clear the stump
        this.fx.push({ kind: 'tool', tool: 'axe', tx, ty });
        return;
      case 'hands':
        if (t && this.isRipe(t)) {
          const kind = t.food ?? 'wheat', why = this.loadProblem('food', kind, this.cropYieldOf(kind));
          if (why) { this.event('food', why + '.'); return; }
          this.world.set(tx, ty, 'tilled'); this.player.pickUp('food', this.cropYieldOf(kind), kind); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty });
        } else if (t && WILD_FOOD[t.kind]) {
          // foraging: a ripe bush or patch gives its yield and starts regrowing
          const kind = WILD_FOOD[t.kind]!;
          if (!this.wildRipe(t)) { this.event('food', `Nothing to pick yet — ${FOODS[kind].name.toLowerCase()} in ${this.regrowDays(kind) - t.stage} day${this.regrowDays(kind) - t.stage === 1 ? '' : 's'}`); return; }
          const why = this.loadProblem('food', kind);
          if (why) { this.event('food', why + '.'); return; }
          const got = this.pickWild(tx, ty, Math.min(this.wildLeft(t), pl.roomFor('food', kind)));
          this.player.pickUp('food', got, kind); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty });
        }
        return;
    }
  }

  /** What the tool would do right now, as "E: verb" (or a reason it won't). */
  /** "carrying 8 wood — walk up to the woodyard to unload", shown while the head holds something. */
  carryHint(): string | null {
    return this.player.pack.bulk().length ? 'Pack supplies: food → granary · wood/scrap → woodyard · G throws largest stack' : null;
  }
  hint(): string {
    if (this.interior.active) return this.interior.hint();
    const door = this.doorAt();
    if (door && !this.player.elevated) return `▲ walk up into the door to enter ${BUILDINGS[door.kind].name}`;
    if (this.posting) return `Pick a connected battlement for ${this.posting.name} (or cancel in their card)`;
    const pl = this.player;
    const tg = this.target;
    const t = this.world.get(tg.tx, tg.ty);
    const kind = t?.kind;
    const need = (tool: string) => `need the ${tool}`;
    const b = t?.building;
    if (b && pl.tool !== 'hammer' && pl.tool !== 'sword' && pl.tool !== 'wand') return `${this.buildingTitle(b)} — ${this.buildingBlurb(b)}`;
    switch (pl.tool) {
      case 'bow': return `E: shoot arrow (${this.arrows} left · craft 10 for 2 wood in the barracks)`;
      case 'wall': case 'gate': case 'stairs': {
        const why = this.defenseProblem(pl.tool, this.defenseTarget());
        if (why) return `${pl.tool}: ${why}`;
        return `E: build ${pl.tool} (${this.defenseCost(pl.tool)} wood construction) · ${pl.tool === 'stairs' ? 'connect to a wall; hands to climb' : pl.tool === 'gate' ? 'allies pass; X opens to everyone' : 'point where it goes — walls stand behind walls too'}`;
      }
      case 'sword': {
        const near = this.nearestRaider(pl.x, pl.y, 40);
        if (near) return 'E: attack!';
        const game = this.nearestRaider(pl.x, pl.y, 40, true);
        if (game?.wild && !game.lurking) return game instanceof Boar
          ? `E: strike the ${game.name.toLowerCase()} — it and its sounder will charge you (${game.meat} meat)`
          : `E: attack the ${game.name.toLowerCase()} (${game instanceof Troll ? game.meat : 0} meat)`;
        return t?.tall ? 'E: mow the long grass (a swing clears its arc)' : 'E: swing sword';
      }
      case 'pen': {
        const r = this.penReport(pl.penKind), where = t?.pen ? (t.pen === pl.penKind ? 'E: erase' : `E: repaint as ${PEN_NAME[pl.penKind]}`) : `E: paint ${PEN_NAME[pl.penKind]}`;
        return `${where} · F: next pen kind · ${r.kids} training here, ${r.piles || 'nothing'} on the ground`;
      }
      case 'wand': {
        const n = this.squad.length, all = this.fighters().length;
        if (!all) return 'wand: nobody to command — grown soldiers answer it';
        return `${n ? `${n} picked` : `no one picked — orders go to all ${all}`} · left click / drag: pick soldiers · right click: ground = hold there, raider = attack, wall top = archer post · F: follow me`;
      }
      case 'basket': {
        const why = this.tossProblem();
        const carry = `basket: ${pl.carriedOf('food', pl.basketKind)} ${FOODS[pl.basketKind].one} · F: change food`;
        if (why) return `${carry} — ${why}`;
        const aim = this.tossAim, pen = this.world.get(Math.floor(aim.x / TILE), Math.floor(aim.y / TILE))?.pen;
        const yard = !pen ? this.world.gnomeHouses.find((b) => { const c = buildingCenter(b); return Math.hypot(c.tx * TILE - aim.x, c.ty * TILE - aim.y) <= GNOME_YARD * TILE; }) : undefined;
        if (yard) { const kids = this.villagers().filter((v) => v.role === 'kid' && v.home === yard && !v.dead); return `E: throw ${Math.min(pl.carriedOf('food', pl.basketKind), p.tossSize)} ${FOODS[pl.basketKind].one} by the gnome house (${carry} · ${kids.length} children, ${kids.filter((v) => v.hungerDays > 0 || v.task.startsWith('hungry')).length} hungry · ${this.world.yardFoodTotal(yard, GNOME_YARD) || 'nothing'} lying there)`; }
        if (!pen) return `E: throw ${Math.min(pl.carriedOf('food', pl.basketKind), p.tossSize)} ${FOODS[pl.basketKind].one} — no pen there: children only eat what lies inside their pen or by a gnome house (${carry})`;
        const r = this.penReport(pen);
        return `E: throw ${Math.min(pl.carriedOf('food', pl.basketKind), p.tossSize)} ${FOODS[pl.basketKind].one} toward the ${PEN_NAME[pen]} (${carry} · ${r.kids} children, ${r.hungry} hungry · ${r.piles || 'nothing'} lying there)`;
      }
      case 'house':
      case 'tavern':
      case 'gnomehouse':
      case 'barracks': {
        const why = this.buildProblem(this.buildAnchor(pl.tool), pl.tool);
        return `E: build ${BUILDINGS[pl.tool].name.toLowerCase()} ${this.cursorPlacing ? 'where you point' : 'ahead'} (${this.buildCost(pl.tool)} wood)${pl.tool === 'barracks' ? ' · the ring is its arrow range' : pl.tool === 'gnomehouse' ? ' · a gnome couple moves in' : ''}${why ? ' — ' + why : ''}`;
      }
      case 'hammer': {
        if (t?.defense) return t.defense.hp < t.defense.maxHp ? `E: repair ${t.kind} (${Math.ceil(t.defense.hp)}/${t.defense.maxHp} HP · 1 wood repairs ${p.wallRepair})` : `E: take down ${t.kind} (${DISMANTLE.hits - t.work} more hits · ${Math.round(this.defenseCost(t.kind as DefenseKind) * DISMANTLE.refund)} wood back)`;
        if (!b) return 'hammer: face a building to upgrade it';
        if (b.kind !== 'lair' && b.ruined) { const why = this.repairProblem(b); return why ? `${this.buildingTitle(b)} — ${why}` : `E: rebuild ${BUILDINGS[b.kind].name} (${this.rebuildCost(b)} wood)`; }
        if (b.kind !== 'lair' && b.hp < b.maxHp) return `E: repair ${BUILDINGS[b.kind].name} (${Math.ceil(b.hp)}/${b.maxHp} HP · 1 wood repairs ${REPAIR.perWood})`;
        const why = this.upgradeProblem(b);
        return why ? `${this.buildingTitle(b)} — ${why}` : `E: upgrade ${BUILDINGS[b.kind].name} → Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} (${this.upgradeCost(b)} wood, ${this.mods.hammerHits - (t?.work ?? 0)} hits)`;
      }
      case 'hoe':
        if (kind === 'grass') return 'E: till soil';
        if (kind === 'sapling') return t!.stage < 2 ? 'E: dig out the stump' : 'E: clear the sapling';
        if (kind === 'tilled') return `E: flatten back to grass (${t!.work}/3 — hit it three times)`;
        if (kind === 'crop') return this.isRipe(t!) ? `ripe ${FOODS[t!.food ?? 'wheat'].name.toLowerCase()} — ${need('hands')}` : `${FOODS[t!.food ?? 'wheat'].name.toLowerCase()} growing (${t!.stage}/${this.cropDaysOf(t!)} days) — harvest with hands`;
        if (kind === 'tree') return `tree — ${need('axe')}`;
        return 'hoe: face open grass';
      case 'seeds':
        if (kind === 'tilled') return `E: sow ${FOODS[pl.cropKind].name.toLowerCase()} (${FOODS[pl.cropKind].blurb}) · F: next crop${t!.food && t!.food !== pl.cropKind ? ` · farmers would replant ${FOODS[t!.food].name.toLowerCase()} here` : ''}`;
        if (kind === 'grass') return `E: plant a tree (grows in ${this.saplingDays(tg.tx, tg.ty)} days${this.world.treeNeighbours(tg.tx, tg.ty) >= 2 ? ', sheltered' : ''})`;
        if (kind === 'sapling') return `sapling — a tree in ${this.saplingDays(tg.tx, tg.ty) - t!.stage} days`;
        if (kind === 'crop') return this.isRipe(t!) ? `ripe ${FOODS[t!.food ?? 'wheat'].name.toLowerCase()} — ${need('hands')}` : `${FOODS[t!.food ?? 'wheat'].name.toLowerCase()} growing (${t!.stage}/${this.cropDaysOf(t!)} days)`;
        return `seeds: ${FOODS[pl.cropKind].name.toLowerCase()} on soil, trees on grass · F: next crop`;
      case 'axe':
        if (kind === 'tree') { const why = this.loadProblem('wood', undefined, p.playerTreeYield); return why ?? `E: clear ${this.isOldGrowth(t!) ? 'old growth' : 'young tree'}${this.world.hiveAt(tg.tx, tg.ty) ? ' — A HIVE HANGS HERE' : ''} (${t!.work}/3 · ${p.playerTreeYield} wood for you; a woodcutter gets ${this.treeYield(t!)}) · ${pl.carriedOf('wood')} wood in pack`; }
        if (kind === 'sapling') return t!.stage < 2 ? 'E: clear the stump' : 'E: cut down the sapling';
        return 'axe: face a tree';
      case 'hands':
        if (t?.defense?.kind === 'stairs' || this.world.get(pl.tile.tx, pl.tile.ty)?.kind === 'stairs') return `E: ${pl.elevated ? 'descend' : 'climb'} stairs`;
        if (t?.defense?.kind === 'gate') return `E: ${t.defense.open ? 'close' : 'open'} gate`;
        if (kind === 'crop') { const fk = t!.food ?? 'wheat', why = this.loadProblem('food', fk, this.cropYieldOf(fk)); return this.isRipe(t!) ? (why ?? `E: harvest ${FOODS[fk].name.toLowerCase()} (${this.cropYieldOf(fk)}) · ${pl.carriedOf('food',fk)} in pack`) : `${FOODS[fk].name.toLowerCase()} growing (${t!.stage}/${this.cropDaysOf(t!)} days)`; }
        if (kind && WILD_FOOD[kind]) { const fk = WILD_FOOD[kind]!, why = this.loadProblem('food', fk); return this.wildRipe(t!) ? (why ?? `E: pick ${FOODS[fk].name.toLowerCase()} (${this.wildLeft(t!)} · ${FOODS[fk].blurb})`) : `${FOODS[fk].name.toLowerCase()} picked — back in ${this.regrowDays(fk) - t!.stage} day${this.regrowDays(fk) - t!.stage === 1 ? '' : 's'}`; }
        if (kind === 'grass') return t!.tall ? `long grass — slows everyone to ${Math.round(p.grassSlow * 100)}% · ${need('sword')} to mow it` : `grass — ${need('hoe')} to till`;
        if (kind === 'tilled') return `tilled — ${need('seeds')}`;
        if (kind === 'tree') return `tree — ${need('axe')}`;
        if (kind === 'sapling') return `sapling — a tree in ${this.saplingDays(tg.tx, tg.ty) - t!.stage} days`;
        { const on = this.itemsBlurb(tg.tx, tg.ty); if (on) return `${on} on the ground — walk over it to pick it up`; }
        return 'hands: harvest ripe crops, pick berries and mushrooms; walk over dropped things to pick them up';
    }
  }

  // ---- rendering ------------------------------------------------------------

  draw(): void {
    if (this.cameraZoomSetting !== p.cameraZoom) {
      this.cameraZoomSetting = p.cameraZoom;
      this.zoomChoice = null;
      this.fitCamera();
    }
    const dt = this.game.loop.delta / 1000;
    if (this.following) {
      const cam = this.cameras.main;
      const k = Math.min(1, dt * 8);
      cam.centerOn(cam.midPoint.x + (this.player.x - cam.midPoint.x) * k, cam.midPoint.y + (this.player.y - (this.player.elevated ? WALL_HEIGHT : 0) - cam.midPoint.y) * k);
    }
    if (this.player.tool === 'bow') {
      const aim = this.bowAim();
      if (aim) {
        const dx = aim.x - this.player.x, dy = aim.y - this.player.y;
        const length = Math.hypot(dx, dy);
        if (length > 0.001) {
          this.player.aim = { x: dx / length, y: dy / length };
          if (dx !== 0) this.player.dir = dx < 0 ? -1 : 1;
        }
      }
    }
    this.view?.sync(dt);
    this.ui?.render(dt);
    this.interior.draw();
  }
}

// Decide the touch layout before Phaser measures its parent (the side panel becomes a drawer).
const query = new URLSearchParams(location.search);
if (matchMedia('(pointer: coarse)').matches || query.has('touch')) document.body.classList.add('touch');

// Dev starts, so a link is enough: ?start=gnome and ?peaceful set the debug sliders before the first setup().
if (query.get('start') === 'gnome') p.gnomeStart = true;
if (query.has('peaceful')) p.peaceful = true;
if (query.has('nohunger')) p.hunger = false;
// lil-gui caches its controllers' values at module load, so the panel needs telling the flag moved.
if (p.gnomeStart || p.peaceful || query.has('nohunger')) getGui().controllersRecursive().forEach((c) => c.updateDisplay());

launch(VillageScene, { width: COLS * TILE, height: ROWS * TILE, zoom: ZOOM, scale: 'resize', pixelArt: true, background: '#1a2a1c' });
