import { COLS, ROWS, TILE, p } from './config';
import { Villager, Player, type Mover } from './agents';
import type { VillageScene } from './main';
import { buildingCenter } from './world';

// Fog of war: the map is dark until someone sees it. Tiles in sight now are clear, tiles seen
// before are dimmed, the rest is black. Sight comes from the player, buildings, and villagers.
// This is only the record of what is seen; the 3D view reads it to paint the dark (see view3d).
// Sight is recomputed around each source a few times a second; `explored` is the lasting record.

/** sight radius in tiles for each kind of source */
export const SIGHT = { player: 10, building: 8, soldier: 6, villager: 4 } as const;
/** how many tiles the edge of sight fades over */
const SOFT = 3;

export class Fog {
  /** 1 once a tile has ever been in sight */
  readonly explored = new Uint8Array(COLS * ROWS);
  /** 0..1 how well each tile is seen right now */
  readonly vis = new Float32Array(COLS * ROWS);
  /** tiles lit on the last pass, so the next pass can put them out */
  private lit: number[] = [];
  /** tiles explored since the view last looked (it drains this to repaint the ground) */
  fresh: number[] = [];
  /** bumped whenever `vis` is recomputed, so the view knows to re-upload it */
  revision = 0;
  private t = 0;
  /** tiles ever explored, for the minimap's "% explored" */
  seen = 0;
  enabled: boolean;

  constructor(private scene: VillageScene) {
    this.enabled = !new URLSearchParams(location.search).has('nofog') && p.fog;
    if (!this.enabled) this.lift();
  }

  /** Everything seen, everything explored: the fog switched off. */
  private lift(): void {
    this.explored.fill(1); this.vis.fill(1); this.seen = COLS * ROWS; this.lit = []; this.revision++;
  }

  /** A new run: nothing has been seen. */
  reset(): void {
    if (!this.enabled) return;
    this.explored.fill(0); this.vis.fill(0); this.seen = 0; this.t = 1; this.lit = []; this.fresh = []; this.revision++;
  }

  /**
   * Mark an oval of ground round (cx, cy) as already explored: dimmed, not lit. The village knows its own
   * surroundings — the thorn ring that hems it in is in plain sight from the first morning.
   */
  chart(cx: number, cy: number, rx: number, ry: number): void {
    if (!this.enabled) return;
    for (let ty = Math.max(0, Math.floor(cy - ry)); ty <= Math.min(ROWS - 1, Math.ceil(cy + ry)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - rx)); tx <= Math.min(COLS - 1, Math.ceil(cx + rx)); tx++) {
        if (Math.hypot((tx - cx) / rx, (ty - cy) / ry) > 1) continue;
        const i = ty * COLS + tx;
        if (!this.explored[i]) { this.explored[i] = 1; this.seen++; this.fresh.push(i); }
      }
    this.t = 99; // recompute sight on the next update
  }

  /** How well the tile at world (x, y) is seen right now, 0..1. Everything is seen with fog off. */
  visibleAt(x: number, y: number): number {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return 0;
    return this.vis[ty * COLS + tx];
  }
  isExplored(tx: number, ty: number): boolean { return this.explored[ty * COLS + tx] === 1; }

  update(dt: number): void {
    // the debug panel's fog switch: off lifts the fog (everything seen), on drops it back over what's unexplored
    if (p.fog !== this.enabled) {
      this.enabled = p.fog;
      if (!this.enabled) { this.vis.fill(1); this.revision++; } else { this.vis.fill(0); this.lit = []; this.t = 99; }
    }
    if (!this.enabled) return;
    this.t += dt;
    if (this.t < 0.25) return;
    this.t = 0;
    for (const i of this.lit) this.vis[i] = 0;
    this.lit = [];
    for (const src of this.sources()) {
      const R = src.r + 1;
      const x0 = Math.max(0, Math.floor(src.tx - R)), x1 = Math.min(COLS - 1, Math.ceil(src.tx + R));
      const y0 = Math.max(0, Math.floor(src.ty - R)), y1 = Math.min(ROWS - 1, Math.ceil(src.ty + R));
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const d = Math.hypot(tx + 0.5 - src.tx, ty + 0.5 - src.ty);
        const f = Math.min(1, (src.r - d) / SOFT);
        if (f <= 0) continue;
        const i = ty * COLS + tx;
        if (f <= this.vis[i]) continue;
        if (this.vis[i] === 0) this.lit.push(i);
        this.vis[i] = f;
        if (f > 0.5 && !this.explored[i]) { this.explored[i] = 1; this.seen++; this.fresh.push(i); }
      }
    }
    this.revision++;
  }

  /** Everyone and everything that can see, in tile space. */
  private sources(): { tx: number; ty: number; r: number }[] {
    const s = this.scene;
    const out: { tx: number; ty: number; r: number }[] = [];
    for (const b of s.world.buildings) if (b.kind !== 'lair' && !b.wild) { const c = buildingCenter(b); out.push({ tx: c.tx, ty: c.ty, r: SIGHT.building }); } // a wild place lights nothing
    for (const a of s.agents as Mover[]) {
      if (a.dead) continue;
      if (a instanceof Player) out.push({ tx: a.x / TILE, ty: a.y / TILE, r: SIGHT.player });
      else if (a instanceof Villager && !a.hidden) out.push({ tx: a.x / TILE, ty: a.y / TILE, r: a.moodNow?.glow ? SIGHT.soldier + 3 : a.role === 'soldier' ? SIGHT.soldier : SIGHT.villager }); // the glow shows them more of the dark
    }
    return out;
  }

  /** the share of the map that has been seen, 0..1 */
  get exploredShare(): number { return this.seen / (COLS * ROWS); }
}
