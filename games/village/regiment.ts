import { World, type TilePos } from './world';
import { TILE, BODY } from './config';
import type { Mover, Villager } from './agents';

export type Shape = 'square' | 'line' | 'wedge';
export type Stance = 'hold' | 'advance' | 'follow';
export const SHAPES: Shape[] = ['square', 'line', 'wedge'];
export const STANCES: Stance[] = ['follow', 'hold', 'advance'];

/** how many gnomes one banner carries before a new regiment is raised */
export const REGIMENT_SIZE = 50;
/** the room between neighbouring slots, in sim pixels */
export const SLOT_GAP = BODY.gnome * 2.2;
/** how far an advancing block looks for a quarry, in pixels */
export const ADVANCE_SIGHT = 20 * TILE;
export const BANNER_COLOURS = ['#c83c3c', '#3c78c8', '#3ca85a', '#d4a42c', '#9a4cc0', '#2cb0b0', '#e0702c', '#d8d8d8'];

/**
 * Slot offsets for n bodies, in units of SLOT_GAP: `ox` to the right of the facing, `oy` back from it.
 * Front row first, each row centred, the block centred on its anchor. `cols` widens a line.
 */
export function layout(shape: Shape, n: number, cols = 0): { ox: number; oy: number }[] {
  if (n <= 0) return [];
  const rows: number[] = [];
  if (shape === 'wedge') {
    for (let k = 0, left = n; left > 0; k++) { const c = Math.min(left, 2 * k + 1); rows.push(c); left -= c; }
  } else {
    const w = shape === 'line' ? Math.max(1, Math.min(n, cols || Math.ceil(n / 2))) : Math.ceil(Math.sqrt(n));
    for (let left = n; left > 0; left -= w) rows.push(Math.min(left, w));
  }
  const out: { ox: number; oy: number }[] = [];
  rows.forEach((c, r) => { for (let i = 0; i < c; i++) out.push({ ox: i - (c - 1) / 2, oy: r - (rows.length - 1) / 2 }); });
  return out;
}

/**
 * A block of gnome soldiers under one banner. The block thinks for its members: it picks where the
 * banner goes (behind the head, a placed spot, or onto the nearest raider), marches the banner there
 * along one path, and lays out a slot for each member, rotated to the block's facing. Members walk to
 * their slots and fight whatever comes within their own reach. When one falls the ranks close: the
 * slots are handed out again front rank first, each to the nearest body, so the front stays full and
 * nobody crosses the whole block to get there.
 */
export class Regiment {
  members: Villager[] = [];
  shape: Shape = 'square';
  stance: Stance = 'follow';
  /** the banner: the centre of the block, in sim pixels */
  x: number;
  y: number;
  /** the unit facing; the front rank is on this side */
  fx = 0;
  fy = 1;
  /** where the banner is marching to */
  dest: { x: number; y: number };
  /** a line's width in slots (0 = two deep) */
  cols = 0;
  /** what an advancing block is going for: the raider right-clicked, or the nearest it finds */
  quarry: Mover | null = null;
  /** following: where the block keeps station, in pixels to the right of the head and back from it (the scene ranks the followers) */
  trail = { side: 0, back: 2 * TILE };
  /** the most it has had under the banner, for the strength bar */
  peak = 0;
  /** slot positions, one per active member (same order), in sim pixels */
  slots: { x: number; y: number }[] = [];
  private path: TilePos[] = [];
  private pathTo: TilePos | null = null;
  private think = 0;
  /** seconds until the banner may plan another path (a path a second is plenty for a block) */
  private routeT = 0;
  private lastActive = -1;
  /** the slots must be handed out again: someone fell, or the block turned or changed shape */
  dirty = true;

  constructor(public id: number, public colour: string, x: number, y: number) {
    this.x = x; this.y = y; this.dest = { x, y };
  }

  /** Members the block is laying out: on their feet, without a wand order or a wall post of their own. */
  active(): Villager[] { return this.members.filter((v) => !v.order && !v.post && !v.hidden && !v.carriedBy); }

  /** Drop the fallen (the ranks close on the next tick). */
  prune(keep: (v: Villager) => boolean): void {
    const before = this.members.length;
    this.members = this.members.filter((v) => { if (keep(v)) return true; v.regiment = null; return false; });
    if (this.members.length !== before) this.dirty = true;
  }

  /**
   * Hand the slots out again: front rank first, each slot to the nearest member not yet placed. A gap
   * in the front is filled from right behind it (or beside it), and that gap from behind again, so
   * the block closes up with each body moving about one place. Members without a slot keep their order at the end.
   */
  private closeRanks(who: Villager[], slots: { x: number; y: number }[]): void {
    const left = new Set(who), order: Villager[] = [];
    for (const q of slots) {
      let best: Villager | null = null, bd = Infinity;
      for (const v of left) { const d = (v.x - q.x) ** 2 + (v.y - q.y) ** 2; if (d < bd) { bd = d; best = v; } }
      if (!best) break;
      left.delete(best); order.push(best);
    }
    const placed = new Set(order);
    this.members = [...order, ...this.members.filter((v) => !placed.has(v))];
  }

  add(v: Villager): void { this.members.push(v); this.dirty = true; v.regiment = this; this.peak = Math.max(this.peak, this.members.length); }

  /** The slots for `n` bodies about (x, y) facing (fx, fy): the block's layout, or a ghost of a placement. */
  slotsAt(x: number, y: number, fx: number, fy: number, n: number, shape = this.shape, cols = this.cols): { x: number; y: number }[] {
    const rx = -fy, ry = fx;
    return layout(shape, n, cols).map(({ ox, oy }) => ({ x: x + (rx * ox - fx * oy) * SLOT_GAP, y: y + (ry * ox - fy * oy) * SLOT_GAP }));
  }

  /** How deep the block is front to back, in pixels. */
  depth(): number {
    const l = layout(this.shape, Math.max(1, this.active().length), this.cols);
    return (l[l.length - 1].oy - l[0].oy + 1) * SLOT_GAP;
  }

  /** How wide the block is across its facing, in pixels. */
  width(): number {
    let lo = Infinity, hi = -Infinity;
    for (const o of layout(this.shape, Math.max(1, this.active().length), this.cols)) { lo = Math.min(lo, o.ox); hi = Math.max(hi, o.ox); }
    return (hi - lo + 1) * SLOT_GAP;
  }

  /** Face (dx, dy) — ignored when it has no length. */
  face(dx: number, dy: number): void {
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) { this.fx = dx / d; this.fy = dy / d; }
  }

  /** Put the banner down at (x, y) facing (fx, fy): the block marches there and holds. */
  place(x: number, y: number, fx: number, fy: number, cols = 0): void {
    this.dest = { x, y }; this.face(fx, fy); this.stance = 'hold'; this.quarry = null; this.cols = cols; this.dirty = true;
    this.path = []; this.pathTo = null;
  }

  /**
   * One tick of the block's thinking: where the banner should be, march it there, lay the slots out.
   * `head` is the head (followed), `pick` finds the nearest raider to (x, y) within r.
   */
  tick(dt: number, world: World, head: { x: number; y: number; vx: number; vy: number; dead?: boolean }, pick: (x: number, y: number, r: number) => Mover | null): void {
    const who = this.active();
    this.think -= dt;
    if (this.stance === 'follow' && !head.dead) {
      if (Math.hypot(head.vx, head.vy) > 8) {
        // turn with the head, but smoothly: a block wheels, it does not spin on the spot
        const d = Math.hypot(head.vx, head.vy), k = Math.min(1, dt * 3);
        this.face(this.fx + (head.vx / d - this.fx) * k, this.fy + (head.vy / d - this.fy) * k);
      }
      const { side, back } = this.trail;
      this.dest = { x: head.x - this.fx * back - this.fy * side, y: head.y - this.fy * back + this.fx * side };
    } else if (this.stance === 'advance') {
      if (this.quarry && (this.quarry.dead || this.quarry.hidden)) this.quarry = null;
      if (!this.quarry && this.think <= 0) { this.think = 0.5; this.quarry = pick(this.x, this.y, ADVANCE_SIGHT); }
      const q = this.quarry;
      if (q) {
        // the front rank meets it: the banner stops half a block short
        const dx = q.x - this.x, dy = q.y - this.y, d = Math.hypot(dx, dy);
        this.face(dx, dy);
        const short = Math.min(d, this.depth() / 2);
        this.dest = { x: q.x - (dx / (d || 1)) * short, y: q.y - (dy / (d || 1)) * short };
      } else this.dest = { x: this.x, y: this.y };
    }
    // march the banner, at the pace of the slowest so nobody is left behind
    let pace = Infinity;
    for (const v of who) pace = Math.min(pace, v.speed);
    if (!Number.isFinite(pace)) pace = 30;
    this.march(dt, world, pace * 0.85);
    this.slots = this.slotsAt(this.x, this.y, this.fx, this.fy, who.length).map((q) => this.footing(world, q));
    if (this.dirty || who.length !== this.lastActive) {
      // where the block is going to stand decides who goes where, not where it stands now
      this.closeRanks(who, this.slotsAt(this.dest.x, this.dest.y, this.fx, this.fy, who.length));
      this.dirty = false; this.lastActive = who.length;
    }
  }

  /**
   * A slot that falls on a wall, a tree, a building or thorns slides in toward the banner until it
   * finds open ground: the block squeezes round what is in its way rather than marching into it.
   */
  private footing(world: World, q: { x: number; y: number }): { x: number; y: number } {
    const bad = (x: number, y: number) => { const t = World.toTile(x, y); return world.isBlocked(t.tx, t.ty) || world.thicketAt(x, y); };
    if (!bad(q.x, q.y)) return q;
    const dx = this.x - q.x, dy = this.y - q.y, d = Math.hypot(dx, dy), step = SLOT_GAP / 2;
    for (let k = step; k < d; k += step) { const x = q.x + (dx / d) * k, y = q.y + (dy / d) * k; if (!bad(x, y)) return { x, y }; }
    return q;
  }

  /** Walk the banner toward `dest`: straight while the way is clear, along one planned path where it is not. */
  private march(dt: number, world: World, pace: number): void {
    const d = Math.hypot(this.dest.x - this.x, this.dest.y - this.y);
    if (d < 1) { this.x = this.dest.x; this.y = this.dest.y; this.path = []; return; }
    let to = this.dest;
    this.routeT -= dt;
    const goal = World.toTile(this.dest.x, this.dest.y);
    // a banner bound for ground nobody can stand on just walks at it: the members find their own way round
    if (!world.isBlocked(goal.tx, goal.ty) && !world.lineClear(this, this.dest)) {
      if (this.routeT <= 0 && (!this.pathTo || this.pathTo.tx !== goal.tx || this.pathTo.ty !== goal.ty || !this.path.length)) {
        this.routeT = 1;
        const path = world.route(World.toTile(this.x, this.y), goal, false, false);
        if (path) { this.path = path; this.pathTo = goal; }
      }
      while (this.path.length) {
        const c = World.center(this.path[0].tx, this.path[0].ty);
        if (Math.hypot(c.x - this.x, c.y - this.y) > 2) { to = c; break; }
        this.path.shift();
      }
    } else this.path = [];
    const dx = to.x - this.x, dy = to.y - this.y, g = Math.hypot(dx, dy), step = Math.min(g, pace * dt);
    if (g > 1e-6) { this.x += (dx / g) * step; this.y += (dy / g) * step; }
  }
}
