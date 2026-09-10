/** Seeded PRNG (mulberry32). Same seed => same run, so a sim can be replayed via ?seed=. */
export class Rng {
  private s: number;
  constructor(public readonly seed: number) {
    this.s = seed >>> 0;
  }
  /** [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Seed from ?seed=123 in the URL, else random. Writes the seed back to the URL so it can be shared. */
export function seedFromUrl(): number {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get('seed');
  let seed = raw !== null ? Number(raw) : NaN;
  if (!Number.isFinite(seed)) {
    seed = (Math.random() * 0xffffffff) >>> 0;
    url.searchParams.set('seed', String(seed));
    window.history.replaceState(null, '', url);
  }
  return seed >>> 0;
}
