import type { Agent } from '@shared/index';
import { World, doorstep, buildingCenter, yardOf, BUILDINGS, type House, type Building, type TilePos, type Defense, type BuildingKind } from './world';
import { p, TREE_RESERVE, CADET_AGE_BEFORE, STAR_BONUS, BEDTIME, TRAITS, HAUL, TILE, type Calling, type Trait, type LoadKind } from './config';
import type { Mods } from './meta';
import { NO_ARMOR, NO_WEAPONS, armorStats, weaponMul, type Armor, type Weapons, type HelmetStyle } from './characters';
import type { VillageScene } from './main';

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
  load: { kind: LoadKind; n: number } | null = null;
  /** Put a yield in this body's arms (one kind at a time — the other kind is taken in first). */
  pickUp(kind: LoadKind, n: number): void {
    if (this.load && this.load.kind !== kind) return;
    this.load = { kind, n: (this.load?.n ?? 0) + n };
  }
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
  }

  /** Advance along the path. Returns true when there is nowhere left to go. */
  followPath(dt: number): boolean {
    if (this.path.length === 0) { this.vx = this.vy = 0; return true; }
    if (this.world?.isBlocked(this.path[0].tx, this.path[0].ty, this.hostile, this.elevated)) { this.clearGoal(); this.vx = this.vy = 0; return true; }
    const next = World.center(this.path[0].tx, this.path[0].ty);
    const dx = next.x - this.x, dy = next.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed * dt;
    if (Math.abs(dx) > 0.5) this.dir = dx < 0 ? -1 : 1;
    if (d <= step) {
      this.x = next.x; this.y = next.y;
      this.path.shift();
      return this.path.length === 0;
    }
    this.vx = (dx / d) * this.speed; this.vy = (dy / d) * this.speed;
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
  hit(dmg: number, melee = true): void {
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
        t.hit(a.dmg);
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
    target.hit(dmg);
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

export type Role = 'kid' | 'farmer' | 'woodcutter' | 'soldier';

export class Villager extends Mover {
  weapon: 'sword' | 'bow' = 'sword';
  post: TilePos | null = null;
  private stairsGoal: TilePos | null = null;
  indoors: House | null = null;
  role: Role;
  age: number; // days
  hungerDays = 0;
  /** days of apprenticeship done (drill at the barracks, the field, the woodyard) */
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
    return this.role !== 'kid';
  }
  /** What the house is raising this child to be. */
  get calling(): Calling { return this.home.calling ?? 'farmer'; }
  /** Old enough to apprentice (drill, the field, the woodyard). */
  apprenticeAt(s: VillageScene): boolean {
    return this.role === 'kid' && this.age >= s.adultAge - CADET_AGE_BEFORE;
  }
  /** kept for the soldier path: a soldier cadet is just an apprentice with a soldier calling */
  cadetAt(s: VillageScene): boolean { return this.apprenticeAt(s) && this.calling === 'soldier'; }
  /** Apprenticeship days needed to come of age skilled (War Drums lowers it). */
  static drillNeeded(s: VillageScene): number { return Math.max(1, p.cadetDays + s.mods.cadetDaysDelta); }
  /** What this child will become as things stand — shown in the UI so nothing is a surprise. */
  outlook(s: VillageScene): { role: Calling; skilled: boolean } {
    const startAge = s.adultAge - CADET_AGE_BEFORE;
    const daysLeft = s.adultAge - Math.max(this.age, startAge); // apprentice days still to come, today's included
    const skilled = s.mods.fullDrill || this.trained + daysLeft >= Villager.drillNeeded(s);
    // soldiers must finish drill; an untrained cadet grows up a farmer
    if (this.calling === 'soldier' && !skilled) return { role: 'farmer', skilled: false };
    return { role: this.calling, skilled };
  }
  /** Care stars right now: five for averaging six care points a day. */
  starsNow(): number {
    if (this.role !== 'kid') return this.stars;
    if (!this.careDays) return 0;
    return Math.max(0, Math.min(5, Math.round((this.care / this.careDays) * (5 / 6))));
  }
  /** Work-speed multiplier from upbringing: skill, stars and traits. */
  get workMul(): number {
    return (this.skilled ? 1.4 : 1) * (1 + STAR_BONUS * this.stars) * (this.trait === 'tireless' ? 1.25 : 1);
  }

  applyRole(mods: Mods): void {
    switch (this.role) {
      case 'kid': this.radius = 2; this.color = 0xf5d8a8; this.maxHp = 10; this.speed = 30; break;
      case 'farmer': this.radius = 3; this.color = 0x7fd37f; this.maxHp = 20; this.speed = 35; break;
      case 'woodcutter': this.radius = 3; this.color = 0xc9a26b; this.maxHp = 20; this.speed = 35; break;
      case 'soldier': this.radius = 3; this.color = 0x6f9bff; this.maxHp = p.soldierHp + mods.soldierHpBonus + this.barracksHp + (this.skilled ? 15 : 0) + armorStats(this.armor).hp; this.speed = 45 * armorStats(this.armor).speedMul; break;
    }
    // how they were raised follows them for life
    if (this.isAdult) {
      const stars = 1 + STAR_BONUS * this.stars;
      this.maxHp *= stars * (this.trait === 'hardy' ? 1.25 : 1) * (this.stars <= 1 ? 0.9 : 1);
      this.speed *= stars * (this.trait === 'quick' ? 1.2 : 1);
    }
    this.maxHp = Math.round(this.maxHp * mods.hpMul * (this.role === 'soldier' ? 1 : mods.villagerHpMul));
    this.hp = Math.min(this.hp, this.maxHp);
    this.clearGoal();
  }

  /** Called on the day the kid reaches adultAge: their upbringing becomes who they are. */
  comeOfAge(s: VillageScene): void {
    const { role, skilled } = this.outlook(s);
    this.stars = this.starsNow();
    this.skilled = skilled;
    if (this.stars >= 5) this.trait = s.rng.pick(Object.keys(TRAITS) as Trait[]);
    if (this.calling === 'soldier' && role !== 'soldier') s.event('grow', `${this.name} came of age before finishing drill — a farmer instead`, true);
    this.role = role;
    this.barracksHp = s.world.barracksLevel >= 3 ? 30 : s.world.barracksLevel >= 2 ? 15 : 0;
    this.applyRole(s.mods);
    this.hp = this.maxHp;
    const star = '★'.repeat(this.stars) + '☆'.repeat(5 - this.stars);
    s.event(this.role === 'soldier' ? 'soldier' : 'grow', `${this.name} came of age — ${skilled ? 'a skilled ' : 'a '}${this.role}, ${star}${this.trait ? ` (${TRAITS[this.trait].name})` : ''}`, true);
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
      case 'kid': this.kidUpdate(dt, s); break;
      case 'farmer': this.civilUpdate(dt, s, true); break;
      case 'woodcutter': this.civilUpdate(dt, s, this.helpingFarm(s)); break;
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

    // apprentices spend the working day where their calling is: the barracks yard, the field, the woodyard
    const workHours = s.dayTime > 0.3 && s.dayTime < 0.75;
    const spot = this.apprenticeAt(s) && workHours ? this.apprenticeSpot(s) : null;
    if (spot) {
      if (!this.goal || this.goal.tx !== spot.tx || this.goal.ty !== spot.ty) this.setGoal(s, spot.tx, spot.ty, true);
      const there = this.followPath(dt);
      const c = this.calling;
      if (there) {
        this.task = c === 'soldier' ? 'drilling at the barracks' : c === 'farmer' ? 'learning to farm' : 'learning the axe';
        this.vx = this.vy = 0;
        this.thinkTimer -= dt;
        if (this.thinkTimer <= 0) {
          this.thinkTimer = s.rng.range(1.2, 2.2);
          if (c === 'soldier') s.fx.push({ kind: 'swing', who: this, dx: this.dir, dy: 0, stage: 0 });
          else s.fx.push({ kind: 'tool', tool: c === 'farmer' ? 'hoe' : 'axe', tx: spot.tx, ty: spot.ty, who: this });
        }
      } else this.task = c === 'soldier' ? 'off to drill' : c === 'farmer' ? 'off to the field' : 'off to the woodyard';
      return;
    }

    this.task = 'playing';
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || this.followPath(dt)) {
      this.thinkTimer = s.rng.range(2, 5);
      const r = 5, hc = buildingCenter(this.home);
      const tx = Math.round(hc.tx) + s.rng.int(-r, r), ty = Math.round(hc.ty) + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) this.setGoal(s, tx, ty, true);
    }
  }

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

  private civilUpdate(dt: number, s: VillageScene, farmer: boolean): void {
    if (s.nearestRaider(this.x, this.y, 90)) { this.task = 'fleeing'; this.delivering = false; this.goHome(s, dt); return; }

    if (this.workTimer > 0) {
      this.workTimer -= dt;
      this.vx = this.vy = 0;
      if (this.workTimer <= 0 && this.goal) this.finishWork(s, farmer);
      return;
    }

    if (this.delivering) { this.deliver(dt, s); return; }

    this.thinkTimer -= dt;
    if (!this.goal && this.thinkTimer <= 0) {
      this.thinkTimer = 1;
      const w = s.world;
      // arms full: take it in before looking for more work
      if (this.load && this.load.n >= Math.round(HAUL.villager[this.load.kind] * p.haulMul)) { this.delivering = true; this.deliver(dt, s); return; }
      const job = farmer
        ? w.nearest(this.x, this.y, (t) => t.kind === 'crop' && t.stage >= s.cropDays) ??
          w.nearest(this.x, this.y, (t) => t.kind === 'tilled')
        : s.mods.ignoreReserve || w.treeCount > TREE_RESERVE ? this.pickTree(s) : null;
      if (job) { this.setGoal(s, job.tx, job.ty); this.task = farmer ? (this.role === 'woodcutter' ? 'helping in the field' : 'heading to the field') : 'looking for a tree'; }
      else if (this.load) { this.delivering = true; this.deliver(dt, s); return; } // nothing more to do: bring in what's carried
      else { this.wanderNear(s, this.home); this.task = farmer ? 'no crops to tend' : 'leaving the last trees to regrow'; }
      return;
    }

    if (this.goal && this.followPath(dt)) {
      const t = s.world.get(this.goal.tx, this.goal.ty);
      const isJob = farmer ? t?.kind === 'crop' || t?.kind === 'tilled' : t?.kind === 'tree';
      if (isJob && this.adjacentTo(this.goal)) {
        this.workTimer = (farmer ? p.farmerWork : p.cutterWork) / (farmer ? s.mods.farmerSpeedMul : s.mods.cutterSpeedMul) / this.workMul;
        this.task = farmer ? (t!.kind === 'crop' ? 'harvesting' : 'planting') : 'chopping';
      } else this.clearGoal();
    }
  }

  /**
   * Which tree to fell: thin the grove from its edge and take old growth first, so the core keeps
   * spreading — old growth on the edge, then any old growth, then a young edge tree, then anything.
   */
  private pickTree(s: VillageScene): TilePos | null {
    const w = s.world;
    const edge = (tx: number, ty: number) => w.treeNeighbours(tx, ty) <= 3;
    return w.nearest(this.x, this.y, (t, tx, ty) => s.isOldGrowth(t) && edge(tx, ty))
      ?? w.nearest(this.x, this.y, (t) => s.isOldGrowth(t))
      ?? w.nearest(this.x, this.y, (t, tx, ty) => t.kind === 'tree' && edge(tx, ty))
      ?? w.nearest(this.x, this.y, (t) => t.kind === 'tree');
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
    this.task = hearth ? `bringing firewood to the ${BUILDINGS[hearth.kind].name.toLowerCase()}` : load.kind === 'wood' ? 'hauling logs to the woodyard' : 'carrying the harvest to the granary';
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

  private finishWork(s: VillageScene, farmer: boolean): void {
    const g = this.goal!;
    const t = s.world.get(g.tx, g.ty)!;
    if (farmer && t.kind === 'crop' && t.stage >= s.cropDays) {
      // leave ripe crops standing while the granary is full or the arms hold wood
      if (s.food < s.foodCap && (!this.load || this.load.kind === 'food')) {
        s.world.set(g.tx, g.ty, 'tilled');
        const yieldNow = (s.mods.cropYield + (this.skilled && this.role === 'farmer' ? 1 : 0)) * (this.trait === 'greenthumb' && s.rng.chance(0.25) ? 2 : 1);
        this.pickUp('food', yieldNow);
      }
    }
    else if (farmer && t.kind === 'tilled') { s.world.set(g.tx, g.ty, 'crop'); }
    else if (!farmer && t.kind === 'tree' && (!this.load || this.load.kind === 'wood')) { const wood = s.treeYield(t) + (this.skilled ? 4 : 0); s.world.set(g.tx, g.ty, 'sapling'); this.pickUp('wood', wood); }
    this.clearGoal();
  }

  // --- soldiers -------------------------------------------------------------

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
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.4;
      this.target = s.bestTarget(this.x, this.y, this.weapon === 'bow' ? 190 : 130);
    }
    if (this.target && !this.target.dead) {
      this.task = 'fighting';
      if (this.attackTick(dt, s)) return;
      const dmg = p.soldierDmg * weaponMul(this.weapons, this.weapon === 'bow' ? 'bow' : 'melee') * s.mods.soldierDmgMul * (s.world.barracksLevel >= 3 ? 1.2 : 1) * (this.skilled ? 1.15 : 1) * (this.trait === 'brave' ? 1.2 : 1);
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
    this.task = 'on patrol';
    // a cold barracks mends nobody
    const regen = s.world.barracks.some((b) => b.warm) ? s.mods.soldierRegen + (s.world.barracksLevel >= 3 ? 1 : 0) : 0;
    if (regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    this.thinkTimer -= dt;
    if (this.followPath(dt) && this.thinkTimer <= 0) {
      this.thinkTimer = s.rng.range(3, 7);
      const post = buildingCenter(s.world.barracks.length ? s.rng.pick(s.world.barracks) : this.home);
      this.wanderNear(s, { tx: Math.round(post.tx), ty: Math.round(post.ty) }, 3);
    }
  }

  // --- helpers --------------------------------------------------------------

  /** Where an apprentice of this calling spends the day. */
  private apprenticeSpot(s: VillageScene): TilePos | null {
    const w = s.world;
    if (this.calling === 'soldier') {
      const b = s.nearestBarracks(this.x, this.y);
      if (!b) return null;
      const yard = yardOf(b);
      return yard[1 + (this.id % (yard.length - 1))];
    }
    if (this.calling === 'woodcutter') {
      const y = w.woodyard;
      if (!y) return null;
      const yard = yardOf(y);
      return yard[this.id % yard.length];
    }
    // farmers: the edge of the field nearest home
    const hc = buildingCenter(this.home);
    const crop = w.nearest(hc.tx * 16, hc.ty * 16, (t) => t.kind === 'crop' || t.kind === 'tilled');
    if (!crop) return null;
    const around = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1]].map(([dx, dy]) => ({ tx: crop.tx + dx, ty: crop.ty + dy })).filter((q) => w.inBounds(q.tx, q.ty) && !w.isBlocked(q.tx, q.ty) && w.get(q.tx, q.ty)!.kind !== 'crop');
    return around[this.id % Math.max(1, around.length)] ?? crop;
  }

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

export type EnemyKind = 'raider' | 'warlord' | 'rat' | 'snatcher' | 'brute' | 'shaman' | 'ogre' | 'wrecker';

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
        const hit = target as Raider; hit.hit(this.dmg); hit.shove(this.ux, this.uy, 6);
        s.fx.push({ kind: 'hit', attacker: this, target: hit, dmg: this.dmg, crit: false, killed: !!hit.dead });
        this.dead = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// player

/** What the player holds. The equipped tool decides what E does. */
export type Tool = 'hands' | 'hoe' | 'seeds' | 'axe' | 'sword' | 'house' | 'barracks' | 'hammer' | 'bow' | 'tavern' | 'wall' | 'gate' | 'stairs';
export const TOOLS: Tool[] = ['hands', 'hoe', 'seeds', 'axe', 'sword', 'house', 'barracks', 'hammer', 'bow', 'tavern', 'wall', 'gate', 'stairs'];

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
  facing = { x: 0, y: 1 };
  tool: Tool = 'hands';
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
    return this.tool === 'house' || this.tool === 'barracks' || this.tool === 'tavern' ? this.tool : 'none';
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
    const sp = this.speed * slow * this.armorSpeed;
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
        o.hit(dmg);
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
