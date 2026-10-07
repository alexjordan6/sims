import { TILE, p } from './config';
import type { Warband } from './regiment';
import type { Raider } from './agents';

/** What a host is made of, as shares of its size. Rats, snatchers and wreckers run loose; the rest march in warbands. */
export const HOST_MIX = { raider: 0.6, brute: 0.12, shaman: 0.08, rat: 0.1, wrecker: 0.05, snatcher: 0.05 } as const;
export type HostKind = keyof typeof HOST_MIX;
/** bodies to a warband: shield lines and wedges of raiders and butchers, and smaller knots of shamans */
export const WARBAND_SIZE = { line: 40, shaman: 20 } as const;
/** tiles between one warband's rear rank and the next one's front, on the march */
export const COLUMN_GAP = 3;
/** a warband this close to the village centre breaks ranks and storms it (tiles) */
export const ASSAULT_RANGE = 22;
/** a host cut below this share of its strength breaks and runs */
export const ROUT_SHARE = 0.15;

/** How big the host that comes on `day` is: doubling every hostDoubleDays from hostBase, never past hostMax. */
export function hostSize(day: number): number {
  return Math.min(p.hostMax, Math.round(p.hostBase * 2 ** (Math.max(0, day - p.firstRaidDay) / Math.max(0.1, p.hostDoubleDays))));
}

/** A host of `n` split by HOST_MIX (largest remainders), with always at least one raider. */
export function hostCounts(n: number): Record<HostKind, number> {
  const kinds = Object.keys(HOST_MIX) as HostKind[];
  const raw = kinds.map((k) => n * HOST_MIX[k]);
  const out = Object.fromEntries(kinds.map((k, i) => [k, Math.floor(raw[i])])) as Record<HostKind, number>;
  let left = n - kinds.reduce((a, k) => a + out[k], 0);
  const order = kinds.map((k, i) => [k, raw[i] - Math.floor(raw[i])] as const).sort((a, b) => b[1] - a[1]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i][0]]++;
  if (out.raider < 1) { out.raider = 1; const k = kinds.find((q) => q !== 'raider' && out[q] > 0); if (k) out[k]--; }
  return out;
}

export type HostState = 'mustering' | 'marching' | 'routed';

/**
 * A host: hundreds of raiders in warbands. It musters out in the wild (where you can go and fight it
 * before it moves), marches on the village in one column along one route — each warband keeping its
 * place behind the one before — and any warband that sights your people turns aside and charges them.
 * At the walls the warbands break ranks and storm in as ordinary raiders. The scene drives it
 * (VillageScene.tickHosts); the host only keeps the column in order.
 */
export class Host {
  warbands: Warband[] = [];
  loose: Raider[] = [];
  state: HostState = 'mustering';
  /** the loose rabble (rats, snatchers, wreckers) it will let go when it marches */
  pending: Record<HostKind, number> | null = null;
  /** everyone it set out with, for the rout and the HUD */
  peak = 0;
  /** the march, as points in sim pixels from the muster to the village, and the distance to each */
  private route: { x: number; y: number }[] = [];
  private along: number[] = [];
  /** how far down the route the column's head has come, in pixels */
  lead = 0;
  /** each warband's place in the column: how far behind the head it marches, in pixels */
  private behind = new Map<Warband, number>();

  constructor(public at: { x: number; y: number }, public from: string, public size: number, public marchDay: number) {}

  /** Bodies still standing, in the warbands and out ahead of them. */
  alive(): number {
    let n = 0;
    for (const w of this.warbands) for (const r of w.members) if (!r.dead) n++;
    for (const r of this.loose) if (!r.dead) n++;
    return n;
  }
  /** Every raider of the host, in ranks or loose. */
  bodies(): Raider[] { return [...this.warbands.flatMap((w) => w.members), ...this.loose]; }

  /** Set off down `route` (sim pixels, muster to village), the warbands in column in the order given. */
  march(route: { x: number; y: number }[]): void {
    this.route = route.length ? route : [this.at];
    this.along = [0];
    for (let i = 1; i < this.route.length; i++) this.along.push(this.along[i - 1] + Math.hypot(this.route[i].x - this.route[i - 1].x, this.route[i].y - this.route[i - 1].y));
    let back = 0;
    for (const w of this.warbands) { this.behind.set(w, back); back += w.depth() + COLUMN_GAP * TILE; w.state = 'column'; }
    this.lead = back; // the head starts its own length down the road, so the rear stands where it mustered
    this.state = 'marching';
  }

  /** The point `d` pixels down the route (clamped to its ends). */
  pointAt(d: number): { x: number; y: number } {
    const r = this.route, a = this.along;
    if (!r.length) return this.at;
    if (d <= 0) return r[0];
    if (d >= a[a.length - 1]) return r[r.length - 1];
    let i = 1;
    while (a[i] < d) i++;
    const k = (d - a[i - 1]) / Math.max(1e-6, a[i] - a[i - 1]);
    return { x: r[i - 1].x + (r[i].x - r[i - 1].x) * k, y: r[i - 1].y + (r[i].y - r[i - 1].y) * k };
  }
  get routeLength(): number { return this.along.length ? this.along[this.along.length - 1] : 0; }

  /**
   * Keep the column in order: the head walks on down the route at the pace of its slowest body, but
   * waits whenever the warband at its head has fallen behind; every warband in column marches for its
   * own place behind the head. (Charging warbands are their own masters until they stand down.)
   */
  tick(dt: number): void {
    if (this.state !== 'marching') return;
    const column = this.warbands.filter((w) => w.members.length && w.state === 'column');
    if (column.length) {
      const head = column[0], want = this.pointAt(this.lead - (this.behind.get(head) ?? 0));
      let pace = Infinity;
      for (const w of column) for (const r of w.members) if (!r.dead) pace = Math.min(pace, r.speed);
      if (!Number.isFinite(pace)) pace = 30;
      if (Math.hypot(head.x - want.x, head.y - want.y) < 3 * TILE) this.lead = Math.min(this.routeLength + 400, this.lead + pace * 0.8 * dt);
    }
    for (const w of this.warbands) if (w.state === 'column') w.goal = this.pointAt(this.lead - (this.behind.get(w) ?? 0));
  }

  /** Break and run: every warband turns for the muster ground and charges nobody on the way. */
  rout(): void {
    this.state = 'routed';
    for (const w of this.warbands) { w.state = 'column'; w.goal = { ...this.at }; w.sight = 0; w.quarry = null; }
  }
}
