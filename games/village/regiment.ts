import { World, type TilePos } from './world';
import { TILE, BODY } from './config';
import type { Mover, Villager, Raider } from './agents';

export type Shape = 'line' | 'shieldwall' | 'loose' | 'circle' | 'square' | 'wedge' | 'column';
export type Stance = 'hold' | 'advance' | 'follow' | 'charge' | 'retreat';
/** the formations, in the order the Form menu lists them (F1-F7) */
export const SHAPES: Shape[] = ['line', 'shieldwall', 'loose', 'circle', 'square', 'wedge', 'column'];
export const SHAPE_NAME: Record<Shape, string> = { line: 'Line', shieldwall: 'Shield wall', loose: 'Loose', circle: 'Circle', square: 'Square', wedge: 'Wedge', column: 'Column' };
/** room between bodies, as a multiple of the block's gap: a shield wall closes up, loose order spreads out */
export const SHAPE_GAP: Record<Shape, number> = { line: 1, shieldwall: 0.75, loose: 1.8, circle: 1, square: 1, wedge: 1, column: 1 };
/** the banner's marching pace, as a share of the slowest member's: a shield wall shuffles, a column strides */
export const SHAPE_PACE: Record<Shape, number> = { line: 0.85, shieldwall: 0.6, loose: 0.85, circle: 0.85, square: 0.85, wedge: 0.85, column: 1 };
/** the shield wall: a front-rank shield blocks this much more often against blows from the front (up to `cap`); `front` is the cosine of the arc it covers */
export const SHIELD_WALL = { mul: 1.5, cap: 0.6, front: 0.5 } as const;
export const STANCES: Stance[] = ['follow', 'hold', 'advance', 'charge', 'retreat'];
/** the formation groups, Bannerlord's way: I-III fill by weapon, IV-VIII are yours to transfer banners into */
export const GROUP_NAME = ['All', 'Infantry', 'Pikes', 'Archers', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const GROUPS = 8;
/** The group a gnome with this weapon falls in under. */
export function weaponGroup(weapon: 'sword' | 'pike' | 'bow'): number { return weapon === 'pike' ? 2 : weapon === 'bow' ? 3 : 1; }

/** how many gnomes one banner carries before a new regiment is raised */
export const REGIMENT_SIZE = 50;
/** the room between neighbouring slots in a regiment, in sim pixels */
export const SLOT_GAP = BODY.gnome * 2.2;
/** the room between raiders in a warband: they are bigger bodies */
export const WARBAND_GAP = 3 * BODY.humanoidMul * 2.2;
/** how far an advancing block looks for a quarry, in pixels */
export const ADVANCE_SIGHT = 20 * TILE;
/** a place in a block: where to stand, and (for a circle) which way to face */
export interface Slot { x: number; y: number; fx?: number; fy?: number }
export const BANNER_COLOURS = ['#c83c3c', '#3c78c8', '#3ca85a', '#d4a42c', '#9a4cc0', '#2cb0b0', '#e0702c', '#d8d8d8'];
/** the enemy's banners: bone, ash and old blood */
export const WARBAND_COLOURS = ['#e8e0c8', '#3a3430', '#7a1a14', '#b0a890', '#5a1010'];

/** Footing per tile (0 not yet looked at, 1 good, 2 a wall, a tree, a building or thorns), kept until the world changes. */
let footMemo = new Uint8Array(0), footRev = -1, footWorld: World | null = null;
function badFooting(world: World, tx: number, ty: number): boolean {
  if (!world.inBounds(tx, ty)) return true;
  if (footWorld !== world || footRev !== world.revision || footMemo.length !== world.cols * world.rows) {
    footWorld = world; footRev = world.revision;
    if (footMemo.length !== world.cols * world.rows) footMemo = new Uint8Array(world.cols * world.rows); else footMemo.fill(0);
  }
  const i = ty * world.cols + tx;
  if (!footMemo[i]) footMemo[i] = world.isBlocked(tx, ty) || world.get(tx, ty)?.kind === 'thicket' ? 2 : 1;
  return footMemo[i] === 2;
}

/**
 * Slot offsets for n bodies, in units of the block's gap: `ox` to the right of the facing, `oy` back from it.
 * Front row first, each row centred, the block centred on its anchor. `cols` widens a line.
 */
export function layout(shape: Shape, n: number, cols = 0): { ox: number; oy: number; out?: boolean }[] {
  if (n <= 0) return [];
  if (shape === 'circle') return ringLayout(n);
  const rows: number[] = [];
  if (shape === 'column') {
    for (let left = n; left > 0; left -= 3) rows.push(Math.min(left, 3));
  } else if (shape === 'wedge') {
    for (let k = 0, left = n; left > 0; k++) { const c = Math.min(left, 2 * k + 1); rows.push(c); left -= c; }
  } else {
    const w = shape === 'line' || shape === 'shieldwall' ? Math.max(1, Math.min(n, cols || Math.ceil(n / 2))) : Math.ceil(Math.sqrt(n));
    for (let left = n; left > 0; left -= w) rows.push(Math.min(left, w));
  }
  const out: { ox: number; oy: number }[] = [];
  rows.forEach((c, r) => { for (let i = 0; i < c; i++) out.push({ ox: i - (c - 1) / 2, oy: r - (rows.length - 1) / 2 }); });
  return out;
}

/**
 * The circle: rings about the banner, the outer ring filled first, every slot facing out (`out`). As few
 * rings as hold everyone two deep at most, so the middle stays open for the banner.
 */
function ringLayout(n: number): { ox: number; oy: number; out: boolean }[] {
  const cap = (r: number) => Math.max(1, Math.floor(2 * Math.PI * r));
  let R = 1;
  while (cap(R) + (R > 1 ? cap(R - 1) : 0) < n) R++;
  const out: { ox: number; oy: number; out: boolean }[] = [];
  for (let r = R, left = n; left > 0 && r >= 1; r--) {
    const k = r === R - 1 || r === 1 ? left : Math.min(left, cap(r));
    for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2 - Math.PI / 2; out.push({ ox: Math.cos(a) * r, oy: Math.sin(a) * r, out: true }); }
    left -= k;
  }
  return out;
}

/**
 * A block of bodies under one banner — yours (a Regiment) or the enemy's (a Warband). The block thinks
 * for its members: the side decides where the banner should go, the block marches it there along one
 * path and lays out a slot for each member, rotated to its facing. Members walk to their slots and
 * fight whatever comes within their own reach (Mover.toSlot and each side's rankTick). When one falls
 * the ranks close: the slots are handed out again front rank first, each to the nearest body, so the
 * front stays full and nobody crosses the whole block to get there.
 */
export abstract class Block<M extends Mover = Mover> {
  /** which side the banner is on */
  abstract readonly side: 'ours' | 'theirs';
  members: M[] = [];
  shape: Shape = 'square';
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
  /** what the block is going for, when it is going for something */
  quarry: Mover | null = null;
  /** the most it has had under the banner, for the strength bar */
  peak = 0;
  /** room between slots, in pixels */
  gap = SLOT_GAP;
  /** slot positions, one per active member (same order), in sim pixels; a slot may face its own way (the circle faces out) */
  slots: Slot[] = [];
  /** a column remembers the shape it marched out of, and takes it again once it arrives */
  afterColumn: Shape | null = null;
  protected path: TilePos[] = [];
  protected pathTo: TilePos | null = null;
  protected think = 0;
  /** seconds until the banner may plan another path (a path a second is plenty for a block) */
  protected routeT = 0;
  private lastActive = -1;
  /** the slots must be handed out again: someone fell, or the block turned or changed shape */
  dirty = true;

  constructor(public id: number, public colour: string, x: number, y: number) {
    this.x = x; this.y = y; this.dest = { x, y };
  }

  /** Members the block is laying out right now (on their feet, and the block's to place). */
  abstract active(): M[];
  /** Going at the slowest member's full pace, ranks or no ranks (a retreat, a charge). */
  protected hurried(): boolean { return false; }

  /** Drop those who are no longer the block's (the ranks close on the next tick). */
  prune(keep: (m: M) => boolean): void {
    const before = this.members.length;
    this.members = this.members.filter((m) => { if (keep(m)) return true; if (m.block === this) { m.block = null; m.slot = null; } return false; });
    if (this.members.length !== before) this.dirty = true;
  }

  add(m: M): void { this.members.push(m); this.dirty = true; m.block = this; this.peak = Math.max(this.peak, this.members.length); }

  /**
   * Hand the slots out again: front rank first, each slot to the nearest member not yet placed. A gap
   * in the front is filled from right behind it (or beside it), and that gap from behind again, so
   * the block closes up with each body moving about one place. Members without a slot keep their order at the end.
   */
  private closeRanks(who: M[], slots: { x: number; y: number }[]): void {
    const left = new Set(who), order: M[] = [];
    for (const q of slots) {
      let best: M | null = null, bd = Infinity;
      for (const v of left) { const d = (v.x - q.x) ** 2 + (v.y - q.y) ** 2; if (d < bd) { bd = d; best = v; } }
      if (!best) break;
      left.delete(best); order.push(best);
    }
    const placed = new Set(order);
    this.members = [...order, ...this.members.filter((v) => !placed.has(v))];
  }

  /** The room between bodies in `shape`, in pixels. */
  spacing(shape = this.shape): number { return this.gap * SHAPE_GAP[shape]; }
  /** Take a new formation; a column remembers what it was, to form it again on arrival. */
  setShape(next: Shape): void {
    if (next === this.shape) return;
    this.afterColumn = next === 'column' ? (this.shape === 'column' ? this.afterColumn : this.shape) : null;
    this.shape = next; this.cols = 0; this.dirty = true;
  }
  /** The slots for `n` bodies about (x, y) facing (fx, fy): the block's layout, or a ghost of a placement. */
  slotsAt(x: number, y: number, fx: number, fy: number, n: number, shape = this.shape, cols = this.cols): Slot[] {
    const rx = -fy, ry = fx, g = this.spacing(shape);
    return layout(shape, n, cols).map(({ ox, oy, out }) => {
      const x0 = rx * ox - fx * oy, y0 = ry * ox - fy * oy;
      if (!out) return { x: x + x0 * g, y: y + y0 * g };
      const d = Math.hypot(x0, y0) || 1;
      return { x: x + x0 * g, y: y + y0 * g, fx: x0 / d, fy: y0 / d };
    });
  }

  /** How deep the block is front to back, in pixels. */
  depth(): number {
    const l = layout(this.shape, Math.max(1, this.active().length), this.cols);
    let lo = Infinity, hi = -Infinity;
    for (const o of l) { lo = Math.min(lo, o.oy); hi = Math.max(hi, o.oy); }
    return (hi - lo + 1) * this.spacing();
  }

  /** How wide the block is across its facing, in pixels. */
  width(): number {
    let lo = Infinity, hi = -Infinity;
    for (const o of layout(this.shape, Math.max(1, this.active().length), this.cols)) { lo = Math.min(lo, o.ox); hi = Math.max(hi, o.ox); }
    return (hi - lo + 1) * this.spacing();
  }

  /** Face (dx, dy) — ignored when it has no length. */
  face(dx: number, dy: number): void {
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) { this.fx = dx / d; this.fy = dy / d; }
  }

  /** Go for `q`: face it and set the banner half a block short of it, so the front rank meets it. */
  protected closeOn(q: Mover): void {
    const dx = q.x - this.x, dy = q.y - this.y, d = Math.hypot(dx, dy);
    this.face(dx, dy);
    const short = Math.min(d, this.depth() / 2);
    this.dest = { x: q.x - (dx / (d || 1)) * short, y: q.y - (dy / (d || 1)) * short };
  }

  /**
   * March the banner toward `dest` at the pace of the slowest (so nobody is left behind), lay the slots
   * out, hand them out again when the block changed, and give every member its slot.
   */
  protected marchAndLayOut(dt: number, world: World): void {
    const who = this.active();
    let pace = Infinity;
    for (const v of who) pace = Math.min(pace, v.speed);
    if (!Number.isFinite(pace)) pace = 30;
    // dress the ranks: while the block trails its banner by more than a tile, the banner slows, down to a near halt
    let lag = 0;
    for (const v of who) if (v.slot) lag += Math.hypot(v.x - v.slot.x, v.y - v.slot.y);
    lag = who.length ? lag / who.length : 0;
    // (a column keeps its own loose order on the march: it dresses its ranks only when they trail far behind)
    const column = this.shape === 'column', slack = column ? 2 * TILE : TILE, give = column ? 4 * TILE : 3 * TILE;
    this.march(dt, world, this.hurried() ? pace : pace * SHAPE_PACE[this.shape] * Math.min(1, Math.max(0.1, 1 - (lag - slack) / give)));
    this.slots = this.slotsAt(this.x, this.y, this.fx, this.fy, who.length).map((q) => this.footing(world, q));
    if (this.dirty || who.length !== this.lastActive) {
      // where the block is going to stand decides who goes where, not where it stands now
      this.closeRanks(who, this.slotsAt(this.dest.x, this.dest.y, this.fx, this.fy, who.length));
      this.dirty = false; this.lastActive = who.length;
    }
    const placed = new Set(who);
    let i = 0;
    for (const m of this.members) m.slot = placed.has(m) ? this.slots[i++] ?? null : null;
  }

  /**
   * A slot that falls on a wall, a tree, a building or thorns slides in toward the banner until it
   * finds open ground: the block squeezes round what is in its way rather than marching into it.
   */
  private footing(world: World, q: Slot): Slot {
    const bad = (x: number, y: number) => badFooting(world, Math.floor(x / TILE), Math.floor(y / TILE));
    if (!bad(q.x, q.y)) return q;
    const dx = this.x - q.x, dy = this.y - q.y, d = Math.hypot(dx, dy), step = this.gap / 2;
    for (let k = step; k < d; k += step) { const x = q.x + (dx / d) * k, y = q.y + (dy / d) * k; if (!bad(x, y)) return { ...q, x, y }; }
    return q;
  }

  /** whether the way to `dest` was clear when last looked at, and seconds until it is looked at again */
  protected straight = true;
  protected lookT = 0;
  /** Walk the banner toward `dest`: straight while the way is clear, along one planned path where it is not. */
  private march(dt: number, world: World, pace: number): void {
    const d = Math.hypot(this.dest.x - this.x, this.dest.y - this.y);
    if (d < 1) { this.x = this.dest.x; this.y = this.dest.y; this.path = []; return; }
    let to = this.dest;
    this.routeT -= dt; this.lookT -= dt;
    const goal = World.toTile(this.dest.x, this.dest.y);
    // a banner bound for ground nobody can stand on just walks at it: the members find their own way round.
    // (Whether the way is clear is looked at twice a second, not every tick: the line can be long.)
    if (this.lookT <= 0) { this.lookT = 0.5; this.straight = world.isBlocked(goal.tx, goal.ty) || world.lineClear(this, this.dest); }
    if (!this.straight) {
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

/**
 * A block of your gnome soldiers. It follows the head (the default: blocks march in ranks behind it),
 * holds where it was placed, or advances on the nearest raider.
 */
export class Regiment extends Block<Villager> {
  readonly side = 'ours' as const;
  stance: Stance = 'follow';
  /** following: where the block keeps station, in pixels to the right of the head and back from it (the scene ranks the followers) */
  trail = { side: 0, back: 2 * TILE };
  /** the formation group (1-8) the banner answers to: I-III fill by weapon, IV-VIII by transfer */
  group = 1;
  /** archers in the ranks loose only when this is off (F4: hold fire / fire at will) */
  holdFire = false;
  /** F2: keep turning to face the nearest raider while it holds */
  faceEnemy = false;
  /** retreating: where the banner is running to (the village) */
  rally: { x: number; y: number } | null = null;
  protected override hurried(): boolean { return this.stance === 'retreat' || this.stance === 'charge'; }

  /** Members the block is laying out: on their feet, without a wand order or a wall post of their own. */
  active(): Villager[] { return this.members.filter((v) => !v.order && !v.post && !v.hidden && !v.carriedBy); }

  /** Put the banner down at (x, y) facing (fx, fy): the block marches there and holds. */
  place(x: number, y: number, fx: number, fy: number, cols = 0): void {
    this.dest = { x, y }; this.face(fx, fy); this.stance = 'hold'; this.quarry = null; this.cols = cols; this.dirty = true; this.rally = null;
    this.path = []; this.pathTo = null; this.lookT = 0;
  }

  /**
   * One tick of the block's thinking: where the banner should be, then march it there and lay the slots out.
   * `head` is the head (followed), `pick` finds the nearest raider to (x, y) within r.
   */
  tick(dt: number, world: World, head: { x: number; y: number; vx: number; vy: number; dead?: boolean }, pick: (x: number, y: number, r: number) => Mover | null): void {
    this.think -= dt;
    if (this.stance === 'follow' && !head.dead) {
      if (Math.hypot(head.vx, head.vy) > 8) {
        // turn with the head, but smoothly: a block wheels, it does not spin on the spot
        const d = Math.hypot(head.vx, head.vy), k = Math.min(1, dt * 3);
        this.face(this.fx + (head.vx / d - this.fx) * k, this.fy + (head.vy / d - this.fy) * k);
      }
      const { side, back } = this.trail;
      this.dest = { x: head.x - this.fx * back - this.fy * side, y: head.y - this.fy * back + this.fx * side };
    } else if (this.stance === 'charge') {
      // ranks broken: every member hunts on its own; the banner drifts to where they are, to form on it after
      const who = this.active();
      if (who.length) { let x = 0, y = 0; for (const v of who) { x += v.x; y += v.y; } this.dest = { x: x / who.length, y: y / who.length }; }
    } else if (this.stance === 'retreat') {
      const to = this.rally ?? this.dest;
      this.face(to.x - this.x, to.y - this.y);
      this.dest = { ...to };
      if (Math.hypot(to.x - this.x, to.y - this.y) < TILE) this.place(to.x, to.y, this.fx, this.fy, this.cols); // home: hold there
    } else if (this.stance === 'hold' && this.faceEnemy && this.think <= 0) {
      this.think = 0.5;
      const foe = pick(this.x, this.y, ADVANCE_SIGHT);
      if (foe) { const dx = foe.x - this.x, dy = foe.y - this.y, d = Math.hypot(dx, dy) || 1; if (dx / d * this.fx + dy / d * this.fy < 0.97) { this.face(dx, dy); this.dirty = true; } }
    } else if (this.stance === 'advance') {
      if (this.quarry && (this.quarry.dead || this.quarry.hidden)) this.quarry = null;
      if (!this.quarry && this.think <= 0) { this.think = 0.5; this.quarry = pick(this.x, this.y, ADVANCE_SIGHT); }
      if (this.quarry) this.closeOn(this.quarry); else this.dest = { x: this.x, y: this.y };
    }
    if (this.shape === 'column' && this.afterColumn && this.stance === 'hold' && Math.hypot(this.dest.x - this.x, this.dest.y - this.y) < TILE) this.setShape(this.afterColumn);
    this.marchAndLayOut(dt, world);
  }
}

export type WarbandState = 'camp' | 'column' | 'charge';

/**
 * A block of the enemy's. It stands in camp, marches where its host sends it (the column), and when
 * anything of yours comes near it charges: it faces the nearest of your people and closes on them, the
 * front rank striking as it meets them. A host releases a warband at the walls, and then its raiders
 * are ordinary raiders again.
 */
export class Warband extends Block<Raider> {
  readonly side = 'theirs' as const;
  state: WarbandState = 'camp';
  /** where the column is sending the banner while it marches */
  goal: { x: number; y: number } | null = null;
  /** how close one of yours must come before it charges, in pixels */
  sight = 14 * TILE;
  gap = WARBAND_GAP;

  /** Members the block is laying out: everyone still under the banner and on their feet. */
  active(): Raider[] { return this.members.filter((r) => !r.dead && !r.hidden && r.block === this); }

  /**
   * One tick: in camp the banner stands; in column it walks toward `goal`; anything of yours within sight
   * turns it to a charge (`pick` finds the nearest of your people to (x, y) within r).
   */
  tick(dt: number, world: World, pick: (x: number, y: number, r: number) => Mover | null): void {
    this.think -= dt;
    if (this.quarry && (this.quarry.dead || this.quarry.hidden)) this.quarry = null;
    if (this.think <= 0) {
      this.think = 0.5;
      const near = pick(this.x, this.y, this.state === 'charge' ? this.sight * 1.5 : this.sight);
      if (near) { this.quarry = near; this.state = 'charge'; }
      else if (this.state === 'charge') { this.quarry = null; this.state = this.goal ? 'column' : 'camp'; }
    }
    if (this.state === 'charge' && this.quarry) this.closeOn(this.quarry);
    else if (this.state === 'column' && this.goal) { this.face(this.goal.x - this.x, this.goal.y - this.y); this.dest = { ...this.goal }; }
    else this.dest = { x: this.x, y: this.y };
    this.marchAndLayOut(dt, world);
  }

  /** Break ranks: every member becomes an ordinary raider again. */
  release(): void {
    for (const r of this.members) if (r.block === this) { r.block = null; r.slot = null; }
    this.members = [];
  }
}
