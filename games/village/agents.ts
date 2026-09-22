import type { Agent } from '@shared/index';
import { World, WILD_FOOD, doorstep, buildingCenter, BUILDINGS, type House, type Building, type TilePos, type Defense, type BuildingKind } from './world';
import { p, TREE_RESERVE, STAR_BONUS, BEDTIME, TRAITS, HAUL, TILE, ELDER_MUL, CALLINGS, ORDER, GNOME_YARD, ITEM, MASS, FOODS, FOOD_KINDS, CROP_KINDS, DIET_CAP, BOAR, type Calling, type Trait, type LoadKind, type FoodKind, type DietStat } from './config';
import type { Mods } from './meta';
import { NO_ARMOR, NO_WEAPONS, armorStats, weaponMul, type Armor, type Weapons, type HelmetStyle } from './characters';
import type { VillageScene } from './main';
import type { Item } from './items';

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
  color = 0xffffff;
  attackCd = 0;
  /** true while tucked away inside a house (not drawn, not targetable). */
  hidden = false;
  elevated = false;
  /** what this body is carrying: chopped wood or picked food, on its way to the woodyard / granary */
  /** what the arms hold: wood, or food of one kind */
  load: { kind: LoadKind; n: number; food?: FoodKind } | null = null;
  /** Put a yield in this body's arms (one kind at a time — the other kind is taken in first; one crop per armful). */
  pickUp(kind: LoadKind, n: number, food?: FoodKind): void {
    if (this.load && (this.load.kind !== kind || (kind === 'food' && this.load.food !== food))) return;
    this.load = { kind, n: (this.load?.n ?? 0) + n, food: kind === 'food' ? food : undefined };
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
    this.goal = { tx, ty };
    this.pathRevision = s.world.revision;
    this.path = s.world.bfs(this.tile, this.goal, this.hostile, this.elevated);
  }

  clearGoal(): void {
    this.goal = null;
    this.path = [];
    this.stallT = 0; this.lastGap = Infinity;
  }

  /** seconds spent walking without getting closer to the next waypoint (a body in the way pushes back as fast as we walk), and how close we got */
  private stallT = 0;
  private lastGap = Infinity;

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
        t.shove((t.x - this.x) / d, (t.y - this.y) / d, 3);
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

/** 'infant' lives unseen in the house nursery; 'kid' trains in a pen; the rest are grown (an elder keeps their role, see Villager.elder). 'gnome' is a grown gnome: no calling, fights like a soldier (see Villager.gnome) */
export type Role = 'infant' | 'kid' | 'farmer' | 'woodcutter' | 'soldier' | 'gnome';

/** A standing order from the shaman wand: hold a spot (fight what comes within ORDER.leash of it), hunt one enemy, or shadow the head. A wall post is the other stance; the two never coexist. */
export type Order = { kind: 'hold'; tx: number; ty: number } | { kind: 'attack'; target: Mover } | { kind: 'follow' };

export class Villager extends Mover {
  weapon: 'sword' | 'bow' = 'sword';
  post: TilePos | null = null;
  order: Order | null = null;
  private stairsGoal: TilePos | null = null;
  indoors: House | null = null;
  role: Role;
  /** age in days (fractional: it advances every tick) */
  age: number;
  hungerDays = 0;
  /** grown old: slower, grey, and living on borrowed time (see p.elderDays) */
  elder = false;
  /** born in a gnome house: a little person who never takes a pen or a calling, eats at the granary as a child and fights when grown */
  gnome = false;
  /** the pen kind a child trains in (null: no pen painted — they play near home and eat at home) */
  pen: Calling | null = null;
  /** pen children: the day they last ate from the pile, and sim time their next meal is due */
  ateDay = 0;
  mealAt = 0;
  /** what they ate as a child, by kind, and the bonuses it froze into at coming of age */
  diet: Record<FoodKind, number> = { wheat: 0, carrot: 0, tomato: 0, berry: 0, mushroom: 0, hazelnut: 0, garlic: 0, burdock: 0, meat: 0 };
  dietBonus: Record<Exclude<DietStat, 'care'>, number> = { hp: 0, speed: 0, work: 0, dmg: 0 };
  /** mushrooms counted toward today's care point (one per meal) */
  private shroomMeal = false;
  /** died of hunger (so the death isn't also reported as a killing) */
  starved = false;
  /** days of training done in the pen (fractional: it accrues by the hour while they are there and fed) */
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
  override get mass(): number { return this.isChild ? MASS.kid : MASS.villager; }
  get isChild(): boolean { return this.role === 'kid' || this.role === 'infant'; }
  /** Training in a pen (every child with a pen trains, every day they are fed). */
  apprenticeAt(_s?: VillageScene): boolean {
    return this.role === 'kid' && !!this.pen;
  }
  /** The age this villager passes away: the village's death age, give or take a bit so elders don't drop in unison. */
  deathAt(s: VillageScene): number { return s.deathAge + ((this.id % 7) / 6 - 0.5) * p.elderDays * 0.5; }
  /** Training days needed to come of age skilled (War Drums lowers it). */
  static drillNeeded(s: VillageScene): number { return Math.max(1, p.cadetDays + s.mods.cadetDaysDelta); }
  /** What this child will become as things stand — shown in the UI so nothing is a surprise. The pen decides; without one, nothing is decided yet. */
  outlook(s: VillageScene): { role: Calling | 'gnome' | null; skilled: boolean } {
    if (this.gnome) return { role: 'gnome', skilled: false }; // a gnome grows into a gnome; no pen has a say
    const daysLeft = Math.max(0, s.adultAge - this.age); // training days still possible, if fed all the way
    const skilled = s.mods.fullDrill || (!!this.pen && this.trained + daysLeft >= Villager.drillNeeded(s));
    return { role: this.pen, skilled };
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
  /** A bite from a pen pile: it goes on the diet; mushrooms also earn a care point (once per meal). */
  eatBite(kind: FoodKind, n: number): void {
    this.diet[kind] += n;
    if (kind === 'mushroom' && !this.shroomMeal) { this.shroomMeal = true; this.care += 1; }
  }
  /** Work-speed multiplier from upbringing: skill, stars, traits and diet. */
  get workMul(): number {
    return (this.skilled ? 1.4 : 1) * (1 + STAR_BONUS * this.stars) * (this.trait === 'tireless' ? 1.25 : 1) * (1 + this.dietBonus.work) * (this.elder ? ELDER_MUL : 1);
  }

  applyRole(mods: Mods): void {
    switch (this.role) {
      case 'infant': this.radius = 1; this.color = 0xf5d8a8; this.maxHp = 5; this.speed = 0; break;
      case 'kid': this.radius = 2; this.color = 0xf5d8a8; this.maxHp = 10; this.speed = 30; break;
      case 'farmer': this.radius = 3; this.color = 0x7fd37f; this.maxHp = 20; this.speed = 35; break;
      case 'woodcutter': this.radius = 3; this.color = 0xc9a26b; this.maxHp = 20; this.speed = 35; break;
      case 'gnome': this.radius = 2; this.color = 0xd94a3a; this.maxHp = p.gnomeHp; this.speed = p.gnomeSpeed; break;
      case 'soldier': this.radius = 3; this.color = 0x6f9bff; this.maxHp = p.soldierHp + mods.soldierHpBonus + this.barracksHp + (this.skilled ? 15 : 0) + armorStats(this.armor).hp; this.speed = 45 * armorStats(this.armor).speedMul; break;
    }
    // how they were raised follows them for life
    if (this.isAdult) {
      const stars = 1 + STAR_BONUS * this.stars;
      this.maxHp *= stars * (this.trait === 'hardy' ? 1.25 : 1) * (this.stars <= 1 ? 0.9 : 1) * (1 + this.dietBonus.hp);
      this.speed *= stars * (this.trait === 'quick' ? 1.2 : 1) * (1 + this.dietBonus.speed) * (this.elder ? ELDER_MUL : 1);
    }
    this.maxHp = Math.round(this.maxHp * mods.hpMul * (this.role === 'soldier' ? 1 : mods.villagerHpMul));
    this.hp = Math.min(this.hp, this.maxHp);
    this.clearGoal();
  }

  /** Called on the day the kid reaches adultAge: their upbringing becomes who they are. */
  comeOfAge(s: VillageScene): void {
    const { role, skilled } = this.outlook(s);
    if (!role) return; // no pen ever taught them anything: they stay a child until one does
    this.stars = this.starsNow();
    this.dietBonus = this.dietNow(); // what they ate is who they are
    this.skilled = skilled;
    if (this.stars >= 5) this.trait = s.rng.pick(Object.keys(TRAITS) as Trait[]);
    this.role = role;
    this.pen = null; // grown: they eat at the granary like everyone else
    this.barracksHp = s.world.barracksLevel >= 3 ? 30 : s.world.barracksLevel >= 2 ? 15 : 0;
    this.applyRole(s.mods);
    this.hp = this.maxHp;
    const star = '★'.repeat(this.stars) + '☆'.repeat(5 - this.stars);
    // with a breeding program running, only the gifted are worth a toast; the rest go to the journal
    s.event(this.role === 'soldier' ? 'soldier' : 'grow', `${this.name} came of age — ${this.role === 'gnome' ? 'a grown gnome' : `${skilled ? 'a skilled ' : 'a '}${this.role}`}, ${star}${this.trait ? ` (${TRAITS[this.trait].name})` : ''}`);
    s.stats.childrenRaised++;
    s.stats.starsTotal += this.stars;
    if (this.role === 'soldier') s.stats.soldiersRaised++;
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
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
      if (!s.raidActive || this.role === 'soldier') this.unhide(s);
      return;
    }
    switch (this.role) {
      case 'infant': return;
      case 'kid': if (this.pen) this.penUpdate(dt, s); else this.kidUpdate(dt, s); break;
      case 'farmer': this.civilUpdate(dt, s, 'farm'); break;
      case 'woodcutter': this.civilUpdate(dt, s, this.helpingFarm(s) ? 'farm' : 'wood'); break;
      case 'gnome': this.civilUpdate(dt, s, 'forage'); break;
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

    // a pen painted since they left the nursery: off they go (gnome children never go: no pen has anything to teach them)
    const pen = this.gnome ? null : this.findPen(s);
    if (pen) { this.pen = pen; this.mealAt = s.simTime + p.dayLength / 4; this.ateDay = s.day; this.clearGoal(); return; }

    // gnome children eat what lies in the yard of their cottage — thrown from the basket, or nothing
    if (this.gnome) {
      const hungry = this.mealAt <= s.simTime && p.kidFood > 0;
      if (hungry) {
        const item = s.world.nearestYardItem(this.x, this.y, this.home, GNOME_YARD);
        if (item) { this.eatFrom(dt, s, item); return; }
      }
      this.eatingFrom = null;
      this.task = hungry ? 'hungry — nothing by the gnome house' : 'playing by the gnome house';
    } else this.task = 'no pen to train in';
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || this.followPath(dt)) {
      this.thinkTimer = s.rng.range(2, 5);
      const r = 5, hc = buildingCenter(this.home);
      const tx = Math.round(hc.tx) + s.rng.int(-r, r), ty = Math.round(hc.ty) + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) this.setGoal(s, tx, ty, true);
    }
  }

  /** The pen this child should train in: the nearest one painted, whatever it teaches. */
  findPen(s: VillageScene): Calling | null {
    const q = s.world.nearestPen(this.x, this.y);
    return q ? s.world.get(q.tx, q.ty)?.pen ?? null : null;
  }

  // --- pen children: live in the painted pen, eat what the head tosses in, train ---------

  private penUpdate(dt: number, s: VillageScene): void {
    const kind = this.pen!;
    const tiles = s.world.pens.get(kind);
    if (!tiles?.size) { this.pen = null; this.clearGoal(); return; } // the pen was erased: back to playing near home
    const danger = s.nearestRaider(this.x, this.y, p.fleeRange);
    if (danger || (this.sentHome && s.raidActive)) {
      if (danger && this.fledDay !== s.day) this.fledDay = s.day;
      this.task = 'running for cover';
      this.goInside(s, dt, s.nearestShelter(this.x, this.y) ?? this.home);
      return;
    }
    const w = s.world, here = this.tile, inPen = w.get(here.tx, here.ty)?.pen === kind;
    // a meal is due: walk to the nearest food lying in the pen and eat from it
    const hungry = this.mealAt <= s.simTime && p.kidFood > 0;
    if (hungry) {
      const item = w.nearestPenItem(this.x, this.y, kind);
      if (item) { this.eatFrom(dt, s, item); return; }
      this.task = 'hungry — nothing in the pen';
    }
    this.eatingFrom = null;
    // night: doze where they stand
    if ((s.dayTime > BEDTIME.start || s.dayTime < BEDTIME.end) && inPen) { this.task = 'asleep in the pen'; this.vx = this.vy = 0; this.clearGoal(); return; }
    if (!hungry) this.task = kind === 'soldier' ? 'drilling' : kind === 'farmer' ? 'learning to farm' : 'learning the axe';
    // training accrues by the hour, while they are in the pen and fed (a drill yard needs a warm barracks to drill anyone)
    const canTrain = kind !== 'soldier' || s.world.barracks.some((b) => b.warm);
    // (a waking day in the pen is a day of training: the night asleep does not count against them)
    const waking = 1 - (1 - BEDTIME.start + BEDTIME.end);
    if (inPen && !hungry && canTrain) this.trained = Math.min(Villager.drillNeeded(s), this.trained + dt / (p.dayLength * waking));
    // run about the pen: every leg a real run to a spot a couple of tiles off, a swing or a stroke of the hoe on the way
    const walk = this.speed; this.speed *= p.penPace;
    const arrived = this.followPath(dt);
    this.speed = walk;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || arrived) {
      this.thinkTimer = s.rng.range(1.5, 3);
      let pick = -1, best = -1;
      for (let tries = 0; tries < 4; tries++) {
        let n = s.rng.int(0, tiles.size - 1), i = -1;
        for (const t of tiles) if (n-- <= 0) { i = t; break; }
        if (i < 0) continue;
        const d = Math.hypot((i % w.cols) - here.tx, ((i / w.cols) | 0) - here.ty);
        if (d > best) { best = d; pick = i; }
        if (d >= 2) break;
      }
      if (pick >= 0) this.setGoal(s, pick % w.cols, (pick / w.cols) | 0, true);
    }
    this.trainTimer -= dt;
    if (this.trainTimer <= 0 && inPen && !hungry) {
      this.trainTimer = s.rng.range(2, 4);
      if (kind === 'soldier') s.fx.push({ kind: 'swing', who: this, dx: this.dir, dy: 0, stage: 0 });
      else s.fx.push({ kind: 'tool', tool: kind === 'farmer' ? 'hoe' : 'axe', tx: here.tx, ty: here.ty, who: this });
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
  /** job tiles no path led to, keyed by tile index, with the sim time they may be tried again */
  private unreachable = new Map<number, number>();
  private failedPicks = 0;

  /** How much of a kind these arms hold: a gnome brings home one find at a time — but drags a whole boar's meat in one go. */
  haul(kind: LoadKind): number { return this.gnome ? (kind === 'food' && this.load?.food === 'meat' ? BOAR.meat : 1) : Math.round(HAUL.villager[kind] * p.haulMul); }
  /** the meat lying in the wild this gnome is on its way to (claimed in `VillageScene.meatClaims`, so two never chase one ham) */
  private fetching: Item | null = null;

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
    const take = Math.min(it.n, BOAR.meat);
    this.pickUp('food', take, 'meat'); it.n -= take;
    if (it.n <= 1e-9) s.world.removeItem(it);
    this.dropFetch(s);
    this.delivering = true; this.clearGoal();
    return true;
  }
  private dropFetch(s: VillageScene): void { if (this.fetching) s.meatClaims.delete(this.fetching.id); this.fetching = null; this.clearGoal(); }

  /** Farmers, woodcutters and foraging gnomes: find a job tile, walk there, work it, carry the take home. */
  private civilUpdate(dt: number, s: VillageScene, job: 'farm' | 'wood' | 'forage'): void {
    const farmer = job === 'farm';
    if (s.nearestRaider(this.x, this.y, 90)) { this.task = 'fleeing'; this.delivering = false; if (this.fetching) this.dropFetch(s); this.goHome(s, dt); return; }

    if (this.workTimer > 0) {
      this.workTimer -= dt;
      this.vx = this.vy = 0;
      if (this.workTimer <= 0 && this.goal) this.finishWork(s, job);
      return;
    }

    if (this.delivering) { this.deliver(dt, s); return; }
    if (job === 'forage' && this.fetchMeat(dt, s)) return;

    this.thinkTimer -= dt;
    if (!this.goal && this.thinkTimer <= 0) {
      this.thinkTimer = 1;
      const w = s.world;
      // arms full: take it in before looking for more work
      if (this.load && this.load.n >= this.haul(this.load.kind)) { this.delivering = true; this.deliver(dt, s); return; }
      const ok = (tx: number, ty: number) => (this.unreachable.get(ty * w.cols + tx) ?? 0) <= s.simTime;
      // meat lying in the wild comes before any plant: a gnome claims the nearest unclaimed piece and goes for it
      if (job === 'forage' && (!this.load || this.load.food === 'meat') && s.food < s.foodCap) {
        const it = w.nearestWildMeat(this.x, this.y, (m) => !s.meatClaims.has(m.id) && ok(Math.floor(m.x / TILE), Math.floor(m.y / TILE)));
        if (it) { s.meatClaims.add(it.id); this.fetching = it; this.fetchMeat(dt, s); return; }
      }
      const spot = job === 'forage'
        ? w.nearest(this.x, this.y, (t, tx, ty) => !!WILD_FOOD[t.kind] && s.wildLeft(t) > 0 && (!this.load || this.load.food === WILD_FOOD[t.kind]) && ok(tx, ty))
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
    return w.nearest(this.x, this.y, (t, tx, ty) => s.isOldGrowth(t) && edge(tx, ty) && ok(tx, ty))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => s.isOldGrowth(t) && ok(tx, ty))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'tree' && edge(tx, ty) && ok(tx, ty))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'tree' && ok(tx, ty));
  }

  /** Walk the load to its building and hand it in; falls back to the job loop if there is nowhere to take it. */
  private deliver(dt: number, s: VillageScene): void {
    const load = this.load;
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
        if (this.load) return; // whatever is left goes on to the woodyard next tick
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
      if (kind && s.wildLeft(t) > 0 && s.food < s.foodCap && this.canCarry('food', kind) && s.pickWild(g.tx, g.ty, 1)) this.pickUp('food', 1, kind);
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
    else if (!farmer && t.kind === 'tree' && (!this.load || this.load.kind === 'wood')) { const wood = s.treeYield(t) + (this.skilled ? 4 : 0); s.world.set(g.tx, g.ty, 'sapling'); this.pickUp('wood', wood); }
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
    // an order's quarry is down: the squad holds the ground it took
    const order = this.order;
    if (order?.kind === 'attack' && (order.target.dead || order.target.hidden)) { this.order = { kind: 'hold', ...this.tile }; this.retarget = 0; }
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.4;
      const leash = ORDER.leash * TILE;
      this.target = order?.kind === 'attack' ? (order.target as Raider)
        : order?.kind === 'hold' ? s.bestTarget((order.tx + 0.5) * TILE, (order.ty + 0.5) * TILE, leash)
        : order?.kind === 'follow' ? s.bestTarget(s.player.x, s.player.y, leash)
        : s.bestTarget(this.x, this.y, this.weapon === 'bow' ? 190 : 130);
    }
    if (this.target && !this.target.dead) {
      this.task = 'fighting';
      if (this.attackTick(dt, s)) return;
      const dmg = p.soldierDmg * weaponMul(this.weapons, this.weapon === 'bow' ? 'bow' : 'melee') * s.mods.soldierDmgMul * (s.world.barracksLevel >= 3 ? 1.2 : 1) * (this.skilled ? 1.15 : 1) * (this.trait === 'brave' ? 1.2 : 1) * (1 + this.dietBonus.dmg);
      if (this.weapon === 'bow') {
        const range = this.elevated ? 210 : 160;
        if (this.dist(this.target) <= range && s.world.lineClear(this, this.target, this.elevated)) {
          this.vx = this.vy = 0; this.task = this.post ? 'archer holding the wall' : 'firing arrows';
          if (this.attackCd <= 0) { s.shoot(this, this.target.x - this.x, this.target.y - this.y, Math.round(dmg)); this.attackCd = 0.9; }
          return;
        }
      }
      if (this.post) { this.setGoal(s, this.post.tx, this.post.ty); this.followPath(dt); this.task = 'holding wall post'; return; }
      if (this.startAttack(s, this.target, Math.round(dmg), 13, 0.15, 0.45)) return;
      this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
      this.followPath(dt);
      return;
    }
    this.target = null;
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
    // a cold barracks mends nobody
    const regen = s.world.barracks.some((b) => b.warm) ? s.mods.soldierRegen + (s.world.barracksLevel >= 3 ? 1 : 0) : 0;
    if (regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    this.thinkTimer -= dt;
    if (this.followPath(dt) && this.thinkTimer <= 0) {
      this.thinkTimer = s.rng.range(3, 7);
      const post = buildingCenter(s.world.barracks.length ? s.rng.pick(s.world.barracks) : this.home);
      // a bigger garrison patrols a wider ring, so they aren't all shoulder to shoulder against the wall
      this.wanderNear(s, { tx: Math.round(post.tx), ty: Math.round(post.ty) }, 3 + Math.floor(s.fighters().length / 4));
    }
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

export type EnemyKind = 'raider' | 'warlord' | 'rat' | 'snatcher' | 'brute' | 'shaman' | 'ogre' | 'wrecker' | 'boar';

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
        s.event('raid', 'The defenses have been breached!', true); s.rescueFallenGuards();
      }
    }
    if (a.t >= (this.kind === 'brute' ? 0.6 : 1.1)) { this.siege = null; this.clearGoal(); }
    return true;
  }
  protected target: Mover | null = null;
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
    this.name = this.boss ? 'The Warlord' : 'Raider';
    this.task = this.boss ? 'leading the raid' : 'raiding';
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    if (this.siege && this.breach(dt, s)) return;
    if (this.attackTick(dt, s)) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead || this.target.hidden) {
      this.retarget = 0.5;
      this.target = s.nearestVictim(this.x, this.y);
    }
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
export type Tool = 'hands' | 'hoe' | 'seeds' | 'axe' | 'sword' | 'house' | 'barracks' | 'hammer' | 'bow' | 'tavern' | 'wall' | 'gate' | 'stairs' | 'pen' | 'basket' | 'gnomehouse' | 'wand';
export const TOOLS: Tool[] = ['hands', 'hoe', 'seeds', 'axe', 'sword', 'house', 'barracks', 'hammer', 'bow', 'tavern', 'wall', 'gate', 'stairs', 'pen', 'basket', 'gnomehouse', 'wand'];

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
  override get mass(): number { return MASS.player; }
  facing = { x: 0, y: 1 };
  tool: Tool = 'hands';
  /** which pen the paint tool lays down, which crop the seeds sow, which food the basket takes */
  penKind: Calling = 'farmer';
  cropKind: FoodKind = 'wheat';
  basketKind: FoodKind = 'wheat';
  cyclePen(): void { this.penKind = CALLINGS[(CALLINGS.indexOf(this.penKind) + 1) % CALLINGS.length]; }
  cycleCrop(): void { this.cropKind = CROP_KINDS[(CROP_KINDS.indexOf(this.cropKind) + 1) % CROP_KINDS.length]; }
  /** next food kind for the basket; skips kinds the pantry is out of (unless every kind is) */
  cycleBasket(stock: Record<FoodKind, number>): void {
    const any = FOOD_KINDS.some((k) => stock[k] > 0);
    for (let i = 1; i <= FOOD_KINDS.length; i++) {
      const k = FOOD_KINDS[(FOOD_KINDS.indexOf(this.basketKind) + i) % FOOD_KINDS.length];
      if (!any || stock[k] > 0) { this.basketKind = k; return; }
    }
  }
  swing: Swing | null = null;
  /** stage the next swing will be, and how long since the last swing ended */
  private nextStage = 0;
  private sinceSwing = 99;
  /** recovery after the spin finisher */
  private recover = 0;
  /** kills within the last 1.2 s, for DOUBLE!/TRIPLE! pops */
  private recentKills: number[] = [];
  /** set by the scene: W/A/S/D key objects */
  keys!: Record<'W' | 'A' | 'S' | 'D', { isDown: boolean }>;
  /** virtual joystick axis (-1..1), set by the touch UI */
  touch = { x: 0, y: 0 };

  constructor(x: number, y: number) {
    super(x, y);
    this.hp = this.maxHp = p.playerHp;
    this.speed = 60;
    this.radius = 3.5;
    this.color = 0xffe066;
    this.task = 'you';
  }

  /** The building the tool would place, if it's a building tool. */
  get build(): BuildingKind | 'none' {
    return this.tool === 'house' || this.tool === 'barracks' || this.tool === 'tavern' || this.tool === 'gnomehouse' ? this.tool : 'none';
  }

  /** The tile just in front of the player. */
  /** The neighbouring tile in the direction faced — stable until you turn or cross a tile edge. */
  get faced(): TilePos {
    const t = this.tile;
    return { tx: t.tx + this.facing.x, ty: t.ty + this.facing.y };
  }

  /** seconds the head is occupied (encouraging a child): no walking, no swinging */
  busy = 0;

  update(dt: number, s: VillageScene): void {
    if (s.interior.active) { s.interior.update(dt); return; }
    this.tickTimers(dt);
    this.sinceSwing += dt;
    this.recover = Math.max(0, this.recover - dt);
    if (this.frozen(dt)) return;
    if (this.busy > 0) { this.busy -= dt; this.vx = this.vy = 0; return; }
    let mx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    let my = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    if (!mx && !my && (this.touch.x || this.touch.y)) {
      const len = Math.hypot(this.touch.x, this.touch.y);
      const k = Math.min(1, len) / (len || 1);
      mx = this.touch.x * k; my = this.touch.y * k;
    }
    if (mx || my) this.facing = Math.abs(mx) >= Math.abs(my) ? { x: Math.sign(mx), y: 0 } : { x: 0, y: Math.sign(my) };
    if (mx) this.dir = mx < 0 ? -1 : 1;
    // swinging plants your feet; the swing itself steps you forward
    const slow = this.swing ? 0.25 : this.recover > 0 ? 0.6 : 1;
    const sp = this.speed * slow * this.armorSpeed * s.world.slowAt(this.x, this.y);
    this.vx = mx * sp; this.vy = my * sp;
    this.moveWithCollision(dt, s.world);
    // pushing up into a doorway walks you inside
    s.pushDoor(dt, my < -0.5 && Math.abs(mx) < 0.5);
    this.updateSwing(dt, s);
    if (s.mods.playerRegen && this.hp < this.maxHp && !s.nearestRaider(this.x, this.y, 40)) this.hp = Math.min(this.maxHp, this.hp + s.mods.playerRegen * dt);
  }

  /**
   * Press attack. Starts the next stage of the combo, or queues it if a swing is still running
   * (so mashing chains instead of being eaten). Returns the stage started, or -1.
   */
  pressAttack(): number {
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
      const dmg = Math.round(p.playerDmg * weaponMul(this.weapons, 'melee') * s.mods.playerDmgMul * c.dmgMul);
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

  cycleTool(dir = 1): void {
    this.tool = TOOLS[(TOOLS.indexOf(this.tool) + dir + TOOLS.length) % TOOLS.length];
  }
}
