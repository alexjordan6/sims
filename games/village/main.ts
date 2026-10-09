import { STACK, SKULK, STASH_SLOTS, FOUND_TIER, BANDAGE, UNIT, type BulkKind, type UnitBranch } from './config';
import { enemyDrop, rollLoot, danger } from './loot';
import { Caravan } from './caravan';
import { isImplement, IMPLEMENTS, START_TOOLS, LOST_TOOLS, type Implement, TOOL_NAME, Pack, type Gear, type EquipmentSlot, isBulk, slotName } from './pack';
import Phaser from 'phaser';
import { SimScene, launch, button, getGui, Rng } from '@shared/index';
import { launch as throwItem, type Item } from './items';
import { World, WILD_FOOD, doorstep, buildingCenter, buildingMaxHp, hasHearth, hearthCost, BUILDINGS, MAX_LEVEL, BUILDABLE, type DefenseKind, type Building, type BuildingKind, type Tile, type TilePos, type Hive, type Chest, type Ruin, isGearChest } from './world';
import { Villager, Raider, Player, Mover, Arrow, TOOLS, BELT, BUILDS, SWING, type Role, type Tool, type Order } from './agents';
import { DEFENSE_COST, WALL_HEIGHT, WARREN, SOLDIER_CAP_PER_LEVEL, MAP_AREA, PLAINS } from './config';
import { Interior } from './interior';
import { Rat, Snatcher, Brute, Shaman, Ogre, Wrecker, Bolt, Troll, Skulk } from './enemies';
import { Boar, Swarm, type Sounder } from './wildlife';
import { Fog } from './fog';
import { p, TILE, COLS, ROWS, ZOOM, COST, BOAR, RUN, SAPLING_DAYS, SEED_BASE, SEED_PER_NEIGHBOUR, SHELTERED_SAPLING_DAYS, OLD_GROWTH_DAYS, CAPS, UPGRADE_COST, GNOME_BEDS, YARD, ORDER, LEVEL_PERKS, CALLING_NAME, CALLINGS, MOODS, SERVE_RANGE, TROLL, HIVE, ITEM, FOODS, FOOD_KINDS, RAW_KINDS, DISHES, RECIPES, zeroFood, isDish, foodCount, hasInterior, type Recipe, type DishKind, DIET_STAT_NAME, type DietStat, type FoodKind, ARMOR, ARMOR_BARRACKS_LEVEL, SCRAP_DROP, DYES, PLUMES, TOWER, REPAIR, DISMANTLE, WEAPONS, type Calling, type ArmorSlot, type WeaponSlot } from './config';
import { Meta, type Mods, type RenownBreakdown } from './meta';
import { preloadArt } from './look';
import { ensureFlora, ensureBuildingArt } from './pixelart';
import { View } from './view3d/view';
import { UI } from './ui/ui';
import { weaponMul, reloadMul } from './characters';
import { AdaptiveSpawner } from './adaptive-spawn';
/** seconds of nobody falling before a fight is told; and how many fallen make it worth an alert */
const BATTLE_QUIET = 6;
const BATTLE_BIG = 20;
import { Host, hostSize, hostCounts, ASSAULT_RANGE, ROUT_SHARE, WARBAND_SIZE } from './host';
import { Regiment, Warband, WARBAND_COLOURS, REGIMENT_SIZE, BANNER_COLOURS, SHAPES, SHAPE_NAME, GROUP_NAME, ORDER_MENUS, weaponGroup, layout, type Shape, type Stance } from './regiment';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

export type EventKind = 'birth' | 'grow' | 'soldier' | 'raid' | 'death' | 'build' | 'info' | 'food' | 'wood';
export interface GameEvent { kind: EventKind; text: string; toast: boolean; day: number }
/** Things the sim reports for the renderer to animate; drained every frame. */
export type FxEvent =
  | { kind: 'hit'; attacker: Mover; target: Mover; dmg: number; crit: boolean; killed: boolean; streak?: number; ux?: number; uy?: number; push?: number }
  | { kind: 'telegraph'; who: Mover; ms: number }
  | { kind: 'miss'; who: Mover }
  | { kind: 'slowmo' }
  | { kind: 'tool'; tool: 'axe' | 'seed' | 'hammer'; tx: number; ty: number; who?: Mover }
  | { kind: 'death'; who: Mover; x: number; y: number }
  | { kind: 'boss'; who: Mover }
  | { kind: 'swing'; who: Mover; dx: number; dy: number; stage: number }
  | { kind: 'cast'; who: Mover }
  | { kind: 'impact'; x: number; y: number }
  | { kind: 'upgrade'; building: Building }
  | { kind: 'hearts'; who: Mover }
  | { kind: 'melee'; who: Mover; x: number; y: number }
  /** a pike thrust: the line it ran along, drawn as a streak */
  | { kind: 'thrust'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arrow'; who: Mover }
  /** a handful of food lobbed from the basket into a home's yard */
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

/** The head's standing order, MOBA style: walk somewhere, hunt something, go and use a thing, or go indoors. */
export type Command =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; target: Mover }
  | { kind: 'use'; q: TilePos; how: 'hands' | 'tool'; repeat: boolean }
  | { kind: 'enter'; b: Building }
  | { kind: 'loot'; chest: Chest };
/** the four abilities on Q W E R, aimed at the cursor */
export type AbilityKey = 'Q' | 'W' | 'E' | 'R';

/** A pointer on the 3D view: where on the ground it is (sim pixels), what it landed on, and the event. */
export interface Ptr {
  worldX: number; worldY: number;
  /** the person or beast under it, if any */
  agent: Mover | null;
  /** the wall, gate or stairs under it, if any (posting orders land on wall tops) */
  wallTile: TilePos | null;
  event: MouseEvent;
  rightButtonDown(): boolean;
}

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
  /** a building picked with X or a click */
  selectedBuilding: Building | null = null;
  /** the inspector can also show a tile (tree, plant, wall…) or a thing lying on the ground */
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
  /** standing order for the gnomes: at their head's heels (the default) or off foraging. Toggled by H, inherited by gnomes coming of age. */
  gnomesFollow = true;
  /** set when the run ends */
  result: { won: boolean; renown: RenownBreakdown } | null = null;

  private nameIdx = 0;
  private hovered: Mover | null = null;
  view?: View;
  private ui?: UI;
  /** WASD no longer steers (right-click does): the player reads keys that are never down */
  private wasd = { W: { isDown: false }, A: { isDown: false }, S: { isDown: false }, D: { isDown: false } };
  /** (the 2D camera follow; the 3D view does its own following) */
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
    this.battle = null;
    this.regiments = []; this.warbands = []; this.hosts = []; this.hostSeq = 0; this.awakeT = 0; this.regimentSeq = 0; this.placing = null; this.enlistT = 0; this.warrenBorn = this.warrenToddled = 0;
    this.arrows = 30; this.feverWas = null;
    this.scrap = 0;
    this.armoryFor = null;
    this.pouchOf = null;
    this.cookingAt = null;
    this.buff = null;
    this.mods = this.meta.mods();
    this.world = new World();
    this.world.generate(this.rng, this.seed);
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
    this.lobs = []; this.mealAim = false; this.mealCd = 0; this.mealPick = null;
    this.thicketRng = new Rng(this.seed ^ 0x7b1c0de);
    this.thornT = 0; this.thornWarned = -Infinity;
    this.spawnSounders();
    this.spawnTrolls();
    this.spawnCamps();
    this.placeHoard();
    this.ruinGuards.clear();
    this.spawnHives();
    this.lairFound = false;
    this.foundTools = new Set(START_TOOLS);
    this.gnomesFollow = true; // every run starts with them at your heels (reset() does not re-run the field initialiser)
    this.fog?.reset();
    this.chartHome();
    this.result = null;
    this.nameIdx = this.rng.int(0, NAMES.length - 1);

    const home = this.world.gnomeStart!;
    const door = doorstep(home);
    const c = World.center(door.tx, door.ty);
    this.player = this.spawn(new Player(c.x, c.y + TILE));
    this.player.keys = this.wasd;
    this.player.maxHp += this.mods.playerHpBonus;
    this.player.hp = this.player.maxHp;

    // the founders are young adults: a few days past coming of age, well short of growing old
    const grown = this.adultAge + 3;
    // The band: founders are spawned as written rather than drawn from the caps -- the caps gate births.
    for (let i = 0; i < p.startFarmers; i++) this.addVillager(home, 'farmer', grown);
    for (let i = 0; i < p.startWoodcutters; i++) this.addVillager(home, 'woodcutter', grown);
    // two banners from the first minute: a hedge of pikes (what little people with 14 HP fight behind), and a block of bows to stand behind it
    for (let i = 0; i < p.startPikemen; i++) this.addVillager(home, 'soldier', grown + 2).weapon = 'pike';
    for (let i = 0; i < p.startArchers; i++) this.addVillager(home, 'soldier', grown + 2).weapon = 'bow';
    const where = this.world.denseForests ? 'the deep woodland' : 'the open meadows';
    this.event('info', `A gnome band keeps house in ${where}, under two banners: ${p.startPikemen} pikes and ${p.startArchers} bows. Nobody comes this far out without a reason. Set the pikes where a raid will run onto them with the bows behind (F1-F4 give your formations their orders), forage what grows wild, and cook it in the great pot in the square. Ox caravans bring arrows and food up the south road.`);
    const lost = this.world.toolCaches.map((c) => `the ${c.tool} ${LOST_TOOLS[c.tool]} to the ${this.bearing(World.center(c.tx, c.ty).x, World.center(c.tx, c.ty).y)}`);
    if (lost.length) this.event('info', `In the flight you lost your tools: ${lost.join(', ')}. Go and fetch them — the hammer builds, the axe fells.`, true);
    if (p.thicketRing > 0 && this.world.thicketCount) this.event('info', 'A ring of thorns hems the village in. It was not here last spring. The trails still run through it, but it creeps closer every night — cut it back with the axe, or it will close the trails and take the fields.');
  }

  /** The ground out to the thorn ring starts charted, so you can see what hems you in. */
  private chartHome(): void {
    if (!this.fog || p.thicketRing <= 0) return;
    const r = 16 + p.thicketRing + 6;
    this.fog.chart(COLS / 2, ROWS / 2, r, r * 0.75);
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
    for (let k = 0; k < Math.round(BOAR.sounders * MAP_AREA); k++) {
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
  /** the raider camps out in the wild, and the day each was last cleared (null while anyone holds it) */
  camps: { x: number; y: number; members: Raider[]; cleared: number | null; born: number; war?: boolean; chest?: Chest }[] = [];
  /** loot's own stream off the seed, so stocking a chest never moves a camp or a raid */
  private lootRng = new Rng(1);
  private campRng = new Rng(1);
  /**
   * Camps: raiders who live out in the wild and guard their ground (Raider.camp). They are where the fighting
   * is between raids — you go to them, they do not come to you. Out of their own stream off the seed.
   */
  private spawnCamps(): void {
    this.camps = [];
    this.campRng = new Rng(this.seed ^ 0xca3b5);
    this.lootRng = new Rng(this.seed ^ 0x100750);
    for (let k = 0; k < Math.round(p.campCount * MAP_AREA); k++) this.foundCamp();
    // a war band on every open plain: the large map's set-piece battles, a block of raiders on open ground
    if (p.campCount > 0) for (const pl of this.world.plains) {
      const c = World.center(pl.tx, pl.ty);
      const camp = { x: c.x, y: c.y, members: [] as Raider[], cleared: null as number | null, born: this.day, war: true };
      this.camps.push(camp);
      this.manCamp(camp);
    }
  }
  /** Pick open, reachable ground in the wild for a new camp — outside the thorn ring, off the trails, clear of the lair, the gnome glade and other camps, and out of everyone's sight. */
  private campSpot(): TilePos | null {
    const rng = this.campRng, hx = COLS / 2, hy = ROWS / 2;
    for (let tries = 0; tries < 80; tries++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(32, 80 * Math.sqrt(MAP_AREA)); // the whole wild, however big the map
      const tx = Math.round(hx + Math.cos(a) * r), ty = Math.round(hy + Math.sin(a) * r * 0.7);
      const t = this.world.get(tx, ty);
      if (!t || t.trail || t.building || t.kind === 'thicket' || this.world.isBlocked(tx, ty, true)) continue;
      if (this.world.lair && Math.hypot(this.world.lair.tx - tx, this.world.lair.ty - ty) < 12) continue;
      if (this.world.toolCaches.some((q) => Math.hypot(q.tx - tx, q.ty - ty) < 10)) continue; // nobody camps on your lost tools
      if (this.camps.some((c) => Math.hypot(c.x / TILE - tx, c.y / TILE - ty) < 14)) continue;
      if (this.fog && this.fog.enabled && this.fog.visibleAt(tx * TILE, ty * TILE) > 0) continue; // a camp grows where nobody is looking
      if (!this.world.bfs({ tx, ty }, { tx: hx, ty: hy }, true).length) continue; // somewhere you can walk to
      return { tx, ty };
    }
    return null;
  }
  /** Raise a camp somewhere in the wild and man it. */
  private foundCamp(): void {
    const q = this.campSpot();
    if (!q) return;
    const c = World.center(q.tx, q.ty);
    const camp = { x: c.x, y: c.y, members: [] as Raider[], cleared: null as number | null, born: this.day };
    this.camps.push(camp);
    this.manCamp(camp);
  }
  /**
   * Fill a camp: two to four raiders (more as the days go on), some of them butchers or bone shamans. A war
   * band on a plain is a dozen or more, spread wider and guarding more ground — a battle, not a skirmish.
   */
  private manCamp(camp: { x: number; y: number; members: Raider[]; cleared: number | null; war?: boolean; chest?: Chest }): void {
    const rng = this.campRng, war = !!camp.war;
    const n = war ? Math.min(PLAINS.warband[1], PLAINS.warband[0] + rng.int(0, 3) + Math.floor(this.day / 3)) : Math.min(5, 2 + rng.int(0, 2) + Math.floor(this.day / 7));
    camp.members = [];
    for (let i = 0; i < n; i++) {
      const roll = rng.next(), opts = { hpMul: this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul };
      const a = rng.range(0, Math.PI * 2), d = rng.range(4, war ? 6 * TILE : 20);
      let x = camp.x + Math.cos(a) * d, y = camp.y + Math.sin(a) * d;
      const t = World.toTile(x, y);
      if (this.world.isBlocked(t.tx, t.ty, true)) { x = camp.x; y = camp.y; }
      const r = roll < 0.2 ? new Brute(x, y, opts) : roll < 0.38 ? new Shaman(x, y, opts) : new Raider(x, y, opts);
      r.camp = { x: camp.x, y: camp.y, aggro: p.campAggro * TILE * (war ? 1.5 : 1), leash: p.campLeash * TILE * (war ? 2 : 1) };
      r.lairBound = true; // camps never start, hold open or count toward a raid
      r.task = 'keeping watch over its camp';
      camp.members.push(this.spawn(r));
    }
    camp.cleared = null;
    this.stockCampChest(camp);
  }
  // ---- chests: what camps guard and the Ogre sleeps on; opened, they spill for the taking -------------

  /** A free, open tile near (tx, ty) for a chest: off buildings, walls and other chests. */
  private chestSpot(tx: number, ty: number, ring = 2): TilePos | null {
    for (let r = 1; r <= ring + 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = tx + dx, y = ty + dy, t = this.world.get(x, y);
      if (!t || t.building || t.defense || this.world.isBlocked(x, y, true)) continue;
      if (this.world.chests.some((c) => c.tx === x && c.ty === y)) continue;
      return { tx: x, ty: y };
    }
    return null;
  }
  /** Tiles from the village centre. */
  private tilesOut(tx: number, ty: number): number { const c = this.villageCentre(); return Math.hypot(tx - c.x / TILE, ty - c.y / TILE); }
  /** A camp's chest by its fire, stocked afresh each time the camp is manned: a war band's holds more and better. */
  private stockCampChest(camp: { x: number; y: number; war?: boolean; chest?: Chest }): void {
    if (!camp.chest) {
      const c = World.toTile(camp.x, camp.y), q = this.chestSpot(c.tx, c.ty);
      if (!q) return;
      camp.chest = { tx: q.tx, ty: q.ty, source: 'camp', loot: [], opened: false };
      this.world.chests.push(camp.chest);
    }
    const ch = camp.chest;
    ch.loot = rollLoot(this.lootRng, danger(this.tilesOut(ch.tx, ch.ty), this.day, camp.war ? 0.15 : 0), camp.war ? 10 : 6);
    ch.opened = false;
  }
  /** The Ogre's hoard by the mouth of his cave: twice and more a camp's, and the best there is. */
  private placeHoard(): void {
    const l = this.world.lair;
    if (!l) return;
    const h = World.toTile(Ogre.homeOf(l).x, Ogre.homeOf(l).y), q = this.chestSpot(h.tx + 2, h.ty);
    if (!q) return;
    this.world.chests.push({ tx: q.tx, ty: q.ty, source: 'lair', loot: rollLoot(this.lootRng, danger(this.tilesOut(q.tx, q.ty), this.day, 0.35), 16, 0.7), opened: false });
  }
  /** Why a chest won't open right now (its keepers still stand), or null. */
  chestGuard(ch: Chest): string | null {
    if (ch.opened) return 'It stands open and empty';
    if (ch.source === 'camp') {
      const camp = this.camps.find((c) => c.chest === ch), left = camp ? camp.members.filter((m) => !m.dead).length : 0;
      if (left) return `Guarded — ${left} still hold${left === 1 ? 's' : ''} the camp`;
    }
    if (ch.source === 'lair' && this.ogre && !this.ogre.dead && this.ogre.state !== 'sleeping') return 'The Ogre is up and about — come back while he sleeps, or kill him';
    const ruin = this.world.ruins.find((r) => r.chest === ch), keep = ruin ? this.ruinKeepers(ruin) : 0;
    if (keep) return `Guarded — ${keep} still ${ruin!.kind === 'barrow' ? 'nest in the barrow' : 'hold the tower'}`;
    return null;
  }
  /** The nearest shut chest within `reach` pixels of (x, y). */
  chestNear(x: number, y: number, reach = TILE * 1.2): Chest | null {
    let best: Chest | null = null, bd = reach;
    for (const ch of this.world.chests) {
      if (ch.opened) continue;
      const d = Math.hypot((ch.tx + 0.5) * TILE - x, (ch.ty + 0.5) * TILE - y);
      if (d <= bd) { best = ch; bd = d; }
    }
    return best;
  }
  /**
   * Open a chest: its loot bursts out and lands round it, to be picked up by walking over it (what you
   * can't carry waits for a second trip). Opening the hoard while the Ogre sleeps wakes him.
   */
  openChest(ch: Chest): boolean {
    const ruin = this.world.ruins.find((r) => r.chest === ch);
    if (ruin && !ruin.roused) this.rouseRuin(ruin); // laying hands on a ruin wakes whoever keeps it
    const why = this.chestGuard(ch);
    if (why) { this.event('info', why, true); return false; }
    if (ch.stock && !ch.loot.length) ch.loot = rollLoot(this.lootRng, danger(this.tilesOut(ch.tx, ch.ty), this.day, ch.stock.bonus), ch.stock.size, ch.stock.gear);
    const from = World.center(ch.tx, ch.ty);
    let gear = 0, sup = 0;
    for (const slot of ch.loot) {
      const it = isBulk(slot) ? this.world.dropItem(slot.kind, slot.n, from.x, from.y, slot.kind === 'food' ? slot.food : undefined) : this.world.dropItem('gear', 1, from.x, from.y);
      if (isBulk(slot)) sup++; else { it.gear = { ...slot }; gear++; }
      it.spoils = true; // what you leave lying, the gnomes carry home
      const a = this.lootRng.range(0, Math.PI * 2), r = this.lootRng.range(1, 2.4) * TILE;
      throwItem(it, from, { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r }, this.lootRng, 6);
    }
    ch.loot = []; ch.opened = true;
    const what = ch.source === 'lair' ? "the Ogre's hoard" : ch.source === 'camp' ? 'the camp chest' : ch.source === 'cart' ? 'the wrecked cart' : ch.source === 'barrow' ? 'the barrow' : 'the watchtower chest';
    this.event('build', `You broke open ${what}: ${gear} piece${gear === 1 ? '' : 's'} of gear, ${sup} lot${sup === 1 ? '' : 's'} of supplies.`);
    const og = this.ogre;
    if (ch.source === 'lair' && og && !og.dead && og.state === 'sleeping') {
      og.state = 'roaming'; og.hidden = false; og.aggroed = true; og.emerged = true;
      this.event('raid', 'The Ogre wakes — and he is between you and the door!', true);
    }
    return true;
  }

  // ---- ruins and wrecks: found once, looted once ------------------------------------------------

  /** who keeps each ruin: a watchtower's raiders, a barrow's skulks once roused */
  ruinGuards = new Map<Ruin, Raider[]>();
  private ruinWatchT = 0;
  /** Keepers still standing near their ruin. */
  ruinKeepers(r: Ruin): number {
    const c = World.center(r.tx, r.ty);
    return (this.ruinGuards.get(r) ?? []).filter((g) => !g.dead && Math.hypot(g.x - c.x, g.y - c.y) < 14 * TILE).length;
  }
  /** Keepers round (x, y), leashed to it like a camp's: they stay by their ruin and fight off whoever comes near. */
  private keepers(r: Ruin, rng: Rng, n: number, make: (x: number, y: number, roll: number) => Raider): void {
    const c = World.center(r.tx, r.ty), out: Raider[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(TILE, 2.5 * TILE);
      let x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      const t = World.toTile(x, y);
      if (this.world.isBlocked(t.tx, t.ty, true)) { x = c.x; y = c.y; }
      const g = make(x, y, rng.next());
      g.camp = { x: c.x, y: c.y, aggro: p.campAggro * TILE, leash: p.campLeash * TILE };
      g.lairBound = true; // never part of a raid
      g.task = r.kind === 'tower' ? 'holding the old watchtower' : 'nesting in the barrow';
      out.push(this.spawn(g));
    }
    this.ruinGuards.set(r, out);
  }
  /**
   * A ruin's keepers come to it when you do: a watchtower is found held by three to five raiders (they were
   * there all along — they are only raised once you are within 30 tiles, so a far tower costs nothing),
   * and two or three skulks boil out of a barrow when you come close. A cart has nobody.
   */
  private rouseRuin(r: Ruin): void {
    if (r.roused || r.chest.opened) return;
    r.roused = true;
    // each ruin's own numbers, from where it stands: what a chest held never changes who keeps a ruin
    const rng = new Rng(this.seed ^ Math.imul(r.tx + 1, 73856093) ^ Math.imul(r.ty + 1, 19349663));
    if (r.kind === 'tower') {
      const opts = { hpMul: this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul };
      this.keepers(r, rng, 3 + rng.int(0, 2), (x, y, roll) => roll < 0.25 ? new Brute(x, y, opts) : roll < 0.45 ? new Shaman(x, y, opts) : new Raider(x, y, opts));
    } else if (r.kind === 'barrow') {
      this.keepers(r, rng, 2 + rng.int(0, 1), (x, y) => new Skulk(x, y));
      this.event('raid', 'Skulks boil out of the barrow!', true);
    }
  }
  /** Twice a second: a ruin first seen goes in the journal; a barrow you come near wakes. */
  private watchRuins(dt: number): void {
    this.ruinWatchT -= dt;
    if (this.ruinWatchT > 0) return;
    this.ruinWatchT = 0.5;
    const pl = this.player;
    for (const r of this.world.ruins) {
      const c = World.center(r.tx, r.ty), near = Math.hypot(pl.x - c.x, pl.y - c.y);
      if (!r.seen && (this.fog && this.fog.enabled ? this.fog.visibleAt(c.x, c.y) > 0.5 : near < 18 * TILE)) {
        r.seen = true;
        const b = this.bearing(c.x, c.y);
        this.event('build', r.kind === 'cart' ? `A wrecked cart in the grass to the ${b} — somebody's supplies, never delivered.`
          : r.kind === 'barrow' ? `An old barrow to the ${b} — something glints inside. Skulks nest in such places.`
          : `A ruined watchtower to the ${b}, and raiders holding it. Whatever they keep there, they keep it well.`);
      }
      if (!r.roused && !r.chest.opened && !pl.dead && !pl.hidden && near < (r.kind === 'tower' ? 30 : 8) * TILE) this.rouseRuin(r);
    }
  }

  // ---- ox caravans: supplies up the south road every few days --------------------------------------

  /**
   * Send a caravan: it sets out from the map's south edge on the trail through the middle of the map
   * (the road every seed keeps open), loaded with what the sliders say.
   */
  sendCaravan(): Caravan {
    const hx = Math.floor(COLS / 2), edge = ROWS - 2;
    const start = this.world.nearest((hx + 0.5) * TILE, (edge + 0.5) * TILE, (_t, tx, ty) => !this.world.isBlocked(tx, ty)) ?? { tx: hx, ty: edge };
    const at = World.center(start.tx, start.ty);
    const cargo = { food: Math.round(p.caravanFood), wood: Math.round(p.caravanWood), arrows: Math.round(p.caravanArrows), scrap: Math.round(p.caravanScrap), bandages: Math.round(p.caravanBandages) };
    const c = this.spawn(new Caravan(at.x, at.y, cargo));
    this.event('info', 'An ox caravan is on the south road, bringing supplies to the granary.', true);
    return c;
  }
  /** Where a caravan unloads: the granary's door (else the woodyard's, else the middle of the village). */
  caravanStop(): { x: number; y: number } {
    const b = [this.world.granary, this.world.woodyard].find((x) => x && !x.ruined);
    if (!b) return this.villageCentre();
    const d = doorstep(b);
    return World.center(d.tx, d.ty);
  }
  /** The cart unloads: food to the granary, wood to the woodyard (up to their caps), arrows to the quiver, scrap, bandages to a gear chest. */
  unloadCaravan(c: Caravan): void {
    if (c.unloaded) return;
    c.unloaded = true;
    const k = c.cargo, food0 = this.food, wood0 = this.wood;
    // the food comes mixed: grain mostly, salted meat, roots and nuts
    const mix: [FoodKind, number][] = [['wheat', 0.4], ['meat', 0.25], ['carrot', 0.2], ['hazelnut', 0.15]];
    let left = k.food;
    mix.forEach(([f, share], i) => { const n = i === mix.length - 1 ? left : Math.round(k.food * share); this.addFood(n, f); left -= n; });
    this.addWood(k.wood);
    this.arrows += k.arrows;
    this.scrap += k.scrap;
    const chest = this.nearestGearChest(c.x, c.y);
    let rolls = 0;
    if (chest) for (let i = 0; i < k.bandages && this.stashOf(chest).length < STASH_SLOTS; i++) { this.stashOf(chest).push({ kind: 'kit', kit: 'bandage' }); rolls++; }
    const got = [`+${Math.round(this.food - food0)} food`, `+${Math.round(this.wood - wood0)} wood`, `+${k.arrows} arrows`, k.scrap ? `+${k.scrap} scrap` : '', rolls ? `${rolls} roll${rolls === 1 ? '' : 's'} of bandages` : ''].filter(Boolean);
    c.cargo = { food: 0, wood: 0, arrows: 0, scrap: 0, bandages: 0 };
    this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: got.slice(0, 3).join(' '), colour: '#e8c860' });
    this.event('food', `The caravan unloads: ${got.join(', ')}.${this.food >= this.foodCap || this.wood >= this.woodCap ? ' (What would not fit went back on the cart.)' : ''}`, true);
  }

  /** Dawn: cleared camps are re-manned after a while, and now and then a new one grows out of sight. */
  private tendCamps(): void {
    for (const camp of this.camps) {
      if (camp.members.some((m) => !m.dead)) continue;
      if (camp.cleared === null) { camp.cleared = this.day; continue; }
      if (this.day - camp.cleared >= p.campRespawnDays && !(this.fog && this.fog.visibleAt(camp.x, camp.y) > 0)) this.manCamp(camp);
    }
    if (p.campCount > 0 && this.day % 3 === 0 && this.camps.length < p.campCount * MAP_AREA * 2 + this.world.plains.length) this.foundCamp();
  }

  /**
   * Stress bench: `gnomes` pike gnomes in a block round the head (following it) and `raiders` raiders in a ring
   * 20-30 tiles out, coming in. ?bench=1000 runs it at load; the debug panel has a button.
   */
  bench(gnomes: number, raiders: number, host = 0): void {
    const pl = this.player, home = this.world.gnomeHouses[0], rng = new Rng(7);
    // fill open tiles outward from the head, four gnomes to a tile, until all are placed
    const here = pl.tile, spots: { x: number; y: number }[] = [];
    for (let r = 1; spots.length < gnomes && r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || spots.length >= gnomes) continue;
      const tx = here.tx + dx, ty = here.ty + dy;
      if (!this.world.inBounds(tx, ty) || this.world.isBlocked(tx, ty) || this.world.get(tx, ty)?.kind === 'thicket') continue;
      const c = World.center(tx, ty);
      for (const [ox, oy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) if (spots.length < gnomes) spots.push({ x: c.x + ox, y: c.y + oy });
    }
    for (let i = 0; i < spots.length; i++) {
      const { x, y } = spots[i];
      const g = this.spawn(new Villager(x, y, home, 'soldier', 20, `Pike ${i}`, this.mods));
      g.weapon = 'pike'; g.applyRole(this.mods); g.order = { kind: 'follow' };
    }
    for (let i = 0; i < raiders; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(20, 30) * TILE, x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d, t = World.toTile(x, y);
      if (!this.world.inBounds(t.tx, t.ty) || this.world.isBlocked(t.tx, t.ty, true)) continue;
      this.spawn(new Raider(x, y, { hpMul: this.mods.raiderHpMul }));
    }
    // a host to fight: mustered on open ground 45 tiles from the head, marching at once
    if (host > 0) {
      let spot: TilePos | null = null;
      for (let k = 0; k < 16 && !spot; k++) {
        const a = (k / 16) * Math.PI * 2, t = { tx: Math.round(here.tx + Math.cos(a) * 45), ty: Math.round(here.ty + Math.sin(a) * 45) };
        if (this.world.inBounds(t.tx, t.ty) && !this.world.isBlocked(t.tx, t.ty, true) && this.world.bfs(t, here, true).length) spot = t;
      }
      for (const h of this.hosts) if (h.state === 'mustering') for (const r of h.bodies()) r.dead = true;
      this.hosts = this.hosts.filter((h) => h.state !== 'mustering');
      if (spot && this.musterHost(false, this.day, host, spot)) this.spawnRaid();
    }
    this.event('info', `Bench: ${gnomes} gnomes and ${raiders} raiders${host ? ` against a host of ${host}` : ''}.`);
  }

  private spawnTrolls(): void {
    const hx = COLS / 2, hy = ROWS / 2;
    const rng = new Rng(this.seed ^ 0x7201);
    const placed: TilePos[] = [];
    for (let k = 0; k < Math.round(p.trolls * MAP_AREA); k++) {
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
    for (let k = 0; k < Math.round(p.hives * MAP_AREA); k++) {
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

  /** A new gnome house comes with its founders: a grown couple who can feed themselves, and who breed like any family. */
  foundGnomes(b: Building): [Villager, Villager] {
    const grown = this.adultAge + 3;
    return [this.addVillager(b, 'farmer', grown), this.addVillager(b, 'woodcutter', grown)];
  }

  private addVillager(home: Building, role: Role, age: number): Villager {
    const d = doorstep(home);
    const c = World.center(d.tx, d.ty);
    const v = new Villager(c.x + this.rng.range(-4, 4), c.y + this.rng.range(-4, 4), home, role, age, NAMES[this.nameIdx++ % NAMES.length], this.mods);
    if (role === 'soldier') v.order = { kind: 'follow' };
    v.followingPlayer = this.gnomesFollow; v.hp = v.maxHp; // a gnome, and one of your train
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
    const clearMovementInput = (): void => {
      kb.resetKeys();
    };
    const clearMovementWhenHidden = (): void => { if (document.hidden) clearMovementInput(); };
    window.addEventListener('blur', clearMovementInput);
    document.addEventListener('visibilitychange', clearMovementWhenHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', clearMovementInput);
      document.removeEventListener('visibilitychange', clearMovementWhenHidden);
    });
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
      button('bench: 1000 gnomes', () => this.bench(1000, 150), 'Stress test: a thousand gnome pikemen at your heels and 150 raiders closing in. Watch the frame time.');
      button('bench: 1000 v 1000', () => this.bench(1000, 0, 1000), 'Stress test: a thousand gnome pikemen against a host of a thousand marching from 45 tiles off.');
    }
    // Stardew-style: C / left click = use tool, X / right click = check, E / Esc = menu, 1-8 or Tab / wheel = tools
    kb.on('keydown-C', () => { if (this.hoverTile) this.useAt(this.hoverTile); else this.interact(); });
    kb.on('keydown-X', () => {
      if (this.interior.active) { this.interior.act(); return; }
      if (this.handsAt(this.target)) return;
      if (this.checkNearby()) return;
      if (this.hovered) { this.select(this.hovered); return; }
      const b = this.facedBuilding() ?? this.world.get(this.player.tile.tx, this.player.tile.ty)?.building ?? null;
      if (b) this.selectBuilding(b); else this.select(null);
    });
    const closePanel = (): void => {
      if (this.commandBack()) return; // a command menu backs out first
      if (this.mealAim) this.mealAim = false; // Esc lets go of an aimed meal first
      else if (BUILDS.includes(this.player.tool)) this.player.tool = 'hammer'; // a build put down: the hammer again
      else if (this.ui?.bagShowing) this.ui.toggleBag(false);
      else if (this.cookingAt) this.openCooking(null);
      else if (this.pouchOf) this.openPouch(null);
      else if (this.armoryFor) this.openArmory(null);
      else if (this.ui?.closeTop()) { /* an open panel, or the inspector, shut */ }
      else this.togglePause();
    };
    kb.on('keydown-ESC', closePanel);
    for (const k of ['Q', 'W', 'E'] as const) kb.on(`keydown-${k}`, (e: KeyboardEvent) => { if (!e.repeat) this.ability(k); });
    kb.on('keyup-R', () => this.releaseMeal());
    kb.on('keydown-B', () => this.ui?.toggleBag());
    kb.on('keydown-V', () => this.openArmory(this.armoryFor ? null : this.player));
    kb.on('keydown-TAB', (e: KeyboardEvent) => { e.preventDefault?.(); this.player.cycleTool(e.shiftKey ? -1 : 1, this.locked); });
    kb.on('keydown-F', () => this.cycleVariant());
    kb.on('keydown-M', () => this.toggleMute());
    kb.on('keydown-Z', () => this.cycleZoom());
    kb.on('keydown-H', (e: KeyboardEvent) => { if (!e.repeat && !this.regimentKey('H')) this.summonGnomes(); });

    super.create(); // creates gfx + hud, then calls reset() -> setup()
    kb.removeAllListeners('keydown-SPACE'); // Esc handles pause; Space brings the camera back to the head
    kb.on('keydown-SPACE', () => this.view?.recentre());
    kb.on('keydown-Y', () => this.view?.toggleLock());
    kb.on('keydown-U', (e: KeyboardEvent) => { if (!e.repeat && this.screen === 'playing') this.useBandage(); });
    kb.on('keydown-G', () => { if (!this.regimentKey('G')) this.tossLoad(); });
    kb.on('keydown-T', () => { if (this.regimentKey('T')) return; if (this.screen === 'playing' && !this.paused) this.eat(); });
    // number keys pick tools; game speed moves to - / =
    kb.removeAllListeners('keydown-ONE'); kb.removeAllListeners('keydown-TWO'); kb.removeAllListeners('keydown-THREE');
    kb.on('keydown-MINUS', () => (this.speed = this.speed > 4 ? 4 : 1));
    kb.on('keydown-PLUS', () => (this.speed = this.speed < 4 ? 4 : 16));
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'].forEach((k, i) => kb.on(`keydown-${k}`, () => { if (!this.commandOpen()) this.setTool(this.hammerOut() ? BUILDS[i] : BELT[i]); }));
    kb.on('keydown-ZERO', () => { if (this.hammerOut() && !this.commandOpen()) this.setTool('hammer'); });
    // the command bar's keys (F1-F7, the numbers, Alt+numbers) are read straight off the window, so the browser's own F-keys can be stopped
    window.addEventListener('keydown', (e) => this.commandKey(e), true);
    // the kernel's R (restart) / N (new seed) are far too easy to hit mid-run: restart lives in the pause menu,
    // and R only works on the end screens where it means "new run"
    kb.removeAllListeners('keydown-R');
    kb.removeAllListeners('keydown-N');
    kb.on('keydown-R', (e: KeyboardEvent) => { if (this.screen === 'over' || this.screen === 'won') this.startGame(); else if (!e.repeat) this.beginMealAim(); });
    this.hud.setVisible(false);

    ensureFlora(this); ensureBuildingArt(this); // the DOM UI's icons are still drawn from these
    this.fog = new Fog(this);
    this.view = new View(this);
    this.chartHome();
    this.view.rebuild();
    this.ui = new UI(this);
    this.ui.mount();

    this.scale.on('resize', () => this.fitCamera());
    this.setupTail();
  }

  /** A press on the map (the 3D view hands it over with what lies under it). */
  onPointerDown(ptr: Ptr): void {
      if (this.posting) { const q = ptr.wallTile ?? World.toTile(ptr.worldX, ptr.worldY); this.assignPost(this.posting, q); return; }
      if (this.player.tool === 'wand' && this.screen === 'playing' && !this.interior.active) { this.wandDown(ptr); return; }
      // aiming a meal: the right button lets go of the aim, the left throws it
      if (this.mealAim) { if (ptr.rightButtonDown()) this.mealAim = false; else this.releaseMeal(); return; }
      // with the command bar open the right button places the picked formations, whatever is in hand
      if (ptr.rightButtonDown() && this.commandOpen() && this.screen === 'playing') { this.wandDown(ptr); return; }
      // the right button is the command: walk, hunt, or go and use whatever is there
      if (ptr.rightButtonDown()) { this.rightCommand(ptr); return; }
      if (this.screen !== 'playing') return;
      // the left button: a weapon in hand looks things over; any other tool is walked over and used there
      const tool = this.player.tool;
      if (tool === 'sword' || tool === 'bow') { this.pick(ptr); return; }
      this.useAt(World.toTile(ptr.worldX, ptr.worldY));
  }

  // ---- MOBA command: right-click orders, left-click tool use, QWER abilities ---------------------

  command: Command | null = null;
  private cmdPath: TilePos[] = [];
  private cmdGoal = '';
  private cmdRepath = 0;
  /** seconds until a repeated use (felling a tree, hacking thorns) strikes again */
  private cmdNext = 0;
  private cmdStuck = { x: 0, y: 0, t: 0 };
  /** while a command acts: the tile it acts on and the point a bow aims at, in place of the cursor */
  private forcedTile: TilePos | null = null;
  private forcedAim: { x: number; y: number } | null = null;
  /** R held: the meal reticle is up */
  mealAim = false;
  /** the meal R throws (null: whichever you carry most of) */
  mealPick: DishKind | null = null;
  /** seconds until another meal can be thrown */
  mealCd = 0;
  /** meals in the air: from, to, how far along, how long the flight takes */
  lobs: { x0: number; y0: number; x1: number; y1: number; t: number; T: number; dish: DishKind }[] = [];

  /** Give the head a standing order (it replaces whatever it was doing). */
  order(c: Command | null): void { this.command = c; this.cmdPath = []; this.cmdGoal = ''; this.cmdNext = 0; this.cmdStuck = { x: this.player.x, y: this.player.y, t: 0 }; }

  /** Right-click: hunt an enemy, go indoors, go and use a plant / pot / gate / stairs, else walk there. */
  private rightCommand(ptr: Ptr): void {
    if (this.screen !== 'playing') return;
    const m = ptr.agent;
    if (m instanceof Raider && !m.dead) {
      if (this.player.tool !== 'sword' && this.player.tool !== 'bow') this.setTool('sword');
      this.order({ kind: 'attack', target: m }); return;
    }
    if (m && m !== this.player) { this.select(m); return; } // a friend: look them over
    const q = ptr.wallTile ?? World.toTile(ptr.worldX, ptr.worldY), t = this.world.get(q.tx, q.ty);
    const b = t?.building;
    const chest = this.chestNear(ptr.worldX, ptr.worldY);
    if (chest) { this.order({ kind: 'loot', chest }); return; }
    if (b && hasInterior(b.kind) && !b.ruined) { this.order({ kind: 'enter', b }); return; }
    if (t && (t.defense?.kind === 'gate' || t.defense?.kind === 'stairs' || t.kind === 'cookpot' || (!t.defense && this.handsHint(q)))) { this.order({ kind: 'use', q, how: 'hands', repeat: false }); return; }
    this.order({ kind: 'move', x: ptr.worldX, y: ptr.worldY });
  }

  /** Left-click (or C) with a tool: walk into reach of q and use it there; an axe keeps chopping till the tree is down. */
  useAt(q: TilePos): void {
    if (this.screen !== 'playing') return;
    if (this.interior.active) { this.interior.act(); return; }
    const t = this.world.get(q.tx, q.ty);
    const repeat = this.player.tool === 'axe' && (t?.kind === 'tree' || t?.kind === 'thicket');
    this.order({ kind: 'use', q, how: 'tool', repeat });
  }

  /** How far the held tool reaches, in tiles (Chebyshev). */
  private toolReach(): number {
    const tool = this.player.tool;
    if (tool === 'basket') return p.tossRange;
    if (tool === 'wall' || tool === 'gate' || tool === 'stairs' || tool === 'gnomehouse' || tool === 'warren' || tool === 'barracks') return Math.min(3, VillageScene.BUILD_REACH);
    return VillageScene.TOOL_REACH;
  }

  /** Turn the head to face a point (four ways, as the sim faces). */
  private faceTo(x: number, y: number): void {
    const pl = this.player, dx = x - pl.x, dy = y - pl.y;
    if (Math.hypot(dx, dy) > 1) pl.facing = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    if (dx) pl.dir = dx < 0 ? -1 : 1;
  }

  /** Run `act` as if the cursor were on q (tools read the pointed tile, buildings their footprint from it). */
  private performAt(q: TilePos, act: () => void): void {
    const hv = this.hoverTile, hp = this.hoverPoint;
    this.forcedTile = q; this.hoverTile = q; this.hoverPoint = World.center(q.tx, q.ty);
    try { act(); } finally { this.forcedTile = null; this.hoverTile = hv; this.hoverPoint = hp; }
  }

  /**
   * Steer the head along a path toward (x, y) on tile `goal`: A* round walls, buildings and thorns, re-planned
   * when the goal moves to another tile or the head stops making headway. Returns false when there is no way there.
   */
  private walkToward(x: number, y: number, goal: TilePos): boolean {
    const pl = this.player, here = pl.tile;
    const key = `${goal.tx},${goal.ty}`;
    this.cmdStuck.t += this.game.loop.delta / 1000;
    if (this.cmdStuck.t > 0.7) {
      if (Math.hypot(pl.x - this.cmdStuck.x, pl.y - this.cmdStuck.y) < 2) { this.cmdGoal = ''; } // no headway: plan again
      this.cmdStuck = { x: pl.x, y: pl.y, t: 0 };
    }
    if (key !== this.cmdGoal || this.cmdRepath <= 0) {
      this.cmdGoal = key; this.cmdRepath = 1.5;
      this.cmdPath = here.tx === goal.tx && here.ty === goal.ty ? [] : this.world.bfs(here, goal, false, pl.elevated);
      if (!this.cmdPath.length && Math.abs(here.tx - goal.tx) + Math.abs(here.ty - goal.ty) > 1) { pl.steer = null; return false; }
    }
    while (this.cmdPath.length && this.cmdPath[0].tx === here.tx && this.cmdPath[0].ty === here.ty) this.cmdPath.shift();
    const wp = this.cmdPath.length ? World.center(this.cmdPath[0].tx, this.cmdPath[0].ty) : { x, y };
    const dx = wp.x - pl.x, dy = wp.y - pl.y, d = Math.hypot(dx, dy);
    pl.steer = d > 0.5 ? { x: dx / d, y: dy / d } : null;
    return true;
  }

  /** Each tick: carry the standing order forward (walk, swing, shoot, use, step indoors). */
  driveCommand(dt: number): void {
    const pl = this.player, c = this.command;
    pl.steer = null;
    if (!c) return;
    if (pl.dead || pl.hidden || this.interior.active) { this.command = null; return; }
    this.cmdNext -= dt; this.cmdRepath -= dt;
    switch (c.kind) {
      case 'move': {
        if (Math.hypot(c.x - pl.x, c.y - pl.y) < 3) { this.command = null; return; }
        if (!this.walkToward(c.x, c.y, World.toTile(c.x, c.y))) this.command = null;
        return;
      }
      case 'attack': {
        const m = c.target;
        if (m.dead || m.hidden || (m instanceof Raider && m.lurking) || (this.fog && this.fog.visibleAt(m.x, m.y) <= 0.35)) { this.command = null; return; }
        const bow = pl.tool === 'bow' && pl.weapons.bow >= 0 && this.arrows > 0, d = pl.dist(m);
        if (d <= (bow ? 150 : SWING.reach + m.radius - 3) && (!bow || this.world.lineClear(pl, m, pl.elevated))) {
          this.faceTo(m.x, m.y);
          if (bow) { this.forcedAim = { x: m.x, y: m.y }; try { this.interact(); } finally { this.forcedAim = null; } }
          else { const stage = pl.pressAttack(); if (stage >= 0) this.fx.push({ kind: 'swing', who: pl, dx: pl.facing.x, dy: pl.facing.y, stage }); }
          return;
        }
        if (!this.walkToward(m.x, m.y, m.tile)) this.command = null;
        return;
      }
      case 'use': {
        const q = c.q, at = World.center(q.tx, q.ty), here = pl.tile;
        const near = c.how === 'hands' ? pl.dist(at) <= ITEM.reach + TILE - 2 : Math.max(Math.abs(q.tx - here.tx), Math.abs(q.ty - here.ty)) <= this.toolReach();
        if (!near) { if (!this.walkToward(at.x, at.y, q)) this.command = null; return; }
        if (this.cmdNext > 0 || pl.busy > 0) return;
        this.faceTo(at.x, at.y);
        const before = this.world.get(q.tx, q.ty)?.kind;
        this.performAt(q, () => { if (c.how === 'hands') this.handsAt(q); else this.interact(); });
        const now = this.world.get(q.tx, q.ty)?.kind;
        if (c.repeat && now === before && (now === 'tree' || now === 'thicket') && pl.tool === 'axe') { this.cmdNext = 0.45; return; } // keep chopping
        this.command = null;
        return;
      }
      case 'loot': {
        const at = World.center(c.chest.tx, c.chest.ty);
        if (pl.dist(at) < TILE * 1.3) { this.command = null; this.faceTo(at.x, at.y); this.openChest(c.chest); return; }
        if (!this.walkToward(at.x, at.y, { tx: c.chest.tx, ty: c.chest.ty })) this.command = null;
        return;
      }
      case 'enter': {
        const d = doorstep(c.b), at = World.center(d.tx, d.ty);
        if (c.b.ruined) { this.command = null; return; }
        if (pl.dist(at) < 7) { this.command = null; this.interior.enter(c.b); return; }
        if (!this.walkToward(at.x, at.y, d)) this.command = null;
        return;
      }
    }
  }

  /** Where the cursor points on the ground, for abilities (falls back to straight ahead). */
  private aimAt(): { x: number; y: number } {
    const pl = this.player;
    return this.view?.aimPoint() ?? this.hoverPoint ?? { x: pl.x + pl.facing.x * 32, y: pl.y + pl.facing.y * 32 };
  }

  /**
   * Q W E R, aimed at the cursor. Each is something the head could already do, on the cooldown it already had:
   * Q the sword (the combo strike), W a bow shot, E the dodge roll. (R is the meal: hold to aim, release to lob — see beginMealAim.)
   */
  ability(k: Exclude<AbilityKey, 'R'>): void {
    if (this.screen !== 'playing' || this.paused || this.interior.active) return;
    const pl = this.player, aim = this.aimAt();
    if (pl.dead || pl.hidden || pl.busy > 0) return;
    switch (k) {
      case 'Q': {
        if (pl.weapons.melee < 0) { this.event('info', 'No blade to swing — forge one at the barracks.', true); return; }
        this.faceTo(aim.x, aim.y);
        const stage = pl.pressAttack();
        if (stage >= 0) this.fx.push({ kind: 'swing', who: pl, dx: pl.facing.x, dy: pl.facing.y, stage });
        return;
      }
      case 'W': {
        if (pl.weapons.bow < 0) { this.event('info', 'No bow yet — forge one at the barracks.', true); return; }
        if (pl.attackCd > 0) return;
        this.faceTo(aim.x, aim.y);
        this.shoot(pl, aim.x - pl.x, aim.y - pl.y, Math.round(14 * weaponMul(pl.weapons, 'bow') * this.mods.playerDmgMul * this.buffMul('dmg')));
        return;
      }
      case 'E': {
        // the roll goes the way the cursor is, not the way the standing order walks
        const dx = aim.x - pl.x, dy = aim.y - pl.y, d = Math.hypot(dx, dy);
        const keep = pl.steer;
        pl.steer = d > 1 ? { x: dx / d, y: dy / d } : null;
        this.dodge();
        pl.steer = keep;
        if (pl.roll) this.order(null);
        return;
      }
    }
  }

  /** The meal R would throw: the one picked, while you still carry it, else whichever you carry most of. */
  loadedMeal(): DishKind | null {
    const pl = this.player;
    if (this.mealPick && pl.carriedOf('food', this.mealPick) >= 1) return this.mealPick;
    let best: DishKind | null = null, n = 0;
    for (const d of DISHES) { const c = pl.carriedOf('food', d); if (c >= 1 && c > n) { n = c; best = d; } }
    return best;
  }
  /** Step which meal R throws, through the dishes you carry. */
  cycleMeal(dir = 1): void {
    const held = DISHES.filter((d) => this.player.carriedOf('food', d) >= 1);
    if (!held.length) return;
    const i = Math.max(0, held.indexOf(this.loadedMeal() ?? held[0]));
    this.mealPick = held[(i + dir + held.length) % held.length];
  }
  /** Where a meal thrown now would come down: the cursor, pulled in to the throwing range. */
  mealTarget(): { x: number; y: number } {
    const pl = this.player, aim = this.aimAt(), max = p.mealRange * TILE;
    const dx = aim.x - pl.x, dy = aim.y - pl.y, d = Math.hypot(dx, dy);
    return d <= max ? aim : { x: pl.x + (dx / d) * max, y: pl.y + (dy / d) * max };
  }
  /** R pressed: put up the reticle. */
  beginMealAim(): void {
    if (this.screen !== 'playing' || this.paused || this.interior.active || this.player.dead) return;
    this.mealAim = true;
    if (!this.loadedMeal()) this.event('info', 'No cooked meal in your pack — cook one at the Great Pot, then hold R to lob it.', true);
  }
  /** R let go (or a left-click while aiming): lob the loaded meal at the reticle. */
  releaseMeal(): void {
    if (!this.mealAim) return;
    this.mealAim = false;
    if (this.screen !== 'playing' || this.paused || this.interior.active || this.mealCd > 0) return;
    const dish = this.loadedMeal(), pl = this.player;
    if (!dish || pl.takeOut('food', 1, dish) < 1) return;
    const to = this.mealTarget(), d = Math.hypot(to.x - pl.x, to.y - pl.y);
    this.lobs.push({ x0: pl.x, y0: pl.y, x1: to.x, y1: to.y, t: 0, T: 0.4 + (d / TILE) * 0.045, dish });
    this.mealCd = p.mealCd;
    this.faceTo(to.x, to.y);
    this.fx.push({ kind: 'arrow', who: pl }); // the whoosh of the throw
  }
  /** Meals in the air come down; where one lands, everyone in the splash eats it. */
  tickLobs(dt: number): void {
    if (!this.lobs.length) return;
    for (const lob of this.lobs) lob.t += dt;
    const landed = this.lobs.filter((l) => l.t >= l.T);
    this.lobs = this.lobs.filter((l) => l.t < l.T);
    for (const l of landed) this.landMeal(l.x1, l.y1, l.dish);
  }
  /** A meal lands at (x, y): every grown villager in the splash gets the dish's mood, the head its heal and buff. */
  landMeal(x: number, y: number, dish: DishKind): number {
    const r = p.mealSplash * TILE;
    let fed = 0;
    for (const v of this.villagers()) {
      if (!v.isAdult || v.dead || v.hidden || v.carriedBy || Math.hypot(v.x - x, v.y - y) > r) continue;
      this.serveOne(v, dish); fed++;
    }
    const pl = this.player;
    if (!pl.dead && !pl.hidden && Math.hypot(pl.x - x, pl.y - y) <= r) {
      pl.hunger = Math.min(p.hungerMax, pl.hunger + this.hungerOf(dish));
      this.dishBuff(dish); fed++;
    }
    this.fx.push({ kind: 'impact', x, y });
    this.fx.push({ kind: 'deposit', x, y: y - TILE, text: fed ? `${FOODS[dish].name} · ${fed} fed` : `${FOODS[dish].name} · wasted`, colour: FOODS[dish].colour });
    if (!fed) this.event('food', `The ${FOODS[dish].name.toLowerCase()} splashes on empty ground — nobody near enough to eat it.`);
    return fed;
  }

  /** Each ability's state for the bar: seconds left on its cooldown out of its full length, and whether it can fire. */
  abilityState(): { key: AbilityKey; name: string; left: number; full: number; usable: boolean; note: string }[] {
    const pl = this.player;
    const swingLeft = pl.swing ? Math.max(0, 0.3 - pl.swing.t) : pl.recover;
    return [
      { key: 'Q', name: 'Strike', left: swingLeft, full: 0.45, usable: pl.weapons.melee >= 0, note: pl.weapons.melee >= 0 ? 'sword toward the cursor; press again to combo' : 'no blade' },
      { key: 'W', name: 'Shoot', left: Math.max(0, pl.attackCd), full: 0.65, usable: pl.weapons.bow >= 0 && this.arrows > 0, note: pl.weapons.bow < 0 ? 'no bow' : `${this.arrows} arrows` },
      { key: 'E', name: 'Roll', left: Math.max(0, p.rollCd - pl.sinceRoll), full: p.rollCd, usable: true, note: 'dodge toward the cursor' },
      (() => { const d = this.loadedMeal(), n = d ? Math.floor(this.player.carriedOf('food', d)) : 0; return { key: 'R' as const, name: d ? FOODS[d].name.replace(/^(Mushroom|Boar|Berry|Garden|Honey) /, '') : 'Meal', left: Math.max(0, this.mealCd), full: Math.max(0.01, p.mealCd), usable: !!d, note: d ? `${n} ${FOODS[d].name.toLowerCase()} — hold R to aim, release to lob it into a crowd; the wheel (or a click here) picks which` : 'no cooked meal in your pack — cook one at the Great Pot' }; })(),
    ];
  }
  /** The pointer left the map. */
  onPointerOut(): void { this.hovered = null; this.hoverTile = null; this.hoverPoint = null; this.ui?.tooltip(null); }

  private setupTail(): void {
    // Phaser only watches the window; the stage can change on its own (drawer, orientation, layout)
    new ResizeObserver(() => this.scale.refresh()).observe(this.game.canvas.parentElement!);
    this.goTitle();
  }

  reset(newSeed?: number): void {
    this.ui?.inventory.cancel();
    super.reset(newSeed);
    this.view?.rebuild();
    this.ui?.clear();
    this.view?.snapCamera();
    if (this.screen !== 'title') { this.screen = 'playing'; this.paused = false; this.ui?.showScreen(null); }
  }


  /** The 3D view follows the head and sizes itself; this is kept for the resize hook (Phaser's own camera draws nothing). */
  fitCamera(): void {}

  /** Step the camera's distance out (Z); it wraps back in. */
  cycleZoom(): void { this.view?.cycleZoom(); }

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
    if (isImplement(tool) && !this.player.pack.hasTool(tool)) {
      const name = TOOL_NAME[tool].toLowerCase();
      if (this.foundTools.has(tool)) return `Recover your ${name} at the granary or woodyard, or pick it up`;
      const c = this.world.toolCaches.find((q) => q.tool === tool), at = c ? World.center(c.tx, c.ty) : null;
      return c && at ? `Find your ${name} — ${LOST_TOOLS[c.tool]} to the ${this.bearing(at.x, at.y)}` : `Find ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
    }
    if ((tool === 'sword' && this.player.weapons.melee < 0) || (tool === 'bow' && this.player.weapons.bow < 0)) return 'Equip a weapon first';
    if (BUILDS.includes(tool) && !this.player.pack.hasTool('hammer')) return this.toolLocked('hammer') ?? 'Find your hammer first';
    return null;
  }
  validateTool(): void { if (this.toolLocked(this.player.tool)) { this.player.tool = 'sword'; this.player.swing = null; } }
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
    if(item && (isBulk(item)||item.kind==='tool'||item.kind==='kit'||item.slot!==slot))return false;
    this.player.pack.slots[index]=old; this.wear(slot,item as Gear|null); return true;
  }
  stowGear(gear: Gear): void {
    if(this.player.pack.put(gear)>=0)return;
    const it=this.world.dropItem('gear',1,this.player.x,this.player.y);it.gear={...gear};it.playerDropPending=true;
    this.event('info',slotName(gear)+' placed at your feet — pack full',true);
  }
  recoverBasicKit(): boolean {
    const pack=this.player.pack, missing: Gear[]=IMPLEMENTS.filter(t=>this.foundTools.has(t)&&!pack.hasTool(t)).map(tool=>({kind:'tool',tool})); // lost tools must be found first
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
  // ---- bandages: found in chests, they bind a wound over a few seconds ----------------------------

  /** who is being mended, and the HP still to come back to them */
  mending = new Map<Mover, number>();
  private mendCheckT = 0;
  /** U: bind a wound with a bandage from your pack (heals BANDAGE.heal over BANDAGE.secs). */
  useBandage(): boolean {
    const pl = this.player, i = pl.pack.findSlot((g) => g.kind === 'kit' && g.kit === 'bandage');
    if (i < 0) { this.event('info', 'No bandages in your pack — they turn up in chests', true); return false; }
    if (pl.hp >= pl.maxHp) { this.event('info', 'You are not hurt', true); return false; }
    pl.pack.removeAt(i);
    this.mending.set(pl, (this.mending.get(pl) ?? 0) + BANDAGE.heal);
    this.event('info', `You bind your wounds (+${BANDAGE.heal} HP over ${BANDAGE.secs} s)`);
    return true;
  }
  /** The mending comes back a little each tick; twice a second a hurt gnome warrior with a bandage in its pouch uses it. */
  private tickMending(dt: number): void {
    this.mendCheckT -= dt;
    if (this.mendCheckT <= 0) {
      this.mendCheckT = 0.5;
      for (const v of this.villagers()) {
        if (v.dead || !v.pouch || v.hp >= v.maxHp * BANDAGE.selfAt || this.mending.has(v)) continue;
        const i = v.pouch.findSlot((g) => g.kind === 'kit' && g.kit === 'bandage');
        if (i < 0) continue;
        v.pouch.removeAt(i);
        this.mending.set(v, BANDAGE.heal);
      }
    }
    for (const [m, left] of this.mending) {
      if (m.dead) { this.mending.delete(m); continue; }
      const step = Math.min(left, BANDAGE.heal / BANDAGE.secs * dt);
      m.hp = Math.min(m.maxHp, m.hp + step);
      if (left - step <= 1e-6 || m.hp >= m.maxHp) this.mending.delete(m); else this.mending.set(m, left - step);
    }
  }

  /** Is the hammer (or something it builds) in hand? Then the build row shows and 1-8 pick a build. */
  hammerOut(): boolean { return this.player.tool === 'hammer' || BUILDS.includes(this.player.tool); }
  setTool(tool: Tool): void {
    if (!TOOLS.includes(tool)) return; // nothing but a tool goes in the head's hand
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
  pick(ptr: { worldX: number; worldY: number; agent?: Mover | null }): void {
    if (this.checkNearby(World.toTile(ptr.worldX, ptr.worldY))) return;
    const m = ptr.agent ?? null;
    if (m) { this.select(m); return; }
    const near = this.world.itemsNear(ptr.worldX, ptr.worldY, 8).sort((a, b) => (a.x - ptr.worldX) ** 2 + (a.y - ptr.worldY) ** 2 - ((b.x - ptr.worldX) ** 2 + (b.y - ptr.worldY) ** 2))[0]
      ?? this.world.items.find((it) => !it.rest && Math.hypot(it.x - ptr.worldX, it.y - it.z - ptr.worldY) <= 8);
    if (near) { this.selectItem(near); return; }
    const q = World.toTile(ptr.worldX, ptr.worldY);
    const b = this.world.get(q.tx, q.ty)?.building ?? null;
    if (b) this.selectBuilding(b); else this.selectTile(q);
  }

  // ---- the inspector's take on tiles and things on the ground -------------------------------

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
  /** F: the held tool's variant — the food the basket takes, the wand's standing order. */
  cycleVariant(): void {
    const pl = this.player;
    if (pl.tool === 'basket') pl.cycleBasket(this.pantry);
    else if (pl.tool === 'wand') { if (!this.regimentKey('F')) this.orderFollow(); }
  }
  /** Age in days a child comes of age: the nursery, then the years in the yard (Quick to Grow shortens it). */
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

  /** Every chest gear is kept in: the barracks', and (for the gnomes) the toadstool cottages' and the warrens'. */
  gearChests(): Building[] { return this.world.buildings.filter(isGearChest); }
  nearestGearChest(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.gearChests()) { const c = buildingCenter(b); const d = (c.tx * TILE - x) ** 2 + (c.ty * TILE - y) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }
  /** Is this piece already promised to a soldier on the way to fetch it? */
  reserved(g: Gear): boolean { return this.villagers().some((v) => v.kitFetch?.gear === g); }
  /** What lies in the chests for a soldier's `slot`, best first (not what another is already off to fetch). */
  fetchOptions(v: Villager, slot: EquipmentSlot | 'kit'): { b: Building; gear: Gear }[] {
    const out: { b: Building; gear: Gear }[] = [];
    for (const b of this.gearChests()) for (const g of this.stashOf(b)) {
      if (this.reserved(g)) continue;
      if (slot === 'kit' ? g.kind === 'kit' && !!v.pouch : (g.kind === 'weapon' || g.kind === 'armor') && g.slot === slot) out.push({ b, gear: g });
    }
    const tier = (g: Gear) => g.kind === 'weapon' || g.kind === 'armor' ? g.tier : 0;
    return out.sort((a, b) => tier(b.gear) - tier(a.gear));
  }
  /** Why `v` can't be sent for `gear` in `b`, or null. */
  fetchProblem(v: Villager, b: Building, gear: Gear): string | null {
    if (v.dead || v.role !== 'soldier') return 'only soldiers draw gear from the chests';
    if (!this.stashOf(b).includes(gear)) return 'it is no longer in the chest';
    if (this.reserved(gear) && v.kitFetch?.gear !== gear) return 'another soldier is already on the way for it';
    if (gear.kind === 'kit' && !v.pouch) return 'only a gnome carries a pouch to keep bandages in';
    if (gear.kind === 'armor' && gear.slot === 'shield' && v.weapon === 'bow') return 'a bow needs both hands';
    if (gear.kind === 'tool') return 'tools are for your own hands';
    return null;
  }
  /** FETCH: send a soldier to `b` to take `gear` and put it on (their old piece goes back in the chest). */
  orderFetch(v: Villager, b: Building, gear: Gear): boolean {
    const why = this.fetchProblem(v, b, gear);
    if (why) { this.event('info', `Can't fetch: ${why}`, true); return false; }
    v.kitFetch = { b, gear };
    v.post = null; // down off the wall first
    v.clearGoal();
    this.event('soldier', `${v.name} goes to fetch the ${slotName(gear).toLowerCase()} from the ${BUILDINGS[b.kind].name.toLowerCase()}.`);
    return true;
  }
  /** Call a fetch off (the piece is gone, a raid is on, there is no way there). */
  cancelFetch(v: Villager, why: string): void {
    const f = v.kitFetch;
    v.kitFetch = null; v.clearGoal();
    if (f && !v.dead) this.event('info', `${v.name} gives up fetching the ${slotName(f.gear).toLowerCase()}: ${why}.`);
  }
  /** At the chest: take the piece, put it on, and leave the old one in its place. */
  completeFetch(v: Villager): boolean {
    const f = v.kitFetch;
    v.kitFetch = null;
    if (!f) return false;
    const stash = this.stashOf(f.b), i = stash.indexOf(f.gear), g = f.gear;
    if (i < 0) return false;
    if (g.kind === 'kit') { if (!v.pouch || v.pouch.put(g) < 0) return false; stash.splice(i, 1); this.event('soldier', `${v.name} tucks a bandage in the pouch.`); return true; }
    if (g.kind !== 'weapon' && g.kind !== 'armor') return false;
    stash.splice(i, 1);
    const old = g.kind === 'weapon' ? v.weapons[g.slot] : v.armor[g.slot];
    if (g.kind === 'weapon') v.weapons = { ...v.weapons, [g.slot]: g.tier }; else v.armor = { ...v.armor, [g.slot]: g.tier };
    // the old piece goes back in the chest (a crude club or nothing at all is left behind); a full chest leaves it at the door
    if (old > 0) {
      const back: Gear = g.kind === 'weapon' ? { kind: 'weapon', slot: g.slot, tier: old } : { kind: 'armor', slot: g.slot, tier: old };
      if (stash.length < STASH_SLOTS) stash.push(back);
      else { const d = World.center(doorstep(f.b).tx, doorstep(f.b).ty); this.world.dropItem('gear', 1, d.x, d.y, undefined, this.rng).gear = back; }
    }
    this.refitArmor(v);
    this.event('soldier', `${v.name} now ${g.kind === 'weapon' ? 'carries' : 'wears'} ${slotName(g).toLowerCase()}.`);
    return true;
  }
  /** Forge a piece for a soldier: it is made into the chest, and the soldier sent to fetch it. */
  private forgeInto(v: Villager, piece: Gear, tier: { wood: number; scrap: number }): boolean {
    const chest = (this.armoryChest && this.armoryChest.kind === 'barracks' && !this.armoryChest.ruined ? this.armoryChest : null) ?? this.nearestBarracks(v.x, v.y);
    if (!chest) { this.event('info', "Can't forge: build a barracks first", true); return false; }
    if (this.stashOf(chest).length >= STASH_SLOTS) { this.event('info', "Can't forge: the barracks chest is full", true); return false; }
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    this.stashOf(chest).push(piece);
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: v.tile.tx, ty: v.tile.ty });
    this.orderFetch(v, chest, piece);
    return true;
  }
  /** Gear a gnome carried home in its pouch goes into the nearest gear chest. */
  stowPouchGear(v: Villager): void {
    if (!v.pouch) return;
    const b = this.nearestGearChest(v.x, v.y);
    if (!b) return;
    const stash = this.stashOf(b);
    v.pouch.slots.forEach((g, i) => { if (g && !isBulk(g) && g.kind !== 'tool' && !(g.kind === 'kit' && v.role === 'soldier') && stash.length < STASH_SLOTS) { stash.push(g); v.pouch!.removeAt(i); } });
  }

  /** Everyone who can wear armor: you and your soldiers. */
  wearers(): Mover[] {
    return [this.player as Mover, ...this.villagers().filter((v) => v.role === 'soldier' && !v.dead)];
  }
  /** Why `who` can't have the next tier in `slot` right now, or null. */
  craftProblem(who: Mover, slot: ArmorSlot): string | null {
    const next = who.armor[slot] + 1;
    const tier = ARMOR[slot].tiers[next];
    if (!tier) return 'already the best there is';
    const rare = this.forgeRare(next); if (rare) return rare;
    if (slot === 'shield' && ((who instanceof Villager && who.weapon === 'bow') || (who instanceof Player && who.tool === 'bow'))) return 'a bow needs both hands';
    return this.forgeProblem(next, tier);
  }
  /** Why `who` can't have the next weapon tier in `slot` right now, or null. */
  weaponProblem(who: Mover, slot: WeaponSlot): string | null {
    const next = who.weapons[slot] + 1;
    const tier = WEAPONS[slot].tiers[next];
    if (!tier) return 'already the best there is';
    const rare = this.forgeRare(next); if (rare) return rare;
    return this.forgeProblem(next, tier);
  }
  /** Forge a better weapon for a wearer; pays wood and scrap. */
  craftWeapon(who: Mover, slot: WeaponSlot): boolean {
    const why = this.weaponProblem(who, slot);
    if (why) { this.event('info', `Can't forge: ${why}`, true); return false; }
    const next = who.weapons[slot] + 1, tier = WEAPONS[slot].tiers[next];
    if (who instanceof Villager) return this.forgeInto(who, { kind: 'weapon', slot, tier: next }, tier);
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    if (who instanceof Player && who.weapons[slot]>=0) this.stowGear({kind:'weapon',slot,tier:who.weapons[slot]});
    who.weapons = { ...who.weapons, [slot]: next };
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: who.tile.tx, ty: who.tile.ty });
    this.event('build', `${who instanceof Player ? 'You' : (who as Villager).name} now carr${who instanceof Player ? 'y' : 'ies'} a ${tier.name.toLowerCase()}`);
    return true;
  }
  /**
   * Forge rare: the barracks makes the basics (up to forgeMaxTier) from nothing. Anything better is
   * looted — though a found piece (tier 2 or better) can be reforged one tier up. Null when allowed.
   */
  forgeRare(next: number): string | null {
    if (next >= FOUND_TIER) return 'nothing better is forged: the tower shield, the warhammer and the crossbow are only ever found';
    if (next <= p.forgeMaxTier || next - 1 >= 2) return null;
    return 'iron and better are looted, not forged: clear camps, ruins and the fallen';
  }
  /** Is forging `next` a reforge of a found piece (past what the forge makes from nothing)? */
  isReforge(next: number): boolean { return next > p.forgeMaxTier; }
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
    if (who instanceof Villager) return this.forgeInto(who, { kind: 'armor', slot, tier: next }, tier);
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    if (who instanceof Player && who.armor[slot]>0) this.stowGear({kind:'armor',slot,tier:who.armor[slot]});
    who.armor = { ...who.armor, [slot]: next };
    this.refitArmor(who);
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: who.tile.tx, ty: who.tile.ty });
    this.event('build', `${who instanceof Player ? 'You' : (who as Villager).name} now wear${who instanceof Player ? '' : 's'} ${tier.name.toLowerCase()}`);
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
    if (who && !this.gearChests().length) { this.event('info', 'Build a barracks (or a gnome cottage or warren) to keep a gear chest', true); return; }
    this.armoryFor = who;
    const sel = this.interior.building && isGearChest(this.interior.building) ? this.interior.building : this.selectedBuilding && isGearChest(this.selectedBuilding) ? this.selectedBuilding : null;
    this.armoryChest = who ? chest ?? sel ?? this.nearestBarracks(this.player.x, this.player.y) ?? this.nearestGearChest(this.player.x, this.player.y) : null;
    this.ui?.renderArmory();
  }

  // ---- the cooking pot --------------------------------------------------------------------

  /** Open the gnomes' pot in `b`, or close the panel. */
  openCooking(b: Building | null): void {
    this.cookingAt = b;
    this.ui?.renderCooking();
  }
  /** What is lying in the pot waiting to be cooked, by kind. */
  potStock(b = this.world.cookpot): Partial<Record<FoodKind, number>> { return (b && (b.stock ??= {})) || {}; }
  /** What the pot has cooked and not yet ladled out. */
  potServings(b = this.world.cookpot): Partial<Record<DishKind, number>> { return (b && (b.servings ??= {})) || {}; }
  /** Units of everything in the pot, cooked and raw — what the steam over it is scaled to. */
  potFullness(b = this.world.cookpot): number {
    if (!b) return 0;
    const sum = (o: Record<string, number | undefined>) => Object.values(o).reduce<number>((n, v) => n + (v ?? 0), 0);
    return sum(this.potStock(b)) + sum(this.potServings(b));
  }
  /**
   * Food thrown into the pot goes in the pot, not on the ground: this runs after the items have
   * settled and before the head's pickup magnet, so a throw that lands in it is the pot's.
   */
  potAbsorb(): void {
    const b = this.world.cookpot;
    if (!b) return;
    const f = BUILDINGS[b.kind], stock = this.potStock(b);
    for (const it of [...this.world.items]) {
      if (!it.rest || it.kind !== 'food' || !it.food || it.playerDropPending) continue;
      const tx = Math.floor(it.x / TILE), ty = Math.floor(it.y / TILE);
      if (tx < b.tx || tx >= b.tx + f.w || ty < b.ty || ty >= b.ty + f.h) continue;
      stock[it.food] = (stock[it.food] ?? 0) + it.n;
      this.world.removeItem(it);
      this.fx.push({ kind: 'deposit', x: it.x, y: it.y - TILE, text: `+${foodCount(it.n, it.food)}`, colour: FOODS[it.food].colour });
      this.event('food', `${foodCount(it.n, it.food)} into the pot.`);
    }
  }
  /**
   * How much of an ingredient the cook can lay hands on: what was thrown in the pot, what the head
   * carries, and what the granary holds (a ruined granary holds nothing anyone can reach).
   */
  ingredientHave(k: FoodKind, b = this.cookingAt ?? this.world.cookpot): { pot: number; pack: number; granary: number; total: number } {
    const pot = b ? this.potStock(b)[k] ?? 0 : 0, pack = this.player.carriedOf('food', k);
    const g = this.world.granary, granary = g && !g.ruined ? this.pantry[k] ?? 0 : 0;
    return { pot, pack, granary, total: pot + pack + granary };
  }
  /** Where an ingredient comes from, in a few words, for a card that is missing it. */
  ingredientSource(k: FoodKind): string {
    const plant: Partial<Record<FoodKind, string>> = { berry: 'a berry bush', mushroom: 'a mushroom patch', hazelnut: 'a hazel', garlic: 'wild garlic', burdock: 'a burdock plant' };
    switch (FOODS[k].source) {
      case 'wild': return `pick it wild: right-click a ripe ${plant[k] ?? FOODS[k].name.toLowerCase()} out past the thorns`;
      case 'trade': return 'the ox caravans bring it up the south road (and chests hold some)';
      case 'hunt': return 'hunt boars in the woods';
      case 'hive': return 'knock down a beehive with the axe (and run)';
      default: return 'cook it';
    }
  }
  /** Why this dish can't be made right now, or null. */
  cookProblem(r: Recipe): string | null {
    const b = this.cookingAt;
    if (!b) return 'no pot here';
    if (b.ruined) return 'the pot is tipped over — set it right with the hammer';
    for (const [k, n] of Object.entries(r.needs) as [FoodKind, number][]) {
      const have = this.ingredientHave(k, b).total;
      if (have < n) return `needs ${foodCount(n, k)} (you have ${Math.floor(have)}) — ${this.ingredientSource(k)}`;
    }
    return null;
  }
  /**
   * Cook a dish: the ingredients come out of the pot first, then the head's pack, then the granary, and
   * the servings go into the head's pack (ready to eat, or to lob with R). What the pack has no room for
   * stands in the pot to be ladled out.
   */
  cook(r: Recipe): boolean {
    const b = this.cookingAt;
    if (!b || this.cookProblem(r)) return false;
    const stock = this.potStock(b), made = this.potServings(b), pl = this.player;
    for (const [k, n] of Object.entries(r.needs) as [FoodKind, number][]) {
      let left = n;
      const fromPot = Math.min(left, stock[k] ?? 0);
      if (fromPot > 0) { stock[k] = (stock[k] ?? 0) - fromPot; left -= fromPot; if ((stock[k] ?? 0) < 1e-9) delete stock[k]; }
      if (left > 1e-9) left -= pl.takeOut('food', Math.min(left, pl.carriedOf('food', k)), k);
      if (left > 1e-9) this.pantry[k] = Math.max(0, this.pantry[k] - left);
    }
    const packed = Math.min(r.makes, pl.roomFor('food', r.dish));
    const took = packed > 0 ? pl.pickUp('food', packed, r.dish) : 0;
    if (r.makes - took > 1e-9) made[r.dish] = (made[r.dish] ?? 0) + (r.makes - took);
    const c = buildingCenter(b);
    this.fx.push({ kind: 'deposit', x: c.tx * TILE, y: (b.ty + BUILDINGS[b.kind].h) * TILE - 6, text: `+${foodCount(r.makes, r.dish)}`, colour: FOODS[r.dish].colour });
    const where = took >= r.makes ? `${r.makes} in your pack — hold R to lob one into a crowd, or eat one (T)` : took > 0 ? `${took} in your pack, ${r.makes - took} left standing in the pot` : `${r.makes} standing in the pot (your pack is full)`;
    this.event('food', `${FOODS[r.dish].name} cooked — ${where}.`);
    return true;
  }
  /** Every cooked meal the head carries, by dish. */
  packMeals(): Partial<Record<DishKind, number>> {
    const out: Partial<Record<DishKind, number>> = {};
    for (const d of DISHES) { const n = this.player.carriedOf('food', d); if (n >= 1) out[d] = n; }
    return out;
  }
  /** the thicket's own random stream (see reset) */
  private thicketRng = new Rng(1);
  /** seconds since the thorns last bit, and when the head was last told why it hurts */
  private thornT = 0;
  private thornWarned = -Infinity;
  /**
   * The thorns: anyone standing in thicket bleeds a little every quarter-second — you, villagers and raiders
   * alike. Taken off `hp` directly (like hunger), so armor does not turn brambles and a shield does not
   * block them. Villagers and raiders path round it when there is a way round (see THICKET_PATH_COST).
   */
  tickThorns(dt: number): void {
    if (p.thicketDps <= 0 || !this.world.thicketCount) return;
    this.thornT += dt;
    if (this.thornT < 0.25) return;
    const bite = p.thicketDps * this.thornT;
    this.thornT = 0;
    for (const a of this.agents) {
      if (!(a instanceof Mover) || a.dead || a.hidden || a.elevated || a instanceof Arrow || a instanceof Bolt || a instanceof Swarm) continue;
      if (a instanceof Villager && a.carriedBy) continue;
      if (!this.world.thicketAt(a.x, a.y)) continue;
      if (a instanceof Player && p.godMode) continue;
      a.hp -= bite; a.hurtT = 0;
      if (a.hp > 0) continue;
      a.hp = 0; a.dead = true;
      if (a instanceof Player) this.event('death', 'The thorns drank you dry.');
      else if (a instanceof Villager) this.battleNow().thorns++; // counted with the fallen when it is removed (onDeath)
    }
    const pl = this.player;
    if (!pl.dead && this.world.thicketAt(pl.x, pl.y) && this.simTime - this.thornWarned > 20) {
      this.thornWarned = this.simTime;
      this.event('info', 'Thorns! Hooks in the skin, roots round the ankles — the thicket drags at you. Cut your way out with the axe or sword.', true);
    }
  }
  /**
   * Dawn: the thicket creeps. It spares the great pot's doorstep and every building's, so nothing is
   * walled in overnight — everything else that is open ground or forage is fair game.
   */
  creepThicket(): void {
    const doors = new Set(this.world.buildings.map((b) => { const d = doorstep(b); return d.ty * this.world.cols + d.tx; }));
    const took = this.world.spreadThicket(this.thicketRng, p.thicketSpread, (tx, ty) => doors.has(ty * this.world.cols + tx));
    if (!took.length) return;
    // what the village actually lost is what makes the warning worth reading
    // the ring itself creeps every night; only what it takes inside it (or in a lane) is news
    const near = took.filter((q) => Math.abs(q.tx - COLS / 2) < 18 && Math.abs(q.ty - ROWS / 2) < 13 || this.world.get(q.tx, q.ty)?.trail).length;
    if (near) this.event('info', `In the night the thorns crept ${near} tile${near === 1 ? '' : 's'} closer. Something feeds them. Cut them back with the axe before they take the fields and close the trails.`);
  }
  /** Is there a bowl standing in the pot for someone? */
  potHasServings(b = this.world.cookpot): boolean {
    if (!b || b.ruined) return false;
    const made = this.potServings(b);
    return DISHES.some((d) => (made[d] ?? 0) >= 1);
  }
  /** The grown gnomes standing near enough the pot to be handed a bowl. */
  gnomesAtPot(b = this.world.cookpot): Villager[] {
    if (!b) return [];
    const c = buildingCenter(b);
    return this.villagers().filter((v) => v.isAdult && !v.dead && !v.hidden && !v.carriedBy
      && Math.hypot(v.x - c.tx * TILE, v.y - c.ty * TILE) <= SERVE_RANGE * TILE);
  }
  /** Why nobody can be served right now, or null. */
  servingProblem(b = this.world.cookpot): string | null {
    if (!b) return 'there is no pot';
    const made = this.potServings(b), packed = this.packMeals();
    if (!DISHES.some((d) => (made[d] ?? 0) >= 1 || (packed[d] ?? 0) >= 1)) return 'nothing cooked to ladle out yet';
    if (!this.gnomesAtPot(b).length) return `no grown gnome within ${SERVE_RANGE} tiles of the pot — call them (H) and serve them here`;
    return null;
  }
  /**
   * Ladle the pot out: every grown gnome standing round it gets a bowl, and whatever that dish does
   * to a little person for the next few minutes (see MOODS). The oldest dish in the pot goes first.
   */
  serveGnomes(b = this.world.cookpot): number {
    if (!b || this.servingProblem(b)) return 0;
    const made = this.potServings(b), taken: Record<string, number> = {};
    let served = 0;
    for (const v of this.gnomesAtPot(b)) {
      // the pot's own servings first, then the meals in the head's pack
      const dish = DISHES.find((d) => (made[d] ?? 0) >= 1) ?? DISHES.find((d) => this.player.carriedOf('food', d) >= 1);
      if (!dish) break;
      if ((made[dish] ?? 0) >= 1) { made[dish] = (made[dish] ?? 0) - 1; if ((made[dish] ?? 0) < 1e-9) delete made[dish]; }
      else this.player.takeOut('food', 1, dish);
      this.serveOne(v, dish);
      taken[dish] = (taken[dish] ?? 0) + 1;
      served++;
    }
    const what = Object.entries(taken).map(([d, n]) => `${n} ${FOODS[d as DishKind].name.toLowerCase()}`).join(', ');
    if (served) this.event('food', `${what} ladled out — ${served} gnome${served === 1 ? '' : 's'} fed.`);
    return served;
  }
  /** One bowl into one gnome: the mood takes hold, and its stats are rewritten to match. */
  serveOne(v: Villager, dish: DishKind): void {
    const m = MOODS[dish];
    v.mood = { dish, until: this.simTime + m.secs };
    v.hungerDays = 0;
    const frac = v.hp / Math.max(1, v.maxHp);
    v.applyRole(this.mods); // the mood is folded in by applyRole, so it has to run again to take
    v.hp = Math.min(v.maxHp, Math.max(Math.round(v.maxHp * frac), v.hp) + RECIPES[dish].heal);
    v.hp = Math.min(v.hp, v.maxHp);
    this.fx.push({ kind: 'deposit', x: v.x, y: v.y - TILE, text: m.name, colour: m.colour });
    this.fx.push({ kind: 'hearts', who: v });
    this.event('food', `${v.name}: ${m.name} — ${m.blurb}.`);
  }
  /**
   * A gnome full of toadstool stew, struck: the cap bursts and every raider in the cloud is left
   * reeling and thrown off. It costs the gnome nothing but the blow it just took, so a line of them
   * round the pot is a minefield rather than a militia.
   */
  sporeBurst(v: Villager, spores: { radius: number; freeze: number }): void {
    const r = spores.radius * TILE;
    let caught = 0;
    for (const a of this.agents) {
      if (!(a instanceof Raider) || a.dead || a.hidden) continue;
      const d = Math.hypot(a.x - v.x, a.y - v.y);
      if (d > r) continue;
      a.freeze = Math.max(a.freeze, spores.freeze);
      a.shove((a.x - v.x) / (d || 1), (a.y - v.y) / (d || 1), 7);
      a.attack = null; // whatever it was winding up is lost
      caught++;
    }
    this.fx.push({ kind: 'impact', x: v.x, y: v.y });
    this.fx.push({ kind: 'deposit', x: v.x, y: v.y - TILE, text: 'SPORES', colour: MOODS.stew.colour });
    if (caught) this.event('soldier', `${v.name} bursts — ${caught} raider${caught === 1 ? ' is' : 's are'} left reeling in the spores.`);
  }
  /**
   * Sharp-eyed: the gnome picks up a stone and slings it. It is an arrow in everything but name, and
   * deliberately not `shoot()` — no bow, and it never touches the village's quiver.
   */
  slingStone(v: Villager, sling: { range: number; dmg: number }): void {
    const mark = this.bestTarget(v.x, v.y, sling.range * TILE);
    if (!mark || v.hidden || v.carriedBy) return;
    const dx = mark.x - v.x, dy = mark.y - v.y, len = Math.hypot(dx, dy) || 1;
    v.dir = dx < 0 ? -1 : 1;
    this.spawn(new Arrow(v.x, v.y - 4, dx / len, dy / len, sling.dmg, v, sling.range * TILE));
    this.fx.push({ kind: 'arrow', who: v });
    v.task = 'slinging stones';
  }
  /**
   * The odd thing a fed gnome does now and then. Called from `Villager.tickMood` on its own timer,
   * so each of these fires a handful of times over a bowl rather than every frame.
   */
  gnomeQuirk(v: Villager, quirk: 'sprout' | 'caper' | 'crumb' | 'holler'): void {
    const here = v.tile;
    if (quirk === 'sprout') {
      // toadstools spring up in its footprints
      const spot = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, -1]]
        .map(([dx, dy]) => ({ tx: here.tx + dx, ty: here.ty + dy }))
        .find((q) => this.world.get(q.tx, q.ty)?.kind === 'grass' && !this.world.get(q.tx, q.ty)?.building);
      if (!spot) return;
      this.world.set(spot.tx, spot.ty, 'mushroom').stage = this.regrowDays('mushroom');
      this.fx.push({ kind: 'tool', tool: 'seed', tx: spot.tx, ty: spot.ty, who: v });
      return;
    }
    if (quirk === 'caper') { this.fx.push({ kind: 'hearts', who: v }); return; }
    if (quirk === 'holler') { this.fx.push({ kind: 'swing', who: v, dx: v.dir, dy: 0, stage: 0 }); return; }
    // a crumb of cake falls where the children will find it
    const c = World.center(here.tx, here.ty);
    if (this.world.itemsNear(c.x, c.y, TILE).length) return; // one crumb at a time
    this.world.dropItem('food', 1, v.x, v.y, 'cake');
  }
  /** One serving out of the pot for the head: the same meal a gnome gets, and the same warm glow after. */
  eatFromPot(dish: DishKind): boolean {
    const b = this.cookingAt ?? this.world.cookpot;
    if (!b) return false;
    const made = this.potServings(b);
    if ((made[dish] ?? 0) >= 1) { made[dish] = (made[dish] ?? 0) - 1; if ((made[dish] ?? 0) < 1e-9) delete made[dish]; }
    else if (this.player.carriedOf('food', dish) >= 1) this.player.takeOut('food', 1, dish); // one of your own
    else return false;
    this.player.hunger = Math.min(p.hungerMax, this.player.hunger + this.hungerOf(dish));
    this.dishBuff(dish);
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
    this.event('food', `${FOODS[kind].name}: +${r.heal} HP and +${Math.round(r.buffAdd * 100)}% ${DIET_STAT_NAME[stat]} for ${r.buffSecs}s.`);
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
  /** The line shown when the head stands at the great pot. */
  cookHint(b: Building): string {
    const was = this.cookingAt; this.cookingAt = b;
    const can = DISHES.filter((d) => !this.cookProblem(RECIPES[d]));
    this.cookingAt = was;
    const made = this.potServings(b);
    const ready = DISHES.filter((d) => (made[d] ?? 0) >= 1).map((d) => foodCount(made[d] ?? 0, d)).join(', ');
    const inPot = (Object.entries(this.potStock(b)) as [FoodKind, number][]).filter(([, n]) => n >= 0.05).map(([k, n]) => foodCount(Math.round(n * 10) / 10, k)).join(', ');
    return `open the Great Pot · ${can.length ? `${can.length} dish${can.length === 1 ? '' : 'es'} you can cook` : 'nothing you can cook yet — it shows what each dish needs'}${ready ? ` · ${ready} standing in it` : ''}${inPot ? ` · holding ${inPot}` : ''}`;
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
      { label: 'Well fed', ok: kid.ateDay >= this.day, note: 'ate in the yard today' },
      { label: 'Family', ok: parents >= 2, note: parents === 1 ? 'one parent' : parents === 0 ? 'no parents' : undefined },
      { label: 'Company', ok: sibling, note: 'another child at home' },
      { label: 'Warm', ok: kid.home.warm, note: kid.home.warm ? 'the hearth is lit' : 'their cottage is cold — stock its hearth' },
      { label: 'Home', ok: kid.home.level >= 2 && !kid.home.ruined && kid.home.warm, note: kid.home.ruined ? 'their cottage is in ruins' : 'cottage Lv2+' },
      { label: 'Attention', ok: kid.encouragedDay === this.day, note: 'encourage them' },
      { label: 'Safe', ok: kid.fledDay !== this.day, note: 'ran from raiders' },
    ];
  }
  /** Where a child runs when raiders come: the nearest cottage, warren or barracks door. */
  nearestShelter(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.world.buildings) {
      if ((b.kind !== 'barracks' && b.kind !== 'gnomehouse' && b.kind !== 'warren') || b.ruined) continue;
      const d = doorstep(b), c = World.center(d.tx, d.ty), dd = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }

  hoverAgent(m: Mover | null): void {
    this.hovered = m;
  }

  /** tile under the mouse (null when the pointer left the canvas); drives cursor placement */
  hoverTile: TilePos | null = null;
  /** the exact point under the mouse, for throws and bow aiming */
  hoverPoint: { x: number; y: number } | null = null;

  /** Refresh from screen coordinates so a stationary mouse still aims correctly as the camera follows. */
  private bowAim(): { x: number; y: number } | null {
    if (this.forcedAim) return this.forcedAim;
    if (!this.hoverPoint) return null;
    return this.view?.aimPoint() ?? null;
  }

  onPointerMove(ptr: Ptr): void {
    this.hovered = ptr.agent;
    if (this.drag) { this.drag.x1 = ptr.worldX; this.drag.y1 = ptr.worldY; }
    if (this.placing) { this.placing.x1 = ptr.worldX; this.placing.y1 = ptr.worldY; }
    this.hoverTile = { tx: Math.floor(ptr.worldX / TILE), ty: Math.floor(ptr.worldY / TILE) };
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
      case 'grass':
        if (lying) html = `<div class="t">On the ground</div><div class="d">${lying} · walk over it to pick it up</div>`;
        else if (t.tall) html = `<div class="t">Long grass</div><div class="d">slows everyone to ${Math.round(p.grassSlow * 100)}% — raiders too · swing the sword to mow it</div>`;
        break;
      case 'thicket': html = `<div class="t">Thicket</div><div class="d">thorns: ${p.thicketDps} HP a second and ${Math.round(p.thicketSlow * 100)}% pace to anyone in it — it creeps over fields and forage every night · the axe clears it in one blow, the sword in two</div>`; break;
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
      case 'barracks': case 'granary': case 'woodyard': case 'gnomehouse': case 'warren': {
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
    this.world.beginTick();
    this.newsClock += dt;

    this.dayTime += dt / p.dayLength;
    if (this.dayTime >= 1) {
      this.dayTime -= 1;
      this.day++;
      this.newDay();
    }


    this.mealCd = Math.max(0, this.mealCd - dt);
    this.tickLobs(dt);
    this.driveCommand(dt);
    // At 120 ticks a second (the game loop: see tickRate) the heavy work is shared between two ticks, so
    // every frame carries half of it: the blocks think on one tick and bodies are pushed apart on the
    // other, each with two ticks' time, and each agent moves on alternate ticks. A longer step (the
    // checks call tick(1/60)) does all of it every time.
    const half = dt < 1 / 90 ? (this.tickHalf ^= 1) : -1;
    if (half !== 1) { const dt2 = half < 0 ? dt : dt * 2; this.tickHosts(dt2); this.tickRegiments(dt2); }
    this.updateAgents(dt, half);
    if (half !== 0) this.separate();
    this.tickAges(dt);
    this.tickHunger(dt);
    this.tickBirths();
    this.world.tickItems(dt);
    this.potAbsorb();
    this.tickThorns(dt);
    this.validateTool();
    this.pickUpItems(dt);
    this.tickMending(dt);
    this.tidySelection();
    this.tickHives(dt);
    this.tickSkulks(dt);
    this.tickAdaptiveSpawns(dt);
    this.tickTowers(dt);
    for (const a of this.agents) if (a.dead) this.onDeath(a as Mover);
    this.removeDead();

    this.watchRuins(dt);
    // finding the lair: the first time it comes into sight
    if (!this.lairFound && this.world.lair && this.fog) {
      const c = buildingCenter(this.world.lair);
      if (this.fog.visibleAt(c.tx * TILE, c.ty * TILE) > 0.5) { this.lairFound = true; this.event('raid', "You found the Ogre's lair. It reeks of old meat. He sleeps by day."); }
    }
    if (this.battle && (this.newsClock - this.battle.last >= BATTLE_QUIET || (this.raidActive && !this.agents.some((a) => a instanceof Raider && !a.lairBound)))) this.tellBattle();
    if (this.raidActive && !this.agents.some((a) => a instanceof Raider && !a.lairBound)) {
      this.raidActive = false;
      this.stats.raidsRepelled++;
      this.slowMo();
      if (this.boss?.dead) { this.endRun(true); return; }
      this.event('raid', 'The raid is broken. Count the living.', true);
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
    else this.event('food', 'You slept badly on an empty belly, and dreamt of teeth.');
    this.creepThicket();
    this.tendCamps();
    if (p.caravanEvery > 0 && this.day >= p.caravanFirstDay && (this.day - p.caravanFirstDay) % Math.round(p.caravanEvery) === 0) this.sendCaravan();
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
      this.event('info', `The woodcutters won't go ${ns}${ns && ew ? '-' : ''}${ew} any more. Something walks the forest there, taller than the trees. Only at night.`);
    }
    // the gnomes: that they exist, never where. Their glade is the clue — walk into it.

    this.burnHearths();
    // the warrens' night, in one line each rather than one a child
    if (this.warrenBorn) this.event('birth', `${this.warrenBorn} gnome${this.warrenBorn === 1 ? ' was' : 's were'} born in the warrens`);
    if (this.warrenToddled) this.event('grow', `${this.warrenToddled} gnome child${this.warrenToddled === 1 ? '' : 'ren'} toddled out of the warrens`);
    this.warrenBorn = this.warrenToddled = 0;
    // Baby Fever is judged on the larder as the day breaks, before anyone eats
    const fever = this.feverActive();
    if (this.mods.babyFever && this.feverWas !== null && fever !== this.feverWas) this.event('birth', fever ? 'Baby fever: full larders, and the village knows it.' : 'The surplus is gone — births return to normal.');
    this.feverWas = fever;

    // villagers: eat (children from the piles in their yard, everyone else from the granary), tally the children's day
    const villagers = this.villagers(), warnedHomes = new Set<Building>(), starved: Villager[] = [];
    for (const v of villagers) {
      if (v.role === 'infant') continue; // nursed: judged after the grown have eaten, below
      const ration = this.rationOf(v);
      let wellFed = false;
      if (v.role === 'kid' && v.home.kind !== 'warren') {
        // children eat nothing but what lands in their home yard: yesterday's meal came off a pile, or it didn't
        if (p.kidFood <= 0 || v.ateDay >= this.day - 1) { v.hungerDays = 0; wellFed = true; }
        else if (++v.hungerDays >= p.kidStarveDays) { v.dead = true; v.hp = 0; v.starved = true; starved.push(v); continue; }
        else if (!warnedHomes.has(v.home)) { warnedHomes.add(v.home); this.event('food', `Children at a cottage are going hungry — throw food in their yard (BASKET)`, true); }
      }
      else if (this.food >= ration) { this.food -= ration; v.hungerDays = 0; }
      else if (++v.hungerDays >= 3 + this.mods.starveDaysDelta) { v.dead = true; v.hp = 0; v.starved = true; starved.push(v); continue; }
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
      const nursed = villagers.some((o) => o !== v && (v.home.kind === 'warren' || o.home === v.home) && o.isAdult && !o.dead && o.hungerDays === 0);
      if (nursed) { v.hungerDays = 0; continue; }
      if (++v.hungerDays >= p.kidStarveDays) { v.dead = true; v.hp = 0; v.starved = true; starved.push(v); continue; }
      if (!nurseryWarned) { nurseryWarned = true; this.event('food', `${v.name} goes hungry in the nursery — a fed grown-up at home nurses the infants`, true); }
    }

    // the night's hunger, told once: one name, or how many and who
    if (starved.length === 1) this.event('death', `${starved[0].name} starved in the night${starved[0].role === 'infant' ? ', in the nursery — nobody at home was fed' : starved[0].isChild ? ' — nothing lay in their yard' : ''}.`);
    else if (starved.length) this.event('death', `${starved.length} starved in the night: ${starved.slice(0, 4).map((v) => v.name).join(', ')}${starved.length > 4 ? ` and ${starved.length - 4} more` : ''}. Feed the yards and fill the granary.`, starved.length >= 3);

    // move-ins: adults from crowded houses take a spare room elsewhere
    for (const h of this.world.gnomeHouses) {
      if (!this.hasBed(h)) continue;
      const mover = villagers.find((v) => v.isAdult && !v.dead && v.home !== h && this.homesFor(v).includes(h) && villagers.filter((o) => o.home === v.home && o.isAdult).length > 2);
      if (mover) { mover.home.residents--; mover.home = h; h.residents++; this.event('info', `${mover.name} moved into a new cottage`); }
    }

    if (p.peaceful) {
      // nobody marches. The run still has a length: outlast the day the Warlord would have come.
      if (this.day >= p.bossDay) { this.event('raid', 'The Warlord never came. The village endures — for now.', true); this.endRun(true); }
      return;
    }
    const warn = Math.max(0, 1 + this.mods.warnDaysDelta);
    if (this.day === p.bossDay) this.spawnRaid(true);
    else if (this.isRaidDay(this.day)) this.spawnRaid();
    // the next host musters where your scouts can see it gather, and says when it will march
    if (this.day === p.bossDay - RUN.warnDays) {
      const h = this.musterHost(true, p.bossDay);
      if (h) this.event('raid', `The Warlord marches. His host of ${h.peak} gathers to the ${h.from} — he arrives in ${RUN.warnDays} days`, true);
    } else if (warn > 0 && (this.isRaidDay(this.day + warn) || this.day + warn === p.bossDay)) {
      const h = this.musterHost(false, this.day + warn);
      if (h) this.event('raid', `Scouts report a host of ${h.peak} mustering to the ${h.from} — it marches ${warn > 1 ? `in ${warn} days` : 'tomorrow'}. Meet it in the open, or bar the doors.`, true);
    }
  }

  // ---- the breeding program: nurseries, ages, pens ------------------------------------

  /** Cribs in a house's nursery: p.cribs, one more per level. */
  cribs(h: Building): number { return h.ruined ? 0 : h.kind === 'warren' ? WARREN.cribs : p.cribs + h.level - 1; }
  infantsOf(h: Building): Villager[] { return this.villagers().filter((v) => v.role === 'infant' && v.home === h && !v.dead); }
  /** Beds in use: residents less the infants, who sleep in cribs. */
  bedsTaken(h: Building): number { return h.residents - this.infantsOf(h).length; }
  hasBed(h: Building): boolean { return this.bedsTaken(h) < this.beds(h); }
  /** Seconds until this house next rolls for a birth (0 when due). */
  birthIn(h: Building): number { return Math.max(0, (h.nextBirth ?? 0) - this.simTime); }
  /**
   * Places one building keeps in work, times the standing buildings of that kind: a second barracks
   * allows another p.soldierCap warriors. A ruin keeps nobody, so losing a granary closes its places.
   */
  callingCap(c: Calling): number {
    if (c === 'soldier') return this.world.barracks.reduce((n, b) => n + p.soldierCap + SOLDIER_CAP_PER_LEVEL * (Math.min(3, b.level) - 1), 0);
    if (c === 'woodcutter') return p.woodcutterCap * this.world.woodyards.length;
    return p.farmerCap * this.world.granaries.length;
  }
  /** Places taken: the grown who hold one, plus every child already promised one (see Villager.calling). */
  callingFilled(c: Calling): number {
    return this.villagers().filter((v) => !v.dead && (v.isAdult ? v.role === c : v.calling === c)).length;
  }
  /** Callings with a place still open. */
  freeCallings(): Calling[] {
    return CALLINGS.filter((c) => this.callingFilled(c) < this.callingCap(c));
  }
  /**
   * The calling a newborn is promised: the trade standing emptiest as a share of its own cap, ties in
   * CALLINGS order. A 5/5/10 village therefore fills out about 1:1:2 and opens farmer, woodcutter,
   * warrior, warrior — where picking by free places alone would promise the first five children to the
   * barracks (10 open beats 5) and starve the village before a field was ever worked.
   */
  pickCalling(): Calling | null {
    let best: Calling | null = null, bestShare = Infinity;
    for (const c of CALLINGS) {
      const cap = this.callingCap(c), filled = this.callingFilled(c);
      if (cap <= 0 || filled >= cap) continue;
      const share = filled / cap;
      if (share < bestShare - 1e-9) { bestShare = share; best = c; }
    }
    return best;
  }
  /** Why no child will be born in this house right now, or null. */
  birthProblem(h: Building): string | null {
    if (h.ruined) return 'in ruins';
    if (!h.warm) return 'the hearth is cold';
    if (h.kind === 'warren') { if (this.villagers().filter((v) => v.isAdult && !v.dead).length < 2) return 'needs two grown gnomes in the village'; }
    else if (this.villagers().filter((v) => v.home === h && v.isAdult && !v.dead).length < 2) return 'needs a couple living here';
    if (this.infantsOf(h).length >= this.cribs(h)) return 'the nursery is full';
    if (this.food <= 10) return 'food to spare first';
    // no place to grow into, no child: the village raises nobody it cannot put to work
    if (!this.freeCallings().length) return `no work for another villager — ${CALLINGS.map((c) => `${this.callingFilled(c)}/${this.callingCap(c)} ${CALLING_NAME[c]}`).join(', ')}`;
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
    for (const h of this.world.gnomeHouses) {
      if (h.nextBirth === undefined) h.nextBirth = this.simTime + this.rng.range(0, p.birthEvery);
      if (h.nextBirth > this.simTime) continue;
      const warren = h.kind === 'warren';
      h.nextBirth = this.simTime + (warren ? p.warrenBirthEvery : p.birthEvery);
      if (this.birthProblem(h) || !this.rng.chance(this.birthChance(h, fever))) continue;
      const adults = this.villagers().filter((v) => (warren || v.home === h) && v.isAdult && !v.dead);
      const kid = this.addVillager(h, 'infant', 0);
      kid.calling = this.pickCalling(); // the place is theirs from birth, gnome or not
      kid.parents = [adults[0], adults[1]];
      // a twin needs a place of their own: the first child has just taken one
      if (this.infantsOf(h).length < this.cribs(h) && this.freeCallings().length && this.rng.chance(this.mods.twinChance)) {
        const twin = this.addVillager(h, 'infant', 0);
        twin.calling = this.pickCalling();
        twin.parents = [adults[0], adults[1]];
        if (warren) this.warrenBorn += 2; else this.event('birth', `Twins! ${kid.name} and ${twin.name} were born`);
      } else if (warren) this.warrenBorn++; // a warren's births are told once a dawn, all together
      else this.event('birth', `${kid.name} was born`);
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
      else if (v.age >= v.deathAt(this)) { v.dead = true; v.hp = 0; this.event('death', `${v.name} died in their sleep at ${Math.floor(v.age)}. The house is quieter.`); }
    }
  }
  /** An infant walks out of the house into the yard, to be fed and to learn the trade they were promised. */
  leaveNursery(v: Villager): void {
    v.role = 'kid'; v.applyRole(this.mods); v.hp = v.maxHp;
    v.unhide(this);
    v.mealAt = this.simTime + p.dayLength / 4;
    v.ateDay = this.day;
    if (v.home.kind === 'warren') { this.warrenToddled++; return; }
    this.event('grow', `${v.name} toddled out of the cottage`);
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
  homesFor(_v: Villager): Building[] { return this.world.gnomeHouses; }
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
  /** Where a throw is aimed: the mouse, or a few tiles ahead when it is off the map. */
  get tossAim(): { x: number; y: number } {
    const pl = this.player;
    return this.hoverPoint ?? { x: pl.x + pl.facing.x * p.tossRange * TILE / 2, y: pl.y + pl.facing.y * p.tossRange * TILE / 2 };
  }
  /** Why the basket can't throw at the aim, or null. */
  tossProblem(aim = this.tossAim): string | null {
    const pl = this.player;
    if (pl.carriedOf('food', pl.basketKind) <= 0) return 'the basket is empty — walk up to the granary (or pick something wild by hand)';
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
      const protectedFood = it.kind === 'food' && (this.world.inYard(it.x, it.y) || this.villagers().some(v=>v.eatingFrom===it)); // a child's dinner stays where it was thrown
      if (d > ITEM.reach && d <= range && !this.meatClaims.has(it.id) && !protectedFood) {
        let left = Math.min(p.pickupPull * dt, d - ITEM.reach);
        while (left > 0.001) {
          const step = Math.min(2,left), x=it.x+(pl.x-it.x)/d*step, y=it.y+(pl.y-it.y)/d*step;
          if (this.world.itemBlocked(x,y,0)) break;
          it.x=x;it.y=y;left-=step;d=Math.hypot(it.x-pl.x,it.y-pl.y);
        }
      }
      if (d > ITEM.reach + 0.001) continue;
      if (it.kind === 'gear') {
        if (it.gear && pl.pack.put(it.gear) >= 0) {
          this.world.removeItem(it);
          const g = it.gear;
          if (g.kind === 'tool' && !this.foundTools.has(g.tool)) { this.foundTools.add(g.tool); this.event('build', `You found your old ${TOOL_NAME[g.tool].toLowerCase()}! ${g.tool === 'hammer' ? 'Hold it to build.' : g.tool === 'axe' ? 'It fells trees and cuts thorns.' : 'It tills soil for seeds.'}`, true); }
        }
      }
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

  /** separate()'s working arrays, kept between ticks: who is solid, where, how big and how heavy; and the cells as linked lists (each cell's first body, each body's next) */
  private sep = { solid: [] as Mover[], x: new Float64Array(0), y: new Float64Array(0), sp: new Float64Array(0), ms: new Float64Array(0), next: new Int32Array(0), cell: new Int32Array(0), head: new Int32Array(0), touched: new Int32Array(0), big: [] as number[] };
  /**
   * Nobody stands inside anybody: overlapping bodies push apart, the lighter one giving way, and nobody is
   * pushed into a wall. With armies of hundreds this runs over thousands of bodies a tick, so it is a flat
   * pass that allocates nothing: each body's size, weight and place are read once into arrays, the bodies
   * are threaded into 16 px cells as linked lists, and every pair is visited once through half its cell's
   * neighbourhood. The few bodies too big for that (trolls, the Ogre, a warlord) are checked against the
   * cells around them, and against each other.
   */
  separate(): void {
    if (!p.collide) return;
    const S = this.sep, solid = S.solid;
    solid.length = 0;
    for (const a of this.agents) {
      if (!(a instanceof Mover) || a.dead || a.hidden || a instanceof Arrow || a instanceof Bolt || a instanceof Swarm) continue;
      if (a instanceof Villager && (a.carriedBy || a.role === 'infant')) continue;
      if (a instanceof Player && a.roll) continue; // a roll goes through bodies — walls still stop it
      solid.push(a);
    }
    const n = solid.length;
    if (S.x.length < n) { const cap = Math.max(256, n * 2); S.x = new Float64Array(cap); S.y = new Float64Array(cap); S.sp = new Float64Array(cap); S.ms = new Float64Array(cap); S.next = new Int32Array(cap); S.cell = new Int32Array(cap); S.touched = new Int32Array(cap); }
    const C = 16, cols = Math.ceil(this.W / C) + 2, rows = Math.ceil(this.H / C) + 2, small = C / 2;
    if (S.head.length !== cols * rows) { S.head = new Int32Array(cols * rows).fill(-1); }
    const X = S.x, Y = S.y, SP = S.sp, MS = S.ms, next = S.next, cellOf = S.cell, head = S.head, touched = S.touched, big = S.big;
    big.length = 0;
    let nt = 0;
    for (let i = 0; i < n; i++) {
      const m = solid[i];
      X[i] = m.x; Y[i] = m.y; SP[i] = m.space; MS[i] = m.mass;
      if (SP[i] > small) { big.push(i); cellOf[i] = -1; continue; }
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(m.x / C) + 1)), cy = Math.min(rows - 1, Math.max(0, Math.floor(m.y / C) + 1)), c = cy * cols + cx;
      if (head[c] === -1) touched[nt++] = c;
      next[i] = head[c]; head[c] = i; cellOf[i] = c;
    }
    const pair = (i: number, j: number) => {
      // the arrays first: most neighbours are not touching, and those need no more than this
      const dx = X[j] - X[i], dy = Y[j] - Y[i], minD = SP[i] + SP[j], d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) return;
      const a = solid[i], b = solid[j];
      if (a.elevated !== b.elevated) return;
      // two of one block: their slots keep them apart; one walking to its place slips between its mates instead of shouldering them out of theirs
      if (a.block && a.block === b.block && a.slot && b.slot && (a.vx || a.vy || b.vx || b.vy)) return;
      let d = Math.sqrt(d2), ux: number, uy: number;
      if (d < 0.01) { const ang = (a.id * 2.399 + b.id) % (Math.PI * 2); ux = Math.cos(ang); uy = Math.sin(ang); d = 0.01; } // dead centre: pick a direction
      else { ux = dx / d; uy = dy / d; }
      const overlap = minD - d, share = MS[j] / (MS[i] + MS[j]);
      this.nudge(a, -ux * overlap * share, -uy * overlap * share); X[i] = a.x; Y[i] = a.y;
      this.nudge(b, ux * overlap * (1 - share), uy * overlap * (1 - share)); X[j] = b.x; Y[j] = b.y;
    };
    // small bodies: the rest of its own cell's list, then the cell to the right and the three below (each pair once)
    const o1 = 1, o2 = cols - 1, o3 = cols, o4 = cols + 1, last = cols * rows;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c < 0) continue;
      for (let j = next[i]; j !== -1; j = next[j]) pair(i, j);
      let nb = c + o1; if (nb < last) for (let j = head[nb]; j !== -1; j = next[j]) pair(i, j);
      nb = c + o2; if (nb < last) for (let j = head[nb]; j !== -1; j = next[j]) pair(i, j);
      nb = c + o3; if (nb < last) for (let j = head[nb]; j !== -1; j = next[j]) pair(i, j);
      nb = c + o4; if (nb < last) for (let j = head[nb]; j !== -1; j = next[j]) pair(i, j);
    }
    // big bodies: against every small one in the cells they could touch, and against each other
    for (let bi = 0; bi < big.length; bi++) {
      const i = big[bi], reach = SP[i] + small;
      const x0 = Math.max(0, Math.floor((X[i] - reach) / C) + 1), x1 = Math.min(cols - 1, Math.floor((X[i] + reach) / C) + 1);
      const y0 = Math.max(0, Math.floor((Y[i] - reach) / C) + 1), y1 = Math.min(rows - 1, Math.floor((Y[i] + reach) / C) + 1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (let j = head[cy * cols + cx]; j !== -1; j = next[j]) pair(i, j);
      for (let bj = bi + 1; bj < big.length; bj++) {
        const j = big[bj], r = SP[i] + SP[j];
        if (Math.abs(X[j] - X[i]) < r && Math.abs(Y[j] - Y[i]) < r) pair(i, j);
      }
    }
    // leave the grid empty for next time: only the cells used are reset
    for (let t = 0; t < nt; t++) head[touched[t]] = -1;
  }
  /** Move a body by (dx, dy) unless that puts it in a blocked tile (then it stays and the other body takes the whole push next tick). */
  private nudge(m: Mover, dx: number, dy: number): void {
    const nx = m.x + dx, ny = m.y + dy, tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
    if (m instanceof Player) { if (!m.fits(nx, ny, this.world)) return; }
    // a push within the tile it already stands on needs no look at the ground (it is standing there)
    else if ((tx !== Math.floor(m.x / TILE) || ty !== Math.floor(m.y / TILE)) && this.world.isBlocked(tx, ty, m.hostile, m.elevated)) return;
    m.x = nx; m.y = ny;
  }
  /** Is another child already eating from this pile (within reach of it)? */
  someoneEating(item: Item, notMe: Villager): boolean {
    for (const v of this.villagers()) if (v !== notMe && v.eatingFrom === item && !v.dead && Math.hypot(v.x - item.x, v.y - item.y) <= ITEM.eatReach) return true;
    return false;
  }

  /** The children raised in a home and the food waiting in its yard. */
  yardReport(b: Building): { kids: number; hungry: number; food: number; piles: string } {
    const kids = this.villagers().filter((v) => v.role === 'kid' && v.home === b && !v.dead);
    const piles = FOOD_KINDS.map((k) => [k, this.world.yardFoodTotal(b, YARD, k)] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n % 1 ? n.toFixed(1) : n} ${FOODS[k].one}`).join(', ');
    return { kids: kids.length, hungry: kids.filter((v) => v.hungerDays > 0 || v.task.startsWith('hungry')).length, food: this.world.yardFoodTotal(b, YARD), piles };
  }
  /** A child's diet so far and what it will give them, for the UI. */
  dietReport(v: Villager): { kinds: { kind: FoodKind; n: number; share: number }[]; bonuses: string } {
    const b = v.dietNow();
    const bonuses = (['hp', 'speed', 'work', 'dmg'] as const).filter((k) => b[k] > 0.004).map((k) => `+${Math.round(b[k] * 100)}% ${DIET_STAT_NAME[k]}`).join(' · ');
    return { kinds: FOOD_KINDS.map((kind) => ({ kind, n: v.diet[kind], share: Math.min(1, v.diet[kind] / Math.max(1, p.dietFull)) })), bonuses };
  }

  /** Days between raids (Long Peace stretches it). */
  get raidEvery(): number { return p.raidEvery + this.mods.raidEveryDelta; }

  /**
   * A raid: the host that mustered for today marches (or, called with no warning, one musters and
   * marches at once). Its size comes from hostSize; see musterHost and launchHost.
   */
  spawnRaid(boss = false): void {
    const wave = Math.max(1, 1 + Math.floor((this.day - p.firstRaidDay) / this.raidEvery));
    const opts = { hpMul: (1 + p.waveHpGrowth * wave) * this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul, snatchDelayMul: this.mods.snatchDelayMul, noSnatch: this.mods.noSnatch, harmlessRats: this.mods.ratsHarmless };
    const host = this.hosts.find((h) => h.state === 'mustering') ?? this.musterHost(boss, this.day);
    if (host) this.launchHost(host, opts, boss);
  }

  // ---- hooks called by enemies ----------------------------------------------

  private ratsWarned = false;
  /** A rat gets a bite of the granary's stores: one food, from whatever it holds most of (told once a raid). */
  ratGnaw(): void {
    let best: FoodKind | null = null;
    for (const k of FOOD_KINDS) if (this.pantry[k] > 0 && (!best || this.pantry[k] > this.pantry[best])) best = k;
    if (!best) return;
    this.pantry[best] = Math.max(0, this.pantry[best] - 1);
    if (this.ratsWarned) return;
    this.ratsWarned = true;
    this.event('food', 'Rats in the granary — hundreds of them, gnawing at the stores!', true);
  }
  /** Where rat `id` gnaws: a free tile against the granary's walls, the swarm spread all round it. */
  gnawSpot(b: Building, id: number): TilePos | null {
    const f = BUILDINGS[b.kind], ring: TilePos[] = [];
    for (let x = b.tx - 1; x <= b.tx + f.w; x++) for (const y of [b.ty - 1, b.ty + f.h]) ring.push({ tx: x, ty: y });
    for (let y = b.ty; y < b.ty + f.h; y++) for (const x of [b.tx - 1, b.tx + f.w]) ring.push({ tx: x, ty: y });
    const open = ring.filter((q) => this.world.inBounds(q.tx, q.ty) && !this.world.isBlocked(q.tx, q.ty, true));
    return open.length ? open[id % open.length] : null;
  }
  childGrabbed(kid: Villager, by: Raider): void {
    this.event('raid', `A ${by.name.toLowerCase()} has taken ${kid.name}! Get them back before the trees do!`, true);
  }
  childCarriedOff(kid: Villager, _by: Raider): void {
    kid.carriedBy = null;
    kid.dead = true;
    kid.hp = 0;
    kid.hungerDays = 99; // keeps onDeath from logging "was killed"
    this.event('death', `${kid.name} was carried off into the woods. Nobody heard them scream.`);
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
      if (a.hp <= 0 && !a.starved && a.age < a.deathAt(this)) this.tallyLoss(a);
    } else if (a instanceof Boar) {
      // game, not an enemy: the meat lies where it fell for the head's hands or a gnome
      a.sounder.members = a.sounder.members.filter((b) => b !== a);
      if (a.hp <= 0) {
        this.stats.boarsHunted++;
        this.world.dropItem('food', a.meat, a.x, a.y, 'meat', this.rng);
        this.tallyKill(a, 'beast', a.meat);
      }
    } else if (a instanceof Skulk) {
      // no meat on one of these: it leaves the club it swung, or a single scrap off its trappings
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        if (this.rng.chance(p.skulkClub)) {
          const it = this.world.dropItem('gear', 1, a.x, a.y, undefined, this.rng);
          it.gear = { kind: 'weapon', slot: 'melee', tier: 0 };
        } else this.world.dropItem('scrap', 1, a.x, a.y, undefined, this.rng);
        this.tallyKill(a, 'foe');
      }
    } else if (a instanceof Troll) {
      // a monster, but the meat is good: it lies where it fell for the head's hands or a gnome
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        this.world.dropItem('food', a.meat, a.x, a.y, 'meat', this.rng);
        this.tallyKill(a, 'troll', a.meat);
      }
    } else if (a instanceof Raider) {
      if (a.carrying && !a.carrying.dead) { const kid = a.carrying; kid.carriedBy = null; a.carrying = null; this.event('grow', `${kid.name} was rescued!`); }
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        const scrap = (SCRAP_DROP as Record<string, number>)[a.kind] ?? 2;
        if (scrap > 0) this.world.dropItem('scrap', scrap, a.x, a.y, undefined, this.rng); // loot lies where the raider fell: walk over it
        const gear = enemyDrop(this.rng, a.kind, !!a.boss, this.day); // and now and then the gear it fought with
        if (gear) this.world.dropItem('gear', 1, a.x, a.y, undefined, this.rng).gear = gear;
        // Bounty: spoils and a second wind for the village head
        if (this.mods.killWood) this.addWood(this.mods.killWood);
        if (this.mods.killFood) this.addFood(this.mods.killFood);
        if (this.mods.killHeal) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.mods.killHeal);
        if (a instanceof Ogre) {
          this.stats.bossesSlain++;
          a.lair.level = 3; this.world.refresh(a.lair); // the fire goes out
          this.slowMo();
          this.event('raid', 'The Ogre is slain! His lair falls silent — for the first time in living memory.', true);
        } else if (a.boss) this.event('raid', 'The Warlord has fallen!', true);
        else this.tallyKill(a, 'foe');
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
  /** this tick's answers to identical target searches (a band at the head's heels asks the same question a thousand times) */
  private targetMemo = new Map<string, Raider | null>();
  /** the grid rebuild the memo belongs to: every frame rebuilds the grid (the game loop and the test steppers alike) */
  private memoGrid = -1;
  private gridStamp = 0;
  private memoFresh(): void {
    if (!(this.grid as unknown as { _stamped?: boolean })._stamped) {
      const g = this.grid as unknown as { rebuild(i: Iterable<unknown>): void; _stamped?: boolean }, orig = g.rebuild.bind(g);
      g.rebuild = (items) => { this.gridStamp++; orig(items); };
      g._stamped = true;
    }
    if (this.memoGrid !== this.gridStamp) { this.memoGrid = this.gridStamp; this.targetMemo.clear(); }
  }
  bestTarget(x: number, y: number, r: number): Raider | null {
    this.memoFresh();
    const key = `b${Math.round(x)},${Math.round(y)},${r}`;
    if (this.targetMemo.has(key)) { const m = this.targetMemo.get(key)!; if (!m || !m.dead) return m; }
    const found = this.bestTargetUncached(x, y, r);
    this.targetMemo.set(key, found);
    return found;
  }
  private bestTargetUncached(x: number, y: number, r: number): Raider | null {
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
    this.memoFresh();
    const key = `a${Math.round(x)},${Math.round(y)},${r}`;
    if (this.targetMemo.has(key)) { const m = this.targetMemo.get(key)!; if (!m || !m.dead) return m; }
    const found = this.attackingPlayerUncached(x, y, r);
    this.targetMemo.set(key, found);
    return found;
  }
  private attackingPlayerUncached(x: number, y: number, r: number): Raider | null {
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

  /** The nearest of your people (the head, a villager on its feet and not carried off) within r of (x, y). */
  nearestPerson(x: number, y: number, r: number): Mover | null {
    let best: Mover | null = null, bd = r * r;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (d2 >= bd || !(o instanceof Villager || o instanceof Player)) return;
      if (o.dead || o.hidden || (o instanceof Villager && o.carriedBy)) return;
      bd = d2; best = o;
    });
    return best;
  }
  /**
   * The nearest of your people to (x, y), anywhere: rings of the grid outward first (with an army of
   * hundreds and a host of hundreds, a scan of everyone for every raider is the whole frame), and only
   * when nobody is within 400 px a scan of the lot.
   */
  nearestVictim(x: number, y: number): Mover | null {
    for (const r of [64, 160, 400]) { const m = this.nearestPerson(x, y, r); if (m) return m; }
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


  // ---- buildings: beds, caps, upgrades ----------------------------------------------

  // ---- food and births --------------------------------------------------------

  /** What one villager eats from the granary at dawn: grown villagers only (infants are nursed, children eat from the pens). */
  rationOf(v: Villager): number {
    const full = p.foodPerDay * this.mods.foodPerDayMul;
    // a warren's children eat from the granary like the grown; everywhere else they eat what lies in their yard
    if (v.role === 'kid' && v.home.kind === 'warren') return full * p.gnomeRation;
    if (v.isChild) return 0; // infants are nursed, children eat only what lies in their home yard
    return full * p.gnomeRation;
  }
  /** births in the warrens since the last dawn, and children who left a warren's nursery: told once a dawn, together */
  warrenBorn = 0;
  warrenToddled = 0;
  /** A warren's card line: beds, cribs, how fast it breeds, what its people eat. */
  warrenReport(b: Building): string {
    const folk = this.villagers().filter((v) => v.home === b && !v.dead);
    const kids = folk.filter((v) => v.role === 'kid').length, eat = folk.reduce((n, v) => n + this.rationOf(v), 0);
    const perDay = this.birthProblem(b) ? 0 : (p.dayLength / p.warrenBirthEvery) * this.birthChance(b);
    return `${this.bedsTaken(b)}/${this.beds(b)} beds · nursery ${this.infantsOf(b).length}/${this.cribs(b)} · ${kids} children eating from the granary · ${perDay ? `about ${Math.round(perDay)} births a day (the cribs allowing)` : `no births: ${this.birthProblem(b)}`} · its folk eat ${eat.toFixed(1)} food a dawn`;
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
    if (h.kind === 'warren') return WARREN.beds;
    return Math.max(0, (GNOME_BEDS[h.level] ?? 3) + p.bedBonus);
  }
  get foodCap(): number { return Math.round(CAPS[this.world.granary?.level ?? 1] * this.mods.capMul); }
  get woodCap(): number { return Math.round(CAPS[this.world.woodyard?.level ?? 1] * this.mods.capMul); }
  private warnedFull = false;


  /** Add to the stockpile, respecting storage; says so (once a day) when the store is full. */
  /** Hand a carried load in at its building: the stockpile takes it (up to the cap) and the arms are free. */
  deposit(m: Mover, at?: Building): void {
    if (m instanceof Villager && m.role !== 'soldier') this.stowPouchGear(m);
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
    const now = b.kind === 'warren' ? this.warrenReport(b)
      : b.kind === 'gnomehouse' ? `${this.bedsTaken(b)}/${this.beds(b)} beds · nursery ${this.infantsOf(b).length}/${this.cribs(b)}${b.level >= 3 ? ' · births +15%' : ''}`
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
    if (b.kind === 'warren') return 'a warren comes in one size — dig another';
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
    this.event('build', `${BUILDINGS[b.kind].name} is now Lv${b.level} — ${LEVEL_PERKS[b.kind][b.level]}`);
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
    if (!(b.kind in COST)) return 'only cottages, warrens and barracks can be taken down';
    if ((b.kind === 'gnomehouse' || b.kind === 'warren') && this.villagers().some((v) => v.home === b && !v.dead) && !this.world.gnomeHouses.some((h) => h !== b && !h.ruined)) return 'its tenants would have nowhere to live';
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
    this.event('build', `Took down the ${BUILDINGS[b.kind].name.toLowerCase()}${refund ? ` — ${refund} wood recovered` : ''}`);
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
      this.event('build', `The ${BUILDINGS[b.kind].name.toLowerCase()} stands again.`);
      return true;
    }
    this.wood--; b.hp = Math.min(b.maxHp, b.hp + REPAIR.perWood);
    this.world.refresh(b);
    return true;
  }
  /** Standing buildings (never the lair) an enemy at `from` can walk to, nearest first; `kinds` narrows it. */
  /** The nearest building of `kinds` (any breakable one by default) a walker from `from` can reach: nearest first, one search at a time, stopping at the first that answers. */
  nearestReachableBuilding(from: TilePos, kinds?: readonly BuildingKind[]): Building | null {
    const fx = (from.tx + 0.5) * TILE, fy = (from.ty + 0.5) * TILE;
    const near = this.world.buildings.filter((b) => !(b.kind === 'lair' || b.ruined || !b.maxHp || (kinds && !kinds.includes(b.kind))))
      .map((b) => { const c = buildingCenter(b); return { b, d: (c.tx * TILE - fx) ** 2 + (c.ty * TILE - fy) ** 2 }; }).sort((a, z) => a.d - z.d);
    for (const { b } of near) {
      const f = BUILDINGS[b.kind];
      if (from.tx >= b.tx - 1 && from.tx <= b.tx + f.w && from.ty >= b.ty - 1 && from.ty <= b.ty + f.h) return b;
      if (this.world.bfs(from, doorstep(b), true).length) return b;
    }
    return null;
  }
  reachableBuildings(from: TilePos, kinds?: readonly BuildingKind[]): Building[] {
    const fx = (from.tx + 0.5) * TILE, fy = (from.ty + 0.5) * TILE;
    const out: { b: Building; d: number }[] = [];
    for (const b of this.world.buildings) {
      if (b.kind === 'lair' || b.ruined || !b.maxHp || (kinds && !kinds.includes(b.kind))) continue; // nothing to gain from battering what cannot break
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
   * them back to their trades; the next calls the ones within 20 tiles to your heels. Workers move by
   * `followingPlayer`, warriors by their standing order. The order sticks, so gnomes coming of age fall in
   * with the rest (see `Villager.comeOfAge`).
   */
  summonGnomes(): void {
    if (this.screen !== 'playing' || this.paused || this.interior.active) return;
    const adults = this.villagers().filter(v => v.isAdult && !v.dead);
    const workers = adults.filter(v => v.role !== 'soldier');
    // only warriors whose orders are ours to move: a wand hold or attack, and a wall post, are not
    const warriors = adults.filter(v => v.role === 'soldier' && !v.post && !v.regiment && (!v.order || v.order.kind === 'follow'));
    const following = workers.filter(v => v.followingPlayer).length + warriors.filter(v => v.order?.kind === 'follow').length + this.regiments.filter((r) => r.stance === 'follow').length;
    if (following) {
      this.gnomesFollow = false;
      for (const v of workers) v.followPlayer(this, false);
      for (const r of this.regiments) if (r.stance === 'follow') r.place(r.x, r.y, r.fx, r.fy, r.cols); // the banners plant where they stand
      for (const v of warriors) { v.order = null; v.clearGoal(); } // back to patrolling the barracks
      this.event('info', 'The gnomes go back to work. H or CALL GNOMES brings them to your heels.', true);
      return;
    }
    const nearby = [...workers, ...warriors].filter(v => !v.hidden && !v.carriedBy && v.dist(this.player) <= 20 * TILE);
    const banners = this.regiments.filter((r) => Math.hypot(r.x - this.player.x, r.y - this.player.y) <= 20 * TILE);
    for (const r of banners) r.stance = 'follow';
    if (banners.length) this.gnomesFollow = true;
    if (nearby.length) this.gnomesFollow = true; // a call nobody heard changes no standing order
    for (const v of nearby) {
      if (v.role === 'soldier') { v.order = { kind: 'follow' }; v.clearGoal(); }
      else v.followPlayer(this, true);
    }
    this.event('info', nearby.length ? `${nearby.length} gnome${nearby.length === 1 ? ' answers' : 's answer'} your call. H or SEND TO WORK puts them back to it.` : 'No grown gnomes within calling distance (20 tiles).', true);
  }

  shoot(who: Mover, dx: number, dy: number, dmg: number): boolean {
    if(who.weapons.bow<0)return false;
    if (this.arrows <= 0) { who.task = 'out of arrows'; if (who === this.player) this.event('info', 'Out of arrows. Craft a bundle at the barracks.'); return false; }
    const len = Math.hypot(dx, dy) || 1;
    who.aim = { x: dx / len, y: dy / len }; who.dir = dx < 0 ? -1 : 1;
    this.arrows--; who.attackCd = 0.65 * reloadMul(who.weapons);
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
    if (g.kind === 'tool' || g.kind === 'kit') return null;
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
  hearthBuildings(): Building[] { return this.world.buildings.filter((b) => hasHearth(b) && !b.ruined); }
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
  equipSoldier(v: Villager, weapon: 'sword' | 'bow' | 'pike'): void {
    if (v.role !== 'soldier' || v.dead) return;
    // past the recruits a soldier keeps the weapon of its line
    if (v.line && v.tier >= 2 && weapon !== v.line) { this.event('info', `${v.name} is a ${v.unitName}: it keeps its ${v.line}`, true); return; }
    v.weapon = weapon; v.attack = null; v.clearGoal();
    // a gnome with a new weapon leaves its banner for its weapon's group (it falls in again within half a second)
    const r = v.regiment;
    if (r && r.group <= 3 && r.group !== weaponGroup(weapon)) r.prune((m) => m !== v);
  }
  /**
   * A pike thrust lands: every raider along the line from the pikeman out to pike's length is struck.
   * A target running onto the point takes up to (1 + pikeBrace) times the blow — the faster it was
   * closing, the more — so a set pike is death to a charging Brute and only fair against a standing one.
   * Returns how many it struck.
   */
  pikeStrike(who: Mover, ux: number, uy: number, dmg: number): number {
    const reach = p.pikeReach;
    let hits = 0;
    for (const a of this.agents) {
      if (!(a instanceof Raider) || a.dead || a.hidden || a.elevated !== who.elevated) continue;
      const rx = a.x - who.x, ry = a.y - who.y;
      const along = rx * ux + ry * uy, across = Math.abs(rx * uy - ry * ux);
      if (along < p.pikeDeadZone * 0.5 || along > reach + a.radius || across > p.pikeWidth + a.radius) continue;
      // how hard it was coming on: its speed toward the pikeman, as a share of a brisk charge
      const closing = Math.max(0, -(a.vx * ux + a.vy * uy));
      const brace = 1 + p.pikeBrace * Math.min(1, closing / 80);
      const blow = Math.round(dmg * p.pikeDmgMul * brace);
      a.hit(blow, true, who);
      a.shove(ux, uy, brace > 1.5 ? 6 : 3);
      this.fx.push({ kind: 'hit', attacker: who, target: a, dmg: blow, crit: brace > 1.5, killed: !!a.dead });
      hits++;
    }
    this.fx.push({ kind: 'thrust', x1: who.x, y1: who.y - 4, x2: who.x + ux * reach, y2: who.y - 4 + uy * reach });
    if (!hits) this.fx.push({ kind: 'miss', who });
    return hits;
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
    this.event('soldier', `${v.name} is taking an archer post.`); return true;
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
    const who = this.loose();
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
    const regs = this.orderedRegiments();
    for (const r of regs) { r.stance = 'advance'; r.quarry = m; }
    const who = this.loose();
    for (const v of who) this.giveOrder(v, { kind: 'attack', target: m });
    if (regs.length && !who.length) this.wandFx(m.x, m.y - 12, 'ADVANCE');
    if (who.length) this.wandFx(m.x, m.y - 12, 'ATTACK');
    return who;
  }
  /** F with the wand: the squad shadows the head; pressed again, they hold where they stand. */
  orderFollow(): Villager[] {
    const regs = this.orderedRegiments();
    if (regs.length) { const all = regs.every((r) => r.stance === 'follow'); for (const r of regs) { if (all) r.place(r.x, r.y, r.fx, r.fy, r.cols); else r.stance = 'follow'; } }
    const who = this.loose();
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
  /** The wand's pointer: left picks (a click or a marquee), right orders. */
  private wandDown(ptr: Ptr): void {
    const m = ptr.agent;
    if (ptr.rightButtonDown()) {
      const top = ptr.wallTile ?? World.toTile(ptr.worldX, ptr.worldY);
      if (!(m instanceof Raider && !m.dead) && this.world.get(top.tx, top.ty)?.defense?.kind !== 'wall' && this.orderedRegiments().length) {
        this.placing = { x0: ptr.worldX, y0: ptr.worldY, x1: ptr.worldX, y1: ptr.worldY };
        return;
      }
      this.wandOrder(ptr, m); return;
    }
    const shift = (ptr.event as MouseEvent).shiftKey;
    if (m instanceof Villager && this.commandable(m)) { this.selectSquad(m.regiment ? m.regiment.members : [m], shift); return; }
    const flag = this.bannerAt(ptr.worldX, ptr.worldY);
    if (flag) { this.selectRegiment(flag, shift); return; }
    this.drag = { x0: ptr.worldX, y0: ptr.worldY, x1: ptr.worldX, y1: ptr.worldY };
  }
  wandUp(ptr: Ptr): void {
    const pl = this.placing;
    if (pl) {
      this.placing = null;
      pl.x1 = ptr.worldX; pl.y1 = ptr.worldY;
      for (const g of this.placementPlan(pl)) g.reg.place(g.x, g.y, g.fx, g.fy, g.cols);
      const q = World.toTile(pl.x0, pl.y0);
      if (this.loose().length && !this.world.isBlocked(q.tx, q.ty)) this.orderHold(q.tx, q.ty);
      else this.wandFx(pl.x0, pl.y0 - 8, 'FORM UP');
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const add = (ptr.event as MouseEvent).shiftKey;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 6) this.selectBox(d.x0, d.y0, d.x1, d.y1, add);
    else if (!add) this.clearSquad();
  }
  /** What the right button means: a raider = attack, a wall top = post, anywhere else = hold there. */
  private wandOrder(ptr: Ptr, m: Mover | null): void {
    if (m instanceof Raider && !m.dead) { this.orderAttack(m); return; }
    const top = ptr.wallTile ?? World.toTile(ptr.worldX, ptr.worldY);
    if (this.world.get(top.tx, top.ty)?.defense?.kind === 'wall') { this.orderPost(top); return; }
    const q = World.toTile(ptr.worldX, ptr.worldY);
    const spot = !this.world.isBlocked(q.tx, q.ty) ? q : this.world.nearest(ptr.worldX, ptr.worldY, (_t, tx, ty) => !this.world.isBlocked(tx, ty));
    if (spot) this.orderHold(spot.tx, spot.ty);
  }


  // ---- the fighting, told once it is over --------------------------------------------------------

  /**
   * A fight in progress: who has fallen on either side, and where. Nothing is posted body by body — a
   * battle of a thousand would bury the journal — and once BATTLE_QUIET seconds pass with nobody falling
   * (or the raid ends) it is told in one line, toasted only when it was a big one.
   */
  /** seconds of play, as the tick counts them (the fight's quiet is timed by it) */
  private newsClock = 0;
  battle: { slain: number; trolls: number; beasts: number; meat: number; lost: number; gnomes: number; thorns: number; sx: number; sy: number; n: number; host: boolean; last: number } | null = null;
  private battleNow(): NonNullable<VillageScene['battle']> {
    return this.battle ??= { slain: 0, trolls: 0, beasts: 0, meat: 0, lost: 0, gnomes: 0, thorns: 0, sx: 0, sy: 0, n: 0, host: false, last: this.newsClock };
  }
  /** One of yours has fallen in a fight. */
  tallyLoss(v: Villager): void {
    const b = this.battleNow();
    b.lost++; b.gnomes++;
    b.sx += v.x; b.sy += v.y; b.n++; b.last = this.newsClock;
    if (this.hosts.some((h) => h.state === 'marching')) b.host = true;
  }
  /** An enemy (or game) has been cut down; `meat` is what it leaves. */
  tallyKill(m: Mover, what: 'foe' | 'troll' | 'beast', meat = 0): void {
    const b = this.battleNow();
    if (what === 'troll') b.trolls++; else if (what === 'beast') b.beasts++; else b.slain++;
    b.meat += meat;
    b.sx += m.x; b.sy += m.y; b.n++; b.last = this.newsClock;
    if (this.hosts.some((h) => h.state === 'marching')) b.host = true;
  }
  /** Tell the fight in one line and start a fresh tally. */
  tellBattle(): void {
    const b = this.battle;
    this.battle = null;
    if (!b) return;
    const c = this.villageCentre(), x = b.sx / Math.max(1, b.n), y = b.sy / Math.max(1, b.n);
    const where = Math.hypot(x - c.x, y - c.y) < 25 * TILE ? 'at the village' : `to the ${this.bearing(x, y)}`;
    const parts: string[] = [];
    if (b.slain) parts.push(`${b.slain} ${b.slain === 1 ? 'raider' : 'raiders'} slain`);
    if (b.trolls) parts.push(`${b.trolls} troll${b.trolls === 1 ? '' : 's'} felled`);
    if (b.beasts) parts.push(`${b.beasts} boar${b.beasts === 1 ? '' : 's'} hunted`);
    const lost = b.lost ? `${b.lost} of yours lost${b.gnomes && b.gnomes < b.lost ? ` (${b.gnomes} gnome${b.gnomes === 1 ? '' : 's'})` : b.gnomes ? ` — all gnomes` : ''}${b.thorns ? `, ${b.thorns} to the thorns` : ''}` : parts.length ? 'none of yours lost' : '';
    if (lost) parts.push(lost);
    if (!parts.length) return;
    const meat = b.meat ? ` — ${b.meat} meat lies where they fell` : '';
    const big = b.lost >= BATTLE_BIG || (b.host && b.slain + b.lost >= BATTLE_BIG);
    this.event(b.lost && !b.slain && !b.trolls && !b.beasts ? 'death' : 'raid', `${b.slain + b.trolls + b.lost >= 10 ? 'The battle' : 'A fight'} ${where}: ${parts.join(', ')}${meat}.`, big);
  }

  // ---- hosts: the enemy's armies ------------------------------------------------------------------

  hosts: Host[] = [];
  private hostSeq = 0;
  /** Where the village stands, in sim pixels. */
  private villageCentre(): { x: number; y: number } { return World.center(COLS / 2, ROWS / 2); }
  /** Compass words for the direction from the village to (x, y). */
  private bearing(x: number, y: number): string {
    const c = this.villageCentre(), a = Math.atan2(y - c.y, x - c.x), k = Math.round(a / (Math.PI / 4));
    return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][(k + 8) % 8];
  }
  /** Muster ground for a host: a plain on the large map, or open, reachable ground 60-75 tiles out. */
  private hostSpot(): TilePos {
    if (this.world.plains.length) { const pl = this.rng.pick(this.world.plains); return { tx: pl.tx, ty: pl.ty }; }
    const hx = COLS / 2, hy = ROWS / 2;
    for (let tries = 0; tries < 200; tries++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(60, 75);
      const tx = Math.round(hx + Math.cos(a) * r), ty = Math.round(hy + Math.sin(a) * r * 0.7);
      if (tx < 6 || ty < 6 || tx > COLS - 7 || ty > ROWS - 7) continue;
      const t = this.world.get(tx, ty)!;
      if (t.building || t.kind === 'thicket' || this.world.isBlocked(tx, ty, true)) continue;
      if (!this.world.bfs({ tx, ty }, { tx: hx, ty: hy }, true).length) continue;
      return { tx, ty };
    }
    return { tx: hx, ty: hy + Math.min(40, ROWS / 2 - 6) };
  }
  /**
   * Raise a host for the raid on `day` out in the wild, its warbands camped in ranks facing the village.
   * Shield lines and wedges of raiders and butchers, knots of shamans behind; the Warlord (on his day)
   * at the head of the first. Its rats, snatchers and wreckers join when it marches. Nothing is raised
   * while another host is still mustering.
   */
  musterHost(boss: boolean, day: number, sizeOverride?: number, spot?: TilePos): Host | null {
    if (this.hosts.some((h) => h.state === 'mustering')) return null;
    // Scouts thin every host by a tenth a point; Hearsay shrinks the Warlord's
    const size = Math.max(1, Math.round((boss ? p.hostMax * Math.min(1, this.mods.bossEscortMul) : hostSize(day)) * Math.max(0.3, 1 - 0.1 * this.mods.waveShrink))), n = hostCounts(sizeOverride ?? size), q = spot ?? this.hostSpot(), at = World.center(q.tx, q.ty);
    const host = new Host(at, this.bearing(at.x, at.y), sizeOverride ?? size, day);
    const wave = Math.max(1, 1 + Math.floor((day - p.firstRaidDay) / this.raidEvery));
    const opts = { hpMul: (1 + p.waveHpGrowth * wave) * this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul, snatchDelayMul: this.mods.snatchDelayMul, noSnatch: this.mods.noSnatch, harmlessRats: this.mods.ratsHarmless };
    // the ranks: butchers spread through the shield lines, shamans in their own knots at the back
    const heavy: ('raider' | 'brute')[] = [];
    for (let i = 0, b = 0; i < n.raider + n.brute; i++) heavy.push(b < n.brute && (i + 1) * n.brute >= (b + 1) * (n.raider + n.brute) ? (b++, 'brute') : 'raider');
    const groups: { kinds: ('raider' | 'brute' | 'shaman')[]; shape: 'line' | 'wedge' | 'square' }[] = [];
    for (let i = 0, k = 0; i < heavy.length; i += WARBAND_SIZE.line, k++) groups.push({ kinds: heavy.slice(i, i + WARBAND_SIZE.line), shape: k % 2 ? 'wedge' : 'line' });
    for (let i = 0; i < n.shaman; i += WARBAND_SIZE.shaman) groups.push({ kinds: Array(Math.min(WARBAND_SIZE.shaman, n.shaman - i)).fill('shaman'), shape: 'square' });
    // camp: warbands three abreast, rank behind rank, all facing the village
    const c = this.villageCentre(), fd = Math.hypot(c.x - at.x, c.y - at.y) || 1, fx = (c.x - at.x) / fd, fy = (c.y - at.y) / fd;
    groups.forEach((g, i) => {
      const col = (i % 3) - 1, row = Math.floor(i / 3), spread = 9 * TILE;
      let bx = at.x + -fy * col * spread - fx * row * spread, by = at.y + fx * col * spread - fy * row * spread;
      const bt = World.toTile(bx, by);
      if (!this.world.inBounds(bt.tx, bt.ty) || this.world.isBlocked(bt.tx, bt.ty, true)) { bx = at.x; by = at.y; }
      const w = new Warband(++this.hostSeq, WARBAND_COLOURS[i % WARBAND_COLOURS.length], bx, by);
      w.shape = g.shape; w.face(fx, fy);
      const spots = w.slotsAt(bx, by, fx, fy, g.kinds.length);
      g.kinds.forEach((k, j) => {
        let { x, y } = spots[j];
        const t = World.toTile(x, y);
        if (!this.world.inBounds(t.tx, t.ty) || this.world.isBlocked(t.tx, t.ty, true)) { x = bx; y = by; }
        const r = this.spawn(k === 'brute' ? new Brute(x, y, opts) : k === 'shaman' ? new Shaman(x, y, opts) : new Raider(x, y, opts));
        r.lairBound = true; // camped: not yet a raid
        w.add(r);
      });
      host.warbands.push(w); this.warbands.push(w);
    });
    if (boss && host.warbands.length) {
      const w0 = host.warbands[0], wl = this.spawn(new Raider(w0.x, w0.y, { ...opts, boss: true }));
      wl.lairBound = true; w0.add(wl); this.boss = wl;
    }
    host.peak = host.bodies().length + n.rat + n.snatcher + n.wrecker;
    host.pending = n;
    this.hosts.push(host);
    return host;
  }
  /** The host marches: one route to the village, its loose rabble let go ahead of it, and the raid is on. */
  private launchHost(host: Host, opts: ConstructorParameters<typeof Raider>[2], boss: boolean): void {
    const c = this.villageCentre(), from = World.toTile(host.at.x, host.at.y), to = World.toTile(c.x, c.y);
    const tiles = this.world.bfs(from, to, true);
    const route = [host.at, ...tiles.filter((_, i) => i % 3 === 2 || i === tiles.length - 1).map((q) => World.center(q.tx, q.ty))];
    for (const r of host.bodies()) r.lairBound = false;
    const n = host.pending;
    if (n) {
      const at = () => ({ x: host.at.x + this.rng.range(-3, 3) * TILE, y: host.at.y + this.rng.range(-3, 3) * TILE });
      for (let i = 0; i < n.rat; i++) { const q = at(); host.loose.push(this.spawn(new Rat(q.x, q.y, opts))); }
      for (let i = 0; i < n.snatcher; i++) { const q = at(); host.loose.push(this.spawn(new Snatcher(q.x, q.y, opts))); }
      for (let i = 0; i < n.wrecker; i++) { const q = at(); host.loose.push(this.spawn(new Wrecker(q.x, q.y, opts))); }
    }
    host.march(route);
    for (const b of this.world.buildings) b.alarmed = false;
    this.raidActive = true;
    this.ratsWarned = false;
    if (boss && this.boss) this.fx.push({ kind: 'boss', who: this.boss });
    this.event('raid', boss ? `THE WARLORD ATTACKS from the ${host.from} with a host of ${host.peak}!` : `The host marches from the ${host.from} — ${host.peak} of them, in ${host.warbands.length} warband${host.warbands.length === 1 ? '' : 's'}!`, true);
  }
  /**
   * Each tick: hosts keep their columns in order; a warband at the walls breaks ranks and storms in; a
   * host cut below ROUT_SHARE of its strength breaks and runs, and those who make it home are gone.
   */
  tickHosts(dt: number): void {
    if (!this.hosts.length) return;
    const c = this.villageCentre(), reach = ASSAULT_RANGE * TILE;
    for (const h of this.hosts) {
      h.tick(dt);
      if (h.state === 'marching') {
        for (const w of h.warbands) if (w.members.length && Math.hypot(w.x - c.x, w.y - c.y) < reach) {
          if (!h.warbands.some((o) => o !== w && !o.members.length)) this.event('raid', `The host is at the walls — warband after warband breaks ranks and storms in!`, true);
          h.loose.push(...w.members); // still the host's: they count for its strength and its rout
          w.release();
        }
        if (h.peak >= 10 && h.alive() < h.peak * ROUT_SHARE) {
          h.rout();
          for (const w of h.warbands) for (const r of w.members) r.lairBound = true; // fleeing: no longer the raid
          this.event('raid', `The host breaks! Its last ${h.alive()} turn and run for the ${h.from}.`, true);
        }
      } else if (h.state === 'routed') {
        for (const w of h.warbands) if (w.members.length && Math.hypot(w.x - h.at.x, w.y - h.at.y) < 2 * TILE) for (const r of w.members) r.dead = true; // home and gone (no loot: nobody cut them down)
      }
    }
    this.hosts = this.hosts.filter((h) => h.alive() > 0 || h.state === 'mustering' && h.warbands.some((w) => w.members.length));
  }
  /** The HUD's word on the hosts: the one marching (how many, how far), else the one mustering. */
  hostStatus(): { marching: boolean; alive: number; peak: number; tiles: number; marchDay: number } | null {
    const h = this.hosts.find((q) => q.state === 'marching') ?? this.hosts.find((q) => q.state === 'mustering');
    if (!h) return null;
    const c = this.villageCentre(), lead = h.warbands.find((w) => w.members.length);
    const tiles = lead ? Math.round(Math.hypot(lead.x - c.x, lead.y - c.y) / TILE) : 0;
    return { marching: h.state === 'marching', alive: h.alive(), peak: h.peak, tiles, marchDay: h.marchDay };
  }

  // ---- far from anyone: creatures nobody of yours is near think at a quarter of the rate ------------------

  /** the map in 16-tile buckets: 1 where one of yours (the head, a villager) is within about three buckets */
  private awake = new Uint8Array(0);
  private awakeSeed = new Uint8Array(0);
  private awakeT = 0;
  private lodTick = 0;
  /** which half of the interleaved work this tick carries (see tick) */
  private tickHalf = 0;
  /** 120 ticks a second, each carrying half the heavy work: smooth at 120 fps, and no heavier at 60 */
  tickRate = 120;
  maxTicksPerFrame = 40;
  /**
   * Update everyone. Your own people, the head, arrows and anything near them update every tick; a
   * troll, a boar or a camp raider out where nobody of yours is (more than about 48 tiles from all of
   * them) updates every fourth tick with four ticks' time, so it keeps its pace at a quarter of the cost.
   * On the large map most of the wild is like that most of the time.
   */
  private updateAgents(dt: number, half = -1): void {
    const B = 16 * TILE, cols = Math.ceil(this.W / B), rows = Math.ceil(this.H / B), R = 3;
    if (this.awake.length !== cols * rows) { this.awake = new Uint8Array(cols * rows); this.awakeSeed = new Uint8Array(cols * rows); this.awakeT = 0; }
    const aw = this.awake;
    // who is near anyone of yours changes slowly: the map of it is redrawn every fourth tick
    if ((this.awakeT++ & 3) === 0) {
      const seed = this.awakeSeed;
      seed.fill(0);
      const mark = (x: number, y: number) => { const bx = Math.floor(x / B), by = Math.floor(y / B); if (bx >= 0 && by >= 0 && bx < cols && by < rows) seed[by * cols + bx] = 1; };
      mark(this.player.x, this.player.y);
      for (const a of this.agents) if (a instanceof Villager && !a.dead) mark(a.x, a.y);
      aw.fill(0);
      for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
        if (!seed[by * cols + bx]) continue;
        for (let y = Math.max(0, by - R); y <= Math.min(rows - 1, by + R); y++) for (let x = Math.max(0, bx - R); x <= Math.min(cols - 1, bx + R); x++) aw[y * cols + x] = 1;
      }
    }
    // interleaved (half 0 or 1): the head, arrows and bolts every tick; everyone else every other tick with
    // twice the time, and the far wild every eighth with eight times. Otherwise as before: all every tick,
    // the far wild every fourth.
    const far = half < 0 ? 4 : 8, k = this.lodTick++ & (far - 1);
    for (const a of this.agents) {
      const m = a as Mover;
      if (m instanceof Player || m instanceof Arrow || m instanceof Bolt) { a.update(dt, this); continue; }
      if (m instanceof Villager || m === this.boss || aw[Math.floor(m.y / B) * cols + Math.floor(m.x / B)]) {
        if (half < 0) a.update(dt, this);
        else if (((m.id + half) & 1) === 0) a.update(dt * 2, this);
        continue;
      }
      if (((m.id + k) & (far - 1)) === 0) a.update(dt * far, this);
    }
  }

  // ---- regiments: the gnome army in blocks under banners ---------------------------------------

  regiments: Regiment[] = [];
  /** the enemy's blocks in the field (see Warband; hosts raise them) */
  warbands: Warband[] = [];
  private regimentSeq = 0;
  private enlistT = 0;
  /** the wand's right button held on open ground: press = the centre, drag = the facing (and a line's width) */
  placing: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Who stands under a banner: grown gnome soldiers. */
  rankable(v: Villager): boolean { return this.commandable(v); }
  /** Orders to loose fighters: the picked ones (or everyone) not under a banner. */
  loose(): Villager[] { return this.recipients().filter((v) => !v.regiment); }
  /** The regiments an order goes to: those of the picked fighters (or every one when nobody is picked). */
  orderedRegiments(): Regiment[] { return this.squad.length ? this.regimentsOf(this.squad) : [...this.regiments]; }
  regimentsOf(list: Villager[]): Regiment[] { const out = new Set<Regiment>(); for (const v of list) if (v.regiment && !v.dead) out.add(v.regiment); return [...out]; }
  /** The regiments picked with the wand (none when nobody is picked). */
  pickedRegiments(): Regiment[] { return this.regimentsOf(this.squad); }
  selectRegiment(r: Regiment, add = false): void { this.selectSquad(r.members, add); }
  /** A banner within a tile of (x, y). */
  bannerAt(x: number, y: number): Regiment | null {
    let best: Regiment | null = null, bd = TILE;
    for (const r of this.regiments) { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r; } }
    return best;
  }
  /** A gnome soldier falls in under the newest banner with room, or a new banner is raised for it. */
  enlist(v: Villager): Regiment {
    // by weapon, as Bannerlord groups them: swords to I, pikes to II, bows to III (a banner moved to another group takes no recruits)
    const g = weaponGroup(v.weapon);
    let r = [...this.regiments].reverse().find((x) => x.group === g && x.members.length < REGIMENT_SIZE);
    if (!r) {
      this.regimentSeq++;
      r = new Regiment(this.regimentSeq, BANNER_COLOURS[(this.regimentSeq - 1) % BANNER_COLOURS.length], v.x, v.y);
      r.group = g;
      this.regiments.push(r);
    }
    r.add(v);
    return r;
  }
  /** Each tick: the fallen leave their banners, new warriors fall in, every block thinks and lays out its slots. */
  tickRegiments(dt: number): void {
    for (const r of this.regiments) r.prune((v) => this.rankable(v) && v.regiment === r);
    this.regiments = this.regiments.filter((r) => r.members.length > 0);
    this.enlistT -= dt;
    if (this.enlistT <= 0) {
      this.enlistT = 0.5;
      for (const a of this.agents) if (a instanceof Villager && !a.regiment && this.rankable(a) && (!a.order || a.order.kind === 'follow') && !a.post && !a.hidden) this.enlist(a);
    }
    // a soldier's default order, following the head, is the banner's job once it stands under one
    for (const r of this.regiments) for (const v of r.members) if (v.order?.kind === 'follow') { v.order = null; v.clearGoal(); }
    // the blocks following the head march in ranks of three behind it, each keeping its own station
    // the archers march behind everyone else: the foot in the first ranks (three banners abreast), the bows in ranks of their own after them
    const following = this.regiments.filter((r) => r.stance === 'follow');
    const foot = following.filter((r) => r.group !== 3), bows = following.filter((r) => r.group === 3);
    const ranks: Regiment[][] = [];
    for (const list of [foot, bows]) for (let i = 0; i < list.length; i += 3) ranks.push(list.slice(i, i + 3));
    for (let row = 0, back = 2 * TILE; row < ranks.length; row++) {
      const rank = ranks[row], widths = rank.map((r) => r.width()), depth = Math.max(...rank.map((r) => r.depth()));
      let at = -(widths.reduce((a, w) => a + w, 0) + TILE * (rank.length - 1)) / 2;
      rank.forEach((r, i) => { r.trail = { side: at + widths[i] / 2, back: back + depth / 2 }; at += widths[i] + TILE; });
      back += depth + TILE;
    }
    const pick = (x: number, y: number, r: number): Mover | null => this.bestTarget(x, y, r);
    for (const r of this.regiments) r.tick(dt, this.world, this.player, pick);
    // the enemy's blocks: the dead leave the ranks, an empty banner is struck, and the rest look for a fight
    for (const w of this.warbands) w.prune((r) => !r.dead && r.block === w);
    this.warbands = this.warbands.filter((w) => w.members.length > 0);
    const prey = (x: number, y: number, r: number): Mover | null => this.nearestPerson(x, y, r);
    for (const w of this.warbands) w.tick(dt, this.world, prey);
  }
  /**
   * Where a wand placement puts each ordered regiment: side by side across the drag's facing, centred on
   * the press. A click (no drag) faces the blocks the way they would walk; a line is two deep, and a longer drag stretches it wider.
   */
  placementPlan(pl: { x0: number; y0: number; x1: number; y1: number }, regs = this.orderedRegiments()): { reg: Regiment; x: number; y: number; fx: number; fy: number; cols: number; slots: { x: number; y: number }[] }[] {
    if (!regs.length) return [];
    const dx = pl.x1 - pl.x0, dy = pl.y1 - pl.y0, len = Math.hypot(dx, dy);
    let fx: number, fy: number;
    if (len > TILE / 2) { fx = dx / len; fy = dy / len; }
    else {
      const cx = regs.reduce((a, r) => a + r.x, 0) / regs.length, cy = regs.reduce((a, r) => a + r.y, 0) / regs.length, d = Math.hypot(pl.x0 - cx, pl.y0 - cy);
      if (d > TILE) { fx = (pl.x0 - cx) / d; fy = (pl.y0 - cy) / d; } else { fx = regs[0].fx; fy = regs[0].fy; }
    }
    const sized = regs.map((reg) => {
      const n = Math.max(1, reg.active().length);
      const wide = reg.shape === 'line' || reg.shape === 'shieldwall', gap = reg.spacing();
      const cols = wide && len > TILE / 2 ? Math.max(Math.ceil(n / 2), Math.min(n, Math.round(len / regs.length / gap))) : wide ? reg.cols : 0;
      let lo = Infinity, hi = -Infinity;
      for (const o of layout(reg.shape, n, cols)) { lo = Math.min(lo, o.ox); hi = Math.max(hi, o.ox); }
      return { reg, cols, n, width: (hi - lo + 1) * gap };
    });
    const gap = TILE, total = sized.reduce((a, z) => a + z.width, 0) + gap * (sized.length - 1);
    const rx = -fy, ry = fx;
    let at = -total / 2;
    return sized.map(({ reg, cols, n, width }) => {
      const off = at + width / 2; at += width + gap;
      const x = pl.x0 + rx * off, y = pl.y0 + ry * off;
      return { reg, x, y, fx, fy, cols, slots: reg.slotsAt(x, y, fx, fy, n, reg.shape, cols) };
    });
  }
  // ---- promotion: experience earned in the field, the step up bought at the barracks ------------

  /** Why `v` can't be promoted (to its next tier, down `branch` at the fork), or null. */
  promoteProblem(v: Villager, branch?: UnitBranch): string | null {
    if (v.dead || v.role !== 'soldier') return 'only soldiers are promoted';
    const next = v.tier + 1;
    if (next > UNIT.maxTier) return 'already Elite';
    if (v.xp < UNIT.xp[next]) return `needs ${UNIT.xp[next]} experience (has ${Math.floor(v.xp)})`;
    if (!this.world.barracks.length) return 'promotions are made at a barracks: build one';
    if (this.world.barracksLevel < UNIT.barracks[next]) return `needs a Lv${UNIT.barracks[next]} barracks`;
    if (next === 3 && !branch) return 'pick the branch';
    const c = this.promoteCost(next);
    if (this.wood < c.wood) return `needs ${c.wood} wood (have ${this.wood | 0})`;
    if (this.scrap < c.scrap) return `needs ${c.scrap} scrap (have ${this.scrap})`;
    return null;
  }
  /** What a promotion to `tier` costs. */
  promoteCost(tier: number): { wood: number; scrap: number } { const c = UNIT.cost[tier] ?? { wood: 0, scrap: 0 }; return p.freeBuild ? { wood: 0, scrap: 0 } : c; }
  /** Promote `v` one tier (down `branch` at the fork): pays, steps up, and its role is re-applied. */
  promote(v: Villager, branch?: UnitBranch): boolean {
    const why = this.promoteProblem(v, branch);
    if (why) { this.event('info', `Can't promote ${v.name}: ${why}`, true); return false; }
    const next = v.tier + 1, c = this.promoteCost(next);
    this.wood -= c.wood; this.scrap -= c.scrap;
    if (next === 2) v.line = v.weapon;
    if (next === 3) v.branch = branch ?? 'a';
    v.tier = next;
    const frac = v.hp / Math.max(1, v.maxHp);
    v.applyRole(this.mods); v.hp = Math.round(v.maxHp * frac);
    this.event('soldier', `${v.name} is promoted: ${v.unitName}.`);
    return true;
  }

  /** Set regiments' stance (a hold is where they stand). */
  setStance(regs: Regiment[], stance: Stance): void {
    for (const r of regs) {
      if (stance === 'hold') r.place(r.x, r.y, r.fx, r.fy, r.cols);
      else { r.stance = stance; if (stance === 'advance') r.quarry = null; }
    }
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, stance === 'hold' ? 'HOLD' : stance === 'advance' ? 'ADVANCE' : 'FOLLOW');
  }
  // ---- the command bar: Bannerlord's order menus ----------------------------------------------------

  /** the open order menu: 0 the top (pick formations, then F1-F4), 1-4 a menu (F1-F7 an item); null when the bar is shut */
  cmdMenu: number | null = null;
  /** the bar was opened by an F-key (it shuts after an order) rather than by holding the wand (it stays) */
  private cmdByKey = false;
  /** Is the command bar showing? An F-key opened it, or the wand is in hand with banners to command. */
  commandOpen(): boolean { return this.screen === 'playing' && this.regiments.length > 0 && (this.cmdMenu !== null || this.player.tool === 'wand'); }
  /** The menu showing: what an F-key opened, or the top when the wand is held. */
  commandMenu(): number { return this.cmdMenu ?? 0; }
  /** Open the bar on menu `m` (0 the top). */
  openCommand(m: number): boolean {
    if (this.screen !== 'playing' || this.interior.active) return false;
    if (!this.regiments.length) { this.event('info', 'No formations to command yet: gnome soldiers fall in under banners', true); return false; }
    if (this.cmdMenu === null) this.cmdByKey = this.player.tool !== 'wand';
    this.cmdMenu = m;
    return true;
  }
  /** Esc: back to the top, then shut. True when it did something. */
  commandBack(): boolean {
    if (!this.commandOpen()) return false;
    if (this.commandMenu() > 0) { this.cmdMenu = 0; return true; }
    if (this.cmdMenu !== null) { this.cmdMenu = null; return true; }
    return false; // the wand's bar stays while the wand is in hand
  }
  /** An item of a menu: the order goes to the picked formations (all of them when none are picked). */
  commandItem(menu: number, item: number): boolean {
    const regs = this.orderedRegiments(), aim = this.aimAt();
    if (!regs.length) return false;
    const def = ORDER_MENUS[menu - 1];
    if (!def || item < 1 || item > def.items.length) return false;
    if (menu === 1) [() => this.moveTo(regs, aim.x, aim.y), () => this.setStance(regs, 'follow'), () => this.charge(regs), () => this.setStance(regs, 'advance'), () => this.setStance(regs, 'hold'), () => this.retreat(regs)][item - 1]();
    else if (menu === 2) this.faceOrder(regs, item === 1 ? 'enemy' : 'point', aim.x, aim.y);
    else if (menu === 3) this.formOrder(regs, SHAPES[item - 1]);
    else if (menu === 4) this.fireOrder(regs, item === 2);
    // an order given: back to the top, and shut altogether when an F-key opened the bar
    this.cmdMenu = this.cmdByKey ? null : 0;
    return true;
  }
  /** The window's keys while there are formations: F1-F4 open a menu (and pick its items, up to F7); 1-8 pick a group (Shift adds), 0 all; Alt+1-8 transfers. */
  commandKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.repeat) return;
    // Esc backs out of a menu at once (not on the next frame, as the game's own keys go), so it never lands after the F-key that follows it
    if (e.key === 'Escape' && this.commandBack()) { e.preventDefault(); e.stopPropagation(); return; }
    const f = /^F([1-7])$/.exec(e.key);
    if (f) {
      const n = Number(f[1]);
      if (n <= 4 && this.commandMenu() === 0 && this.openCommand(n)) { e.preventDefault(); e.stopPropagation(); return; }
      if (this.commandOpen() && this.commandMenu() > 0) { e.preventDefault(); e.stopPropagation(); this.commandItem(this.commandMenu(), n); }
      return;
    }
    if (!this.commandOpen()) return;
    const d = /^Digit([0-8])$/.exec(e.code);
    if (!d) return;
    const n = Number(d[1]);
    e.preventDefault();
    if (e.altKey) { if (n >= 1) this.transferGroup(this.pickedRegiments(), n); return; }
    this.selectGroup(n, e.shiftKey);
  }

  // ---- formation orders: what the F-key menus send (see the command bar) -------------------------

  /** Pick a formation group (1-8), or all of them (0); `add` keeps what was picked. */
  selectGroup(n: number, add = false): Regiment[] {
    const regs = n === 0 ? [...this.regiments] : this.regiments.filter((r) => r.group === n);
    if (!add) this.clearSquad();
    if (regs.length) this.selectSquad(regs.flatMap((r) => r.members), true);
    return regs;
  }
  /** Move banners into group `n` (Bannerlord's transfer). They keep it; recruits still go to I-III by weapon. */
  transferGroup(regs: Regiment[], n: number): void {
    for (const r of regs) r.group = Math.max(1, Math.min(8, n));
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, `TO ${GROUP_NAME[regs[0].group].toUpperCase()}`);
  }
  /** F1 F1: march to where the cursor points, facing the way they walk (side by side, as a right-click places them). */
  moveTo(regs: Regiment[], x: number, y: number): void {
    for (const g of this.placementPlan({ x0: x, y0: y, x1: x, y1: y }, regs)) { g.reg.place(g.x, g.y, g.fx, g.fy, g.cols); g.reg.faceEnemy = false; }
    if (regs.length) this.wandFx(x, y - 8, 'MOVE');
  }
  /** F1 F3: break ranks and go for them. */
  charge(regs: Regiment[]): void {
    for (const r of regs) { r.stance = 'charge'; r.quarry = null; r.faceEnemy = false; r.rally = null; }
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, 'CHARGE!');
  }
  /** F1 F6: fall back to the village at a run, side by side about its centre, and hold there. */
  retreat(regs: Regiment[]): void {
    const c = this.villageCentre();
    for (const g of this.placementPlan({ x0: c.x, y0: c.y, x1: c.x, y1: c.y }, regs)) { const r = g.reg; r.rally = { x: g.x, y: g.y }; r.stance = 'retreat'; r.quarry = null; r.faceEnemy = false; r.dest = { x: g.x, y: g.y }; }
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, 'FALL BACK');
  }
  /** F2: face the nearest enemy (and keep facing it), or face where the cursor points. A follower stops to do it. */
  faceOrder(regs: Regiment[], how: 'enemy' | 'point', x = 0, y = 0): void {
    for (const r of regs) {
      if (r.stance !== 'hold') r.place(r.x, r.y, r.fx, r.fy, r.cols);
      if (how === 'enemy') r.faceEnemy = true;
      else { r.faceEnemy = false; r.face(x - r.x, y - r.y); r.dirty = true; }
    }
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, how === 'enemy' ? 'FACE THE ENEMY' : 'FACE');
  }
  /** F3: take a formation. */
  formOrder(regs: Regiment[], shape: Shape): void {
    for (const r of regs) r.setShape(shape);
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, SHAPE_NAME[shape].toUpperCase());
  }
  /** F4: archers in these ranks loose at will, or hold their fire. */
  fireOrder(regs: Regiment[], hold: boolean): void {
    for (const r of regs) r.holdFire = hold;
    if (regs.length) this.wandFx(regs[0].x, regs[0].y - 12, hold ? 'HOLD FIRE' : 'FIRE AT WILL');
  }
  /** The next shape for these regiments, in the Form menu's order. */
  cycleShape(regs: Regiment[]): void {
    if (!regs.length) return;
    const next: Shape = SHAPES[(SHAPES.indexOf(regs[0].shape) + 1) % SHAPES.length];
    for (const r of regs) r.setShape(next);
    this.wandFx(regs[0].x, regs[0].y - 12, next.toUpperCase());
  }
  /** F, G, T and H while the wand is out and a regiment is picked: shape, hold, advance, follow. True when taken. */
  regimentKey(k: 'F' | 'G' | 'T' | 'H'): boolean {
    if (this.player.tool !== 'wand' || this.screen !== 'playing') return false;
    const regs = this.pickedRegiments();
    if (!regs.length) return false;
    if (k === 'F') this.cycleShape(regs);
    else this.setStance(regs, k === 'G' ? 'hold' : k === 'T' ? 'advance' : 'follow');
    return true;
  }

  /** the tools the head has found (or started with): Recover basic kit gives back only these */
  foundTools = new Set<Implement>(START_TOOLS);

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
    if (!BUILDABLE.has(tile?.kind ?? 'tree')) return 'Clear trees and bushes before building defenses';
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
  /** Context action: use a nearby doorway, stairs, or gate. */
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
  buildAnchor(kind: BuildingKind = this.player.build === 'none' ? 'gnomehouse' : this.player.build): { tx: number; ty: number } {
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
  buildProblem(a: { tx: number; ty: number }, kind: BuildingKind = this.player.build === 'none' ? 'gnomehouse' : this.player.build): string | null {
    const { w, h } = BUILDINGS[kind];
    const locked = this.toolLocked(kind as Tool);
    if (locked) return locked;
    if (!this.world.canBuild(kind, a.tx, a.ty)) return `Need ${w}x${h} of open ground (no trees or buildings)`;
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
    if (this.forcedTile) return this.forcedTile;
    return this.cursorAiming ? this.hoverTile! : this.player.faced;
  }
  /** flatten-in-progress bookkeeping: the tile being hammered/flattened resets when you move on */
  private workTile: TilePos | null = null;
  private workOn(tx: number, ty: number): void {
    if (this.workTile && (this.workTile.tx !== tx || this.workTile.ty !== ty)) {
      const prev = this.world.get(this.workTile.tx, this.workTile.ty);
      if (prev && (prev.building || prev.defense)) { prev.work = 0; this.world.markDirty(this.workTile.tx, this.workTile.ty); }
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
    if (pl.elevated && pl.tool !== 'bow' && pl.tool !== 'sword') { this.event('info', 'Use the stairs to return to ground level first.'); return; }
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
      case 'basket': this.toss(); return;
      case 'sword': {
        const stage = pl.pressAttack();
        if (stage >= 0) this.fx.push({ kind: 'swing', who: pl, dx: pl.facing.x, dy: pl.facing.y, stage });
        return;
      }
      case 'gnomehouse':
      case 'warren':
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
        this.event('build', `Built a ${BUILDINGS[pl.tool].name.toLowerCase()}`);
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
      case 'axe':
        if (t?.kind === 'tree') {
          const why = this.loadProblem('wood', undefined, p.playerTreeYield);
          if (why) { this.event('wood', why + '.'); return; }
          // the head clears ground; the real wood comes in on woodcutters' backs
          if (++t.work >= this.workHits(3)) { this.knockDownHive(tx, ty, this.player); this.world.set(tx, ty, 'sapling'); this.player.pickUp('wood', p.playerTreeYield); }
          else this.world.dirty.add(ty * COLS + tx);
        } else if (t?.kind === 'sapling') this.world.set(tx, ty, 'grass'); // clear the stump
        else if (t?.kind === 'thicket') {
          // one blow clears a tile; the canes go in the pack as a little firewood
          if (this.world.cutThicket(tx, ty, 1) && p.thicketWood > 0 && !this.loadProblem('wood', undefined, p.thicketWood)) this.player.pickUp('wood', p.thicketWood);
        }
        this.fx.push({ kind: 'tool', tool: 'axe', tx, ty });
        return;
    }
  }

  /**
   * What your two hands do, on whatever you pointed at: open the great pot, pick a
   * wild plant, climb a stair, work a gate. There is no HANDS tool any more — the right button does all
   * of it whatever you are holding, and falls back to looking the thing over when there is nothing to do.
   * Returns true when it did something.
   */
  handsAt(q: TilePos): boolean {
    if (this.screen !== 'playing' || this.interior.active) return false;
    const pl = this.player;
    if (pl.busy > 0) return false;
    // out of arm's reach it is not your hands' business
    if (pl.dist(World.center(q.tx, q.ty)) > ITEM.reach + TILE) return false;
    if (this.checkNearby(q)) return true; // stairs and gates first: they are what you are standing on
    const t = this.world.get(q.tx, q.ty);
    if (!t || pl.elevated) return false;
    if (t.kind === 'cookpot') { this.openCooking(t.building ?? this.world.cookpot ?? null); return true; }
    if (WILD_FOOD[t.kind]) {
      // foraging: a ripe bush or patch gives its yield and starts regrowing
      const kind = WILD_FOOD[t.kind]!;
      if (!this.wildRipe(t)) { this.event('food', `Nothing to pick yet — ${FOODS[kind].name.toLowerCase()} in ${this.regrowDays(kind) - t.stage} day${this.regrowDays(kind) - t.stage === 1 ? '' : 's'}`); return true; }
      const why = this.loadProblem('food', kind);
      if (why) { this.event('food', why + '.'); return true; }
      const got = this.pickWild(q.tx, q.ty, Math.min(this.wildLeft(t), pl.roomFor('food', kind)));
      pl.pickUp('food', got, kind);
      this.fx.push({ kind: 'tool', tool: 'seed', tx: q.tx, ty: q.ty });
      return true;
    }
    return false;
  }

  /** What the tool would do right now, as "E: verb" (or a reason it won't). */
  /**
   * What your hands would do on the pointed tile, for the hint line — the right button's half of it,
   * shown next to whatever the held tool offers. Null when there is nothing there to handle.
   */
  handsHint(q: TilePos = this.target): string | null {
    const pl = this.player, t = this.world.get(q.tx, q.ty);
    if (!t) return null;
    if (t.defense?.kind === 'stairs' || this.world.get(pl.tile.tx, pl.tile.ty)?.kind === 'stairs') return `${pl.elevated ? 'descend' : 'climb'} stairs`;
    if (pl.elevated) return null;
    if (t.defense?.kind === 'gate') return `${t.defense.open ? 'close' : 'open'} gate`;
    if (t.kind === 'cookpot') return this.cookHint(t.building ?? this.world.cookpot!);
    if (WILD_FOOD[t.kind]) {
      const fk = WILD_FOOD[t.kind]!, why = this.loadProblem('food', fk);
      return this.wildRipe(t) ? (why ?? `pick ${FOODS[fk].name.toLowerCase()} (${this.wildLeft(t)} · ${FOODS[fk].blurb})`) : `${FOODS[fk].name.toLowerCase()} picked — back in ${this.regrowDays(fk) - t.stage} day${this.regrowDays(fk) - t.stage === 1 ? '' : 's'}`;
    }
    return null;
  }
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
        if (t?.kind === 'thicket' || this.world.thicketAt(pl.x, pl.y)) return 'E: hack at the thicket (two swings a tile — the axe clears it in one)';
        return t?.tall ? 'E: mow the long grass (a swing clears its arc)' : 'E: swing sword';
      }
      case 'wand': {
        const n = this.squad.length, all = this.fighters().length;
        if (!all) return 'wand: nobody to command — grown soldiers answer it';
        const regs = this.pickedRegiments();
        if (regs.length) return `${regs.length === 1 ? `banner ${regs[0].id} picked (${regs[0].members.length}, ${regs[0].shape}, ${regs[0].stance})` : `${regs.length} banners picked`} · right-drag on the ground: place it — the drag is the facing, and a line's width · right click a raider: advance on it · F shape · G hold · T advance · H follow`;
        return `${n ? `${n} picked` : `no one picked — orders go to all ${all}`} · left click / drag: pick soldiers · right click: ground = hold there, raider = attack, wall top = archer post · F: follow me`;
      }
      case 'basket': {
        const why = this.tossProblem();
        const carry = `basket: ${pl.carriedOf('food', pl.basketKind)} ${FOODS[pl.basketKind].one} · F: change food`;
        if (why) return `${carry} — ${why}`;
        const aim = this.tossAim;
        const throwing = `E: throw ${Math.min(pl.carriedOf('food', pl.basketKind), p.tossSize)} ${FOODS[pl.basketKind].one}`;
        const home = this.world.gnomeHouses.find((b) => { const c = buildingCenter(b); return Math.hypot(c.tx * TILE - aim.x, c.ty * TILE - aim.y) <= YARD * TILE; });
        if (!home) return `${throwing} — no yard there: children only eat what lands within ${YARD} tiles of the home they live in (${carry})`;
        const r = this.yardReport(home);
        return `${throwing} into the ${home.kind === 'warren' ? 'warren' : 'cottage'} yard (${carry} · ${r.kids} children, ${r.hungry} hungry · ${r.piles || 'nothing'} lying there)`;
      }
      case 'gnomehouse':
      case 'warren':
      case 'barracks': {
        const why = this.buildProblem(this.buildAnchor(pl.tool), pl.tool);
        return `E: build ${BUILDINGS[pl.tool].name.toLowerCase()} ${this.cursorPlacing ? 'where you point' : 'ahead'} (${this.buildCost(pl.tool)} wood)${pl.tool === 'barracks' ? ' · the ring is its arrow range' : pl.tool === 'gnomehouse' ? ' · a gnome couple moves in' : pl.tool === 'warren' ? ` · sleeps ${WARREN.beds}, ${WARREN.cribs} cribs, its children eat from the granary` : ''}${why ? ' — ' + why : ''}`;
      }
      case 'hammer': {
        if (t?.defense) return t.defense.hp < t.defense.maxHp ? `E: repair ${t.kind} (${Math.ceil(t.defense.hp)}/${t.defense.maxHp} HP · 1 wood repairs ${p.wallRepair})` : `E: take down ${t.kind} (${DISMANTLE.hits - t.work} more hits · ${Math.round(this.defenseCost(t.kind as DefenseKind) * DISMANTLE.refund)} wood back)`;
        if (!b) return 'hammer: face a building to upgrade it';
        if (b.kind !== 'lair' && b.ruined) { const why = this.repairProblem(b); return why ? `${this.buildingTitle(b)} — ${why}` : `E: rebuild ${BUILDINGS[b.kind].name} (${this.rebuildCost(b)} wood)`; }
        if (b.kind !== 'lair' && b.hp < b.maxHp) return `E: repair ${BUILDINGS[b.kind].name} (${Math.ceil(b.hp)}/${b.maxHp} HP · 1 wood repairs ${REPAIR.perWood})`;
        const why = this.upgradeProblem(b);
        return why ? `${this.buildingTitle(b)} — ${why}` : `E: upgrade ${BUILDINGS[b.kind].name} → Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} (${this.upgradeCost(b)} wood, ${this.mods.hammerHits - (t?.work ?? 0)} hits)`;
      }
      case 'axe':
        if (kind === 'tree') { const why = this.loadProblem('wood', undefined, p.playerTreeYield); return why ?? `E: clear ${this.isOldGrowth(t!) ? 'old growth' : 'young tree'}${this.world.hiveAt(tg.tx, tg.ty) ? ' — A HIVE HANGS HERE' : ''} (${t!.work}/3 · ${p.playerTreeYield} wood for you; a woodcutter gets ${this.treeYield(t!)}) · ${pl.carriedOf('wood')} wood in pack`; }
        if (kind === 'sapling') return t!.stage < 2 ? 'E: clear the stump' : 'E: cut down the sapling';
        if (kind === 'thicket') return `E: hack out the thicket (one blow · ${p.thicketWood} wood)`;
        return 'axe: face a tree';
    }
  }

  // ---- rendering ------------------------------------------------------------

  draw(): void {
    const dt = this.game.loop.delta / 1000;
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

  }
}

const query = new URLSearchParams(location.search);

// Dev switches, so a link is enough: ?peaceful and ?nohunger set the debug sliders before the first setup().
if (query.has('peaceful')) p.peaceful = true;
if (query.has('nohunger')) p.hunger = false;
// ?bench=1000: a stress test once the first village is up (see VillageScene.bench)
// ?bench=1000&host=1000: against a marching host instead of a ring of raiders
if (query.has('bench')) {
  const go = () => {
    const s = (window as unknown as { game?: { scene: { scenes: unknown[] } } }).game?.scene.scenes.find((q): q is VillageScene => q instanceof VillageScene);
    if (!s) { window.setTimeout(go, 500); return; }
    if (s.screen !== 'playing') s.startGame();
    const host = Number(query.get('host')) || 0;
    s.bench(Number(query.get('bench')) || 1000, host ? 0 : 150, host);
  };
  window.setTimeout(go, 2500);
}
// lil-gui caches its controllers' values at module load, so the panel needs telling the flag moved.
if (p.peaceful || query.has('nohunger')) getGui().controllersRecursive().forEach((c) => c.updateDisplay());

launch(VillageScene, { width: COLS * TILE, height: ROWS * TILE, zoom: ZOOM, scale: 'resize', pixelArt: true, background: '#1a2a1c' });
