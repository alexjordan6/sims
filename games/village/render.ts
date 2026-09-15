import Phaser from 'phaser';
import { World, BUILDINGS, yardOf, type Tile, type Building, type BuildingKind } from './world';
import { Mover, Villager, Raider, Player } from './agents';
import { Bolt } from './enemies';
import { TOWN, FARM, CHAR } from './atlas';
import { TILE, COLS, ROWS, CAPS } from './config';
import type { VillageScene } from './main';
import { Fx } from './fx';
import { ensureLogPiles, ensureCabin, ensureLogStack, STACK_ROWS } from './pixelart';

import townUrl from './assets/town.png';
import farmUrl from './assets/farm.png';
import dungeonUrl from './assets/dungeon.png';

// Tileset first-gids inside the one tilemap (0 is reserved for "no tile" by using 1-based gids).
const GID = { town: 1, farm: 1 + 132, dungeon: 1 + 264 } as const;
const EMPTY = -1;

/**
 * Building art per kind: `ridge` is the overhanging roof row drawn above the footprint (over agents),
 * `parts` the footprint row-major. Gids are relative to the town sheet unless wrapped by farm().
 * Level markers replace the ridge's end tiles: Lv2 adds a chimney, Lv3 a gable peak beside it.
 */
const farm = (f: number) => GID.farm - GID.town + f; // express a farm-sheet frame as a town-relative gid
const BUILDING: Record<BuildingKind, { ridge: readonly number[]; parts: readonly number[]; chimney: number; peak: number }> = {
  house: {
    ridge: [52, 53, 53, 54],
    parts: [
      64, 65, 65, 66,
      64, 65, 65, 66,
      72, 84, 84, 75, // wall edges with two windows
      72, TOWN.wallWoodDoor, 73, 75, // door, plain wall
    ],
    chimney: 55, peak: 63,
  },
  barracks: {
    ridge: [48, 49, 49, 50],
    parts: [
      60, 61, 61, 62,
      60, 61, 61, 62,
      76, 88, 88, 79,
      76, TOWN.wallStoneDoor, 77, 79,
    ],
    chimney: 51, peak: 67,
  },
  // red barn from the farm sheet: X-braced doors on top, plank walls below
  granary: {
    ridge: [farm(90), farm(91), farm(92)],
    parts: [
      farm(102), farm(103), farm(104),
      farm(114), farm(115), farm(116),
    ],
    chimney: farm(96), peak: farm(97), // hay bale, then a grain barrel on the roofline
  },
  // the woodyard is drawn as sprites (a cabin and a log stack, see paintYards); its tiles stay bare
  woodyard: {
    ridge: [EMPTY, EMPTY, EMPTY],
    parts: [
      EMPTY, EMPTY, EMPTY,
      EMPTY, EMPTY, EMPTY,
    ],
    chimney: EMPTY, peak: EMPTY,
  },
};
/** Granary yard stock, by tier: crate, hay bale, grain barrel (farm-sheet frames). */
const GRANARY_STOCK = [FARM.crate, FARM.hayBale, 97] as const;

export const DEPTH = { ground: 0, objects: 1, under: 5, agents: 10, roofs: 20, bars: 30, night: 40, arrows: 50 } as const;

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
  /** stock shown at a supply building: 3 yard slots (granary) or the cabin + growing log stack (woodyard) */
  private yards = new Map<Building, Phaser.GameObjects.Image[]>();
  private under: Phaser.GameObjects.Graphics;
  private bars: Phaser.GameObjects.Graphics;
  private night: Phaser.GameObjects.Rectangle;
  /** screen-space arrows toward off-screen raiders */
  private arrows: Phaser.GameObjects.Graphics;
  /** set on frames where tiles were repainted (the minimap redraws its terrain then) */
  tilesChanged = false;
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
    this.arrows = scene.add.graphics().setDepth(DEPTH.arrows).setScrollFactor(0);
    this.fx = new Fx(scene);
    ensureLogPiles(scene);
    ensureCabin(scene);
    ensureLogStack(scene);
  }

  /** Redraw every tile and drop all sprites (after a reset). */
  rebuild(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.fx.clear();
    for (const imgs of this.yards.values()) imgs.forEach((i) => i.destroy());
    this.yards.clear();
    this.roofs.fill(EMPTY);
    const w = this.scene.world;
    for (let i = 0; i < w.tiles.length; i++) w.dirty.add(i);
    this.drainDirty();
  }

  /** Per-frame: patch changed tiles, sync sprites, overlays. */
  sync(dt: number): void {
    this.t += dt;
    this.paintYards();
    this.drainDirty();
    this.syncSprites();
    for (const ev of this.scene.fx) this.fx.handle(ev, this.sprites);
    this.scene.fx.length = 0;
    this.fx.update(dt, this.sprites);
    this.drawOverlays();
    this.drawRaidArrows();
  }

  // ---- tiles ---------------------------------------------------------------

  /**
   * The stockpile shows in the world. Granary: the yard in front fills slot by slot (each slot
   * growing through crate → hay → barrel). Woodyard: a plank cabin on the left two tiles and, on
   * the right, a stack of logs that climbs one row at a time as wood comes in.
   */
  private paintYards(): void {
    const s = this.scene;
    for (const b of s.world.buildings) {
      if (b.kind === 'granary') this.paintGranaryYard(b);
      else if (b.kind === 'woodyard') this.paintWoodyard(b);
    }
  }

  private paintGranaryYard(b: Building): void {
    const s = this.scene;
    let imgs = this.yards.get(b);
    if (!imgs) {
      imgs = yardOf(b).map((q) => s.add.image((q.tx + 0.5) * TILE, (q.ty + 1) * TILE - 1, 'farm', GRANARY_STOCK[0]).setOrigin(0.5, 1).setDepth(DEPTH.objects + 1).setVisible(false));
      this.yards.set(b, imgs);
    }
    const units = s.food <= 0 ? 0 : Math.min(9, Math.max(1, Math.ceil((s.food / CAPS[b.level]) * 9)));
    for (let i = 0; i < 3; i++) {
      const tier = Math.max(0, Math.min(3, units - i * 3));
      imgs[i].setVisible(tier > 0);
      if (tier > 0) imgs[i].setTexture('farm', GRANARY_STOCK[tier - 1]);
    }
  }

  private paintWoodyard(b: Building): void {
    const s = this.scene;
    const f = BUILDINGS[b.kind];
    let imgs = this.yards.get(b);
    if (!imgs) {
      imgs = [
        // cabin: 2 tiles wide, 3 tall including the roof, which overhangs the row above the footprint
        s.add.image(b.tx * TILE, (b.ty - 1) * TILE, 'cabin', 0).setOrigin(0, 0).setDepth(DEPTH.objects + 1),
        // log stack in the third column, standing on the footprint's bottom edge
        s.add.image((b.tx + 2) * TILE, (b.ty + f.h) * TILE - 1, 'logstack', 0).setOrigin(0, 1).setDepth(DEPTH.objects + 1),
      ];
      this.yards.set(b, imgs);
    }
    imgs[0].setFrame(Math.min(2, b.level - 1));
    const rows = s.wood <= 0 ? 0 : Math.min(STACK_ROWS, Math.max(1, Math.ceil((s.wood / CAPS[b.level]) * STACK_ROWS)));
    imgs[1].setFrame(rows);
  }

  private drainDirty(): void {
    const w = this.scene.world;
    this.tilesChanged = w.dirty.size > 0;
    if (w.dirty.size === 0) return;
    for (const i of w.dirty) this.paintTile(w, i % w.cols, (i / w.cols) | 0);
    w.dirty.clear();
  }

  private paintTile(w: World, tx: number, ty: number): void {
    const t = w.get(tx, ty)!;
    const { ground, object } = tileFrames(t, this.scene.cropDays);
    this.ground.putTileAt(ground, tx, ty);
    this.objects.putTileAt(object, tx, ty);
    // the roof ridge overhangs the row above the footprint (drawn over agents); level markers sit on it
    const b = t.building;
    if (b && (t.part ?? 0) < BUILDINGS[b.kind].w) {
      const art = BUILDING[b.kind];
      const col = t.part ?? 0, last = BUILDINGS[b.kind].w - 1;
      let frame = art.ridge[col];
      if (b.level >= 2 && col === last) frame = art.chimney;
      if (b.level >= 3 && col === 0) frame = art.peak;
      this.roofs.putTileAt(frame === EMPTY ? EMPTY : GID.town + frame, tx, ty - 1);
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
        // selection is handled by the scene's pointerdown (right click on desktop, tap on touch)
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

  /**
   * During a raid, a red arrow sits on the edge of the view for every raider that's off screen,
   * pointing along the line from the view centre to it (the boss gets a big gold one).
   */
  private drawRaidArrows(): void {
    const g = this.arrows;
    g.clear();
    const s = this.scene;
    if (!s.raidActive) return;
    const cam = s.cameras.main;
    const view = cam.worldView;
    const cx = view.centerX, cy = view.centerY;
    // scrollFactor(0) objects are still scaled by the zoom around the screen centre, so work
    // in zoom-divided units from the centre
    const zoom = cam.zoom;
    const sw = cam.width, sh = cam.height;
    const pad = 14;
    for (const a of s.agents) {
      if (!(a instanceof Raider) || a.dead) continue;
      const inside = a.x > view.x - 4 && a.x < view.right + 4 && a.y > view.y - 4 && a.y < view.bottom + 4;
      if (inside) continue;
      const dx = a.x - cx, dy = a.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // where the ray from the screen centre leaves the (padded) screen rectangle
      const hw = (sw / 2 - pad) / zoom, hh = (sh / 2 - pad) / zoom;
      const t = Math.min(hw / Math.abs(ux || 1e-6), hh / Math.abs(uy || 1e-6));
      const px = sw / 2 + ux * t, py = sh / 2 + uy * t;
      const size = (a.boss ? 11 : 7) / zoom;
      const colour = a.boss ? 0xffcc33 : 0xff4a3d;
      const ang = Math.atan2(uy, ux);
      const tip = { x: px + Math.cos(ang) * size, y: py + Math.sin(ang) * size };
      const l = { x: px + Math.cos(ang + 2.4) * size, y: py + Math.sin(ang + 2.4) * size };
      const r = { x: px + Math.cos(ang - 2.4) * size, y: py + Math.sin(ang - 2.4) * size };
      g.fillStyle(0x000000, 0.5);
      g.fillTriangle(tip.x + 1, tip.y + 1, l.x + 1, l.y + 1, r.x + 1, r.y + 1);
      g.fillStyle(colour, 0.95);
      g.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
    }
  }

  private drawOverlays(): void {
    const s = this.scene;
    const u = this.under;
    u.clear();
    // faced-tile cursor; in build mode a 2x2 footprint preview, red when blocked
    const f = s.player.faced;
    if (s.world.inBounds(f.tx, f.ty)) {
      const build = s.player.build !== 'none';
      if (build) {
        const kind = s.player.build as BuildingKind;
        const { w, h } = BUILDINGS[kind];
        const a = s.buildAnchor(kind);
        const ok = !s.buildProblem(a, kind);
        u.fillStyle(ok ? 0xffe066 : 0xff4040, 0.18);
        u.fillRect(a.tx * TILE, a.ty * TILE, TILE * w, TILE * h);
        u.lineStyle(1, ok ? 0xffe066 : 0xff4040, 0.9);
        u.strokeRect(a.tx * TILE + 0.5, a.ty * TILE + 0.5, TILE * w - 1, TILE * h - 1);
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
    case 'sapling': return { ground: grass, object: t.stage < 2 ? GID.farm + FARM.bareTree : GID.town + TOWN.trees[3] };
    case 'house':
    case 'barracks':
    case 'granary':
    case 'woodyard': {
      const part = BUILDING[t.kind].parts[t.part ?? 0];
      return { ground: grass, object: part === EMPTY ? EMPTY : GID.town + part };
    }
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
