import { Mover, Raider, Villager, Player } from './agents';
import { World, type TilePos, type Hive } from './world';
import { BOAR, HIVE, TILE, p } from './config';
import type { VillageScene } from './main';

// Wild animals. Like enemies.ts this imports agents, never the reverse.

/** A family of boars: where they live and who is still alive. */
export interface Sounder { id: number; home: TilePos; members: Boar[] }

/**
 * A boar roots about near its sounder's home and is nobody's enemy — soldiers and towers leave it be, nobody
 * flees from it — until something strikes it. Then it (and every mate in earshot) charges the attacker until
 * it calms: BOAR.calmAfter seconds without landing a blow, the attacker gone, or the chase past BOAR.leash tiles
 * from home. Dead, it drops meat where it fell (VillageScene.onDeath).
 */
export class Boar extends Raider {
  /** days old; drawn small and dropping half meat until BOAR.youngDays */
  age: number;
  /** seconds of anger left; 0 = calm */
  anger = 0;
  private grazeT = 0;
  private rustleT = 0;

  constructor(x: number, y: number, public readonly sounder: Sounder, young = false) {
    super(x, y);
    this.kind = 'boar';
    this.name = young ? 'Young boar' : 'Boar';
    this.wild = true;
    this.harmless = true;
    this.lairBound = true;
    this.lurker = true; // unseen in long grass until it moves, or someone treads on it
    this.age = young ? 0 : BOAR.youngDays;
    this.hp = this.maxHp = young ? Math.round(BOAR.hp / 2) : BOAR.hp;
    this.dmg = p.boarDmg;
    this.speed = BOAR.speed;
    this.radius = BOAR.radius;
    this.color = 0x8a5a34;
    this.task = 'rooting about';
    sounder.members.push(this);
  }

  get young(): boolean { return this.age < BOAR.youngDays; }
  get provoked(): boolean { return this.anger > 0; }
  /** whoever it is charging (for the inspector and tests) */
  get prey(): Mover | null { return this.provoked ? this.target : null; }
  /** meat this body drops */
  get meat(): number { return this.young ? BOAR.meat / 2 : BOAR.meat; }

  override hit(dmg: number, melee = true, by?: Mover): void {
    super.hit(dmg, melee, by);
    if (!this.dead && by && !by.dead) this.rouse(by);
  }

  /** Turn on an attacker; calm mates within earshot join in. */
  rouse(by: Mover): void {
    const wasCalm = !this.provoked;
    this.target = by; this.anger = BOAR.calmAfter; this.harmless = false; this.task = 'charging';
    this.clearGoal();
    if (!wasCalm) return;
    for (const m of this.sounder.members) if (m !== this && !m.dead && !m.provoked && m.dist(this) <= BOAR.packRange * TILE) m.rouse(by);
  }

  calm(): void {
    this.anger = 0; this.harmless = true; this.target = null; this.attack = null; this.speed = BOAR.speed;
    this.clearGoal(); this.grazeT = 0; this.task = 'rooting about';
  }

  /** A grown boar's name once it has grown up (called at dawn). */
  grow(): void { if (++this.age >= BOAR.youngDays && this.name === 'Young boar') { this.name = 'Boar'; this.maxHp = BOAR.hp; this.hp = Math.min(this.maxHp, this.hp + BOAR.hp / 2); } }

  update(dt: number, s: VillageScene): void {
    this.tickTimers(dt);
    if (this.frozen(dt)) return;
    if (this.attackTick(dt, s)) { if (this.attack?.struck) this.anger = BOAR.calmAfter; return; }
    const home = World.center(this.sounder.home.tx, this.sounder.home.ty);
    if (this.provoked) {
      this.anger -= dt;
      const t = this.target;
      if (!t || t.dead || t.hidden || this.anger <= 0 || this.dist(home) > BOAR.leash * TILE) { this.calm(); return; }
      this.speed = BOAR.angrySpeed;
      this.task = 'charging';
      if (this.startAttack(s, t, this.dmg, BOAR.reach, BOAR.windup, BOAR.recover)) { this.anger = BOAR.calmAfter; return; }
      this.setGoal(s, t.tile.tx, t.tile.ty);
      this.followPath(dt); // walled off: no path, the anger runs out and it wanders home
      return;
    }
    // calm: graze around home. Hidden in the long grass, a body treading on it startles it; moving, it stirs the grass.
    if (this.lurking) {
      let trod: Mover | null = null;
      s.grid.forEachInRadius(this.x, this.y, BOAR.startle, (o) => {
        if (trod || !(o instanceof Mover) || o.dead || o.hidden || o.elevated) return;
        if (o instanceof Player || (o instanceof Villager && !o.carriedBy && o.role !== 'infant')) trod = o;
      });
      const who = trod as Mover | null;
      if (who) {
        this.rouse(who);
        if (who instanceof Player) s.event('raid', `A ${this.name.toLowerCase()} bursts out of the long grass!`, true);
        return;
      }
      this.rustleT -= dt;
      if ((this.vx || this.vy) && this.rustleT <= 0) { this.rustleT = s.rng.range(BOAR.rustleEvery[0], BOAR.rustleEvery[1]); s.fx.push({ kind: 'rustle', x: this.x, y: this.y }); }
    }
    this.grazeT -= dt;
    if (this.grazeT <= 0 || this.followPath(dt)) {
      this.grazeT = s.rng.range(2, 6);
      this.vx = this.vy = 0;
      this.task = s.rng.chance(0.5) ? 'rooting about' : 'grazing';
      const ht = this.sounder.home;
      for (let i = 0; i < 12; i++) {
        const tx = ht.tx + s.rng.int(-BOAR.roam, BOAR.roam), ty = ht.ty + s.rng.int(-BOAR.roam, BOAR.roam);
        if (!s.world.inBounds(tx, ty) || s.world.isBlocked(tx, ty, true)) continue;
        this.setGoal(s, tx, ty, true);
        if (this.path.length) break;
      }
    }
  }
}

/**
 * The swarm out of a disturbed hive. It is a `Mover`, not a `Raider`, on purpose: bees are weather, not
 * an army, so soldiers don't march on them, towers don't shoot them, villagers don't count them as a raid
 * and they carry no HP bar or minimap dot. There is no killing one — you outrun it, or you get behind a
 * door. When its patience runs out (or it loses its quarry) it drifts home and is gone.
 */
export class Swarm extends Mover {
  /** seconds of temper left */
  private patience = HIVE.patience;
  private stingT = 0;
  /** the erratic weave, so it doesn't fly in a straight line */
  private weave = 0;
  readonly home: { x: number; y: number };

  constructor(public readonly hive: Hive, public target: Mover | null) {
    super((hive.tx + 0.5) * TILE, (hive.ty + 0.5) * TILE);
    this.home = { x: this.x, y: this.y };
    this.hp = this.maxHp = 1;
    this.speed = HIVE.speed;
    this.radius = 3;
    this.color = 0xe8d45a;
    this.task = 'swarming';
  }

  /** Bees leave people and raiders alike alone once they are dead or behind a door. */
  private lost(): boolean {
    const t = this.target;
    return !t || t.dead || t.hidden || this.dist(this.home) > HIVE.range * TILE;
  }

  update(dt: number, s: VillageScene): void {
    this.patience -= dt;
    this.stingT -= dt;
    this.weave += dt * 9;
    s.fx.push({ kind: 'bees', x: this.x, y: this.y });

    const giveUp = this.patience <= 0 || this.lost();
    const to = giveUp ? this.home : this.target!;
    const dx = to.x - this.x, dy = to.y - this.y, d = Math.hypot(dx, dy) || 1;

    if (giveUp && d < 6) { // home again: the hive settles, and the bees are gone
      this.hive.angry = HIVE.calmAfter;
      this.dead = true;
      return;
    }
    // fly at it, weaving as bees do
    const ux = dx / d, uy = dy / d;
    const wob = Math.sin(this.weave) * 0.45;
    this.x += (ux - uy * wob) * this.speed * dt;
    this.y += (uy + ux * wob) * this.speed * dt;
    this.dir = ux < 0 ? -1 : 1;

    if (giveUp) { this.task = 'going home'; return; }
    this.task = 'swarming';
    if (d <= HIVE.reach && this.stingT <= 0) {
      this.stingT = HIVE.stingEvery;
      const t = this.target!;
      t.hit(p.beeDmg, false);
      s.fx.push({ kind: 'hit', attacker: this, target: t, dmg: p.beeDmg, crit: false, killed: !!t.dead });
    }
  }
}
