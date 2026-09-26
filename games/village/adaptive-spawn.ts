export interface AdaptiveSettings {
  adaptiveSpawns: boolean;
  adaptiveHp: number;
  adaptiveEvery: number;
  adaptiveStart: number;
  adaptiveGrowth: number;
  adaptiveBatchCap: number;
  adaptiveAliveCap: number;
}

/** Simulation-time scheduler: no catch-up bursts or growth while under pressure. */
export class AdaptiveSpawner {
  elapsed = 0;
  batches = 0;
  lastSpawned = 0;
  reset(): void { this.elapsed = 0; this.batches = 0; this.lastSpawned = 0; }
  nextBatch(p: AdaptiveSettings): number {
    return Math.max(1, Math.min(Math.floor(p.adaptiveBatchCap), Math.floor(p.adaptiveStart + this.batches * p.adaptiveGrowth)));
  }
  tick(dt: number, hp: number, active: boolean, alive: number, p: AdaptiveSettings, spawn: (n: number) => number): void {
    if (!p.adaptiveSpawns) { this.reset(); return; }
    if (!active || hp <= p.adaptiveHp || alive >= p.adaptiveAliveCap) { this.elapsed = 0; return; }
    this.elapsed += Math.max(0, dt);
    if (this.elapsed < Math.max(0.25, p.adaptiveEvery)) return;
    this.elapsed = 0;
    this.lastSpawned = spawn(Math.min(this.nextBatch(p), Math.max(0, Math.floor(p.adaptiveAliveCap - alive))));
    if (this.lastSpawned > 0) this.batches++;
  }
}
