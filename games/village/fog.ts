import Phaser from 'phaser';
import { COLS, ROWS, TILE } from './config';
import { Villager, Player, type Mover } from './agents';
import type { VillageScene } from './main';
import { buildingCenter } from './world';

// Fog of war: the map is dark until someone sees it. Tiles in sight now are clear, tiles seen
// before are dimmed, the rest is black. Sight comes from the player, buildings, and villagers.
// Only the camera's view is repainted, a few times a second; `explored` is the lasting record.

/** sight radius in tiles for each kind of source */
export const SIGHT = { player: 10, building: 8, soldier: 6, villager: 4 } as const;
/** how many tiles the edge of sight fades over */
const SOFT = 3;

export class Fog {
  /** 1 once a tile has ever been in sight */
  readonly explored = new Uint8Array(COLS * ROWS);
  /** 0..1 how well each tile is seen right now (recomputed for the camera view each pass) */
  private vis = new Float32Array(COLS * ROWS);
  private layer: Phaser.Tilemaps.TilemapLayer;
  private t = 0;
  private lastScroll = { x: -1e9, y: -1e9 };
  /** tiles ever explored, for the minimap's "% explored" */
  seen = 0;
  readonly enabled: boolean;

  constructor(private scene: VillageScene, depth: number) {
    this.enabled = !new URLSearchParams(location.search).has('nofog');
    if (!scene.textures.exists('fogtile')) {
      const c = scene.textures.createCanvas('fogtile', TILE * 2, TILE)!;
      const ctx = c.context;
      ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, TILE, TILE);          // frame 0: unseen
      ctx.fillStyle = 'rgba(5,4,10,0.55)'; ctx.fillRect(TILE, 0, TILE, TILE); // frame 1: explored, out of sight
      c.refresh();
      c.add(0, 0, 0, 0, TILE, TILE); c.add(1, 0, TILE, 0, TILE, TILE);
    }
    const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: COLS, height: ROWS });
    const set = map.addTilesetImage('fogtile', 'fogtile', TILE, TILE, 0, 0, 1)!;
    this.layer = map.createBlankLayer('fog', set)!.setDepth(depth);
    this.layer.fill(1); // frame 0 = gid 1: everything starts unseen
    if (!this.enabled) { this.layer.setVisible(false); this.explored.fill(1); this.vis.fill(1); this.seen = COLS * ROWS; }
  }

  /** A new run: nothing has been seen. */
  reset(): void {
    if (!this.enabled) return;
    this.explored.fill(0); this.vis.fill(0); this.seen = 0; this.t = 1; this.lastScroll = { x: -1e9, y: -1e9 };
    this.layer.fill(1);
  }

  /** How well the tile at world (x, y) is seen right now, 0..1. Everything is seen with fog off. */
  visibleAt(x: number, y: number): number {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return 0;
    return this.vis[ty * COLS + tx];
  }
  isExplored(tx: number, ty: number): boolean { return this.explored[ty * COLS + tx] === 1; }

  update(dt: number): void {
    if (!this.enabled) return;
    this.t += dt;
    const cam = this.scene.cameras.main;
    const moved = Math.abs(cam.scrollX - this.lastScroll.x) + Math.abs(cam.scrollY - this.lastScroll.y) > TILE * 3;
    if (this.t < 0.25 && !moved) return;
    this.t = 0;
    this.lastScroll = { x: cam.scrollX, y: cam.scrollY };
    const v = cam.worldView;
    const x0 = Math.max(0, Math.floor(v.x / TILE) - 2), y0 = Math.max(0, Math.floor(v.y / TILE) - 2);
    const x1 = Math.min(COLS - 1, Math.ceil((v.x + v.width) / TILE) + 2), y1 = Math.min(ROWS - 1, Math.ceil((v.y + v.height) / TILE) + 2);
    const sources = this.sources();
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      let best = 0;
      for (const src of sources) {
        const d = Math.hypot(tx + 0.5 - src.tx, ty + 0.5 - src.ty);
        const f = (src.r - d) / SOFT;
        if (f > best) best = f;
      }
      const vis = Math.max(0, Math.min(1, best));
      const i = ty * COLS + tx;
      this.vis[i] = vis;
      if (vis > 0.5 && !this.explored[i]) { this.explored[i] = 1; this.seen++; }
      if (vis >= 1) { this.layer.removeTileAt(tx, ty); continue; }
      const tile = this.layer.putTileAt(this.explored[i] ? 2 : 1, tx, ty);
      tile.alpha = this.explored[i] ? 1 - vis : 1 - vis * 0.8;
    }
  }

  /** Everyone and everything that can see, in tile space. */
  private sources(): { tx: number; ty: number; r: number }[] {
    const s = this.scene;
    const out: { tx: number; ty: number; r: number }[] = [];
    for (const b of s.world.buildings) if (b.kind !== 'lair') { const c = buildingCenter(b); out.push({ tx: c.tx, ty: c.ty, r: SIGHT.building }); }
    for (const a of s.agents as Mover[]) {
      if (a.dead) continue;
      if (a instanceof Player) out.push({ tx: a.x / TILE, ty: a.y / TILE, r: SIGHT.player });
      else if (a instanceof Villager && !a.hidden) out.push({ tx: a.x / TILE, ty: a.y / TILE, r: a.role === 'soldier' ? SIGHT.soldier : SIGHT.villager });
    }
    return out;
  }

  /** the share of the map that has been seen, 0..1 */
  get exploredShare(): number { return this.seen / (COLS * ROWS); }
}
