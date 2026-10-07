import type { Agent } from '@shared/index';
import { World, WILD_FOOD, doorstep, buildingCenter, BUILDINGS, type House, type Building, type TilePos, type Defense, type BuildingKind } from './world';
import { p, TREE_RESERVE, STAR_BONUS, BEDTIME, TRAITS, HAUL, TILE, ELDER_MUL, GNOME_CALLING, MOODS, type Mood, type DishKind, ORDER, YARD, GNOME_PACK, ITEM, MASS, BODY, FOODS, FOOD_KINDS, CROP_KINDS, DIET_CAP, zeroFood, BOAR, type Calling, type Trait, type LoadKind, type FoodKind, type DietStat } from './config';
import type { Mods } from './meta';
import { NO_ARMOR, NO_WEAPONS, armorStats, weaponMul, type Armor, type Weapons, type HelmetStyle } from './characters';
import type { VillageScene } from './main';
import type { Item } from './items';
import { Pack, START_TOOLS } from './pack';
import { WorkerSafety, WORKER_DANGER, WORKER_CLEAR } from './worker-safety';
import type { BulkKind } from './config';
import type { Block, Regiment, Warband } from './regiment';

// All distances are in world pixels: 16 px per tile.

// ---------------------------------------------------------------------------
// shared movement / combat

export abstract class Mover implements Agent {
  id = 0;
  vx = 0;
  vy = 0;
  dead?: boolean;
  hp = 10;
  maxHp = 10;
  speed = 35; // px/s
  radius = 3;
  /** how much room the body takes in a crowd (see BODY); never less than its hit radius */
  get space(): number { return this.radius; }
  color = 0xffffff;
  attackCd = 0;
  /** true while tucked away inside a house (not drawn, not targetable). */
  hidden = false;
  elevated = false;
  /** what this body is carrying: chopped wood or picked food, on its way to the woodyard / granary */
  /** what the arms hold: wood, or food of one kind */
  load: { kind: LoadKind; n: number; food?: FoodKind } | null = null;
  /** Put a yield in this body's arms (one kind at a time — the other kind is taken in first; one crop per armful). */
  pickUp(kind: BulkKind, n: number, food?: FoodKind): number {
    if (kind === 'scrap' || (this.load && (this.load.kind !== kind || (kind === 'food' && this.load.food !== food)))) return 0;
    this.load = { kind, n: (this.load?.n ?? 0) + n, food: kind === 'food' ? food : undefined };
    return n;
  }
  carriedLoads(): readonly { kind: BulkKind; n: number; food?: FoodKind }[] { return this.load ? [{ ...this.load }] : []; }
  roomFor(kind: BulkKind, food?: FoodKind): number {
    if (kind === 'scrap' || !this.canCarry(kind, food)) return 0;
    const cap = this instanceof Player ? HAUL.player[kind] : this instanceof Villager ? this.haul(kind) : HAUL.villager[kind];
    return Math.max(0, cap - (this.load?.n ?? 0));
  }
  carriedOf(kind: BulkKind, food?: FoodKind): number { return this.load?.kind === kind && (kind !== 'food' || food === undefined || this.load.food === food) ? this.load.n : 0; }
  takeOut(kind: BulkKind, n: number, food?: FoodKind): number {
    const take = Math.min(Math.max(0, n), this.carriedOf(kind, food));
    if (take && this.load) { this.load.n -= take; if (this.load.n < 1e-9) this.load = null; }
    return take;
  }
  /** Can these arms take n of this? */
  canCarry(kind: LoadKind, food?: FoodKind): boolean { return !this.load || (this.load.kind === kind && (kind !== 'food' || this.load.food === food)); }
  hostile = false;
  aim = { x: 1, y: 0 };
  private pathRevision = -1;
  /** -1 faces left, 1 faces right (sprite flip). */
  dir = 1;
  /** seconds since last hit, for the hurt flash */
  hurtT = 99;
  /** worn armor (the head and soldiers); raiders wear none */
  armor: Armor = { ...NO_ARMOR };
  /** forged weapon tiers; a crude club and hunting bow until the chest forges better */
  weapons: Weapons = { ...NO_WEAPONS };
  /** look customisation: tabard dye, helmet style, plume */
  dye = 0;
  helmetStyle: HelmetStyle = 0;
  plume = 0;
  /** set when the last hit was blocked by a shield (the renderer pops BLOCK) */
  blocked = false;
  /** speed multiplier from armor (legs) */
  get armorSpeed(): number { return armorStats(this.armor).speedMul; }
  /** what this agent is doing, for the inspector */
  task = '';
  /** how hard this body is to push aside when bodies overlap */
  get mass(): number { return MASS.villager; }

  path: TilePos[] = [];
  goal: TilePos | null = null;

  constructor(public x: number, public y: number) {}

  abstract update(dt: number, s: VillageScene): void;

  get tile(): TilePos {
    return World.toTile(this.x, this.y);
  }

  /** Re-path only when the goal tile changes (or `force`). */
  setGoal(s: VillageScene, tx: number, ty: number, force = false): void {
    if (!force && this.pathRevision === s.world.revision && this.goal && this.goal.tx === tx && this.goal.ty === ty) return;
    const path = s.world.route(this.tile, { tx, ty }, this.hostile, this.elevated);
    if (path === null) { this.goal = null; return; } // over the tick's path budget: keep walking, ask again next tick
    this.goal = { tx, ty };
    this.pathRevision = s.world.revision;
    this.path = path;
  }

  clearGoal(): void {
    this.goal = null;
    this.path = [];
    this.stallT = 0; this.lastGap = Infinity;
  }

  /** seconds spent walking without getting closer to the next waypoint (a body in the way pushes back as fast as we walk), and how close we got */
  private stallT = 0;
  private lastGap = Infinity;

  /** the banner this body stands under (a regiment of yours or an enemy warband), and its spot in the block */
  block: Block | null = null;
  slot: { x: number; y: number } | null = null;
  /** walking to the slot: seconds without getting closer, and how close it was */
  private slotStall = 0;
  private slotGap = Infinity;

  /** Walk straight toward (x, y) this tick; a blocked tile stops the step. Returns the distance moved. */
  protected stepToward(dt: number, s: VillageScene, x: number, y: number): number {
    const dx = x - this.x, dy = y - this.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) { this.vx = this.vy = 0; return 0; }
    const pace = this.speed * s.world.slowAt(this.x, this.y), step = Math.min(d, pace * dt);
    const nx = this.x + (dx / d) * step, ny = this.y + (dy / d) * step, tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
    if (Math.abs(dx) > 0.5) this.dir = dx < 0 ? -1 : 1;
    // never into a wall, and never into thorns from clear ground (one already caught in them walks out);
    // a step that stays on the tile it is on needs no look at the ground
    if ((tx !== Math.floor(this.x / TILE) || ty !== Math.floor(this.y / TILE)) && (s.world.isBlocked(tx, ty, this.hostile, this.elevated) || (s.world.thicketAt(nx, ny) && !s.world.thicketAt(this.x, this.y)))) { this.vx = this.vy = 0; return 0; }
    this.x = nx; this.y = ny; this.vx = (dx / d) * pace; this.vy = (dy / d) * pace;
    return step;
  }

  /**
   * Walk to this body's slot in its block: straight there, and along a path only after 1.5 s without
   * getting closer. In the slot it stands facing the block's way (`fx`) and is about `settled`.
   */
  protected toSlot(dt: number, s: VillageScene, fx: number, settled: string): void {
    const slot = this.slot;
    if (!slot) { this.vx = this.vy = 0; this.task = 'falling in'; return; }
    const dx = slot.x - this.x, dy = slot.y - this.y, d = Math.hypot(dx, dy);
    // the path fallback: walk it until the slot is near again
    if (this.goal) {
      if (d < TILE * 0.75 || this.followPath(dt)) this.clearGoal();
      this.task = 'finding a way back to the ranks'; return;
    }
    if (d < 0.75) {
      this.vx = this.vy = 0; this.slotStall = 0; this.slotGap = Infinity;
      if (Math.abs(fx) > 0.2) this.dir = fx < 0 ? -1 : 1;
      this.task = settled;
      return;
    }
    const step = this.stepToward(dt, s, slot.x, slot.y);
    this.slotStall = d < this.slotGap - step * 0.25 ? Math.max(0, this.slotStall - dt) : this.slotStall + dt;
    this.slotGap = d;
    if (this.slotStall > 1.5) {
      this.slotStall = 0; this.slotGap = Infinity;
      const q = World.toTile(slot.x, slot.y);
      if (d > TILE * 0.75 && !s.world.isBlocked(q.tx, q.ty, this.hostile) && !s.world.thicketAt(slot.x, slot.y)) this.setGoal(s, q.tx, q.ty, true);
    }
    this.task = 'taking its place in the ranks';
  }

  /** Advance along the path. Returns true when there is nowhere left to go. */
  followPath(dt: number): boolean {
    if (this.path.length === 0) { this.vx = this.vy = 0; return true; }
    if (this.world?.isBlocked(this.path[0].tx, this.path[0].ty, this.hostile, this.elevated)) { this.clearGoal(); this.vx = this.vy = 0; return true; }
    const next = World.center(this.path[0].tx, this.path[0].ty);
    const dx = next.x - this.x, dy = next.y - this.y;
    const d = Math.hypot(dx, dy);
    const pace = this.speed * (this.world?.slowAt(this.x, this.y) ?? 1); // long grass drags at everyone
    const step = pace * dt;
    if (Math.abs(dx) > 0.5) this.dir = dx < 0 ? -1 : 1;
    if (d <= step) {
      this.x = next.x; this.y = next.y;
      this.path.shift();
      this.stallT = 0; this.lastGap = Infinity;
      return this.path.length === 0;
    }
    // Stalled: someone stands in the way and the collision push cancels every step. Bodies used to lock like this for
    // good (two soldiers heading through each other, anyone walking into the head). After half a second, either
    // settle for where we are when the last tile is the one taken, or hop half a tile to the side and try again.
    this.stallT = d < this.lastGap - step * 0.25 ? Math.max(0, this.stallT - dt / 2) : this.stallT + dt;
    this.lastGap = d;
    if (this.stallT > 0.5) {
      this.stallT = 0; this.lastGap = Infinity;
      if (this.path.length === 1 && d < TILE) { this.path = []; this.vx = this.vy = 0; return true; }
      const px = -dy / d, py = dx / d, hop = (this.id % 2 ? 1 : -1) * TILE * 0.6;
      for (const side of [hop, -hop]) {
        const nx = this.x + px * side, ny = this.y + py * side, t = World.toTile(nx, ny);
        if (this.world && !this.world.isBlocked(t.tx, t.ty, this.hostile, this.elevated)) { this.x = nx; this.y = ny; break; }
      }
      return false;
    }
    this.vx = (dx / d) * pace; this.vy = (dy / d) * pace;
    this.x += this.vx * dt; this.y += this.vy * dt;
    return false;
  }

  dist(o: { x: number; y: number }): number {
    return Math.hypot(o.x - this.x, o.y - this.y);
  }

  /** Is `pos` the tile we stand on or one of its 4 neighbours? */
  adjacentTo(pos: TilePos): boolean {
    const t = this.tile;
    return Math.abs(t.tx - pos.tx) + Math.abs(t.ty - pos.ty) <= 1;
  }

  /** knockback impulse (px/s), decays over ~200 ms */
  pushX = 0;
  pushY = 0;
  /** how much of a push this body takes (brutes 0.3, the warlord 0.15) */
  pushScale = 1;
  /** hitstop: seconds this body stays frozen after a big hit lands */
  freeze = 0;
  /** telegraphed melee attack in progress (raiders, soldiers) */
  attack: { target: Mover; t: number; windup: number; recover: number; dmg: number; reach: number; struck: boolean } | null = null;

  /** Take a blow. Chest armor shaves it; a shield can turn a melee hit away entirely (`melee` = not an arrow/bolt). */
  /** Take a blow. `by` is whoever struck (a wild boar turns on them); arrows pass their archer, towers nobody. */
  hit(dmg: number, melee = true, by?: Mover): void {
    void by;
    const st = armorStats(this.armor);
    this.blocked = false;
    if (melee && st.block > 0 && Math.random() < st.block) { this.blocked = true; this.hurtT = 0.2; return; }
    this.hp -= Math.max(1, Math.round(dmg * st.dmgMul));
    this.hurtT = 0;
    if (this.hp <= 0) this.dead = true;
  }

  /** How hard this body's blows throw what they land on. An ordinary swing is 3. */
  protected get blowPush(): number { return 3; }
  /** Shove this body: the impulse plays out over the next few ticks (see tickTimers). */
  shove(ux: number, uy: number, px: number): void {
    this.pushX += ux * px * this.pushScale * 6;
    this.pushY += uy * px * this.pushScale * 6;
  }

  /**
   * Start a telegraphed melee attack: wind up, then strike (re-checking reach, so the target can
   * step away), then recover. Returns true while an attack is running so callers hold position.
   */
  startAttack(s: VillageScene, target: Mover, dmg: number, reach: number, windup: number, recover: number): boolean {
    if (this.attack || this.attackCd > 0 || this.dist(target) > reach + 4 || this.elevated !== target.elevated || !s.world.lineClear(this, target, this.elevated)) return false;
    this.dir = target.x < this.x ? -1 : 1;
    this.attack = { target, t: 0, windup, recover, dmg, reach, struck: false };
    this.vx = this.vy = 0;
    s.fx.push({ kind: 'telegraph', who: this, ms: windup * 1000 });
    return true;
  }

  /** Advance a running attack. Returns true while it still occupies this body. */
  attackTick(dt: number, s: VillageScene): boolean {
    const a = this.attack;
    if (!a) return false;
    a.t += dt;
    if (!a.struck && a.t >= a.windup) {
      a.struck = true;
      const t = a.target;
      s.fx.push({ kind: 'melee', who: this, x: t.x, y: t.y });
      if (!t.dead && !t.hidden && this.elevated === t.elevated && this.dist(t) <= a.reach && s.world.lineClear(this, t, this.elevated)) {
        this.dir = t.x < this.x ? -1 : 1;
        t.hit(a.dmg, true, this);
        const d = this.dist(t) || 1;
        t.shove((t.x - this.x) / d, (t.y - this.y) / d, this.blowPush);
        s.fx.push({ kind: 'hit', attacker: this, target: t, dmg: a.dmg, crit: false, killed: !!t.dead });
      } else {
        s.fx.push({ kind: 'miss', who: this });
      }
    }
    if (a.t >= a.windup + a.recover) { this.attack = null; this.attackCd = 0.05; return false; }
    this.vx = this.vy = 0;
    return true;
  }

  /** Legacy instant melee (kept for the odd caller); prefer startAttack. */
  tryAttack(s: VillageScene, target: Mover, dmg: number, reach = 13, cooldown = 0.8): boolean {
    if (this.attackCd > 0 || this.dist(target) > reach) return false;
    this.dir = target.x < this.x ? -1 : 1;
    target.hit(dmg, true, this);
    this.attackCd = cooldown;
    s.fx.push({ kind: 'hit', attacker: this, target, dmg, crit: false, killed: !!target.dead });
    return true;
  }

  protected tickTimers(dt: number): void {
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hurtT += dt;
    if (this.pushX || this.pushY) {
      const nx = this.x + this.pushX * dt, ny = this.y + this.pushY * dt;
      const t = World.toTile(nx, ny);
      if (!this.world?.isBlocked(t.tx, t.ty, this.hostile, this.elevated)) { this.x = nx; this.y = ny; }
      const k = Math.max(0, 1 - dt * 9);
      this.pushX *= k; this.pushY *= k;
      if (Math.abs(this.pushX) + Math.abs(this.pushY) < 2) this.pushX = this.pushY = 0;
    }
  }

  /** set by the scene on spawn so pushes can respect walls */
  world?: World;

  /** Hitstop: true while this body is frozen this tick (counts the freeze down). */
  protected frozen(dt: number): boolean {
    if (this.freeze <= 0) return false;
    this.freeze -= dt;
    this.vx = this.vy = 0;
    return true;
  }
}

// ---------------------------------------------------------------------------
// villagers

/**
 * 'infant' lives unseen in the house nursery; 'kid' is raised in its home's yard; the rest are the three
 * grown callings (an elder keeps theirs, see Villager.elder). Being a gnome is not a role: it is
 * `Villager.gnome`, and a gnome takes one of these callings like anyone else — its food calling is
 * foraging where a human's is farming.
 */
export type Role = 'infant' | 'kid' | Calling;

/** A standing order from the shaman wand: hold a spot (fight what comes within ORDER.leash of it), hunt one enemy, or shadow the head. A wall post is the other stance; the two never coexist. */
export type Order = { kind: 'hold'; tx: number; ty: number } | { kind: 'attack'; target: Mover } | { kind: 'follow' };

export class Villager extends Mover {
  weapon: 'sword' | 'bow' | 'pike' = 'sword';
  /** a pike thrust in progress: the line it runs along, and how far through the windup it is */
  private thrust: { t: number; ux: number; uy: number; dmg: number; struck: boolean } | null = null;
  post: TilePos | null = null;
  order: Order | null = null;
  /** the regiment this soldier fights under (gnome soldiers only) */
  get regiment(): Regiment | null { return this.block?.side === 'ours' ? this.block as Regiment : null; }
  private stairsGoal: TilePos | null = null;
  indoors: House | null = null;
  role: Role;
  /** age in days (fractional: it advances every tick) */
  age: number;
  hungerDays = 0;
  /** grown old: slower, grey, and living on borrowed time (see p.elderDays) */
  elder = false;
  /** born in a gnome house: a little person for life, whatever calling they take (see `applyRole` and the `forage` dispatch) */
  gnome = false;
  /**
   * A bowl out of the great pot and the sim time it wears off (see MOODS). It is set by
   * `VillageScene.serveGnomes`, spent down in `update`, and every stat it touches is either a getter
   * or re-applied through `applyRole` when it starts and ends.
   */
  mood: { dish: DishKind; until: number } | null = null;
  /** seconds of the bowl left, and the mood itself while it lasts */
  moodLeft(s: VillageScene): number { return this.mood ? Math.max(0, this.mood.until - s.simTime) : 0; }
  private moodAt = -1;
  /** a grown gnome's little backpack: what it forages into while it trails the head, and what you can open up */
  pouch: Pack | null = null;
  /**
   * The calling this child is promised: reserved at birth (see `VillageScene.pickCalling`) and spent by
   * `comeOfAge`, so a growing child already holds its building's place. Null once grown (their `role`
   * holds it) and null for a gnome child, who grows into a gnome whatever the village needs.
   */
  calling: Calling | null = null;
  /** children: the day they last ate from a pile in the yard, and sim time their next meal is due */
  ateDay = 0;
  mealAt = 0;
  /** what they ate as a child, by kind, and the bonuses it froze into at coming of age */
  diet: Record<FoodKind, number> = zeroFood();
  dietBonus: Record<Exclude<DietStat, 'care'>, number> = { hp: 0, speed: 0, work: 0, dmg: 0 };
  /** mushrooms counted toward today's care point (one per meal) */
  private shroomMeal = false;
  /** died of hunger (so the death isn't also reported as a killing) */
  starved = false;
  /** days of training done toward their calling (fractional: it accrues by the hour while they are home and fed) */
  trained = 0;
  name: string;
  // ---- upbringing (children); frozen into stars/trait at coming of age
  parents: Villager[] = [];
  /** care points earned so far and the days they were earned over */
  care = 0;
  careDays = 0;
  /** care stars, 0-5: live estimate while a child, frozen for life at coming of age */
  stars = 0;
  /** finished their apprenticeship: works faster, hits harder */
  skilled = false;
  trait: Trait | null = null;
  /** the day the village head last encouraged them / they last had to run from raiders */
  encouragedDay = 0;
  fledDay = 0;
  /** was hungry at some point today (set by the scene at dawn) */
  hungryDay = 0;
  /** the head shooed them home during a raid: stay in until it's over */
  sentHome = false;
  /** a snatcher has this child */
  carriedBy: Raider | null = null;
  private workTimer = 0;
  private thinkTimer = 0;
  private retarget = 0;
  private target: Mover | null = null;

  constructor(x: number, y: number, public home: House, role: Role, age: number, name: string, mods: Mods) {
    super(x, y);
    this.role = role;
    if (role === 'soldier') this.order = { kind: 'follow' };
    this.age = age;
    this.name = name;
    this.applyRole(mods);
    this.hp = this.maxHp;
  }

  /** extra HP from the village's best barracks (set by the scene before applyRole) */
  barracksHp = 0;

  get isAdult(): boolean {
    return this.role !== 'kid' && this.role !== 'infant';
  }
  get isChild(): boolean { return this.role === 'kid' || this.role === 'infant'; }
  /** Learning a trade at home (every child promised a calling trains, every day they are fed). */
  apprenticeAt(_s?: VillageScene): boolean {
    return this.role === 'kid' && !!this.calling;
  }
  /** The age this villager passes away: the village's death age, give or take a bit so elders don't drop in unison. */
  deathAt(s: VillageScene): number { return s.deathAge + ((this.id % 7) / 6 - 0.5) * p.elderDays * 0.5; }
  /** Training days needed to come of age skilled (War Drums lowers it). */
  static drillNeeded(s: VillageScene): number { return Math.max(1, p.cadetDays + s.mods.cadetDaysDelta); }
  /** What this child will become — the calling reserved for them at birth, shown in the UI so nothing is a surprise. */
  outlook(s: VillageScene): { role: Calling | null; skilled: boolean } {
    const daysLeft = Math.max(0, s.adultAge - this.age); // training days still possible, if fed all the way
    const teaching = this.calling !== 'soldier' || s.world.barracks.some((b) => b.warm); // no warm barracks, no sword lesson
    const skilled = s.mods.fullDrill || (!!this.calling && teaching && this.trained + daysLeft >= Villager.drillNeeded(s));
    return { role: this.calling, skilled };
  }
  /** Care stars right now: five for averaging six care points a day. */
  starsNow(): number {
    if (this.role !== 'kid') return this.stars;
    if (!this.careDays) return 0;
    return Math.max(0, Math.min(5, Math.round((this.care / this.careDays) * (5 / 6))));
  }
  /** What the diet so far would give at coming of age (live for children, the frozen numbers for adults). */
  dietNow(): Record<Exclude<DietStat, 'care'>, number> {
    if (this.isAdult) return this.dietBonus;
    const out = { hp: 0, speed: 0, work: 0, dmg: 0 };
    for (const k of FOOD_KINDS) { const stat = FOODS[k].stat; if (stat !== 'care') out[stat] += DIET_CAP[stat] * (FOODS[k].power ?? 1) * p.dietMul * Math.min(1, this.diet[k] / Math.max(1, p.dietFull)); }
    return out;
  }
  /** A bite from a pile in the yard: it goes on the diet; mushrooms also earn a care point (once per meal). */
  eatBite(kind: FoodKind, n: number): void {
    this.diet[kind] += n;
    if (kind === 'mushroom' && !this.shroomMeal) { this.shroomMeal = true; this.care += 1; }
  }
  /** What the last bowl is still doing to them, or null. */
  get moodNow(): Mood | null {
    return this.mood && this.mood.until > this.moodAt ? MOODS[this.mood.dish] : null;
  }
  /** Work-speed multiplier from upbringing. */
  get workMul(): number {
    return (this.skilled ? 1.4 : 1) * (1 + STAR_BONUS * this.stars) * (this.trait === 'tireless' ? 1.25 : 1) * (1 + this.dietBonus.work) * (this.elder ? ELDER_MUL : 1);
  }
  override get space(): number {
    const base = this.gnome ? (this.isChild ? BODY.gnomeKid : BODY.gnome) : this.isChild ? BODY.kid : BODY.adult;
    return Math.max(this.radius, base * (this.moodNow?.bulk?.scale ?? 1));
  }
  /** A swollen gnome shoulders bodies aside instead of giving way. */
  override get mass(): number { return (this.isChild ? MASS.kid : MASS.villager) * (this.moodNow?.bulk ? 3 : 1); }
  /** Emboldened, its swings throw a raider off its feet. */
  protected override get blowPush(): number { return this.moodNow?.knockback ?? 3; }
  /**
   * Take a blow with whatever the pot left in you: a giddy gnome is too quick to be caught, a swollen
   * one shrugs half of it off, and a sporeburst answers it (the burst itself fires from `tickMood`,
   * which has the scene to find raiders with).
   */
  override hit(dmg: number, melee = true, by?: Mover): void {
    const m = this.moodNow;
    if (m?.evade && melee && Math.random() < m.evade) { this.blocked = true; this.hurtT = 0.2; return; }
    const before = this.hp;
    super.hit(m?.bulk ? dmg * m.bulk.dmgMul : dmg, melee, by);
    if (m?.spores && this.hp < before) this.sporePending = true;
  }
  /** struck while full of toadstool stew: the cloud goes up on the next tick */
  sporePending = false;

  applyRole(mods: Mods): void {
    switch (this.role) {
      case 'infant': this.radius = 1; this.color = 0xf5d8a8; this.maxHp = 5; this.speed = 0; break;
      case 'kid': this.radius = 2; this.color = 0xf5d8a8; this.maxHp = 10; this.speed = 30; break;
      case 'farmer': this.radius = 3; this.color = 0x7fd37f; this.maxHp = 20; this.speed = 35; break;
      case 'woodcutter': this.radius = 3; this.color = 0xc9a26b; this.maxHp = 20; this.speed = 35; break;
      case 'soldier': this.radius = 3; this.color = 0x6f9bff; this.maxHp = p.soldierHp + mods.soldierHpBonus + this.barracksHp + (this.skilled ? 15 : 0) + armorStats(this.armor).hp; this.speed = 45 * armorStats(this.armor).speedMul; break;
    }
    // A gnome is a little person whatever its calling: its own base, and for a warrior only what the
    // village earned it on top — never a human soldier's. A gnome warrior at a Lv1 barracks with no
    // armor has exactly the HP of its foraging sister.
    if (this.gnome && this.isAdult) {
      const armor = armorStats(this.armor);
      this.radius = 2; this.color = 0xd94a3a;
      this.pouch ??= new Pack(GNOME_PACK.slots, 1);
      const earned = this.role === 'soldier' ? this.barracksHp + (this.skilled ? 15 : 0) + armor.hp : 0;
      this.maxHp = p.gnomeHp + earned;
      this.speed = p.gnomeSpeed * (this.role === 'soldier' ? armor.speedMul : 1);
    }
    // and whatever came out of the pot, until it wears off
    const mood = this.moodNow;
    if (mood && this.isAdult) {
      this.speed *= mood.speedMul ?? 1;
      if (mood.bulk) this.radius = Math.round(this.radius * mood.bulk.scale); // it takes up more room, and bodies feel it
    }
    // how they were raised follows them for life
    if (this.isAdult) {
      const stars = 1 + STAR_BONUS * this.stars;
      this.maxHp *= stars * (this.trait === 'hardy' ? 1.25 : 1) * (this.stars <= 1 ? 0.9 : 1) * (1 + this.dietBonus.hp);
      this.speed *= stars * (this.trait === 'quick' ? 1.2 : 1) * (1 + this.dietBonus.speed) * (this.elder ? ELDER_MUL : 1);
    }
    this.maxHp = Math.round(this.maxHp * mods.hpMul * (this.role === 'soldier' && !this.gnome ? 1 : mods.villagerHpMul));
    this.hp = Math.min(this.hp, this.maxHp);
    this.clearGoal();
  }

  /** Called on the day the kid reaches adultAge: their upbringing becomes who they are. */
  comeOfAge(s: VillageScene): void {
    const { role, skilled } = this.outlook(s);
    if (!role) return; // nothing was ever promised them: they stay a child until a place opens
    this.stars = this.starsNow();
    this.dietBonus = this.dietNow(); // what they ate is who they are
    this.skilled = skilled;
    if (this.stars >= 5) this.trait = s.rng.pick(Object.keys(TRAITS) as Trait[]);
    this.role = role;
    this.calling = null; // spent: their role holds it now, and they eat at the granary like everyone else
    this.barracksHp = s.world.barracksLevel >= 3 ? 30 : s.world.barracksLevel >= 2 ? 15 : 0;
    // a young gnome falls in with whatever the grown ones are doing: at your heels, or off at work
    if (this.gnome) {
      this.followingPlayer = s.gnomesFollow;
      if (this.role === 'soldier' && !s.gnomesFollow) this.order = null; // sent to work: patrol like any soldier
    }
    this.applyRole(s.mods);
    this.hp = this.maxHp;
    const star = '★'.repeat(this.stars) + '☆'.repeat(5 - this.stars);
    // with a breeding program running, only the gifted are worth a toast; the rest go to the journal
    s.event(this.role === 'soldier' ? 'soldier' : 'grow', `${this.name} came of age — ${skilled ? 'a skilled ' : 'a '}${this.gnome ? GNOME_CALLING[this.role as Calling] : this.role}, ${star}${this.trait ? ` (${TRAITS[this.trait].name})` : ''}`);
    s.stats.childrenRaised++;
    s.stats.starsTotal += this.stars;
    if (this.role === 'soldier') s.stats.soldiersRaised++;
  }

  /** The bowl wears off: the stats it wrote are put back, and the quirk stops. */
  private tickMood(dt: number, s: VillageScene): void {
    this.moodAt = s.simTime;
    if (!this.mood) return;
    if (this.mood.until <= s.simTime) {
      const was = MOODS[this.mood.dish];
      this.mood = null;
      const frac = this.hp / Math.max(1, this.maxHp);
      this.applyRole(s.mods);
      this.hp = Math.min(this.maxHp, Math.round(this.maxHp * frac));
      s.event('food', `${this.name} comes back to ${was.name === 'Giddy' ? 'their senses' : 'themselves'}.`);
      return;
    }
    const m = MOODS[this.mood.dish];
    // struck last tick, and full of spores: the cloud goes up now
    if (this.sporePending) { this.sporePending = false; if (m.spores) s.sporeBurst(this, m.spores); }
    // sharp-eyed: a stone every so often at whatever is closest
    if (m.sling) {
      this.slingTimer -= dt;
      if (this.slingTimer <= 0) { this.slingTimer = m.sling.every; s.slingStone(this, m.sling); }
    }
    if (!m.quirk) return;
    this.quirkTimer -= dt;
    if (this.quirkTimer > 0) return;
    this.quirkTimer = s.rng.range(6, 14);
    s.gnomeQuirk(this, m.quirk);
  }
  private quirkTimer = 4;
  private slingTimer = 0.5;

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    this.tickMood(dt, s);
    if (this.frozen(dt)) return;
    if (this.carriedBy) {
      if (this.carriedBy.dead) { this.carriedBy = null; this.clearGoal(); }
      else { this.x = this.carriedBy.x; this.y = this.carriedBy.y - 8; this.vx = this.vy = 0; this.task = 'being carried off!'; return; }
    }
    if (this.hidden) {
      if (this.role === 'infant') { this.task = 'in the nursery'; this.vx = this.vy = 0; return; }
      if (this.role === 'kid') {
        const bedtime = s.dayTime > BEDTIME.start || s.dayTime < BEDTIME.end;
        this.task = bedtime ? 'asleep' : 'hiding indoors';
        if (!bedtime && !s.raidActive) { this.sentHome = false; this.unhide(s); }
        return;
      }
      this.task = 'hiding indoors';
      if (this.role === 'soldier') { this.unhide(s); return; }
      // Roaming enemies do not set raidActive. Check the exit, not the indoor position.
      const door = doorstep(this.indoors ?? this.home);
      const exit = World.center(door.tx, door.ty);
      const unsafe = !!s.nearestRaider(exit.x, exit.y, WORKER_CLEAR + TILE);
      if (!this.workerSafety.update(dt, unsafe, unsafe) && !s.raidActive) this.unhide(s);
      return;
    }
    // the pot before the job: a gnome with a bowl waiting for it goes and stands by the cauldron
    if (this.wantsBowl(s) && !s.nearestRaider(this.x, this.y, WORKER_DANGER) && this.comeForBowl(dt, s)) return;
    switch (this.role) {
      case 'infant': return;
      case 'kid': this.kidUpdate(dt, s); break;
      case 'farmer': if (this.moodNow?.bold) { this.soldierUpdate(dt, s); break; } this.civilUpdate(dt, s, this.gnome ? 'forage' : 'farm'); break; // gnomes never work the crops: the wild is their field
      case 'woodcutter': if (this.moodNow?.bold) { this.soldierUpdate(dt, s); break; } this.civilUpdate(dt, s, this.helpingFarm(s) ? (this.gnome ? 'forage' : 'farm') : 'wood'); break;
      case 'soldier': this.soldierUpdate(dt, s); break;
    }
  }

  // --- kids: wander near home, soak up whatever is around ---------------------

  private kidUpdate(dt: number, s: VillageScene): void {
    // danger: run for the nearest door (home or the barracks) and stay in until the raid is over
    const danger = s.nearestRaider(this.x, this.y, p.fleeRange);
    if (danger || (this.sentHome && s.raidActive)) {
      if (danger && this.fledDay !== s.day) this.fledDay = s.day;
      this.task = 'running for cover';
      this.goInside(s, dt, s.nearestShelter(this.x, this.y) ?? this.home);
      return;
    }
    // bedtime: home to sleep
    if (s.dayTime > BEDTIME.start || s.dayTime < BEDTIME.end) { this.task = 'off to bed'; this.goHome(s, dt); return; }

    // every child eats what lies in the yard of their own home — thrown there from the BASKET, or nothing
    const hungry = this.mealAt <= s.simTime && p.kidFood > 0 && this.home.kind !== 'warren'; // a warren's children are fed from the granary at dawn
    if (hungry) {
      const item = s.world.nearestYardItem(this.x, this.y, this.home, YARD);
      if (item) { this.eatFrom(dt, s, item); return; }
    }
    this.eatingFrom = null;
    // the trade they were promised is learned in the yard; only the sword needs a building, and a warm one
    const learning = this.calling;
    const teaching = !!learning && (learning !== 'soldier' || s.world.barracks.some((b) => b.warm));
    const lesson = hungry || !teaching ? null : learning;
    const yard = this.gnome ? 'the gnome house' : 'the house';
    this.task = hungry ? `hungry — nothing by ${yard}`
      : lesson === 'soldier' ? 'drilling in the yard'
      : lesson === 'farmer' ? (this.gnome ? 'learning to forage' : 'learning to farm')
      : lesson === 'woodcutter' ? 'learning the axe'
      : `playing by ${yard}`;
    // training accrues by the waking hour, every hour they are home and fed (the night asleep costs them nothing)
    const waking = 1 - (1 - BEDTIME.start + BEDTIME.end);
    if (lesson) this.trained = Math.min(Villager.drillNeeded(s), this.trained + dt / (p.dayLength * waking));
    this.thinkTimer -= dt;
    // children scamper about the yard rather than walk it
    const walk = this.speed; this.speed *= p.kidPace;
    const arrived = this.followPath(dt);
    this.speed = walk;
    if (this.thinkTimer <= 0 || arrived) {
      this.thinkTimer = s.rng.range(2, 5);
      const r = 5, hc = buildingCenter(this.home);
      const tx = Math.round(hc.tx) + s.rng.int(-r, r), ty = Math.round(hc.ty) + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) this.setGoal(s, tx, ty, true);
    }
    // a swing of the sword or a stroke of the hoe now and then, while the lesson lasts
    this.trainTimer -= dt;
    if (this.trainTimer <= 0 && lesson) {
      this.trainTimer = s.rng.range(2, 4);
      const here = this.tile;
      if (lesson === 'soldier') s.fx.push({ kind: 'swing', who: this, dx: this.dir, dy: 0, stage: 0 });
      else s.fx.push({ kind: 'tool', tool: lesson === 'farmer' ? 'hoe' : 'axe', tx: here.tx, ty: here.ty, who: this });
    }
  }

  /** Walk to a pile lying on the ground and eat from it: two meals a day, each half of p.kidFood (children eat nothing else). */
  private eatFrom(dt: number, s: VillageScene, item: Item): void {
    const w = s.world, at = World.toTile(item.x, item.y);
    if (!this.goal || this.goal.tx !== at.tx || this.goal.ty !== at.ty) this.setGoal(s, at.tx, at.ty, true);
    // close enough to eat: at the pile, or in the ring around it when someone else already has the pile
    const near = this.dist(item) <= ITEM.eatReach || (this.dist(item) <= ITEM.eatReach * 2 && s.someoneEating(item, this));
    if (near) this.vx = this.vy = 0; else if (this.followPath(dt) && !near) { const d = this.dist(item) || 1; this.x += (item.x - this.x) / d * Math.min(d, this.speed * dt); this.y += (item.y - this.y) / d * Math.min(d, this.speed * dt); } // the last few pixels, off the tile grid
    if (!near) { this.task = 'off to eat'; this.eatingFrom = null; return; }
    this.eatTimer -= dt;
    this.task = 'eating'; this.eatingFrom = item;
    if (this.eatTimer <= 0) {
      this.eatTimer = 0.6;
      const bite = Math.min(1, p.kidFood / 2 - this.eaten, item.n);
      if (bite > 0) { item.n -= bite; this.eaten += bite; this.eatBite(item.food ?? 'wheat', bite); s.fx.push({ kind: 'tool', tool: 'seed', tx: at.tx, ty: at.ty, who: this }); }
      if (item.n <= 1e-9) w.removeItem(item);
      if (this.eaten >= p.kidFood / 2 - 1e-9) { this.eaten = 0; this.shroomMeal = false; this.ateDay = s.day; this.mealAt = s.simTime + p.dayLength / 2; this.clearGoal(); }
    }
  }
  /** the pile this child is eating from right now (so others can crowd round it) */
  eatingFrom: Item | null = null;
  private trainTimer = 0;
  /** food units nibbled toward today's meal, and the pause between bites */
  private eaten = 0;
  private eatTimer = 0;

  // --- farmers / woodcutters ------------------------------------------------

  /** Woodcutters farm instead when the woodyard is full (until it drops well below the cap) or the forest is at its floor. */
  private helpingFarm(s: VillageScene): boolean {
    if (s.wood >= s.woodCap) this.farmHelp = true;
    else if (s.wood < s.woodCap * 0.55) this.farmHelp = false;
    return this.farmHelp || (!s.mods.ignoreReserve && s.world.treeCount <= TREE_RESERVE);
  }
  private farmHelp = false;

  /** heading to the woodyard / granary with a load */
  private delivering = false;
  private readonly workerSafety = new WorkerSafety();
  /** job tiles no path led to, keyed by tile index, with the sim time they may be tried again */
  private unreachable = new Map<number, number>();
  private failedPicks = 0;

  /** How much of a kind these arms hold: a gnome brings home one find at a time — but drags a whole boar's meat in one go. */
  haul(kind: LoadKind): number { return this.gnome ? (kind === 'food' && this.load?.food === 'meat' ? BOAR.meat : 1) : Math.round(HAUL.villager[kind] * p.haulMul); }
  /** the meat lying in the wild this gnome is on its way to (claimed in `VillageScene.meatClaims`, so two never chase one ham) */
  private fetching: Item | null = null;
  /** Arms and pouch together: what a granary trip hands in (see `VillageScene.deposit`), so a gnome sent back to work empties its pouch. */
  override carriedLoads(): readonly { kind: BulkKind; n: number; food?: FoodKind }[] {
    const arms = super.carriedLoads();
    if (!this.pouch) return arms;
    return [...arms, ...this.pouch.bulk().map(b => ({ kind: b.kind, n: b.n, food: b.kind === 'food' ? b.food : undefined }))];
  }
  /** The arms empty first, then the pouch. `carriedOf` deliberately stays arms-only: `Mover.takeOut` measures its own take by it, so counting the pouch there would hand out food it never removed. */
  override takeOut(kind: BulkKind, n: number, food?: FoodKind): number {
    const arms = super.takeOut(kind, n, food);
    return arms + (this.pouch ? this.pouch.take(kind, n - arms, food) : 0);
  }
  /** A gnome at your heels forages into its own pouch instead of hauling armfuls to the granary. */
  private get toPouch(): boolean { return this.followingPlayer && !!this.pouch; }
  get pouchFull(): boolean { return !!this.pouch && this.pouch.full; }
  /** Put a find where it goes: the pouch while following, the arms on a working trip. Returns what was taken. */
  private stow(kind: BulkKind, n: number, food?: FoodKind): number {
    return this.toPouch ? this.pouch!.add(kind, n, food) : this.pickUp(kind, n, food);
  }
  /** Room for one more find, wherever it would go. */
  private canStow(kind: BulkKind, food?: FoodKind): boolean {
    if (this.toPouch) return this.pouch!.room(kind, food) > 0;
    return kind !== 'scrap' && this.canCarry(kind, food); // bare arms never hold scrap
  }
  /** Gnomes keep to the head's heels by default; H (`VillageScene.summonGnomes`) sends them off foraging. Ignored by every other role. */
  followingPlayer = true;

  /** Cancel the current job without losing the carried food or leaving a meat claim behind. */
  followPlayer(s: VillageScene, follow: boolean): void {
    this.followingPlayer = follow;
    // whatever the arms hold goes into the pouch: they are not walking it to the granary now
    if (follow && this.pouch && this.load) {
      const moved = this.pouch.add(this.load.kind, this.load.n, this.load.food);
      this.load.n -= moved;
      if (this.load.n < 1e-9) this.load = null;
    }
    if (this.fetching) this.dropFetch(s);
    this.clearGoal();
    this.workTimer = 0;
    this.thinkTimer = 0;
    this.companyWait = 0;
    this.delivering = !follow && !!this.pouch?.bulk().length; // released with a full pouch: the granary first
    this.task = follow ? 'following you' : 'off foraging';
  }
  /**
   * Something is in the pot and this gnome has not had a bowl: it leaves off whatever it was doing and
   * comes to the square to wait for one. A mood already on it means it has eaten; it goes back to work.
   */
  private wantsBowl(s: VillageScene): boolean {
    return this.gnome && this.isAdult && !this.mood && !this.hidden && !this.carriedBy && s.potHasServings();
  }
  /** Walk to the pot and stand about it. True while that is what this gnome is doing. */
  private comeForBowl(dt: number, s: VillageScene): boolean {
    const pot = s.world.cookpot;
    if (!pot) return false;
    const door = doorstep(pot), at = World.center(door.tx, door.ty);
    if (this.dist(at) > 2.2 * TILE) {
      this.setGoal(s, door.tx, door.ty);
      this.followPath(dt);
      this.task = 'coming for a bowl';
    } else {
      this.clearGoal(); this.vx = this.vy = 0;
      this.task = 'waiting on the pot';
    }
    return true;
  }
  /** Walk to the head and keep station: what a follower does when there is nothing worth picking nearby. */
  private walkToHead(dt: number, s: VillageScene, task: string): void {
    const gap = (2 + this.id % 3 * 0.5) * TILE;
    if (this.dist(s.player) > gap) {
      this.setGoal(s, s.player.tile.tx, s.player.tile.ty);
      this.followPath(dt);
    } else { this.clearGoal(); this.vx = this.vy = 0; }
    this.task = s.player.hidden ? 'waiting outside for you' : task;
  }
  private companyWait = 0;
  private companyRest = 0;

  /** Stable parties of up to three adults from one cottage; regroup when the household changes. */
  private foragingParty(s: VillageScene): Villager[] {
    const adults = s.villagers().filter(v => v.gnome && v.isAdult && v.role !== 'soldier' && !v.dead && v.home === this.home).sort((a, b) => a.id - b.id);
    const start = Math.floor(adults.indexOf(this) / 3) * 3;
    return adults.slice(start, start + 3).filter(v => v !== this && !v.hidden && !v.carriedBy && !v.followingPlayer && v.task !== 'fleeing');
  }

  /** Prefer the patch a companion is already working, without chasing them across the map. */
  private companyPatch(s: VillageScene): { x: number; y: number } | null {
    const mate = this.foragingParty(s).find(v => !v.delivering && v.goal && this.dist(v) < 20 * TILE);
    return mate?.goal ? World.center(mate.goal.tx, mate.goal.ty) : null;
  }

  /** Let a trailing companion catch up. A bounded wait and cooldown prevent mutual waiting forever. */
  private waitForCompany(dt: number, s: VillageScene): boolean {
    this.companyRest = Math.max(0, this.companyRest - dt);
    if (this.companyRest > 0) return false;
    const destination = this.delivering ? s.world.granary && doorstep(s.world.granary) : this.goal;
    if (!destination) { this.companyWait = 0; return false; }
    const end = World.center(destination.tx, destination.ty);
    const behind = this.foragingParty(s).some(v => {
      const returning = v.delivering || !!v.load;
      const gap = this.dist(v);
      return returning === this.delivering && gap > 3 * TILE && gap < 12 * TILE && v.dist(end) > this.dist(end) + TILE;
    });
    if (!behind) { this.companyWait = 0; return false; }
    this.companyWait += dt;
    if (this.companyWait >= 2) { this.companyWait = 0; this.companyRest = 6; return false; }
    this.vx = this.vy = 0;
    this.task = 'waiting for foraging companions';
    return true;
  }

  /** Gnomes: walk to a claimed piece of meat and take it. Returns true while busy with it. */
  private fetchMeat(dt: number, s: VillageScene): boolean {
    const it = this.fetching;
    if (!it) return false;
    // gone (the head walked over it, or someone else took it): let it go and think again
    if (!s.world.items.includes(it) || it.n <= 0 || !it.rest) { this.dropFetch(s); return false; }
    const at = World.toTile(it.x, it.y);
    if (!this.goal || this.goal.tx !== at.tx || this.goal.ty !== at.ty) this.setGoal(s, at.tx, at.ty, true);
    this.task = 'off to fetch the meat';
    const near = this.dist(it) <= ITEM.eatReach;
    if (!near && this.followPath(dt) && !near) { const d = this.dist(it) || 1; this.x += (it.x - this.x) / d * Math.min(d, this.speed * dt); this.y += (it.y - this.y) / d * Math.min(d, this.speed * dt); }
    if (!near && !this.path.length && this.dist(it) > TILE * 1.5) { this.dropFetch(s); this.unreachable.set(at.ty * s.world.cols + at.tx, s.simTime + 60); return false; } // no way there
    if (!near) return true;
    const took = this.stow('food', Math.min(it.n, BOAR.meat), 'meat');
    if (took <= 0) { this.dropFetch(s); return false; } // nowhere to put it after all
    it.n -= took;
    if (it.n <= 1e-9) s.world.removeItem(it);
    this.dropFetch(s);
    if (!this.toPouch) this.delivering = true; // a follower keeps it in the pouch
    this.clearGoal();
    return true;
  }
  private dropFetch(s: VillageScene): void { if (this.fetching) s.meatClaims.delete(this.fetching.id); this.fetching = null; this.clearGoal(); }

  /** Farmers, woodcutters and foraging gnomes: find a job tile, walk there, work it, carry the take home. */
  private civilUpdate(dt: number, s: VillageScene, job: 'farm' | 'wood' | 'forage'): void {
    const farmer = job === 'farm';
    // a bowl out of the great pot steadies them: a fed gnome holds its ground whatever the dish, and
    // sees the fight through with whatever that dish gave it. Only a roast sends it at them (Mood.bold).
    const danger = !this.moodNow && !!s.nearestRaider(this.x, this.y, WORKER_DANGER);
    const wasFleeing = this.workerSafety.fleeing;
    const nearby = danger || (wasFleeing && !!s.nearestRaider(this.x, this.y, WORKER_CLEAR));
    if (this.workerSafety.update(dt, danger, nearby)) {
      if (!wasFleeing) {
        // Do not immediately retry the dangerous job or inherit its work progress.
        if (this.goal) this.unreachable.set(this.goal.ty * s.world.cols + this.goal.tx, s.simTime + 15);
        this.workTimer = 0;
        this.clearGoal();
      }
      this.task = 'fleeing'; this.delivering = false;
      if (this.fetching) this.dropFetch(s);
      this.goHome(s, dt);
      return;
    }
    if (wasFleeing) { this.clearGoal(); this.thinkTimer = 0; }

    // at the head’s heels: still working — foraging or chopping — but only what lies within a short walk
    const heeling = this.gnome && this.followingPlayer && !!this.pouch;
    if (heeling) {
      this.delivering = false; // no granary trips while following; the pouch holds the finds
      if (s.player.hidden || this.pouchFull || this.dist(s.player) > GNOME_PACK.leash * TILE) {
        if (this.fetching) this.dropFetch(s);
        this.workTimer = 0;
        this.walkToHead(dt, s, this.pouchFull ? 'pouch full — following you' : 'following you');
        return;
      }
    }

    if (this.workTimer > 0) {
      this.workTimer -= dt;
      this.vx = this.vy = 0;
      if (this.workTimer <= 0 && this.goal) this.finishWork(s, job);
      return;
    }

    if (job === 'forage' && this.load && this.load.n >= this.haul(this.load.kind)) this.delivering = true;
    if (job === 'forage' && !heeling && this.waitForCompany(dt, s)) return;
    if (this.delivering) { this.deliver(dt, s); return; }
    if (job === 'forage' && this.fetchMeat(dt, s)) return;

    this.thinkTimer -= dt;
    if (!this.goal && this.thinkTimer <= 0) {
      this.thinkTimer = 1;
      const w = s.world;
      // arms full: take it in before looking for more work
      if (this.load && this.load.n >= this.haul(this.load.kind)) { this.delivering = true; this.deliver(dt, s); return; }
      const ok = (tx: number, ty: number) => (this.unreachable.get(ty * w.cols + tx) ?? 0) <= s.simTime
        && !s.nearestRaider((tx + 0.5) * TILE, (ty + 0.5) * TILE, WORKER_CLEAR)
        && (!heeling || Math.hypot((tx + 0.5) * TILE - s.player.x, (ty + 0.5) * TILE - s.player.y) <= GNOME_PACK.leash * TILE); // a follower picks what is near you, not what is near home
      const patch = job === 'forage' && !heeling ? this.companyPatch(s) : null; // the head is the company now
      // meat lying in the wild comes before any plant: a gnome claims the nearest unclaimed piece and goes for it
      if (job === 'forage' && this.canStow('food', 'meat') && (heeling || s.food < s.foodCap)) {
        const it = w.nearestWildMeat(patch?.x ?? this.x, patch?.y ?? this.y, (m) => !s.meatClaims.has(m.id) && (!patch || Math.hypot(m.x - patch.x, m.y - patch.y) <= 6 * TILE) && ok(Math.floor(m.x / TILE), Math.floor(m.y / TILE)));
        if (it) { s.meatClaims.add(it.id); this.fetching = it; this.fetchMeat(dt, s); return; }
      }
      const spot = job === 'forage'
        ? (patch ? w.nearest(patch.x, patch.y, (t, tx, ty) => !!WILD_FOOD[t.kind] && s.wildLeft(t) > 0 && (!this.load || this.load.food === WILD_FOOD[t.kind]) && Math.hypot((tx + 0.5) * TILE - patch.x, (ty + 0.5) * TILE - patch.y) <= 6 * TILE && ok(tx, ty)) : null)
          ?? w.nearest(this.x, this.y, (t, tx, ty) => !!WILD_FOOD[t.kind] && s.wildLeft(t) > 0 && (!this.load || this.load.food === WILD_FOOD[t.kind]) && ok(tx, ty))
        : farmer
        ? (this.load?.kind === 'food' ? w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'crop' && s.isRipe(t) && t.food === this.load!.food && ok(tx, ty)) : null) ??
          w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'crop' && s.isRipe(t) && ok(tx, ty)) ??
          w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'tilled' && ok(tx, ty))
        : s.mods.ignoreReserve || w.treeCount > TREE_RESERVE ? this.pickTree(s, ok) : null;
      if (spot) {
        this.setGoal(s, spot.tx, spot.ty);
        // no way there (walled in, or a tree buried in its grove): remember that for a while and pick again next
        // think — bringing the armful in first, so nobody stands about "looking for a tree" with wood on their back
        if (!this.path.length && !this.adjacentTo(spot)) {
          this.unreachable.set(spot.ty * w.cols + spot.tx, s.simTime + 60); this.clearGoal();
          if (++this.failedPicks >= 5) { this.failedPicks = 0; this.thinkTimer = 4; this.wanderNear(s, this.home); this.task = job === 'forage' ? 'no way to the plants' : farmer ? 'no way to the field' : 'no way to the trees'; }
          else if (this.load) { this.delivering = true; this.deliver(dt, s); }
          return;
        }
        this.failedPicks = 0;
        this.task = job === 'forage' ? 'off foraging' : farmer ? (this.role === 'woodcutter' ? 'helping in the field' : 'heading to the field') : 'looking for a tree';
      }
      else if (heeling) { this.walkToHead(dt, s, 'nothing to pick here'); }
      else if (this.load) { this.delivering = true; this.deliver(dt, s); return; } // nothing more to do: bring in what's carried
      else { this.wanderNear(s, this.home); this.task = job === 'forage' ? 'nothing wild to pick' : farmer ? 'no crops to tend' : 'leaving the last trees to regrow'; }
      return;
    }

    if (this.goal && this.followPath(dt) && this.goal) { // (followPath drops the goal when the way is blocked)
      const t = s.world.get(this.goal.tx, this.goal.ty);
      const isJob = job === 'forage' ? !!t && !!WILD_FOOD[t.kind] && s.wildLeft(t) > 0 : farmer ? t?.kind === 'crop' || t?.kind === 'tilled' : t?.kind === 'tree';
      if (isJob && this.adjacentTo(this.goal)) {
        this.workTimer = job === 'forage' ? p.forageWork / this.workMul : (farmer ? p.farmerWork : p.cutterWork) / (farmer ? s.mods.farmerSpeedMul : s.mods.cutterSpeedMul) / this.workMul;
        this.task = job === 'forage' ? 'foraging' : farmer ? (t!.kind === 'crop' ? 'harvesting' : 'planting') : 'chopping';
      } else this.clearGoal();
    }
  }

  /**
   * Which tree to fell: thin the grove from its edge and take old growth first, so the core keeps
   * spreading — old growth on the edge, then any old growth, then a young edge tree, then anything.
   */
  private pickTree(s: VillageScene, ok: (tx: number, ty: number) => boolean = () => true): TilePos | null {
    const w = s.world;
    const edge = (tx: number, ty: number) => w.treeNeighbours(tx, ty) <= 3;
    const free = (tx: number, ty: number) => !w.hiveAt(tx, ty) && ok(tx, ty); // nobody fells a hive tree on their own initiative
    return w.nearest(this.x, this.y, (t, tx, ty) => s.isOldGrowth(t) && edge(tx, ty) && free(tx, ty))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => s.isOldGrowth(t) && free(tx, ty))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'tree' && edge(tx, ty) && free(tx, ty))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'tree' && free(tx, ty));
  }

  /** Walk the load to its building and hand it in; falls back to the job loop if there is nowhere to take it. */
  private deliver(dt: number, s: VillageScene): void {
    const load = this.carriedLoads()[0]; // arms first, then the pouch: a gnome sent back to work walks its finds in
    if (!load) { this.delivering = false; this.clearGoal(); return; }
    // wood goes to a hearth that needs it before the woodyard: the village stays warm on woodcutters' backs
    const hearth = load.kind === 'wood' ? (this.firewoodFor && !this.firewoodFor.ruined && this.firewoodFor.firewood < p.hearthNights ? this.firewoodFor : s.hearthNeeding(this.x, this.y, load.n)) : null;
    this.firewoodFor = hearth;
    const b = hearth ?? (load.kind === 'wood' ? s.world.woodyard : s.world.granary);
    if (!b) { this.delivering = false; this.clearGoal(); return; }
    const door = doorstep(b);
    this.setGoal(s, door.tx, door.ty);
    this.task = hearth ? `bringing firewood to the ${BUILDINGS[hearth.kind].name.toLowerCase()}` : load.kind === 'wood' ? 'hauling logs to the woodyard' : this.gnome ? 'bringing the find to the granary' : 'carrying the harvest to the granary';
    const arrived = this.followPath(dt);
    if (arrived) {
      const there = this.adjacentTo(door) || this.dist(World.center(door.tx, door.ty)) < TILE;
      if (hearth) {
        if (there) s.stockFromLoad(hearth, this);
        this.firewoodFor = null; this.clearGoal();
        if (this.carriedLoads().length) return; // whatever is left goes on to the woodyard next tick
      } else if (there) s.deposit(this);
      this.delivering = false; this.clearGoal(); this.thinkTimer = 0.2; // no path or arrived: back to work either way
    }
  }
  /** the hearth this armful is promised to (so a pile another cutter just filled doesn't send us elsewhere mid-walk) */
  private firewoodFor: Building | null = null;

  private finishWork(s: VillageScene, job: 'farm' | 'wood' | 'forage'): void {
    const farmer = job === 'farm';
    const g = this.goal!;
    const t = s.world.get(g.tx, g.ty)!;
    if (job === 'forage') {
      // one unit off the plant; the rest stays for the next trip (or the head's hands)
      const kind = WILD_FOOD[t.kind];
      if (kind && s.wildLeft(t) > 0 && (this.toPouch || s.food < s.foodCap) && this.canStow('food', kind) && s.pickWild(g.tx, g.ty, 1)) this.stow('food', 1, kind);
    }
    else if (farmer && t.kind === 'crop' && s.isRipe(t)) {
      // leave ripe crops standing while the granary is full or the arms hold wood / another crop
      const kind = t.food ?? 'wheat';
      if (s.food < s.foodCap && this.canCarry('food', kind)) {
        s.world.set(g.tx, g.ty, 'tilled'); // the soil remembers the crop
        const yieldNow = (s.cropYieldOf(kind) + (this.skilled && this.role === 'farmer' ? 1 : 0)) * (this.trait === 'greenthumb' && s.rng.chance(0.25) ? 2 : 1);
        this.pickUp('food', yieldNow, kind);
      }
    }
    else if (farmer && t.kind === 'tilled') { s.world.sow(g.tx, g.ty, t.food ?? 'wheat'); }
    else if (!farmer && t.kind === 'tree' && this.canStow('wood')) {
      const wood = s.treeYield(t) + (this.skilled ? 4 : 0);
      s.world.set(g.tx, g.ty, 'sapling');
      const took = this.stow('wood', wood);
      if (took < wood) this.pickUp('wood', wood - took); // a nearly full pouch loses none of the tree
    }
    this.clearGoal();
  }

  // --- soldiers -------------------------------------------------------------

  /** Soldiers: hunt whatever is in sight (or whatever the wand says), otherwise patrol round the barracks. */
  private soldierUpdate(dt: number, s: VillageScene): void {
    if (this.post && !s.world.get(this.post.tx, this.post.ty)?.defense) { this.post = null; this.clearGoal(); }
    if (this.post && !this.elevated) {
      if (!this.stairsGoal || !s.world.get(this.stairsGoal.tx, this.stairsGoal.ty)?.defense) this.stairsGoal = s.reachableStairs(this, this.post);
      if (!this.stairsGoal) { this.task = 'post needs connected stairs'; return; }
      this.setGoal(s, this.stairsGoal.tx, this.stairsGoal.ty);
      this.followPath(dt);
      if (this.dist(World.center(this.stairsGoal.tx, this.stairsGoal.ty)) < 3) { this.elevated = true; this.clearGoal(); this.stairsGoal = null; }
      this.task = 'climbing to wall post';
      return;
    }
    if (this.elevated && !this.post) {
      const exit = s.reachableStairs(this);
      if (exit) { this.setGoal(s, exit.tx, exit.ty); this.followPath(dt); if (this.dist(World.center(exit.tx, exit.ty)) < 3) { this.elevated = false; this.clearGoal(); } }
      this.task = 'returning down the stairs'; return;
    }
    // under a banner: the regiment thinks for the block; the member keeps its slot and fights what reaches it
    if (this.regiment && !this.order && !this.post) { this.rankTick(dt, s); return; }
    // an order's quarry is down: the squad holds the ground it took
    const order = this.order;
    if (order?.kind === 'attack' && (order.target.dead || order.target.hidden)) { this.order = { kind: 'hold', ...this.tile }; this.retarget = 0; }
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.4;
      const leash = ORDER.leash * TILE;
      // a pikeman sees much further and goes to meet what it sees: following the head, it closes on any raider near
      // the band rather than waiting for one to be on the head; on patrol it looks out to its full sight
      const pike = this.weapon === 'pike';
      this.target = order?.kind === 'attack' ? (order.target as Raider)
        : order?.kind === 'hold' ? s.bestTarget((order.tx + 0.5) * TILE, (order.ty + 0.5) * TILE, leash)
        : order?.kind === 'follow' ? s.attackingPlayer(s.player.x, s.player.y, leash) ?? (pike ? s.bestTarget(s.player.x, s.player.y, p.pikeSight) : null)
        : s.bestTarget(this.x, this.y, this.weapon === 'bow' ? 190 : pike ? p.pikeSight : 130);
    }
    if (this.target && !this.target.dead) {
      this.task = 'fighting';
      if (this.attackTick(dt, s)) return;
      const dmg = this.soldierDmg(s);
      if (this.weapon === 'bow') {
        const range = this.elevated ? 210 : 160;
        if (this.dist(this.target) <= range && s.world.lineClear(this, this.target, this.elevated)) {
          this.vx = this.vy = 0; this.task = this.post ? 'archer holding the wall' : 'firing arrows';
          if (this.attackCd <= 0) { s.shoot(this, this.target.x - this.x, this.target.y - this.y, Math.round(dmg)); this.attackCd = 0.9; }
          return;
        }
      }
      if (this.post) { this.setGoal(s, this.post.tx, this.post.ty); this.followPath(dt); this.task = 'holding wall post'; return; }
      if (this.weapon === 'pike') { this.pikeTick(dt, s, dmg); return; }
      if (this.startAttack(s, this.target, Math.round(dmg), 13, 0.15, 0.45)) return;
      this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
      this.followPath(dt);
      return;
    }
    this.target = null;
    if (this.thrust && this.thrustTick(dt, s)) return;
    // out of combat they mend, whatever their orders: on patrol, escorting, holding ground or up on the wall.
    // (a cold barracks mends nobody, and the fighting branches above have already returned)
    const regen = s.world.barracks.some((b) => b.warm) ? s.mods.soldierRegen + (s.world.barracksLevel >= 3 ? 1 : 0) : 0;
    if (regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    if (this.post) { this.setGoal(s, this.post.tx, this.post.ty); this.followPath(dt); this.task = 'watching from the wall'; return; }
    if (this.order?.kind === 'hold') {
      const o = this.order;
      if (this.tile.tx === o.tx && this.tile.ty === o.ty) { this.vx = this.vy = 0; this.clearGoal(); }
      else { this.setGoal(s, o.tx, o.ty); if (this.followPath(dt) && !this.goal) { this.vx = this.vy = 0; } }
      this.task = 'holding position'; return;
    }
    if (this.order?.kind === 'follow') {
      const pl = s.player, gap = ORDER.followGap * TILE;
      if (this.dist(pl) > gap) { this.setGoal(s, pl.tile.tx, pl.tile.ty); this.followPath(dt); }
      else { this.vx = this.vy = 0; this.clearGoal(); }
      this.task = 'following you'; return;
    }
    this.task = 'on patrol';
    this.thinkTimer -= dt;
    if (this.followPath(dt) && this.thinkTimer <= 0) {
      this.thinkTimer = s.rng.range(3, 7);
      const post = buildingCenter(s.world.barracks.length ? s.rng.pick(s.world.barracks) : this.home);
      // a bigger garrison patrols a wider ring, so they aren't all shoulder to shoulder against the wall
      this.wanderNear(s, { tx: Math.round(post.tx), ty: Math.round(post.ty) }, 3 + Math.floor(s.fighters().length / 4));
    }
  }

  /** What a soldier's blow does now: the weapon, the barracks, the drill, the trait and the diet. */
  private soldierDmg(s: VillageScene): number {
    return p.soldierDmg * weaponMul(this.weapons, this.weapon === 'bow' ? 'bow' : 'melee') * s.mods.soldierDmgMul * (s.world.barracksLevel >= 3 ? 1.2 : 1) * (this.skilled ? 1.15 : 1) * (this.trait === 'brave' ? 1.2 : 1) * (1 + this.dietBonus.dmg);
  }

  /**
   * A soldier in the ranks of a regiment. It does not hunt: the block goes where the regiment sends it.
   * It strikes at the nearest raider within its own reach (a small grid query, not a hunt), and steps
   * a little out of the rank to meet one only when the block is advancing. Otherwise it walks straight
   * to its slot, and falls back on a path only after 1.5 s without getting closer.
   */
  private rankTick(dt: number, s: VillageScene): void {
    const reg = this.regiment!, slot = this.slot;
    if (this.thrust && this.thrustTick(dt, s)) return;
    if (this.attackTick(dt, s)) return;
    const pike = this.weapon === 'pike', bow = this.weapon === 'bow';
    const reach = pike ? p.pikeReach : bow ? 160 : 13;
    const lunge = reg.stance === 'advance' ? TILE * 1.5 : 4;
    this.retarget -= dt;
    if (this.retarget <= 0 || (this.target && (this.target.dead || this.target.hidden))) {
      this.retarget = 0.25;
      this.target = s.nearestRaider(this.x, this.y, reach + lunge + 12);
    }
    const foe = this.target;
    // never chase out of the block: a foe that has drawn the member two tiles off its slot is let go
    if (foe && !foe.dead && (!slot || Math.hypot(this.x - slot.x, this.y - slot.y) < 2 * TILE)) {
      const d = this.dist(foe), dmg = this.soldierDmg(s);
      this.task = 'fighting in the ranks';
      if (bow) {
        if (d <= reach && s.world.lineClear(this, foe, this.elevated)) {
          this.vx = this.vy = 0;
          if (this.attackCd <= 0) { s.shoot(this, foe.x - this.x, foe.y - this.y, Math.round(dmg)); this.attackCd = 0.9; }
          return;
        }
      } else if (pike) {
        if (d <= p.pikeReach + foe.radius + lunge) { this.pikeTick(dt, s, dmg); return; }
      } else {
        if (this.startAttack(s, foe, Math.round(dmg), 13, 0.15, 0.45)) return;
        if (d <= reach + foe.radius + lunge) { this.stepToward(dt, s, foe.x, foe.y); return; }
      }
    } else this.target = null;
    const regen = s.world.barracks.some((b) => b.warm) ? s.mods.soldierRegen + (s.world.barracksLevel >= 3 ? 1 : 0) : 0;
    if (regen && this.hp < this.maxHp && !foe) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    this.toSlot(dt, s, reg.fx, reg.stance === 'hold' ? 'holding the line' : reg.stance === 'advance' ? 'advancing in the ranks' : 'marching behind you');
  }

  /**
   * A pikeman fights at the end of its pike, not at the end of its arm. It keeps its quarry out at
   * pike's length — stepping back from anything that gets inside the point, closing on anything beyond
   * it — and thrusts along the line: every raider on that line is struck, however many, and anything
   * charging onto the point takes far more of it. Friends are never in the way of a thrust, so a rank
   * behind strikes straight past the rank in front.
   */
  private pikeTick(dt: number, s: VillageScene, dmg: number): void {
    if (this.thrust) { this.thrustTick(dt, s); return; }
    const foe = this.target!, d = this.dist(foe);
    const ux = (foe.x - this.x) / (d || 1), uy = (foe.y - this.y) / (d || 1);
    this.dir = ux < 0 ? -1 : 1;
    if (d < p.pikeDeadZone + foe.radius) {
      // inside the point: give ground until the pike can be brought to bear again
      this.clearGoal();
      const step = this.speed * dt, nx = this.x - ux * step, ny = this.y - uy * step, t = World.toTile(nx, ny);
      if (!s.world.isBlocked(t.tx, t.ty, false, this.elevated)) { this.x = nx; this.y = ny; }
      this.vx = -ux * this.speed; this.vy = -uy * this.speed;
      this.task = 'giving ground';
      return;
    }
    if (d <= p.pikeReach + foe.radius && this.attackCd <= 0 && s.world.lineClear(this, foe, this.elevated)) {
      this.clearGoal(); this.vx = this.vy = 0;
      this.thrust = { t: 0, ux, uy, dmg, struck: false };
      s.fx.push({ kind: 'telegraph', who: this, ms: p.pikeWindup * 1000 });
      this.task = 'levelling the pike';
      return;
    }
    if (d <= p.pikeReach + foe.radius) { this.vx = this.vy = 0; this.clearGoal(); this.task = 'holding the point'; return; }
    this.setGoal(s, foe.tile.tx, foe.tile.ty);
    this.followPath(dt);
    this.task = 'closing with the pike';
  }
  /** Advance a thrust: the windup, the strike down the line, the recovery. True while it holds the body. */
  private thrustTick(dt: number, s: VillageScene): boolean {
    const th = this.thrust;
    if (!th) return false;
    th.t += dt;
    this.vx = this.vy = 0;
    if (!th.struck && th.t >= p.pikeWindup) {
      th.struck = true;
      s.pikeStrike(this, th.ux, th.uy, th.dmg);
    }
    if (th.t >= p.pikeWindup + p.pikeRecover) { this.thrust = null; this.attackCd = 0.05; return false; }
    this.task = th.struck ? 'recovering the pike' : 'levelling the pike';
    return true;
  }

  // --- helpers --------------------------------------------------------------

  /** Run to a building's doorstep and duck inside (children take the nearest shelter). */
  private goInside(s: VillageScene, dt: number, b: House): void {
    const door = doorstep(b);
    this.setGoal(s, door.tx, door.ty);
    const arrived = this.followPath(dt);
    // a ruin has no door to hide behind: they huddle on its step, exposed
    if (arrived && this.adjacentTo(door) && !b.ruined) {
      this.hidden = true;
      this.indoors = b;
      const c = buildingCenter(b);
      this.x = c.tx * 16; this.y = c.ty * 16;
      this.clearGoal();
    }
  }

  private wanderNear(s: VillageScene, pos: TilePos, r = 3): void {
    for (let i = 0; i < 6; i++) {
      const tx = pos.tx + s.rng.int(-r, r), ty = pos.ty + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) { this.setGoal(s, tx, ty, true); return; }
    }
  }

  /** Run to the home's doorstep; once there, duck inside. */
  private goHome(s: VillageScene, dt: number): void {
    // home in ruins: take shelter wherever still stands (or wait at the ruin's step)
    this.goInside(s, dt, this.home.ruined ? s.nearestShelter(this.x, this.y) ?? this.home : this.home);
  }

  /** Step back outside (the raid is over, or the roof just came down). */
  unhide(s: VillageScene): void {
    this.hidden = false;
    this.indoors = null;
    const door = doorstep(s.nearestShelter(this.x, this.y) ?? this.home);
    const spots: TilePos[] = [door, { tx: door.tx + 1, ty: door.ty }, { tx: door.tx, ty: door.ty + 1 }, { tx: door.tx - 1, ty: door.ty }];
    const spot = spots.find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? spots[0];
    const c = World.center(spot.tx, spot.ty);
    this.x = c.x; this.y = c.y;
    this.clearGoal();
  }
}

// ---------------------------------------------------------------------------
// raiders

export type EnemyKind = 'raider' | 'warlord' | 'rat' | 'snatcher' | 'brute' | 'shaman' | 'ogre' | 'wrecker' | 'boar' | 'troll' | 'skulk';

export interface RaiderOpts {
  /** the warlord: big, tough, and the run ends when he falls */
  boss?: boolean;
  /** wave scaling on HP */
  hpMul?: number;
  speedMul?: number;
  /** Bounty boons: snatchers need longer to get hold of a child, or can't at all; rats leave crops */
  snatchDelayMul?: number;
  noSnatch?: boolean;
  harmlessRats?: boolean;
}

/**
 * Base enemy: walks at the nearest person and hits them. Other kinds (enemies.ts) extend this so
 * every `instanceof Raider` check — soldier targeting, the sword arc, villagers fleeing — covers them.
 */
export class Raider extends Mover {
  override get space(): number { return this.radius * (this.kind === 'rat' || this.kind === 'boar' ? BODY.beastMul : BODY.humanoidMul); }
  override get mass(): number { return this.boss ? MASS.warlord : this.kind === 'rat' ? MASS.rat : this.kind === 'snatcher' ? MASS.snatcher : MASS.raider; }
  protected siege: { defense: Defense; t: number; struck: boolean } | null = null;
  /** Enemies can breach fortifications, while homes and supply buildings remain indestructible. */
  breach(dt: number, s: VillageScene): boolean {
    if (this.harmless) return false;
    if (!this.siege) {
      if (this.path.length) return false;
      const candidates = [...s.world.defenses.values()].filter(d => d.kind !== 'stairs' && !(d.kind === 'gate' && d.open))
        .sort((a, b) => this.dist(World.center(a.tx, a.ty)) - this.dist(World.center(b.tx, b.ty)));
      const d = candidates[0];
      if (!d) return false;
      const c = World.center(d.tx, d.ty);
      this.siege = { defense: d, t: 0, struck: false };
      this.dir = c.x < this.x ? -1 : 1;
    }
    const a = this.siege, c = World.center(a.defense.tx, a.defense.ty);
    if (a.defense.hp <= 0 || (a.defense.kind === 'gate' && a.defense.open)) { this.siege = null; this.clearGoal(); return false; }
    if (this.dist(c) > 25) { this.setGoal(s, a.defense.tx, a.defense.ty); this.followPath(dt); this.task = 'approaching fortifications'; return true; }
    if (a.t === 0) s.fx.push({ kind: 'telegraph', who: this, ms: 300 });
    a.t += dt; this.vx = this.vy = 0; this.task = 'battering the wall';
    if (!a.struck && a.t >= 0.3) {
      a.struck = true;
      s.fx.push({ kind: 'melee', who: this, x: c.x, y: c.y });
      if (a.defense.hp > 0 && s.world.damageDefense(a.defense, this.dmg * (this.kind === 'brute' ? p.bruteWallMul : 1))) {
        s.event('raid', 'The wall is breached — they are inside!', true); s.rescueFallenGuards();
      }
    }
    if (a.t >= (this.kind === 'brute' ? 0.6 : 1.1)) { this.siege = null; this.clearGoal(); }
    return true;
  }
  protected target: Mover | null = null;
  isTargeting(who: Mover): boolean { return this.target === who && !this.dead; }
  /** Adaptive encounters pursue the head rather than villagers. */
  huntPlayer = false;
  /**
   * A camp in the wild this raider guards (VillageScene.spawnCamps), in sim pixels. It fights only what comes
   * within `aggro` of it while that stays within `leash` of home, walks back when its quarry gets away, and
   * heals on getting home — it never goes looking for the village.
   */
  camp: { x: number; y: number; aggro: number; leash: number } | null = null;
  /** A camp raider's quarry: the nearest person within aggro of it and within the leash of home, or null. */
  protected campPick(s: VillageScene): Mover | null {
    const c = this.camp!;
    let best: Mover | null = null, bd = c.aggro * c.aggro;
    const consider = (m: Mover) => {
      if (m.dead || m.hidden || (m instanceof Villager && m.carriedBy)) return;
      if ((m.x - c.x) ** 2 + (m.y - c.y) ** 2 > c.leash * c.leash) return;
      const d = (m.x - this.x) ** 2 + (m.y - this.y) ** 2;
      if (d < bd) { bd = d; best = m; }
    };
    // a grid query round the raider: a scan of every villager per raider is ruinous with an army of hundreds
    s.grid.forEachInRadius(this.x, this.y, c.aggro, (o) => { if (o instanceof Villager || o instanceof Player) consider(o); });
    return best;
  }
  /** A quarry that has run past the leash is let go. */
  protected campLeash(): void {
    const c = this.camp, t = this.target;
    if (c && t && (t.x - c.x) ** 2 + (t.y - c.y) ** 2 > c.leash * c.leash) this.target = null;
  }
  /** Nothing to fight: walk home, heal on arrival, keep watch. */
  protected campIdle(dt: number, s: VillageScene): void {
    const c = this.camp!, d = Math.hypot(this.x - c.x, this.y - c.y);
    this.bored = 0;
    if (d > TILE * 1.5) {
      const home = World.toTile(c.x, c.y);
      this.setGoal(s, home.tx, home.ty);
      this.followPath(dt);
      this.task = 'going back to its camp';
      return;
    }
    // home with nobody to fight: the camp resets, and its raiders are whole again
    this.hp = this.maxHp;
    this.clearGoal(); this.vx = this.vy = 0;
    this.task = 'keeping watch over its camp';
  }
  protected retarget = 0;
  protected bored = 0;
  readonly boss: boolean;
  dmg: number;
  name: string;
  kind: EnemyKind;
  /** shrugs off knockback */
  heavy = false;
  /** villagers don't flee from it (rats) */
  harmless = false;
  /** a boss-sized body: the big HP bar, footstep thuds */
  huge = false;
  /** lives out in the world rather than arriving with a raid: doesn't start or end one */
  lairBound = false;
  /** lives wild (boars): not the village's enemy — soldiers and towers leave it be — until it's provoked (`harmless` drops) */
  wild = false;
  /** hides in long grass while calm: not drawn, not hoverable, no bar or minimap dot; a body walking onto it finds it the hard way */
  lurker = false;
  /** unseen right now: a calm lurker standing in long grass */
  get lurking(): boolean { return this.lurker && this.harmless && !this.dead && !!this.world?.tallAt(this.x, this.y); }
  /** a child being carried off (snatchers) */
  carrying: Villager | null = null;

  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y);
    this.hostile = true;
    this.boss = opts.boss ?? false;
    this.kind = this.boss ? 'warlord' : 'raider';
    if (this.boss) this.pushScale = 0.15;
    this.hp = this.maxHp = this.boss ? 150 : Math.round(p.raiderHp * (opts.hpMul ?? 1));
    this.dmg = this.boss ? 10 : p.raiderDmg;
    this.speed = (this.boss ? 44 : 38) * (opts.speedMul ?? 1);
    this.radius = this.boss ? 5 : 3;
    this.color = 0xd94a4a;
    this.name = this.boss ? 'The Warlord' : 'Hollow raider';
    this.task = this.boss ? 'leading the raid' : 'raiding';
  }

  /** the enemy warband this raider marches in, if any */
  get warband(): Warband | null { return this.block?.side === 'theirs' ? this.block as Warband : null; }
  /** How far this raider strikes from its place in the ranks. */
  protected rankReach(): number { return this.boss ? 16 : 13; }
  /** Strike `foe` from the ranks if it can: true when the blow has begun. */
  protected rankStrike(_dt: number, s: VillageScene, foe: Mover): boolean {
    return this.startAttack(s, foe, this.dmg, this.rankReach(), this.boss ? 0.35 : 0.25, this.boss ? 0.7 : 0.55);
  }
  /**
   * A raider in a warband: like a soldier in a regiment it does not hunt. It strikes the nearest of
   * your people within its reach (a short lunge out of the rank when the warband charges), and
   * otherwise keeps its slot. True when the ranks had it this tick.
   */
  protected rankTick(dt: number, s: VillageScene): boolean {
    const wb = this.warband;
    if (!wb) return false;
    if (this.attackTick(dt, s)) return true;
    const reach = this.rankReach(), lunge = wb.state === 'charge' ? TILE * 1.5 : 4, slot = this.slot;
    this.retarget -= dt;
    if (this.retarget <= 0 || (this.target && (this.target.dead || this.target.hidden))) {
      this.retarget = 0.25;
      this.target = s.nearestPerson(this.x, this.y, reach + lunge + 12);
    }
    const foe = this.target;
    if (foe && !foe.dead && (!slot || Math.hypot(this.x - slot.x, this.y - slot.y) < 2 * TILE)) {
      this.task = 'fighting in the warband';
      if (this.rankStrike(dt, s, foe)) return true;
      if (this.dist(foe) <= reach + foe.radius + lunge) { this.stepToward(dt, s, foe.x, foe.y); return true; }
    } else this.target = null;
    this.toSlot(dt, s, wb.fx, wb.state === 'charge' ? 'charging in the ranks' : wb.state === 'column' ? 'marching in the host' : 'camped with the host');
    return true;
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    if (this.rankTick(dt, s)) return;
    if (this.siege && this.breach(dt, s)) return;
    if (this.attackTick(dt, s)) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead || this.target.hidden) {
      this.retarget = 0.5;
      this.target = this.camp ? this.campPick(s) : this.huntPlayer ? (s.player.dead || s.player.hidden ? null : s.player) : s.nearestVictim(this.x, this.y);
    }
    this.campLeash();
    if (!this.target && this.camp) { this.campIdle(dt, s); return; }
    if (!this.target) {
      this.bored += dt;
      if (this.bored > 20) this.dead = true; // nothing to loot, leave
      this.vx = this.vy = 0;
      return;
    }
    this.bored = 0;
    if (this.startAttack(s, this.target, this.dmg, this.boss ? 16 : 13, this.boss ? 0.35 : 0.25, this.boss ? 0.7 : 0.55)) return;
    this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
    if (!this.path.length && (this.dist(this.target) > 14 || !s.world.lineClear(this, this.target) || this.target.elevated) && this.breach(dt, s)) return;
    this.followPath(dt);
    // trample crops
    const t = this.tile;
    if (s.world.get(t.tx, t.ty)?.kind === 'crop') s.world.set(t.tx, t.ty, 'tilled');
  }
}

/** A physical arrow, swept in small steps so fast shots cannot tunnel through bodies or walls. */
export class Arrow extends Mover {
  travelled = 0;
  readonly range: number;
  /** `owner` is null for a barracks tower shot, which is always loosed from the roof (elevated). */
  constructor(x: number, y: number, public ux: number, public uy: number, public dmg: number, public owner: Mover | null, public dropDistance = 170) {
    super(x, y); this.speed = 230; this.radius = 2; this.hp = this.maxHp = 1;
    this.elevated = owner ? owner.elevated : true; this.range = owner ? (this.elevated ? 220 : 170) : dropDistance;
  }
  update(dt: number, s: VillageScene): void {
    const total = this.speed * dt, steps = Math.ceil(total / 3), step = total / steps;
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += this.ux * step; this.y += this.uy * step; this.travelled += step;
      const t = s.world.get(this.tile.tx, this.tile.ty);
      if (this.travelled > this.range || !t || (!(this.elevated && t.defense) && s.world.isBlocked(this.tile.tx, this.tile.ty, true))) { this.dead = true; break; }
      let target: Raider | null = null;
      s.grid.forEachInRadius(this.x, this.y, 8, o => { if (o instanceof Raider && !o.dead && this.dist(o) <= o.radius + 2) target = o; });
      if (target) {
        const hit = target as Raider; hit.hit(this.dmg, false, this.owner ?? undefined); hit.shove(this.ux, this.uy, 6);
        s.fx.push({ kind: 'hit', attacker: this, target: hit, dmg: this.dmg, crit: false, killed: !!hit.dead });
        this.dead = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// player

/** What the player holds. The equipped tool decides what E does. */
export type Tool = 'hoe' | 'seeds' | 'axe' | 'sword' | 'house' | 'barracks' | 'hammer' | 'bow' | 'tavern' | 'wall' | 'gate' | 'stairs' | 'basket' | 'gnomehouse' | 'warren' | 'wand';
export const TOOLS: Tool[] = ['hoe', 'seeds', 'axe', 'sword', 'house', 'barracks', 'hammer', 'bow', 'tavern', 'wall', 'gate', 'stairs', 'basket', 'gnomehouse', 'warren', 'wand'];
/** the tool belt, in order (1-8 and Tab): what you hold in your hands */
export const BELT: Tool[] = ['sword', 'bow', 'hoe', 'seeds', 'axe', 'hammer', 'basket', 'wand'];
/** what the hammer builds: a row over the belt while the hammer is out (1-8 then; 0 or Esc back to the hammer) */
export const BUILDS: Tool[] = ['house', 'barracks', 'tavern', 'gnomehouse', 'warren', 'wall', 'gate', 'stairs'];

/** A sword swing in progress: an arc in front of the player that connects during its active window. */
/** A sword swing in progress: an arc in front of the player that connects during its active window. */
export interface Swing {
  t: number;
  /** 0 slash, 1 backslash, 2 spin */
  stage: number;
  /** direction the swing faces (unit) */
  dx: number;
  dy: number;
  /** targets already hit by this swing */
  hit: Set<number>;
  /** a press landed during this swing: chain into the next stage when it ends */
  queued: boolean;
}

/** Per-stage timing of the three-hit combo. `spin` hits all around and always crits. */
export const COMBO = [
  { dur: 0.30, activeFrom: 0.07, activeTo: 0.18, dmgMul: 1, push: 14, spin: false },
  { dur: 0.28, activeFrom: 0.06, activeTo: 0.17, dmgMul: 1, push: 14, spin: false },
  { dur: 0.45, activeFrom: 0.10, activeTo: 0.30, dmgMul: 1.6, push: 60, spin: true },
] as const;
export const SWING = { reach: 24, halfAngleCos: 0.35, comboWindow: 0.5, recoverAfterSpin: 0.4, stepIn: 10 } as const;

export class Player extends Mover {
  readonly pack = new Pack(p.packSlots);
  override pickUp(kind: BulkKind, n: number, food?: FoodKind): number { return this.pack.add(kind, n, food); }
  override carriedLoads() { return this.pack.bulk().map(b => ({ ...b, food: b.kind === 'food' ? b.food : undefined })); }
  override roomFor(kind: BulkKind, food?: FoodKind): number { return this.pack.room(kind, food); }
  override carriedOf(kind: BulkKind, food?: FoodKind): number { return kind === 'food' && food === undefined ? this.pack.bulk().reduce((n,b)=>n+(b.kind==='food'?b.n:0),0) : this.pack.countOf(kind, food); }
  override takeOut(kind: BulkKind, n: number, food?: FoodKind): number { return this.pack.take(kind, n, food); }
  override canCarry(kind: BulkKind, food?: FoodKind): boolean { return this.roomFor(kind, food) > 0; }
  override get mass(): number { return MASS.player; }
  override get space(): number { return Math.max(this.radius, BODY.player); }
  facing = { x: 0, y: 1 };
  tool: Tool = 'sword'; // the club you always have: there is no empty-handed tool, the right button is your hands
  /** which crop the seeds sow, and which food the basket takes */
  cropKind: FoodKind = 'wheat';
  basketKind: FoodKind = 'wheat';
  cycleCrop(): void { this.cropKind = CROP_KINDS[(CROP_KINDS.indexOf(this.cropKind) + 1) % CROP_KINDS.length]; }
  /** next food kind for the basket; skips kinds the pantry is out of (unless every kind is) */
  cycleBasket(stock: Record<FoodKind, number>): void {
    const any = FOOD_KINDS.some((k) => stock[k] > 0 || this.carriedOf('food', k) > 0);
    for (let i = 1; i <= FOOD_KINDS.length; i++) {
      const k = FOOD_KINDS[(FOOD_KINDS.indexOf(this.basketKind) + i) % FOOD_KINDS.length];
      if (!any || stock[k] > 0 || this.carriedOf('food', k) > 0) { this.basketKind = k; return; }
    }
  }
  swing: Swing | null = null;
  /** stage the next swing will be, and how long since the last swing ended */
  private nextStage = 0;
  private sinceSwing = 99;
  /** recovery after the spin finisher */
  recover = 0;
  /** kills within the last 1.2 s, for DOUBLE!/TRIPLE! pops */
  private recentKills: number[] = [];
  /** dodge roll in progress: seconds elapsed and the unit direction it commits to */
  roll: { t: number; ux: number; uy: number } | null = null;
  /** seconds since the last roll ended, for the cooldown */
  sinceRoll = 99;
  /** set by the scene: W/A/S/D key objects */
  keys!: Record<'W' | 'A' | 'S' | 'D', { isDown: boolean }>;
  /** the 3D camera's turn round the head (set by the view each frame); WASD and the stick walk relative to it */
  camYaw = 0;
  /** the way the head's standing order walks it this tick, a unit vector (MOBA right-click), or null */
  steer: { x: number; y: number } | null = null;

  constructor(x: number, y: number) {
    super(x, y);
    this.hp = this.maxHp = p.playerHp;
    this.speed = 60;
    this.radius = 3.5;
    this.color = 0xffe066;
    this.task = 'you';
    for (const tool of START_TOOLS) this.pack.put({ kind: 'tool', tool });
  }

  /** The building the tool would place, if it's a building tool. */
  get build(): BuildingKind | 'none' {
    return this.tool === 'house' || this.tool === 'barracks' || this.tool === 'tavern' || this.tool === 'gnomehouse' || this.tool === 'warren' ? this.tool : 'none';
  }

  /** The tile just in front of the player. */
  /** The neighbouring tile in the direction faced — stable until you turn or cross a tile edge. */
  get faced(): TilePos {
    const t = this.tile;
    return { tx: t.tx + this.facing.x, ty: t.ty + this.facing.y };
  }

  /** seconds the head is occupied (encouraging a child): no walking, no swinging */
  busy = 0;
  /** the head's own belly, in food units: it empties as the day passes, and an empty one costs HP (see VillageScene.tickHunger) */
  hunger = p.hungerMax;
  /** incoming damage scale from the last meal (a hearty dish softens blows); hit() has no scene to ask */
  damageMul = 1;
  override hit(dmg: number, melee = true, by?: Mover): void { super.hit(dmg * this.damageMul, melee, by); }

  update(dt: number, s: VillageScene): void {
    this.damageMul = 1 / s.buffMul('hp');
    if (s.interior.active) { s.interior.update(dt); return; }
    this.tickTimers(dt);
    this.sinceSwing += dt;
    this.sinceRoll += dt;
    this.recover = Math.max(0, this.recover - dt);
    if (this.frozen(dt)) return;
    if (this.busy > 0) { this.busy -= dt; this.vx = this.vy = 0; return; }
    if (this.roll) { this.updateRoll(dt, s); return; }
    const { mx, my } = this.moveAxis();
    if (mx || my) this.facing = Math.abs(mx) >= Math.abs(my) ? { x: Math.sign(mx), y: 0 } : { x: 0, y: Math.sign(my) };
    if (mx) this.dir = mx < 0 ? -1 : 1;
    // swinging plants your feet; the swing itself steps you forward
    const slow = this.swing ? 0.25 : this.recover > 0 ? 0.6 : 1;
    const sp = this.speed * slow * this.armorSpeed * s.world.slowAt(this.x, this.y) * s.buffMul('speed');
    this.vx = mx * sp; this.vy = my * sp;
    this.moveWithCollision(dt, s.world);
    // wading through long grass stirs it, the same tell a moving boar gives away
    this.rustleT -= dt;
    if ((mx || my) && this.rustleT <= 0 && s.world.tallAt(this.x, this.y)) {
      this.rustleT = s.rng.range(BOAR.rustleEvery[0], BOAR.rustleEvery[1]);
      s.fx.push({ kind: 'rustle', x: this.x, y: this.y });
    }
    // pushing up into a doorway walks you inside
    s.pushDoor(dt, my < -0.5 && Math.abs(mx) < 0.5);
    this.updateSwing(dt, s);
    // an empty belly stops the mending: playerRegen is 5 HP/s, which would outrun any starve rate
    if (s.mods.playerRegen && (!p.hunger || this.hunger > 0) && this.hp < this.maxHp && !s.nearestRaider(this.x, this.y, 40)) this.hp = Math.min(this.maxHp, this.hp + s.mods.playerRegen * dt);
  }

  /** seconds until the long grass stirs again as the head wades through it */
  private rustleT = 0;

  /** The movement axis this tick: WASD, or the virtual stick when no key is down. Diagonals are normalised. */
  private moveAxis(): { mx: number; my: number } {
    let mx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    let my = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    // W is away from the camera, wherever it has swung round to
    if (this.camYaw) { const c = Math.cos(this.camYaw), s = Math.sin(this.camYaw); [mx, my] = [mx * c + my * s, -mx * s + my * c]; }
    // no keys, no stick: the standing order walks (VillageScene.driveCommand sets it in world space)
    if (!mx && !my && this.steer) return { mx: this.steer.x, my: this.steer.y };
    return { mx, my };
  }

  /**
   * Begin a dodge roll along the movement input, or the way we face when standing still. A roll is a
   * commitment: no steering, no swinging, and the cooldown only starts once it lands. Returns the
   * direction it committed to, or null if the head was not free to take one.
   */
  pressRoll(): { ux: number; uy: number } | null {
    if (this.roll || this.swing || this.recover > 0 || this.busy > 0 || this.freeze > 0) return null;
    if (this.sinceRoll < p.rollCd) return null;
    const { mx, my } = this.moveAxis();
    const len = Math.hypot(mx, my);
    const ux = len > 0.01 ? mx / len : this.facing.x, uy = len > 0.01 ? my / len : this.facing.y;
    if (!ux && !uy) return null;
    this.roll = { t: 0, ux, uy };
    this.facing = Math.abs(ux) >= Math.abs(uy) ? { x: Math.sign(ux), y: 0 } : { x: 0, y: Math.sign(uy) };
    if (ux) this.dir = ux < 0 ? -1 : 1;
    return { ux, uy };
  }

  /**
   * Advance the roll. It covers `rollDist` over `rollTime` on an ease-out curve — a burst that settles.
   * The step is the difference of the curve between two ticks rather than a speed we integrate, so the
   * distance is exactly what the slider says whatever the frame rate. Armor weight and long grass are
   * ignored: a roll is a fixed commitment, and you go over the grass rather than through it.
   */
  private updateRoll(dt: number, s: VillageScene): void {
    const r = this.roll!;
    const T = Math.max(0.01, p.rollTime);
    const ease = (u: number) => u * (2 - u);
    const u0 = Math.min(1, r.t / T);
    r.t += dt;
    const u1 = Math.min(1, r.t / T);
    const sp = (ease(u1) - ease(u0)) * p.rollDist / dt;
    this.vx = r.ux * sp; this.vy = r.uy * sp;
    this.moveWithCollision(dt, s.world);
    if (r.t >= T) { this.roll = null; this.sinceRoll = 0; this.vx = this.vy = 0; }
  }

  /**
   * Press attack. Starts the next stage of the combo, or queues it if a swing is still running
   * (so mashing chains instead of being eaten). Returns the stage started, or -1.
   */
  pressAttack(): number {
    if(this.weapons.melee<0)return -1;
    if (this.swing) { this.swing.queued = true; return -1; }
    if (this.recover > 0) return -1;
    if (this.sinceSwing > SWING.comboWindow) this.nextStage = 0;
    return this.beginSwing(this.nextStage);
  }

  private beginSwing(stage: number): number {
    this.swing = { t: 0, stage, dx: this.facing.x, dy: this.facing.y, hit: new Set(), queued: false };
    this.nextStage = (stage + 1) % COMBO.length;
    return stage;
  }

  /** Advance the swing; during the active window, anything in the arc gets hit once. */
  private updateSwing(dt: number, s: VillageScene): void {
    const sw = this.swing;
    if (!sw) return;
    const c = COMBO[sw.stage];
    const wasActive = sw.t >= c.activeFrom && sw.t <= c.activeTo;
    sw.t += dt;
    const active = sw.t >= c.activeFrom && sw.t <= c.activeTo;
    if (active && !wasActive) this.mow(s, sw.dx, sw.dy, c.spin);
    // step into the swing
    if (active && !c.spin) {
      const nx = this.x + sw.dx * SWING.stepIn * (dt / (c.activeTo - c.activeFrom)), ny = this.y + sw.dy * SWING.stepIn * (dt / (c.activeTo - c.activeFrom));
      if (this.fits(nx, ny, s.world)) { this.x = nx; this.y = ny; }
    }
    if (active || wasActive) {
      const dmg = Math.round(p.playerDmg * weaponMul(this.weapons, 'melee') * s.mods.playerDmgMul * c.dmgMul * s.buffMul('dmg'));
      s.grid.forEachInRadius(this.x, this.y, SWING.reach + (c.spin ? 4 : 0), (o, d2) => {
        if (!(o instanceof Raider) || o.dead || sw.hit.has(o.id)) return;
        if (o.elevated !== this.elevated || !s.world.lineClear(this, o, this.elevated)) return;
        const d = Math.sqrt(d2) || 1;
        const ux = (o.x - this.x) / d, uy = (o.y - this.y) / d;
        if (!c.spin && d > 6 && ux * sw.dx + uy * sw.dy < SWING.halfAngleCos) return; // outside the arc
        sw.hit.add(o.id);
        o.hit(dmg, true, this);
        o.shove(ux, uy, c.push);
        const crit = c.spin;
        const stop = o.dead ? 0.1 : crit ? 0.12 : 0.06;
        o.freeze = Math.max(o.freeze, stop);
        this.freeze = Math.max(this.freeze, stop * 0.7);
        if (o.dead) {
          const now = s.simTime;
          this.recentKills = this.recentKills.filter((k) => now - k < 1.2);
          this.recentKills.push(now);
        }
        s.fx.push({ kind: 'hit', attacker: this, target: o, dmg, crit, killed: !!o.dead, streak: o.dead ? this.recentKills.length : 0, ux, uy, push: c.push });
      });
    }
    if (sw.t >= c.dur) {
      const queued = sw.queued;
      this.swing = null;
      this.sinceSwing = 0;
      if (c.spin) { this.recover = SWING.recoverAfterSpin; this.nextStage = 0; }
      else if (queued) { const st = this.beginSwing(this.nextStage); s.fx.push({ kind: 'swing', who: this, dx: this.facing.x, dy: this.facing.y, stage: st }); }
    }
  }

  /**
   * The swing doubles as a scythe: every long-grass tile in its arc (the same reach and cone the blade hits in,
   * a full ring for the spin) plus the one underfoot is mown. Once per swing, on the first active frame.
   */
  private mow(s: VillageScene, dx: number, dy: number, spin: boolean): void {
    const reach = SWING.reach + (spin ? 4 : 0), me = this.tile;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const tx = me.tx + ox, ty = me.ty + oy, c = World.center(tx, ty);
      const cx = c.x - this.x, cy = c.y - this.y, d = Math.hypot(cx, cy);
      if (ox || oy) {
        if (d > reach) continue;
        if (!spin && (cx * dx + cy * dy) / (d || 1) < SWING.halfAngleCos) continue;
      }
      if (s.world.cutGrass(tx, ty)) s.fx.push({ kind: 'cut', x: c.x, y: c.y });
      else if (s.world.get(tx, ty)?.kind === 'thicket') { s.world.cutThicket(tx, ty, 2); s.fx.push({ kind: 'cut', x: c.x, y: c.y }); } // two swings to a tile
    }
  }

  /** Does the whole body (all four corners) stand on walkable ground at (x, y)? */
  fits(x: number, y: number, w: World): boolean {
    const r = this.radius - 0.5;
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const t = World.toTile(x + ox, y + oy);
      if (w.isBlocked(t.tx, t.ty, false, this.elevated)) return false;
    }
    return true;
  }

  private moveWithCollision(dt: number, w: World): void {
    // if we are somehow inside something solid (a shove, a swing's step), let any movement through so we can never be trapped
    const stuck = !this.fits(this.x, this.y, w);
    const nx = this.x + this.vx * dt;
    if (stuck || this.fits(nx, this.y, w)) this.x = nx;
    const ny = this.y + this.vy * dt;
    if (stuck || this.fits(this.x, ny, w)) this.y = ny;
  }

  /** Next tool along the belt, skipping any the head has not learned yet (see VillageScene.toolLocked). */
  cycleTool(dir = 1, locked: (t: Tool) => boolean = () => false): void {
    // the belt only: a build counts as the hammer it is made with
    let i = BELT.indexOf(BUILDS.includes(this.tool) ? 'hammer' : this.tool);
    for (let n = 0; n < BELT.length; n++) {
      i = (i + dir + BELT.length) % BELT.length;
      if (!locked(BELT[i])) { this.tool = BELT[i]; return; }
    }
  }
}
