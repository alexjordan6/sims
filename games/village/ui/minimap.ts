import { Villager, Raider, Player, type Mover } from '../agents';
import { COLS, ROWS, TILE } from '../config';
import type { TileKind } from '../world';
import type { VillageScene } from '../main';

// One pixel per tile, agents as dots, the camera window as a box. Drawn on a DOM canvas so it
// never covers the world view.

const TERRAIN: Record<TileKind, [number, number, number]> = {
  grass: [98, 168, 76],
  tree: [40, 96, 44],
  sapling: [72, 134, 58],
  tilled: [140, 96, 58],
  crop: [150, 196, 70],
  house: [196, 84, 62],
  barracks: [104, 122, 156],
  granary: [214, 110, 60],
  woodyard: [160, 116, 66],
  tavern: [210, 164, 88], wall: [163, 169, 178], gate: [209, 177, 113], stairs: [128, 194, 218],
};

const ROLE = { kid: '#f5d8a8', farmer: '#7fd37f', woodcutter: '#c9a26b', soldier: '#6f9bff' } as const;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrain: ImageData;
  private painted = false;
  private t = 0;

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
    if (!this.painted || tilesChanged) this.paintTerrain();
    this.t += dt;
    if (this.t < 0.12) return;
    this.t = 0;
    const c = this.ctx;
    c.putImageData(this.terrain, 0, 0);
    const s = this.scene;
    for (const a of s.agents as Mover[]) {
      if (a.dead || a.hidden) continue;
      let colour: string | null = null, size = 1;
      if (a instanceof Player) { colour = '#ffffff'; size = 2; }
      else if (a instanceof Raider) { colour = a.boss ? '#ffcc33' : '#ff4a3d'; size = a.boss ? 2 : 1; }
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
    for (let i = 0; i < tiles.length; i++) {
      const [r, g, b] = TERRAIN[tiles[i].kind];
      const o = i * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    this.painted = true;
  }
}
