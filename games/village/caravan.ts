import { Mover } from './agents';
import { World } from './world';
import { TILE, p } from './config';
import type { VillageScene } from './main';

/**
 * An ox caravan up the south road: a team of oxen and a laden cart. It comes in from the map's south
 * edge along the trail, unloads at the granary (food, wood, arrows, scrap and a roll of bandages) and
 * goes back the way it came. It is a `Mover`, not a `Villager` or a `Raider`: raiders don't hunt it,
 * soldiers don't escort it and towers don't shoot past it, so it is something you can count on.
 */
export class Caravan extends Mover {
  /** where it came in, and goes back out */
  readonly origin: { x: number; y: number };
  /** what the cart carries until it is unloaded */
  cargo: { food: number; wood: number; arrows: number; scrap: number; bandages: number };
  unloaded = false;
  private stuckT = 0;

  constructor(x: number, y: number, cargo: Caravan['cargo']) {
    super(x, y);
    this.origin = { x, y };
    this.cargo = cargo;
    this.hp = this.maxHp = 400;
    this.speed = p.caravanSpeed;
    this.radius = 6;
    this.pushScale = 0.05; // an ox and its cart are not shoved aside
    this.color = 0x8a6a44;
    this.task = 'coming up the south road';
  }

  update(dt: number, s: VillageScene): void {
    const to = this.unloaded ? this.origin : s.caravanStop();
    const goal = World.toTile(to.x, to.y);
    if (!this.unloaded && this.dist(to) < TILE * 1.5) { s.unloadCaravan(this); this.clearGoal(); return; }
    if (this.unloaded && this.dist(to) < TILE) { this.dead = true; return; } // over the edge of the map and gone
    if (!this.goal || this.goal.tx !== goal.tx || this.goal.ty !== goal.ty) this.setGoal(s, goal.tx, goal.ty);
    const before = { x: this.x, y: this.y };
    if (this.followPath(dt) && this.dist(to) > TILE * 1.5) {
      // no path this tick (the search budget is spent, or the road is shut): try again, and walk straight at it after a while
      this.stuckT += dt;
      if (this.stuckT > 3) { const d = this.dist(to) || 1; this.x += (to.x - this.x) / d * this.speed * dt; this.y += (to.y - this.y) / d * this.speed * dt; }
      if (this.stuckT > 1) this.clearGoal();
    } else this.stuckT = 0;
    if (Math.abs(this.x - before.x) > 0.01) this.dir = this.x < before.x ? -1 : 1;
    this.task = this.unloaded ? 'heading back down the south road' : 'bringing supplies up the south road';
  }
}
