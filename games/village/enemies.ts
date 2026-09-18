import { Mover, Raider, Villager, Player, type RaiderOpts } from './agents';
import { World, type TilePos } from './world';
import { COLS, ROWS, TILE } from './config';
import type { VillageScene } from './main';

// Enemy kinds beyond the plain raider. Each has a different job so raids need different answers.

/** Fast, weak, harmless to people: eats the fields. Flees from anyone armed. */
export class Rat extends Raider {
  private gnawSeconds = 1.5;
  private gnaw = 0;
  private flee = 0;
  private crop: TilePos | null = null;

  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y, opts);
    this.kind = 'rat';
    this.name = 'Rat';
    this.harmless = true;
    this.pushScale = 1.8; // rats fly
    this.hp = this.maxHp = Math.round(8 * (opts.hpMul ?? 1));
    this.dmg = 0;
    this.speed = 55 * (opts.speedMul ?? 1);
    this.radius = 2.5;
    this.task = 'sniffing for crops';
    this.gnawSeconds = opts.harmlessRats ? 3 : 1.5; // Foragers buys time, never immunity.
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    // anyone armed nearby: scatter
    const threat = this.nearestArmed(s, 40);
    if (threat) this.flee = 1;
    if (this.flee > 0) {
      this.flee -= dt;
      this.task = 'scurrying away';
      const from = threat ?? this.nearestArmed(s, 80) ?? { x: this.x - 1, y: this.y };
      const dx = this.x - from.x, dy = this.y - from.y, d = Math.hypot(dx, dy) || 1;
      const nx = this.x + (dx / d) * this.speed * dt, ny = this.y + (dy / d) * this.speed * dt;
      const t = World.toTile(nx, ny);
      if (!s.world.isBlocked(t.tx, t.ty, true)) { this.x = nx; this.y = ny; this.vx = (dx / d) * this.speed; this.vy = (dy / d) * this.speed; }
      this.dir = dx < 0 ? -1 : 1;
      this.clearGoal();
      this.gnaw = 0;
      return;
    }

    this.retarget -= dt;
    if (!this.crop || this.retarget <= 0 || s.world.get(this.crop.tx, this.crop.ty)?.kind !== 'crop') {
      this.retarget = 1;
      const w = s.world;
      // Spread a swarm across the field instead of sending every rat to the same plant.
      const crops = [...w.find(t => t.kind === 'crop')].sort((a, b) => this.dist(World.center(a.tx, a.ty)) - this.dist(World.center(b.tx, b.ty)));
      this.crop = crops.length ? crops[this.id % Math.min(crops.length, 20)] : null;
      if (this.crop) this.setGoal(s, this.crop.tx, this.crop.ty, true);
    }
    if (!this.crop) {
      this.bored += dt;
      this.task = 'nothing to eat';
      if (this.bored > 8) this.dead = true; // scampers off
      this.vx = this.vy = 0;
      return;
    }
    this.bored = 0;
    const here = this.tile;
    if (here.tx === this.crop.tx && here.ty === this.crop.ty) {
      this.vx = this.vy = 0;
      this.task = 'gnawing the crops';
      this.gnaw += dt;
      if (this.gnaw >= this.gnawSeconds) {
        this.gnaw = 0;
        s.world.set(this.crop.tx, this.crop.ty, 'tilled');
        s.cropEaten();
        this.crop = null;
      }
      return;
    }
    this.task = 'heading for the field';
    this.followPath(dt);
  }

  private nearestArmed(s: VillageScene, r: number): Mover | null {
    let best: Mover | null = null, bd = Infinity;
    s.grid.forEachInRadius(this.x, this.y, r, (o, d2) => {
      const armed = (o instanceof Player && (o.tool === 'sword' || o.tool === 'bow')) || (o instanceof Villager && o.role === 'soldier' && !o.elevated);
      if (armed && !(o as Mover).hidden && d2 < bd) { bd = d2; best = o as Mover; }
    });
    return best;
  }
}

/** Quick imp that grabs a child and runs for the map edge. Kill it before it gets there. */
export class Snatcher extends Raider {
  private edge: TilePos | null = null;
  private grabT = 0;
  private snatchDelayMul: number;
  private noSnatch: boolean;

  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y, opts);
    this.snatchDelayMul = opts.snatchDelayMul ?? 1;
    this.noSnatch = !!opts.noSnatch;
    this.kind = 'snatcher';
    this.name = 'Snatcher';
    this.hp = this.maxHp = Math.round(14 * (opts.hpMul ?? 1));
    this.dmg = 3;
    this.speed = 70 * (opts.speedMul ?? 1);
    this.radius = 3;
    this.task = 'hunting for children';
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    if (this.attackTick(dt, s)) return;
    if (this.carrying) {
      if (this.carrying.dead) { this.carrying = null; this.edge = null; }
      else {
        this.task = 'carrying a child away';
        if (!this.edge) { this.edge = nearestEdge(this.tile); this.speed *= 0.6; } // a child is heavy: slower than soldiers and you
        this.setGoal(s, this.edge.tx, this.edge.ty);
        const arrived = this.followPath(dt);
        // keep the child on our back regardless of update order
        this.carrying.x = this.x; this.carrying.y = this.y - 8;
        if (arrived || this.atEdge()) { s.childCarriedOff(this.carrying, this); this.carrying = null; this.dead = true; }
        return;
      }
    }
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead || this.target.hidden || (this.target instanceof Villager && this.target.carriedBy)) {
      this.retarget = 0.5;
      this.target = s.nearestChild(this.x, this.y) ?? s.nearestVictim(this.x, this.y);
    }
    if (!this.target) {
      this.bored += dt;
      if (this.bored > 15) this.dead = true;
      this.vx = this.vy = 0;
      return;
    }
    this.bored = 0;
    const kid = this.target instanceof Villager && this.target.role === 'kid' && !this.noSnatch ? this.target : null;
    // getting hold of a child takes a moment of contact (Quick Hands stretches it)
    if (kid && this.dist(kid) < 10 && !kid.carriedBy && !kid.hidden) this.grabT += dt; else this.grabT = 0;
    if (kid && this.grabT >= 0.35 * this.snatchDelayMul && !kid.carriedBy && !kid.hidden) {
      this.grabT = 0;
      kid.carriedBy = this;
      this.carrying = kid;
      this.edge = null;
      this.clearGoal();
      s.childGrabbed(kid, this);
      return;
    }
    if (!kid && this.startAttack(s, this.target, this.dmg, 12, 0.12, 0.9)) return;
    this.task = kid ? 'chasing a child' : 'looking for prey';
    this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
    this.followPath(dt);
  }

  private atEdge(): boolean {
    const t = this.tile;
    return t.tx <= 0 || t.ty <= 0 || t.tx >= COLS - 1 || t.ty >= ROWS - 1;
  }
}

/** Slow, huge, hits hard, ignores knockback. Goes for soldiers first. */
export class Brute extends Raider {
  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y, opts);
    this.kind = 'brute';
    this.name = 'Brute';
    this.heavy = true;
    this.pushScale = 0.15;
    this.hp = this.maxHp = Math.round(180 * (opts.hpMul ?? 1));
    this.dmg = 24;
    this.speed = 56 * (opts.speedMul ?? 1);
    this.radius = 4.5;
    this.task = 'lumbering in';
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    if (this.siege && this.breach(dt, s)) return;
    if (this.attackTick(dt, s)) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead || this.target.hidden) {
      this.retarget = 0.6;
      this.target = s.nearestSoldier(this.x, this.y, 200) ?? s.nearestVictim(this.x, this.y);
    }
    if (!this.target) {
      this.bored += dt;
      if (this.bored > 20) this.dead = true;
      this.vx = this.vy = 0;
      return;
    }
    this.bored = 0;
    this.task = this.target instanceof Villager && this.target.role === 'soldier' ? 'smashing soldiers' : 'smashing';
    if (this.startAttack(s, this.target, this.dmg, 30, 0.2, 0.4)) return;
    this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
    if (!this.path.length && (this.dist(this.target) > 30 || !s.world.lineClear(this, this.target)) && this.breach(dt, s)) return;
    if (!this.path.length && this.target.elevated && this.breach(dt, s)) return;
    this.followPath(dt);
    const t = this.tile;
    if (s.world.get(t.tx, t.ty)?.kind === 'crop') s.world.set(t.tx, t.ty, 'tilled');
  }
}

/** Keeps its distance and lobs bolts. Close in on it. */
export class Shaman extends Raider {
  private cast = 1;

  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y, opts);
    this.kind = 'shaman';
    this.name = 'Shaman';
    this.hp = this.maxHp = Math.round(22 * (opts.hpMul ?? 1));
    this.dmg = 6;
    this.speed = 34 * (opts.speedMul ?? 1);
    this.radius = 3;
    this.task = 'muttering';
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead || this.target.hidden) {
      this.retarget = 0.5;
      this.target = s.nearestVictim(this.x, this.y);
    }
    if (!this.target) {
      this.bored += dt;
      if (this.bored > 20) this.dead = true;
      this.vx = this.vy = 0;
      return;
    }
    this.bored = 0;
    const d = this.dist(this.target);
    const dx = (this.target.x - this.x) / (d || 1), dy = (this.target.y - this.y) / (d || 1);
    this.dir = dx < 0 ? -1 : 1;
    if (d < 60) {
      // back away
      this.task = 'backing off';
      const nx = this.x - dx * this.speed * dt, ny = this.y - dy * this.speed * dt;
      const t = World.toTile(nx, ny);
      if (!s.world.isBlocked(t.tx, t.ty, true)) { this.x = nx; this.y = ny; this.vx = -dx * this.speed; this.vy = -dy * this.speed; }
      else { this.vx = this.vy = 0; }
      this.clearGoal();
    } else if (d > 110) {
      this.task = 'closing in';
      this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
      this.followPath(dt);
    } else {
      this.task = 'casting';
      this.vx = this.vy = 0;
      this.clearGoal();
    }
    this.cast -= dt;
    if (this.cast <= 0 && d <= 140 && s.world.lineClear(this, this.target, false)) {
      this.cast = 2;
      s.spawn(new Bolt(this.x, this.y - 4, dx, dy, this.dmg));
      s.fx.push({ kind: 'cast', who: this });
    }
  }
}

/** A shaman's projectile. Not a Raider: nothing targets it; it hits the first villager or player it touches. */
export class Bolt extends Mover {
  private travelled = 0;
  readonly range = 150;

  constructor(x: number, y: number, public ux: number, public uy: number, public dmg: number) {
    super(x, y);
    this.hp = this.maxHp = 1;
    this.speed = 120;
    this.radius = 2;
    this.color = 0xb46bff;
    this.task = 'bolt';
    this.dir = ux < 0 ? -1 : 1;
  }

  update(dt: number, s: VillageScene): void {
    const step = this.speed * dt;
    this.x += this.ux * step; this.y += this.uy * step;
    this.vx = this.ux * this.speed; this.vy = this.uy * this.speed;
    this.travelled += step;
    if (this.travelled >= this.range || this.x < 0 || this.y < 0 || this.x > COLS * TILE || this.y > ROWS * TILE) { this.dead = true; return; }
    const t = this.tile;
    if (s.world.isBlocked(t.tx, t.ty, true)) { this.dead = true; s.fx.push({ kind: 'impact', x: this.x, y: this.y }); return; }
    let hit: Mover | null = null;
    s.grid.forEachInRadius(this.x, this.y, 7, (o) => {
      const m = o as Mover;
      if (hit || m.hidden || m.dead || m.elevated) return;
      if (m instanceof Player || (m instanceof Villager && !m.carriedBy)) hit = m;
    });
    if (hit) {
      (hit as Mover).hit(this.dmg, false);
      s.fx.push({ kind: 'hit', attacker: this, target: hit, dmg: this.dmg, crit: false, killed: !!(hit as Mover).dead });
      this.dead = true;
    }
  }
}

/** The map-edge tile closest to `t`. */
function nearestEdge(t: TilePos): TilePos {
  const opts: [number, TilePos][] = [
    [t.tx, { tx: 0, ty: t.ty }], [COLS - 1 - t.tx, { tx: COLS - 1, ty: t.ty }],
    [t.ty, { tx: t.tx, ty: 0 }], [ROWS - 1 - t.ty, { tx: t.tx, ty: ROWS - 1 }],
  ];
  opts.sort((a, b) => a[0] - b[0]);
  return opts[0][1];
}

/** What a raid on wave `w` (1..6) is made of; the warlord's wave passes boss = true. */
export function waveComposition(w: number, boss = false): Record<'raider' | 'rat' | 'snatcher' | 'brute' | 'shaman', number> {
  if (boss) return { raider: 3, rat: 0, snatcher: 2, brute: 1, shaman: 1 };
  switch (Math.max(1, Math.min(6, w))) {
    case 1: return { raider: 2, rat: 0, snatcher: 0, brute: 0, shaman: 0 };
    case 2: return { raider: 2, rat: 10, snatcher: 0, brute: 0, shaman: 0 };
    case 3: return { raider: 2, rat: 12, snatcher: 1, brute: 0, shaman: 0 };
    case 4: return { raider: 3, rat: 0, snatcher: 1, brute: 1, shaman: 0 };
    case 5: return { raider: 3, rat: 16, snatcher: 1, brute: 0, shaman: 1 };
    default: return { raider: 3, rat: 0, snatcher: 2, brute: 1, shaman: 1 };
  }
}
