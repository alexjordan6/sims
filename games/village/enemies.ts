import { Mover, Raider, Villager, Player, type RaiderOpts } from './agents';
import { World, BUILDINGS, type TilePos, type Building } from './world';
import { COLS, ROWS, TILE, OGRE, BEDTIME, WRECKER, p, MASS } from './config';
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
      if (this.crop) {
        this.setGoal(s, this.crop.tx, this.crop.ty);
        // a field it can't get into (walled off) is no field at all: give up on it and, in time, leave
        if (!this.path.length && !(this.tile.tx === this.crop.tx && this.tile.ty === this.crop.ty)) { this.crop = null; this.retarget = 3; }
      }
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

/** Who the Ogre's attacks land on: people, not projectiles or other raiders. */
const prey = (o: unknown): o is Mover => o instanceof Player || (o instanceof Villager && !o.carriedBy);

/** One of the Ogre's three attacks in progress. Replaces Mover.attack, which only ever hits one body. */
type OgreMove =
  | { kind: 'swing'; t: number; ux: number; uy: number; struck: boolean }
  | { kind: 'smash'; t: number; struck: boolean }
  | { kind: 'charge'; t: number; phase: 'windup' | 'rush' | 'recover' | 'stunned'; ux: number; uy: number; travelled: number; maxDist: number; hit: Set<number> };

/**
 * The Ogre of the Deepwood: the first boss. Sleeps hidden in his lair by day, prowls around it
 * by night, and hunts anyone who comes near. Never part of a raid; killing him is its own prize.
 * Once roused (his first target) he never sleeps again: no leash, no dawn retreat, and when his
 * prey dies he picks the next one anywhere on the map.
 */
export class Ogre extends Raider {
  override get mass(): number { return MASS.ogre; }
  state: 'sleeping' | 'roaming' | 'hunting' | 'homing' = 'sleeping';
  /** true once he has first stepped out (the "something stirs" rumour fires then) */
  emerged = false;
  /** set the first time he takes a target; never cleared */
  aggroed = false;
  /** the attack in progress; while set he neither paths nor retargets */
  move: OgreMove | null = null;
  /** per-attack cooldowns (seconds), public so tests and the inspector can read or force them */
  cd = { swing: 0, smash: 0, charge: 0 };
  lastMove: OgreMove['kind'] | null = null;
  private wanderT = 0;
  private stepT = 0;

  constructor(public readonly lair: Building) {
    const home = Ogre.homeOf(lair);
    super(home.x, home.y);
    this.kind = 'ogre';
    this.name = 'The Ogre';
    this.huge = true;
    this.lairBound = true;
    this.heavy = true;
    this.pushScale = 0.05;
    this.hp = this.maxHp = OGRE.hp;
    this.dmg = OGRE.swing.dmg;
    this.speed = OGRE.speed;
    this.radius = 9;
    this.hidden = true;
    this.task = 'sleeping in his lair';
  }

  /** the tile just outside the cave mouth */
  static homeOf(lair: Building): { x: number; y: number } {
    return World.center(lair.tx + BUILDINGS.lair.door, lair.ty + BUILDINGS.lair.h);
  }

  private get lairCentre(): { x: number; y: number } { return World.center(this.lair.tx + 2, this.lair.ty + 2); }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    this.cd.swing = Math.max(0, this.cd.swing - dt); this.cd.smash = Math.max(0, this.cd.smash - dt); this.cd.charge = Math.max(0, this.cd.charge - dt);
    const night = s.dayTime > BEDTIME.start || s.dayTime < BEDTIME.end;
    if (this.state === 'sleeping') {
      const home = Ogre.homeOf(this.lair);
      this.x = home.x; this.y = home.y; this.vx = this.vy = 0; this.hidden = true;
      this.stepT += dt;
      if (this.stepT > 2.2) { this.stepT = 0; s.fx.push({ kind: 'snore', x: home.x, y: home.y - TILE * 2.5 }); }
      if (night) {
        this.state = 'roaming'; this.hidden = false; this.wanderT = 0; this.task = 'prowling';
        if (!this.emerged) { this.emerged = true; s.event('raid', 'Something huge stirs in the deep woods.'); }
      }
      return;
    }
    if (this.frozen(dt)) return;
    if (this.move && this.moveTick(dt, s)) { this.footsteps(dt, s); this.trample(s); return; }
    if (!night && !this.aggroed && this.state !== 'homing') { this.state = 'homing'; this.target = null; this.task = 'lumbering home'; this.clearGoal(); }

    if (this.state === 'homing') {
      const home = Ogre.homeOf(this.lair);
      const ht = World.toTile(home.x, home.y);
      this.setGoal(s, ht.tx, ht.ty);
      const there = this.followPath(dt);
      if (there || this.dist(home) < 6) {
        this.state = 'sleeping'; this.hidden = true; this.clearGoal();
        this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * OGRE.regen)); // a day's sleep
        this.task = 'sleeping in his lair';
      }
      this.footsteps(dt, s);
      return;
    }

    // who to hunt: the player within OGRE.hunt tiles, villagers within 6; keep a chase until they get well away.
    // Once roused there is no range at all: whoever is nearest, wherever they are.
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead || this.target.hidden) {
      this.retarget = 0.5;
      const keepRange = this.aggroed ? Infinity : OGRE.hunt * 1.5 * TILE;
      const keep = this.target && !this.target.dead && !this.target.hidden && this.dist(this.target) < keepRange ? this.target : null;
      this.target = keep ?? this.pickPrey(s);
    }
    if (this.target && !this.aggroed && this.dist(this.lairCentre) > OGRE.roam * 1.6 * TILE) this.target = null; // leashed to his woods

    if (this.target) {
      this.state = 'hunting';
      if (!this.aggroed) { this.aggroed = true; s.event('raid', 'The Ogre has your scent. He will not rest now.', true); }
      this.task = this.target instanceof Player ? 'hunting you' : `hunting ${(this.target as Villager).name ?? 'someone'}`;
      this.setGoal(s, this.target.tile.tx, this.target.tile.ty);
      if (this.selectAttack(s)) return;
      if (!this.path.length && !this.aggroed && this.dist(this.target) > OGRE.swing.reach) this.target = null; // can't reach: lose interest
      this.followPath(dt);
    } else {
      this.state = 'roaming'; this.task = 'prowling';
      this.wanderT -= dt;
      if (this.wanderT <= 0 || this.followPath(dt)) {
        this.wanderT = s.rng.range(2.5, 6);
        const c = this.roamCentre(s), ct = World.toTile(c.x, c.y);
        for (let i = 0; i < 12; i++) {
          const tx = ct.tx + s.rng.int(-OGRE.roam, OGRE.roam), ty = ct.ty + s.rng.int(-Math.round(OGRE.roam * 0.75), Math.round(OGRE.roam * 0.75));
          if (!s.world.inBounds(tx, ty) || s.world.isBlocked(tx, ty, true)) continue;
          this.setGoal(s, tx, ty, true);
          if (this.path.length) break;
        }
      }
    }
    this.footsteps(dt, s);
    this.trample(s);
  }

  /** Asleep-by-day Ogre prowls his woods; a roused one with nobody in sight prowls the village instead. */
  private roamCentre(s: VillageScene): { x: number; y: number } {
    if (!this.aggroed) return this.lairCentre;
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const b of s.world.buildings) {
      if (b.kind === 'lair' || b.ruined) continue;
      const f = BUILDINGS[b.kind], c = World.center(b.tx + f.w / 2, b.ty + f.h / 2), d = this.dist(c);
      if (d < bd) { bd = d; best = c; }
    }
    return best ?? this;
  }

  private pickPrey(s: VillageScene): Mover | null {
    let best: Mover | null = null, bd = Infinity;
    for (const a of s.agents) {
      if (!prey(a) || a.dead || a.hidden) continue;
      const d = this.dist(a), range = this.aggroed ? Infinity : a instanceof Player ? OGRE.hunt * TILE : 6 * TILE;
      if (d < range && d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // ---- the three attacks ----------------------------------------------------------------------

  /**
   * Pick an attack for the current target, or none. Charge when he's far and cooled down (a wall in
   * the way is a reason to charge, not to give up); smash when close and either surrounded or with the
   * swing still cooling; otherwise the swing at melee range. All cooldowns start at 0, so first contact
   * with a lone target is always the swing.
   */
  private selectAttack(s: VillageScene): boolean {
    const t = this.target!, d = this.dist(t), tiles = d / TILE;
    const C = OGRE.charge, M = OGRE.smash, W = OGRE.swing;
    if (this.cd.charge <= 0 && tiles >= C.minTiles && tiles <= C.maxTiles && !t.elevated && !this.elevated && (s.world.lineClear(this, t) || !this.path.length)) { this.beginCharge(s, t); return true; }
    if (this.cd.smash <= 0 && d <= M.radius * 0.8 && (this.victimsWithin(s, M.radius) >= M.minVictims || this.cd.swing > 0)) { this.beginSmash(s); return true; }
    if (this.cd.swing <= 0 && d <= W.reach - 4 && t.elevated === this.elevated && s.world.lineClear(this, t, this.elevated)) { this.beginSwing(s, t); return true; }
    return false;
  }

  private victimsWithin(s: VillageScene, r: number): number {
    let n = 0;
    s.grid.forEachInRadius(this.x, this.y, r, o => { if (prey(o) && !o.dead && !o.hidden && o.elevated === this.elevated) n++; });
    return n;
  }

  private face(t: { x: number; y: number }): { ux: number; uy: number } {
    const d = this.dist(t) || 1, ux = (t.x - this.x) / d, uy = (t.y - this.y) / d;
    this.dir = ux < 0 ? -1 : 1;
    return { ux, uy };
  }

  private beginSwing(s: VillageScene, t: Mover): void {
    const { ux, uy } = this.face(t);
    this.move = { kind: 'swing', t: 0, ux, uy, struck: false };
    this.vx = this.vy = 0; this.task = 'winding up a swing';
    s.fx.push({ kind: 'telegraph', who: this, ms: OGRE.swing.windup * 1000 });
  }

  private beginSmash(s: VillageScene): void {
    if (this.target) this.face(this.target);
    this.move = { kind: 'smash', t: 0, struck: false };
    this.vx = this.vy = 0; this.task = 'raising his club';
    s.fx.push({ kind: 'telegraph', who: this, ms: OGRE.smash.windup * 1000 });
  }

  private beginCharge(s: VillageScene, t: Mover): void {
    const { ux, uy } = this.face(t);
    const maxDist = Math.min(this.dist(t) + OGRE.charge.overshootTiles * TILE, OGRE.charge.maxTiles * TILE);
    this.move = { kind: 'charge', t: 0, phase: 'windup', ux, uy, travelled: 0, maxDist, hit: new Set() };
    this.vx = this.vy = 0; this.clearGoal(); this.task = 'charging';
    s.fx.push({ kind: 'telegraph', who: this, ms: OGRE.charge.windup * 1000 });
    s.fx.push({ kind: 'charge', who: this, ux, uy });
  }

  /** Advance the running attack. Returns true while it still occupies him. */
  private moveTick(dt: number, s: VillageScene): boolean {
    const m = this.move!;
    m.t += dt;
    switch (m.kind) {
      case 'swing': {
        const W = OGRE.swing;
        this.vx = this.vy = 0;
        if (!m.struck && m.t >= W.windup) {
          m.struck = true;
          s.fx.push({ kind: 'melee', who: this, x: this.x + m.ux * 30, y: this.y + m.uy * 30 });
          let hits = 0;
          s.grid.forEachInRadius(this.x, this.y, W.reach, (o, d2) => {
            if (!prey(o) || o.dead || o.hidden || o.elevated !== this.elevated) return;
            const dd = Math.sqrt(d2) || 1, ox = (o.x - this.x) / dd, oy = (o.y - this.y) / dd;
            if (dd > 8 && ox * m.ux + oy * m.uy < W.halfAngleCos) return; // behind him
            if (!s.world.lineClear(this, o, this.elevated)) return;
            hits++;
            this.strike(s, o, W.dmg, ox, oy, W.push, W.freeze, true);
          });
          if (!hits) s.fx.push({ kind: 'miss', who: this });
        }
        if (m.t >= W.windup + W.recover) this.finish('swing', OGRE.swing.cooldown);
        return true;
      }
      case 'smash': {
        const M = OGRE.smash;
        this.vx = this.vy = 0;
        if (!m.struck && m.t >= M.windup) {
          m.struck = true;
          s.fx.push({ kind: 'smash', who: this, x: this.x, y: this.y, r: M.radius });
          s.grid.forEachInRadius(this.x, this.y, M.radius, (o, d2) => {
            if (!prey(o) || o.dead || o.hidden || o.elevated !== this.elevated) return;
            const dd = Math.sqrt(d2) || 1;
            this.strike(s, o, M.dmg, (o.x - this.x) / dd, (o.y - this.y) / dd, M.push * (1 - dd / M.radius * 0.5), M.freeze, false);
          });
          this.crackGround(s, M.radius, M.defenseDmg, M.buildingDmg);
        }
        if (m.t >= M.windup + M.recover) this.finish('smash', M.cooldown);
        return true;
      }
      case 'charge': {
        const C = OGRE.charge;
        if (m.phase === 'windup') {
          this.vx = this.vy = 0;
          if (m.t >= C.windup) { m.phase = 'rush'; m.t = 0; }
          return true;
        }
        if (m.phase === 'rush') {
          const v = this.speed * C.speedMul;
          this.vx = m.ux * v; this.vy = m.uy * v;
          const total = v * dt, steps = Math.ceil(total / 4), step = total / steps;
          for (let i = 0; i < steps; i++) {
            const nx = this.x + m.ux * step, ny = this.y + m.uy * step, q = World.toTile(nx, ny);
            if (s.world.isBlocked(q.tx, q.ty, true)) {
              // ran into something: it takes the blow, and he takes a moment to shake it off
              this.crackTile(s, q.tx, q.ty, C.defenseDmg, C.buildingDmg, new Set());
              s.fx.push({ kind: 'impact', x: nx, y: ny });
              s.fx.push({ kind: 'smash', who: this, x: this.x, y: this.y, r: 24 });
              m.phase = 'stunned'; m.t = 0; this.vx = this.vy = 0; this.task = 'dazed';
              return true;
            }
            this.x = nx; this.y = ny; m.travelled += step;
            s.grid.forEachInRadius(this.x, this.y, C.sweep, o => {
              if (!prey(o) || o.dead || o.hidden || o.elevated || m.hit.has(o.id)) return;
              m.hit.add(o.id);
              // bowled aside: mostly along the charge, a little to whichever side they're on
              const side = (o.x - this.x) * -m.uy + (o.y - this.y) * m.ux < 0 ? -1 : 1;
              this.strike(s, o, C.dmg, m.ux * 0.8 - m.uy * side * 0.6, m.uy * 0.8 + m.ux * side * 0.6, C.push, C.freeze, true);
            });
            this.trample(s);
            if (m.travelled >= m.maxDist) { m.phase = 'recover'; m.t = 0; this.vx = this.vy = 0; break; }
          }
          return true;
        }
        this.vx = this.vy = 0;
        if (m.t >= (m.phase === 'stunned' ? C.stun : C.recover)) this.finish('charge', C.cooldown);
        return true;
      }
    }
  }

  private finish(kind: OgreMove['kind'], cooldown: number): void {
    this.move = null; this.lastMove = kind; this.cd[kind] = cooldown; this.attackCd = 0.05;
  }

  private strike(s: VillageScene, o: Mover, dmg: number, ux: number, uy: number, push: number, freeze: number, melee: boolean): void {
    o.hit(dmg, melee);
    o.shove(ux, uy, push);
    o.freeze = Math.max(o.freeze, freeze);
    s.fx.push({ kind: 'hit', attacker: this, target: o, dmg, crit: false, killed: !!o.dead, ux, uy, push });
  }

  /** Every wall, gate and building whose tile lies under a shockwave of radius r takes a blow. */
  private crackGround(s: VillageScene, r: number, defenseDmg: number, buildingDmg: number): void {
    const c = this.tile, span = Math.ceil(r / TILE), seen = new Set<Building>();
    for (let ty = c.ty - span; ty <= c.ty + span; ty++)
      for (let tx = c.tx - span; tx <= c.tx + span; tx++)
        if (this.dist(World.center(tx, ty)) <= r + TILE / 2) this.crackTile(s, tx, ty, defenseDmg, buildingDmg, seen);
  }

  private crackTile(s: VillageScene, tx: number, ty: number, defenseDmg: number, buildingDmg: number, seen: Set<Building>): void {
    const t = s.world.get(tx, ty);
    if (!t) return;
    if (t.defense && t.defense.hp > 0) {
      if (s.world.damageDefense(t.defense, defenseDmg)) { s.event('raid', 'The defenses have been breached!', true); s.rescueFallenGuards(); }
    } else if (t.building && !seen.has(t.building)) {
      seen.add(t.building);
      s.damageBuilding(t.building, buildingDmg, this);
    }
  }

  private trample(s: VillageScene): void {
    const t = this.tile;
    if (s.world.get(t.tx, t.ty)?.kind === 'crop') s.world.set(t.tx, t.ty, 'tilled');
  }

  /** Each heavy step nearby: a thud and a tremor (the renderer decides by distance). */
  private footsteps(dt: number, s: VillageScene): void {
    if (Math.abs(this.vx) + Math.abs(this.vy) < 1) { this.stepT = 0; return; }
    this.stepT += dt;
    if (this.stepT >= 0.55) { this.stepT = 0; s.fx.push({ kind: 'thud', who: this }); }
  }
}

/** Slow, huge, hits hard, ignores knockback. Goes for soldiers first. */
export class Brute extends Raider {
  override get mass(): number { return MASS.brute; }
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

/**
 * Ignores people and tears down buildings, houses first. It only goes for buildings it can walk to:
 * walled off, it batters the nearest wall — slowly, so a closed perimeter buys the tower and soldiers time.
 */
export class Wrecker extends Raider {
  /** the building it is heading for or pounding on */
  prey: Building | null = null;
  private swing: { t: number; struck: boolean } | null = null;
  constructor(x: number, y: number, opts: RaiderOpts = {}) {
    super(x, y, opts);
    this.kind = 'wrecker';
    this.name = 'Wrecker';
    this.hp = this.maxHp = Math.round(WRECKER.hp * (opts.hpMul ?? 1));
    this.dmg = WRECKER.dmg;
    this.speed = WRECKER.speed * (opts.speedMul ?? 1);
    this.radius = 3.5;
    this.color = 0xb8602c;
    this.task = 'looking for something to wreck';
  }

  /** Nearest point of the building's footprint to us, in pixels. */
  private edgeOf(b: Building): { x: number; y: number } {
    const f = BUILDINGS[b.kind];
    return { x: Math.max(b.tx * TILE, Math.min(this.x, (b.tx + f.w) * TILE)), y: Math.max(b.ty * TILE, Math.min(this.y, (b.ty + f.h) * TILE)) };
  }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    if (this.siege && this.breach(dt, s)) return;
    if (this.attackTick(dt, s)) return;
    this.retarget -= dt;
    if (this.prey?.ruined) { this.prey = null; this.swing = null; }
    if (this.retarget <= 0 || !this.prey) {
      this.retarget = 1;
      const from = this.tile;
      this.prey = s.reachableBuildings(from, ['house'])[0] ?? s.reachableBuildings(from)[0] ?? null;
      if (this.prey) this.clearGoal();
    }
    const t = this.tile;
    if (s.world.get(t.tx, t.ty)?.kind === 'crop') s.world.set(t.tx, t.ty, 'tilled');
    if (this.prey) {
      this.bored = 0;
      const b = this.prey, e = this.edgeOf(b), name = BUILDINGS[b.kind].name.toLowerCase();
      if (this.dist(e) > WRECKER.reach) {
        // walk up to the footprint: the search stops on the tile beside a blocked goal
        this.swing = null;
        const f = BUILDINGS[b.kind];
        this.setGoal(s, Math.max(b.tx, Math.min(t.tx, b.tx + f.w - 1)), Math.max(b.ty, Math.min(t.ty, b.ty + f.h - 1)));
        this.followPath(dt);
        this.task = `heading for the ${name}`;
        return;
      }
      // pounding on it: the same wind-up / strike / recover cycle as battering a wall
      this.vx = this.vy = 0; this.dir = e.x < this.x ? -1 : 1;
      if (!this.swing) { this.swing = { t: 0, struck: false }; s.fx.push({ kind: 'telegraph', who: this, ms: 300 }); }
      const a = this.swing; a.t += dt; this.task = `wrecking the ${name}`;
      if (!a.struck && a.t >= 0.3) {
        a.struck = true;
        s.fx.push({ kind: 'melee', who: this, x: e.x, y: e.y });
        s.damageBuilding(b, p.wreckerDmg, this);
      }
      if (a.t >= WRECKER.swing) this.swing = null;
      return;
    }
    this.swing = null;
    // nothing to reach: hit back at anyone in arm's reach, else batter the wall in the way, else lose interest
    const victim = s.nearestVictim(this.x, this.y);
    if (victim && this.dist(victim) < 40) {
      this.bored = 0;
      if (this.startAttack(s, victim, this.dmg, 13, 0.25, 0.55)) return;
      this.setGoal(s, victim.tile.tx, victim.tile.ty); this.followPath(dt); this.task = 'lashing out'; return;
    }
    this.clearGoal();
    const dmg = this.dmg; this.dmg = p.wreckerWallDmg;
    const battering = this.breach(dt, s);
    this.dmg = dmg;
    if (battering) return;
    this.bored += dt; this.vx = this.vy = 0; this.task = 'finding nothing to wreck';
    if (this.bored > WRECKER.patience) this.dead = true;
  }
}

/** What a raid on wave `w` (1..6) is made of; the warlord's wave passes boss = true. */
export function waveComposition(w: number, boss = false): Record<'raider' | 'rat' | 'snatcher' | 'brute' | 'shaman' | 'wrecker', number> {
  if (boss) return { raider: 3, rat: 0, snatcher: 2, brute: 1, shaman: 1, wrecker: 2 };
  switch (Math.max(1, Math.min(6, w))) {
    case 1: return { raider: 2, rat: 0, snatcher: 0, brute: 0, shaman: 0, wrecker: 0 };
    case 2: return { raider: 2, rat: 10, snatcher: 0, brute: 0, shaman: 0, wrecker: 1 };
    case 3: return { raider: 2, rat: 12, snatcher: 1, brute: 0, shaman: 0, wrecker: 1 };
    case 4: return { raider: 3, rat: 0, snatcher: 1, brute: 1, shaman: 0, wrecker: 2 };
    case 5: return { raider: 3, rat: 16, snatcher: 1, brute: 0, shaman: 1, wrecker: 2 };
    default: return { raider: 3, rat: 0, snatcher: 2, brute: 1, shaman: 1, wrecker: 3 };
  }
}
