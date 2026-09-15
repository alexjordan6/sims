import type { Agent } from '@shared/index';
import { World, doorstep, buildingCenter, yardOf, type House, type TilePos } from './world';
import { p, TREE_RESERVE, CADET_AGE_BEFORE, CADET_DAYS } from './config';
import type { Mods } from './meta';
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
  /** -1 faces left, 1 faces right (sprite flip). */
  dir = 1;
  /** seconds since last hit, for the hurt flash */
  hurtT = 99;
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
    if (!force && this.goal && this.goal.tx === tx && this.goal.ty === ty) return;
    this.goal = { tx, ty };
    this.path = s.world.bfs(this.tile, this.goal);
  }

  clearGoal(): void {
    this.goal = null;
    this.path = [];
  }

  /** Advance along the path. Returns true when there is nowhere left to go. */
  followPath(dt: number): boolean {
    if (this.path.length === 0) { this.vx = this.vy = 0; return true; }
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

  hit(dmg: number): void {
    this.hp -= dmg;
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
    if (this.attack || this.attackCd > 0 || this.dist(target) > reach + 4) return false;
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
      if (!t.dead && !t.hidden && this.dist(t) <= a.reach) {
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
      if (!this.world?.isBlocked(t.tx, t.ty)) { this.x = nx; this.y = ny; }
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
  role: Role;
  age: number; // days
  hungerDays = 0;
  /** days of drill done at the barracks (cadets of sworn houses) */
  drilled = 0;
  name: string;
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
  /** A child of a sworn house who is old enough to drill. */
  cadetAt(s: VillageScene): boolean {
    return this.role === 'kid' && !!this.home.sworn && this.age >= s.adultAge - CADET_AGE_BEFORE;
  }
  /** Drill days a cadet needs (War Drums lowers it). */
  static drillNeeded(s: VillageScene): number { return Math.max(1, CADET_DAYS + s.mods.cadetDaysDelta); }
  /** What this child will become, as things stand — shown in the UI so nothing is a surprise. */
  outlook(s: VillageScene): 'soldier' | 'worker' {
    if (!this.home.sworn) return 'worker';
    const cadetAge = s.adultAge - CADET_AGE_BEFORE;
    const daysLeft = s.adultAge - Math.max(this.age, cadetAge); // drill days still to come, today's included
    return this.drilled + daysLeft >= Villager.drillNeeded(s) ? 'soldier' : 'worker';
  }

  applyRole(mods: Mods): void {
    switch (this.role) {
      case 'kid': this.radius = 2; this.color = 0xf5d8a8; this.maxHp = 10; this.speed = 30; break;
      case 'farmer': this.radius = 3; this.color = 0x7fd37f; this.maxHp = 20; this.speed = 35; break;
      case 'woodcutter': this.radius = 3; this.color = 0xc9a26b; this.maxHp = 20; this.speed = 35; break;
      case 'soldier': this.radius = 3; this.color = 0x6f9bff; this.maxHp = p.soldierHp + mods.soldierHpBonus + this.barracksHp; this.speed = 45; break;
    }
    this.maxHp = Math.round(this.maxHp * mods.hpMul);
    this.hp = Math.min(this.hp, this.maxHp);
    this.clearGoal();
  }

  /** Called on the day the kid reaches adultAge. */
  comeOfAge(s: VillageScene): void {
    const drilled = this.drilled >= Villager.drillNeeded(s);
    this.role = this.home.sworn && drilled ? 'soldier' : s.pickCivilRole();
    if (this.home.sworn && !drilled) s.event('grow', `${this.name} came of age before finishing drill — a ${this.role} instead`, true);
    this.barracksHp = s.world.barracksLevel >= 3 ? 30 : s.world.barracksLevel >= 2 ? 15 : 0;
    this.applyRole(s.mods);
    this.hp = this.maxHp;
    s.event(this.role === 'soldier' ? 'soldier' : 'grow', `${this.name} came of age — ${this.role}`, true);
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
    const danger = s.nearestRaider(this.x, this.y, 80);
    if (danger) { this.task = 'running home'; this.goHome(s, dt); return; }

    // cadets spend the working day drilling in the barracks yard
    const drillHours = s.dayTime > 0.3 && s.dayTime < 0.75;
    const barracks = this.cadetAt(s) && drillHours ? s.nearestBarracks(this.x, this.y) : null;
    if (barracks) {
      const yard = yardOf(barracks);
      const spot = yard[1 + (this.id % (yard.length - 1))];
      if (!this.goal || this.goal.tx !== spot.tx || this.goal.ty !== spot.ty) this.setGoal(s, spot.tx, spot.ty, true);
      const there = this.followPath(dt);
      if (there) {
        this.task = 'drilling at the barracks';
        this.vx = this.vy = 0;
        this.thinkTimer -= dt;
        if (this.thinkTimer <= 0) { this.thinkTimer = s.rng.range(1.2, 2.2); s.fx.push({ kind: 'swing', who: this, dx: this.dir, dy: 0, stage: 0 }); }
      } else this.task = 'off to drill';
      return;
    }

    this.task = this.home.sworn ? 'playing (cadet)' : 'playing';
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
    return this.farmHelp || s.world.count((t) => t.kind === 'tree') <= TREE_RESERVE;
  }
  private farmHelp = false;

  private civilUpdate(dt: number, s: VillageScene, farmer: boolean): void {
    if (s.nearestRaider(this.x, this.y, 90)) { this.task = 'fleeing'; this.goHome(s, dt); return; }

    if (this.workTimer > 0) {
      this.workTimer -= dt;
      this.vx = this.vy = 0;
      if (this.workTimer <= 0 && this.goal) this.finishWork(s, farmer);
      return;
    }

    this.thinkTimer -= dt;
    if (!this.goal && this.thinkTimer <= 0) {
      this.thinkTimer = 1;
      const w = s.world;
      const job = farmer
        ? w.nearest(this.x, this.y, (t) => t.kind === 'crop' && t.stage >= s.cropDays) ??
          w.nearest(this.x, this.y, (t) => t.kind === 'tilled')
        : w.count((t) => t.kind === 'tree') > TREE_RESERVE ? this.pickTree(s) : null;
      if (job) { this.setGoal(s, job.tx, job.ty); this.task = farmer ? (this.role === 'woodcutter' ? 'helping in the field' : 'heading to the field') : 'looking for a tree'; }
      else { this.wanderNear(s, this.home); this.task = farmer ? 'no crops to tend' : 'leaving the last trees to regrow'; }
      return;
    }

    if (this.goal && this.followPath(dt)) {
      const t = s.world.get(this.goal.tx, this.goal.ty);
      const isJob = farmer ? t?.kind === 'crop' || t?.kind === 'tilled' : t?.kind === 'tree';
      if (isJob && this.adjacentTo(this.goal)) {
        this.workTimer = (farmer ? 1.2 : 2.5) / (farmer ? s.mods.farmerSpeedMul : 1);
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

  private finishWork(s: VillageScene, farmer: boolean): void {
    const g = this.goal!;
    const t = s.world.get(g.tx, g.ty)!;
    if (farmer && t.kind === 'crop' && t.stage >= s.cropDays) { if (s.food < s.foodCap) { s.world.set(g.tx, g.ty, 'tilled'); s.addFood(s.mods.cropYield); } }
    else if (farmer && t.kind === 'tilled') { s.world.set(g.tx, g.ty, 'crop'); }
    else if (!farmer && t.kind === 'tree') { const wood = s.treeYield(t); s.world.set(g.tx, g.ty, 'sapling'); s.addWood(wood); }
    this.clearGoal();
  }

  // --- soldiers -------------------------------------------------------------

  private soldierUpdate(dt: number, s: VillageScene): void {
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.4;
      this.target = s.bestTarget(this.x, this.y, 130);
    }
    if (this.target && !this.target.dead) {
      this.task = 'fighting';
      if (this.attackTick(dt, s)) return;
      if (this.startAttack(s, this.target, Math.round(p.soldierDmg * s.mods.soldierDmgMul * (s.world.barracksLevel >= 3 ? 1.2 : 1)), 13, 0.15, 0.45)) return;
      this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
      this.followPath(dt);
      return;
    }
    this.target = null;
    this.task = 'on patrol';
    const regen = s.mods.soldierRegen + (s.world.barracksLevel >= 3 ? 1 : 0);
    if (regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    this.thinkTimer -= dt;
    if (this.followPath(dt) && this.thinkTimer <= 0) {
      this.thinkTimer = s.rng.range(3, 7);
      const post = buildingCenter(s.world.barracks.length ? s.rng.pick(s.world.barracks) : this.home);
      this.wanderNear(s, { tx: Math.round(post.tx), ty: Math.round(post.ty) }, 3);
    }
  }

  // --- helpers --------------------------------------------------------------

  private wanderNear(s: VillageScene, pos: TilePos, r = 3): void {
    for (let i = 0; i < 6; i++) {
      const tx = pos.tx + s.rng.int(-r, r), ty = pos.ty + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) { this.setGoal(s, tx, ty, true); return; }
    }
  }

  /** Run to the home's doorstep; once there, duck inside. */
  private goHome(s: VillageScene, dt: number): void {
    const door = doorstep(this.home);
    this.setGoal(s, door.tx, door.ty);
    const arrived = this.followPath(dt);
    if (arrived && this.adjacentTo(door)) {
      this.hidden = true;
      const c = buildingCenter(this.home);
      this.x = c.tx * 16; this.y = c.ty * 16;
      this.clearGoal();
    }
  }

  private unhide(s: VillageScene): void {
    this.hidden = false;
    const door = doorstep(this.home);
    const spots: TilePos[] = [door, { tx: door.tx + 1, ty: door.ty }, { tx: door.tx, ty: door.ty + 1 }, { tx: door.tx - 1, ty: door.ty }];
    const spot = spots.find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? spots[0];
    const c = World.center(spot.tx, spot.ty);
    this.x = c.x; this.y = c.y;
    this.clearGoal();
  }
}

// ---------------------------------------------------------------------------
// raiders

export type EnemyKind = 'raider' | 'warlord' | 'rat' | 'snatcher' | 'brute' | 'shaman';

export interface RaiderOpts {
  /** the warlord: big, tough, and the run ends when he falls */
  boss?: boolean;
  /** wave scaling on HP */
  hpMul?: number;
  speedMul?: number;
}

/**
 * Base enemy: walks at the nearest person and hits them. Other kinds (enemies.ts) extend this so
 * every `instanceof Raider` check — soldier targeting, the sword arc, villagers fleeing — covers them.
 */
export class Raider extends Mover {
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
  /** a child being carried off (snatchers) */
  carrying: Villager | null = null;

  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y);
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
    this.followPath(dt);
    // trample crops
    const t = this.tile;
    if (s.world.get(t.tx, t.ty)?.kind === 'crop') s.world.set(t.tx, t.ty, 'tilled');
  }
}

// ---------------------------------------------------------------------------
// player

/** What the player holds. The equipped tool decides what E does. */
export type Tool = 'hands' | 'hoe' | 'seeds' | 'axe' | 'sword' | 'house' | 'barracks' | 'hammer';
export const TOOLS: Tool[] = ['hands', 'hoe', 'seeds', 'axe', 'sword', 'house', 'barracks', 'hammer'];

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
    this.hp = this.maxHp = 60;
    this.speed = 60;
    this.radius = 3.5;
    this.color = 0xffe066;
    this.task = 'you';
  }

  /** The building the tool would place, if it's a building tool. */
  get build(): 'house' | 'barracks' | 'none' {
    return this.tool === 'house' || this.tool === 'barracks' ? this.tool : 'none';
  }

  /** The tile just in front of the player. */
  /** The neighbouring tile in the direction faced — stable until you turn or cross a tile edge. */
  get faced(): TilePos {
    const t = this.tile;
    return { tx: t.tx + this.facing.x, ty: t.ty + this.facing.y };
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    this.sinceSwing += dt;
    this.recover = Math.max(0, this.recover - dt);
    if (this.frozen(dt)) return;
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
    this.vx = mx * this.speed * slow; this.vy = my * this.speed * slow;
    this.moveWithCollision(dt, s.world);
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
      const t = World.toTile(nx + sw.dx * 3, ny + sw.dy * 3);
      if (!s.world.isBlocked(t.tx, t.ty)) { this.x = nx; this.y = ny; }
    }
    if (active || wasActive) {
      const dmg = Math.round(12 * s.mods.playerDmgMul * c.dmgMul);
      s.grid.forEachInRadius(this.x, this.y, SWING.reach + (c.spin ? 4 : 0), (o, d2) => {
        if (!(o instanceof Raider) || o.dead || sw.hit.has(o.id)) return;
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

  private moveWithCollision(dt: number, w: World): void {
    const r = this.radius - 0.5;
    const free = (x: number, y: number): boolean => {
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        const t = World.toTile(x + ox, y + oy);
        if (w.isBlocked(t.tx, t.ty)) return false;
      }
      return true;
    };
    // if we are somehow inside something solid, let any movement through so we can never be trapped
    const stuck = !free(this.x, this.y);
    const nx = this.x + this.vx * dt;
    if (stuck || free(nx, this.y)) this.x = nx;
    const ny = this.y + this.vy * dt;
    if (stuck || free(this.x, ny)) this.y = ny;
  }

  cycleTool(dir = 1): void {
    this.tool = TOOLS[(TOOLS.indexOf(this.tool) + dir + TOOLS.length) % TOOLS.length];
  }
}
