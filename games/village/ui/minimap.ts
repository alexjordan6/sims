import { Villager, Raider, Player, type Mover } from '../agents';
import { COLS, ROWS, TILE } from '../config';
import { buildingCenter } from '../world';
import type { TileKind } from '../world';
import type { VillageScene } from '../main';

// One pixel per tile, agents as dots, the camera window as a box. Drawn on a DOM canvas so it
// never covers the world view.

const TERRAIN: Record<TileKind, [number, number, number]> = {
  grass: [98, 168, 76],
  tree: [40, 96, 44],
  sapling: [72, 134, 58],
  bush: [70, 120, 52],
  mushroom: [150, 120, 90],
  tilled: [140, 96, 58],
  crop: [150, 196, 70],
  house: [196, 84, 62],
  barracks: [104, 122, 156],
  granary: [214, 110, 60],
  woodyard: [160, 116, 66],
  hazel: [110, 130, 60], garlic: [150, 190, 120], burdock: [90, 120, 60],
  tavern: [210, 164, 88], lair: [70, 50, 40], gnomehouse: [200, 70, 60], wall: [163, 169, 178], gate: [209, 177, 113], stairs: [128, 194, 218],
};

/** long grass reads a shade deeper than mown ground, so cleared lanes show */
const TALL_GRASS: [number, number, number] = [72, 138, 58];

const ROLE = { infant: '#f5d8a8', kid: '#f5d8a8', farmer: '#7fd37f', woodcutter: '#c9a26b', soldier: '#6f9bff', gnome: '#d94a3a' } as const;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrain: ImageData;
  private painted = false;
  private t = 0;
  /** explored tiles painted last pass; the terrain repaints when more come into view */
  private seenPainted = -1;
  private fogT = 0;

  constructor(private scene: VillageScene, scale: number) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.width = COLS;
    this.el.height = ROWS;
    this.el.style.width = '100%';
    this.el.style.height = 'auto';
    this.el.style.maxWidth = `${Math.min(260, COLS * scale)}px`;
    this.el.title = 'Minimap — your village, the forests, and anyone approaching';
    this.ctx = this.el.getContext('2d')!;
    this.terrain = this.ctx.createImageData(COLS, ROWS);
  }

  /** Force a terrain repaint (after a reset). */
  invalidate(): void { this.painted = false; }

  render(dt: number, tilesChanged: boolean): void {
    const s = this.scene;
    this.t += dt; this.fogT += dt;
    if (!this.painted || tilesChanged || (s.fog && s.fog.seen !== this.seenPainted && this.fogT > 0.6)) { this.paintTerrain(); this.fogT = 0; }
    if (this.t < 0.12) return;
    this.t = 0;
    const c = this.ctx;
    c.putImageData(this.terrain, 0, 0);
    // the lair, once found: a skull mark (grey once the Ogre is dead)
    if (s.lairFound && s.world.lair) {
      const lc = buildingCenter(s.world.lair), lx = Math.round(lc.tx), ly = Math.round(lc.ty);
      c.fillStyle = s.world.lair.level >= 3 ? '#8a8a8a' : '#f4f0e0';
      c.fillRect(lx - 2, ly - 2, 5, 4); c.fillRect(lx - 1, ly + 2, 3, 1);
      c.fillStyle = '#1a1014'; c.fillRect(lx - 1, ly - 1, 1, 1); c.fillRect(lx + 1, ly - 1, 1, 1);
    }
    for (const a of s.agents as Mover[]) {
      if (a.dead || a.hidden) continue;
      if (a.hostile && s.fog && s.fog.visibleAt(a.x, a.y) <= 0.35) continue; // unseen threats stay unseen
      let colour: string | null = null, size = 1;
      if (a instanceof Player) { colour = '#ffffff'; size = 2; }
      else if (a instanceof Raider) { colour = a.boss || a.huge ? '#ffcc33' : a.wild && a.harmless ? '#c9a26b' : '#ff4a3d'; size = a.boss || a.huge ? 2 : 1; }
      else if (a instanceof Villager) colour = ROLE[a.role];
      if (!colour) continue;
      c.fillStyle = colour;
      c.fillRect(Math.floor(a.x / TILE) - (size >> 1), Math.floor(a.y / TILE) - (size >> 1), size, size);
    }
    // the camera window
    const v = s.cameras.main.worldView;
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1;
    c.strokeRect(v.x / TILE + 0.5, v.y / TILE + 0.5, v.width / TILE - 1, v.height / TILE - 1);
  }

  private paintTerrain(): void {
    const tiles = this.scene.world.tiles;
    const d = this.terrain.data;
    const fog = this.scene.fog;
    for (let i = 0; i < tiles.length; i++) {
      const o = i * 4;
      if (fog && !fog.explored[i]) { d[o] = 6; d[o + 1] = 5; d[o + 2] = 10; d[o + 3] = 255; continue; } // unseen: black
      const t = tiles[i], [r, g, b] = t.kind === 'grass' && t.tall ? TALL_GRASS : TERRAIN[t.kind];
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    this.painted = true;
    this.seenPainted = fog ? fog.seen : -1;
  }
}
