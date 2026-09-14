import Phaser from 'phaser';
import { World, BUILDING_W, BUILDING_H, type Tile } from './world';
import { Mover, Villager, Raider, Player } from './agents';
import { Bolt } from './enemies';
import { TOWN, FARM, CHAR } from './atlas';
import { TILE, COLS, ROWS } from './config';
import type { VillageScene } from './main';
import { Fx } from './fx';

import townUrl from './assets/town.png';
import farmUrl from './assets/farm.png';
import dungeonUrl from './assets/dungeon.png';

// Tileset first-gids inside the one tilemap (0 is reserved for "no tile" by using 1-based gids).
const GID = { town: 1, farm: 1 + 132, dungeon: 1 + 264 } as const;
const EMPTY = -1;

/** 4x4 building art: parts are the footprint (row-major: two roof rows, two wall rows), ridge is the overhanging roof row above. */
const BUILDING = {
  house: {
    ridge: [52, 53, 53, 54],
    parts: [
      64, 65, 65, 66,
      64, 65, 65, 66,
      72, 84, 84, 75, // wall edges with two windows
      72, TOWN.wallWoodDoor, 73, 75, // door, plain wall
    ],
  },
  barracks: {
    ridge: [48, 49, 49, 50],
    parts: [
      60, 61, 61, 62,
      60, 61, 61, 62,
      76, 88, 88, 79,
      76, TOWN.wallStoneDoor, 77, 79,
    ],
  },
} as const;

export const DEPTH = { ground: 0, objects: 1, under: 5, agents: 10, roofs: 20, bars: 30, night: 40 } as const;

/** Load the three spritesheets. Call from the scene's preload(). */
export function preloadArt(scene: Phaser.Scene): void {
  scene.load.spritesheet('town', townUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.spritesheet('farm', farmUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.spritesheet('dungeon', dungeonUrl, { frameWidth: 16, frameHeight: 16 });
}

/**
 * Draws the world: three tilemap layers (ground / objects / roofs), one sprite per agent,
 * HP bars, the faced-tile cursor, selection ring and the day/night tint.
 */
export class Renderer {
  private ground!: Phaser.Tilemaps.TilemapLayer;
  private objects!: Phaser.Tilemaps.TilemapLayer;
  private roofs!: Phaser.Tilemaps.TilemapLayer;
  private sprites = new Map<number, Phaser.GameObjects.Sprite>();
  private under: Phaser.GameObjects.Graphics;
  private bars: Phaser.GameObjects.Graphics;
  private night: Phaser.GameObjects.Rectangle;
  private t = 0;
  readonly fx: Fx;

  constructor(private scene: VillageScene) {
    const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: COLS, height: ROWS });
    const town = map.addTilesetImage('town', 'town', TILE, TILE, 0, 0, GID.town)!;
    const farm = map.addTilesetImage('farm', 'farm', TILE, TILE, 0, 0, GID.farm)!;
    const dungeon = map.addTilesetImage('dungeon', 'dungeon', TILE, TILE, 0, 0, GID.dungeon)!;
    const sets = [town, farm, dungeon];
    this.ground = map.createBlankLayer('ground', sets)!.setDepth(DEPTH.ground);
    this.objects = map.createBlankLayer('objects', sets)!.setDepth(DEPTH.objects);
    this.roofs = map.createBlankLayer('roofs', sets)!.setDepth(DEPTH.roofs);
    this.under = scene.add.graphics().setDepth(DEPTH.under);
    this.bars = scene.add.graphics().setDepth(DEPTH.bars);
    this.night = scene.add.rectangle(0, 0, COLS * TILE, ROWS * TILE, 0x060612, 0).setOrigin(0).setDepth(DEPTH.night);
    this.fx = new Fx(scene);
  }

  /** Redraw every tile and drop all sprites (after a reset). */
  rebuild(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.fx.clear();
    this.roofs.fill(EMPTY);
    const w = this.scene.world;
    for (let i = 0; i < w.tiles.length; i++) w.dirty.add(i);
    this.drainDirty();
  }

  /** Per-frame: patch changed tiles, sync sprites, overlays. */
  sync(dt: number): void {
    this.t += dt;
    this.drainDirty();
    this.syncSprites();
    for (const ev of this.scene.fx) this.fx.handle(ev, this.sprites);
    this.scene.fx.length = 0;
    this.fx.update(dt, this.sprites);
    this.drawOverlays();
  }

  // ---- tiles ---------------------------------------------------------------

  private drainDirty(): void {
    const w = this.scene.world;
    if (w.dirty.size === 0) return;
    for (const i of w.dirty) this.paintTile(w, i % w.cols, (i / w.cols) | 0);
    w.dirty.clear();
  }

  private paintTile(w: World, tx: number, ty: number): void {
    const t = w.get(tx, ty)!;
    const { ground, object } = tileFrames(t, this.scene.cropDays);
    this.ground.putTileAt(ground, tx, ty);
    this.objects.putTileAt(object, tx, ty);
    // the roof ridge overhangs the row above the footprint (drawn over agents)
    if ((t.kind === 'house' || t.kind === 'barracks') && (t.part ?? 0) < BUILDING_W) {
      const b = BUILDING[t.kind];
      this.roofs.putTileAt(GID.town + b.ridge[t.part ?? 0], tx, ty - 1);
    }
  }

  // ---- sprites -------------------------------------------------------------

  private syncSprites(): void {
    const seen = new Set<number>();
    for (const ag of this.scene.agents) {
      const m = ag as Mover;
      seen.add(m.id);
      let sp = this.sprites.get(m.id);
      if (!sp) {
        const c = charFor(m);
        sp = this.scene.add.sprite(m.x, m.y, c.key, c.frame).setOrigin(0.5, 0.75).setDepth(DEPTH.agents);
        sp.setData('agent', m);
        if (!(m instanceof Bolt)) sp.setInteractive({ useHandCursor: true });
        sp.on('pointerdown', () => this.scene.select(m));
        sp.on('pointerover', () => this.scene.hoverAgent(m));
        sp.on('pointerout', () => this.scene.hoverAgent(null));
        this.sprites.set(m.id, sp);
      }
      // role can change (kid -> adult), so re-check the frame cheaply
      const c = charFor(m);
      if (sp.texture.key !== c.key || (c.key !== 'px' && sp.frame.name !== String(c.frame))) sp.setTexture(c.key, c.frame);
      const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
      const hurt = m.hp < m.maxHp * 0.4;
      const bob = moving ? Math.abs(Math.sin(this.t * (hurt ? 9 : 14) + m.id)) * 1.5 : 0;
      const a = this.fx.anims.get(m.id);
      const base = m instanceof Villager && m.role === 'kid' ? 0.7 : m instanceof Raider ? ENEMY_SCALE[m.kind] : m instanceof Bolt ? 3 : 1;
      sp.setPosition(Math.round(m.x + (a?.ox ?? 0)), Math.round(m.y - bob + (a?.oy ?? 0)));
      sp.setFlipX(m.dir < 0);
      sp.setVisible(!m.hidden);
      sp.setScale(base * (a?.sx ?? 1), base * (a?.sy ?? 1));
      sp.setRotation(a?.rot ?? 0);
      sp.setDepth(DEPTH.agents + m.y / 1000);
      if (m.hurtT < 0.15) sp.setTintFill(0xffffff);
      else if (m instanceof Raider) sp.setTint(m.boss ? 0xff6a6a : m.kind === 'brute' ? 0xb07070 : 0xffd0d0);
      else if (m instanceof Bolt) sp.setTint(0xb46bff);
      else if (hurt) sp.setTint(0xffb0a0);
      else sp.clearTint();
    }
    for (const [id, sp] of this.sprites) if (!seen.has(id)) { this.sprites.delete(id); this.fx.die(sp, sp.getData('agent') as Mover); }
  }

  /** Screen-space centre of an agent's sprite (for DOM tooltips). */
  screenPos(m: Mover): { x: number; y: number } {
    const cam = this.scene.cameras.main;
    const z = this.scene.scale.displayScale;
    const canvas = this.scene.game.canvas.getBoundingClientRect();
    return {
      x: canvas.left + ((m.x - cam.scrollX) * cam.zoom) / z.x,
      y: canvas.top + ((m.y - 12 - cam.scrollY) * cam.zoom) / z.y,
    };
  }

  // ---- overlays ------------------------------------------------------------

  private drawOverlays(): void {
    const s = this.scene;
    const u = this.under;
    u.clear();
    // faced-tile cursor; in build mode a 2x2 footprint preview, red when blocked
    const f = s.player.faced;
    if (s.world.inBounds(f.tx, f.ty)) {
      const build = s.player.build !== 'none';
      if (build) {
        const a = s.buildAnchor();
        const ok = !s.buildProblem(a);
        u.fillStyle(ok ? 0xffe066 : 0xff4040, 0.18);
        u.fillRect(a.tx * TILE, a.ty * TILE, TILE * BUILDING_W, TILE * BUILDING_H);
        u.lineStyle(1, ok ? 0xffe066 : 0xff4040, 0.9);
        u.strokeRect(a.tx * TILE + 0.5, a.ty * TILE + 0.5, TILE * BUILDING_W - 1, TILE * BUILDING_H - 1);
      } else {
        u.lineStyle(1, 0xffffff, 0.5);
        u.strokeRect(f.tx * TILE + 0.5, f.ty * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }
    // selection ring
    if (s.selected && !s.selected.dead) {
      u.lineStyle(1, 0xffe066, 1);
      u.strokeEllipse(s.selected.x, s.selected.y + 1, 12, 6);
    }
    // hp bars
    const b = this.bars;
    b.clear();
    for (const a of s.agents) {
      const m = a as Mover;
      if (m.hidden || m.hp >= m.maxHp) continue;
      const big = m instanceof Raider && m.boss;
      const bw = big ? 20 : 10, x = Math.round(m.x - bw / 2), y = Math.round(m.y - (big ? 20 : 14));
      b.fillStyle(0x000000, 0.7); b.fillRect(x - 1, y - 1, bw + 2, 3);
      b.fillStyle(m.hp / m.maxHp > 0.4 ? 0x5fdc5f : 0xff4040, 1); b.fillRect(x, y, Math.max(1, Math.round(bw * m.hp / m.maxHp)), 1);
    }
    // day/night: darkest at dayTime 0, clear at 0.5
    const nightness = Math.max(0, -Math.cos((s.dayTime - 0.5) * Math.PI * 2));
    this.night.setAlpha(nightness * 0.55);
  }
}

/** Ground + object gids for a tile. */
function tileFrames(t: Tile, cropDays: number): { ground: number; object: number } {
  const grass = GID.town + TOWN.grass[t.v % TOWN.grass.length];
  switch (t.kind) {
    case 'grass': return { ground: grass, object: EMPTY };
    case 'tree':
      // half-chopped trees show as a bare trunk
      return { ground: grass, object: t.work >= 2 ? GID.farm + FARM.bareTree : GID.town + TOWN.trees[t.v % TOWN.trees.length] };
    case 'tilled': return { ground: GID.farm + FARM.tilled, object: EMPTY };
    case 'crop': {
      const f = t.stage >= cropDays ? 3 : Math.min(2, Math.floor((t.stage / cropDays) * 3));
      return { ground: GID.farm + FARM.tilled, object: GID.farm + FARM.crop[f] };
    }
    case 'house':
    case 'barracks': return { ground: grass, object: GID.town + BUILDING[t.kind].parts[t.part ?? 0] };
  }
}

const ENEMY_SCALE: Record<string, number> = { raider: 1, warlord: 1.5, rat: 0.8, snatcher: 0.9, brute: 1.3, shaman: 1 };

function charFor(m: Mover): { key: string; frame: number } {
  if (m instanceof Player) return CHAR.player;
  if (m instanceof Bolt) return { key: 'px', frame: 0 };
  if (m instanceof Raider) return CHAR[m.kind];
  if (m instanceof Villager) return CHAR[m.role];
  return CHAR.kid;
}
