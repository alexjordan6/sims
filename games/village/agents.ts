import type { Agent } from '@shared/index';
import { World, type House, type TilePos } from './world';
import { p, CROP_YIELD, TREE_YIELD } from './config';
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

  hit(dmg: number): void {
    this.hp -= dmg;
    this.hurtT = 0;
    if (this.hp <= 0) this.dead = true;
  }

  /** Melee: swing at `target` if in reach and cooldown is up. */
  tryAttack(target: Mover, dmg: number, reach = 13, cooldown = 0.8): boolean {
    if (this.attackCd > 0 || this.dist(target) > reach) return false;
    this.dir = target.x < this.x ? -1 : 1;
    target.hit(dmg);
    this.attackCd = cooldown;
    return true;
  }

  protected tickTimers(dt: number): void {
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hurtT += dt;
  }
}

// ---------------------------------------------------------------------------
// villagers

export type Role = 'kid' | 'farmer' | 'woodcutter' | 'soldier';

export class Villager extends Mover {
  role: Role;
  age: number; // days
  hungerDays = 0;
  /** upbringing exposure; compared at coming-of-age */
  martial = 0;
  civil = 0;
  name: string;
  private workTimer = 0;
  private thinkTimer = 0;
  private retarget = 0;
  private target: Mover | null = null;

  constructor(x: number, y: number, public home: House, role: Role, age: number, name: string) {
    super(x, y);
    this.role = role;
    this.age = age;
    this.name = name;
    this.applyRole();
    this.hp = this.maxHp;
  }

  get isAdult(): boolean {
    return this.role !== 'kid';
  }

  applyRole(): void {
    switch (this.role) {
      case 'kid': this.radius = 2; this.color = 0xf5d8a8; this.maxHp = 10; this.speed = 30; break;
      case 'farmer': this.radius = 3; this.color = 0x7fd37f; this.maxHp = 20; this.speed = 35; break;
      case 'woodcutter': this.radius = 3; this.color = 0xc9a26b; this.maxHp = 20; this.speed = 35; break;
      case 'soldier': this.radius = 3; this.color = 0x6f9bff; this.maxHp = p.soldierHp; this.speed = 45; break;
    }
    this.hp = Math.min(this.hp, this.maxHp);
    this.clearGoal();
  }

  /** Called on the day the kid reaches adultAge. */
  comeOfAge(s: VillageScene): void {
    const noise = s.rng.range(-0.15, 0.15) * (this.martial + this.civil + 1);
    this.role = this.martial + noise > this.civil ? 'soldier' : s.pickCivilRole();
    this.applyRole();
    this.hp = this.maxHp;
    s.event(this.role === 'soldier' ? 'soldier' : 'grow', `${this.name} came of age — ${this.role}`, true);
    if (this.role === 'soldier') s.stats.soldiersRaised++;
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.hidden) {
      this.task = 'hiding indoors';
      if (!s.raidActive || this.role === 'soldier') this.unhide(s);
      return;
    }
    switch (this.role) {
      case 'kid': this.kidUpdate(dt, s); break;
      case 'farmer': this.civilUpdate(dt, s, true); break;
      case 'woodcutter': this.civilUpdate(dt, s, false); break;
      case 'soldier': this.soldierUpdate(dt, s); break;
    }
  }

  // --- kids: wander near home, soak up whatever is around ---------------------

  private kidUpdate(dt: number, s: VillageScene): void {
    const danger = s.nearestRaider(this.x, this.y, 80);
    if (danger) { this.martial += 4 * dt; this.task = 'running home'; this.goHome(s, dt); return; }

    this.task = 'playing';
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || this.followPath(dt)) {
      this.thinkTimer = s.rng.range(2, 5);
      const r = 4;
      const tx = this.home.tx + s.rng.int(-r, r), ty = this.home.ty + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) this.setGoal(s, tx, ty, true);
    }

    // exposure: who is nearby
    s.grid.forEachInRadius(this.x, this.y, 48, (o) => {
      if (!(o instanceof Villager) || o === this) return;
      if (o.role === 'soldier') this.martial += dt;
      else if (o.role === 'farmer' || o.role === 'woodcutter') this.civil += dt;
    });
    // exposure: what is nearby (5x5 tiles)
    const t = this.tile;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const k = s.world.get(t.tx + dx, t.ty + dy)?.kind;
        if (k === 'barracks') this.martial += 2 * dt;
        else if (k === 'crop' || k === 'tilled') this.civil += 0.4 * dt;
      }
  }

  // --- farmers / woodcutters ------------------------------------------------

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
        ? w.nearest(this.x, this.y, (t) => t.kind === 'crop' && t.stage >= p.cropDays) ??
          w.nearest(this.x, this.y, (t) => t.kind === 'tilled')
        : w.nearest(this.x, this.y, (t) => t.kind === 'tree');
      if (job) { this.setGoal(s, job.tx, job.ty); this.task = farmer ? 'heading to the field' : 'looking for a tree'; }
      else { this.wanderNear(s, this.home); this.task = farmer ? 'no crops to tend' : 'no trees left'; }
      return;
    }

    if (this.goal && this.followPath(dt)) {
      const t = s.world.get(this.goal.tx, this.goal.ty);
      const isJob = farmer ? t?.kind === 'crop' || t?.kind === 'tilled' : t?.kind === 'tree';
      if (isJob && this.adjacentTo(this.goal)) {
        this.workTimer = farmer ? 1.2 : 2.5;
        this.task = farmer ? (t!.kind === 'crop' ? 'harvesting' : 'planting') : 'chopping';
      } else this.clearGoal();
    }
  }

  private finishWork(s: VillageScene, farmer: boolean): void {
    const g = this.goal!;
    const t = s.world.get(g.tx, g.ty)!;
    if (farmer && t.kind === 'crop' && t.stage >= p.cropDays) { s.world.set(g.tx, g.ty, 'tilled'); s.food += CROP_YIELD; }
    else if (farmer && t.kind === 'tilled') { s.world.set(g.tx, g.ty, 'crop'); }
    else if (!farmer && t.kind === 'tree') { s.world.set(g.tx, g.ty, 'grass'); s.wood += TREE_YIELD; }
    this.clearGoal();
  }

  // --- soldiers -------------------------------------------------------------

  private soldierUpdate(dt: number, s: VillageScene): void {
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.4;
      this.target = s.nearestRaider(this.x, this.y, 130);
    }
    if (this.target && !this.target.dead) {
      this.task = 'fighting';
      if (this.tryAttack(this.target, p.soldierDmg)) return;
      this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
      this.followPath(dt);
      return;
    }
    this.target = null;
    this.task = 'on patrol';
    this.thinkTimer -= dt;
    if (this.followPath(dt) && this.thinkTimer <= 0) {
      this.thinkTimer = s.rng.range(3, 7);
      const post = s.world.barracks.length ? s.rng.pick(s.world.barracks) : this.home;
      this.wanderNear(s, post, 2);
    }
  }

  // --- helpers --------------------------------------------------------------

  private wanderNear(s: VillageScene, pos: TilePos, r = 3): void {
    for (let i = 0; i < 6; i++) {
      const tx = pos.tx + s.rng.int(-r, r), ty = pos.ty + s.rng.int(-r, r);
      if (s.world.inBounds(tx, ty) && !s.world.isBlocked(tx, ty)) { this.setGoal(s, tx, ty, true); return; }
    }
  }

  /** Run to the home house; once adjacent, duck inside. */
  private goHome(s: VillageScene, dt: number): void {
    this.setGoal(s, this.home.tx, this.home.ty);
    const arrived = this.followPath(dt);
    if (arrived && this.adjacentTo(this.home)) {
      this.hidden = true;
      const c = World.center(this.home.tx, this.home.ty);
      this.x = c.x; this.y = c.y;
      this.clearGoal();
    }
  }

  private unhide(s: VillageScene): void {
    this.hidden = false;
    const spots: TilePos[] = [
      { tx: this.home.tx, ty: this.home.ty + 1 }, { tx: this.home.tx, ty: this.home.ty - 1 },
      { tx: this.home.tx + 1, ty: this.home.ty }, { tx: this.home.tx - 1, ty: this.home.ty },
    ];
    const spot = spots.find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? spots[0];
    const c = World.center(spot.tx, spot.ty);
    this.x = c.x; this.y = c.y;
    this.clearGoal();
  }
}

// ---------------------------------------------------------------------------
// raiders

export class Raider extends Mover {
  private target: Mover | null = null;
  private retarget = 0;
  private bored = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.hp = this.maxHp = p.raiderHp;
    this.speed = 38;
    this.radius = 3;
    this.color = 0xd94a4a;
    this.task = 'raiding';
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
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
    if (this.tryAttack(this.target, p.raiderDmg)) return;
    this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
    this.followPath(dt);
    // trample crops
    const t = this.tile;
    if (s.world.get(t.tx, t.ty)?.kind === 'crop') s.world.set(t.tx, t.ty, 'tilled');
  }
}

// ---------------------------------------------------------------------------
// player

export type BuildItem = 'none' | 'house' | 'barracks';
export const BUILD_ORDER: BuildItem[] = ['none', 'house', 'barracks'];

export class Player extends Mover {
  facing = { x: 0, y: 1 };
  build: BuildItem = 'none';
  /** set by the scene: W/A/S/D key objects */
  keys!: Record<'W' | 'A' | 'S' | 'D', { isDown: boolean }>;

  constructor(x: number, y: number) {
    super(x, y);
    this.hp = this.maxHp = 60;
    this.speed = 60;
    this.radius = 3.5;
    this.color = 0xffe066;
    this.task = 'you';
  }

  /** The tile just in front of the player. */
  get faced(): TilePos {
    return World.toTile(this.x + this.facing.x * 11, this.y + this.facing.y * 11);
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    let mx = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    let my = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    if (mx || my) this.facing = { x: Math.sign(mx), y: mx ? 0 : Math.sign(my) };
    if (mx) this.dir = mx < 0 ? -1 : 1;
    this.vx = mx * this.speed; this.vy = my * this.speed;
    this.moveWithCollision(dt, s.world);
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
    const nx = this.x + this.vx * dt;
    if (free(nx, this.y)) this.x = nx;
    const ny = this.y + this.vy * dt;
    if (free(this.x, ny)) this.y = ny;
  }

  cycleBuild(): void {
    this.build = BUILD_ORDER[(BUILD_ORDER.indexOf(this.build) + 1) % BUILD_ORDER.length];
  }
}
