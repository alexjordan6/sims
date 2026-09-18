import Phaser from 'phaser';
import { World, BUILDINGS, doorstep, type Tile, type Building, type BuildingKind } from './world';
import { Mover, Villager, Raider, Player, Arrow } from './agents';
import { Bolt } from './enemies';
import { TOWN, CHAR } from './atlas';
import { ensureCharacter, seedLook, type Look } from './characters';
import { TILE, COLS, ROWS, CAPS, WALL_HEIGHT } from './config';
import type { VillageScene } from './main';
import { Fx } from './fx';
import { ensureBuildingArt, ensureFlora, FLORA, BUILDING_TEXTURE, LIT_TEXTURE, STACK_ROWS } from './pixelart';
import { Night } from './night';

import townUrl from './assets/town.png';
import farmUrl from './assets/farm.png';
import dungeonUrl from './assets/dungeon.png';

// Tileset first-gids inside the one tilemap (0 is reserved for "no tile" by using 1-based gids).
const GID = { town: 1, farm: 1 + 132, dungeon: 1 + 264, flora: 1 + 396 } as const;
const EMPTY = -1;

export const DEPTH = { ground: 0, objects: 1, under: 5, agents: 10, bars: 30, arrows: 50 } as const; // night wash lives at 40-42 (night.ts)

/** Load the three spritesheets. Call from the scene's preload(). */
export function preloadArt(scene: Phaser.Scene): void {
  scene.load.spritesheet('town', townUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.spritesheet('farm', farmUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.spritesheet('dungeon', dungeonUrl, { frameWidth: 16, frameHeight: 16 });
}

/**
 * Draws the world: two tilemap layers (ground / objects), buildings as hand-drawn sprites, one sprite per agent,
 * HP bars, the faced-tile cursor, selection ring and the day/night tint.
 */
export class Renderer {
  private ground!: Phaser.Tilemaps.TilemapLayer;
  private objects!: Phaser.Tilemaps.TilemapLayer;
  /** crown-tops of tall trees, painted into the tile above the trunk */
  private canopy!: Phaser.Tilemaps.TilemapLayer;
  private cropT = 0;
  private sprites = new Map<number, Phaser.GameObjects.Sprite>();
  private forts = new Map<number, Phaser.GameObjects.Image>();
  private bows = new Map<number, Phaser.GameObjects.Image>();
  /** each building's sprite (frame = level - 1) and, for the supply buildings, its climbing stock column */
  private buildings = new Map<Building, { body: Phaser.GameObjects.Image; lit: Phaser.GameObjects.Image; stock?: Phaser.GameObjects.Image; banner?: Phaser.GameObjects.Image }>();
  /** the sky's tint, multiplied into tiles and sprites; tiles repaint only when it changes */
  private tint = 0xffffff;
  private tileTint = 0xffffff;
  private under: Phaser.GameObjects.Graphics;
  private bars: Phaser.GameObjects.Graphics;
  private night: Night;
  /** screen-space arrows toward off-screen raiders */
  private arrows: Phaser.GameObjects.Graphics;
  /** set on frames where tiles were repainted (the minimap redraws its terrain then) */
  tilesChanged = false;
  private t = 0;
  readonly fx: Fx;

  constructor(private scene: VillageScene) {
    ensureFlora(scene); // the drawn tileset has to exist before the map references it
    const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: COLS, height: ROWS });
    const town = map.addTilesetImage('town', 'town', TILE, TILE, 0, 0, GID.town)!;
    const farm = map.addTilesetImage('farm', 'farm', TILE, TILE, 0, 0, GID.farm)!;
    const dungeon = map.addTilesetImage('dungeon', 'dungeon', TILE, TILE, 0, 0, GID.dungeon)!;
    const flora = map.addTilesetImage('flora', 'flora', TILE, TILE, 0, 0, GID.flora)!;
    const sets = [town, farm, dungeon, flora];
    this.ground = map.createBlankLayer('ground', sets)!.setDepth(DEPTH.ground);
    this.objects = map.createBlankLayer('objects', sets)!.setDepth(DEPTH.objects);
    this.canopy = map.createBlankLayer('canopy', sets)!.setDepth(DEPTH.objects + 0.5);
    this.under = scene.add.graphics().setDepth(DEPTH.under);
    this.bars = scene.add.graphics().setDepth(DEPTH.bars);
    this.arrows = scene.add.graphics().setDepth(DEPTH.arrows).setScrollFactor(0);
    this.fx = new Fx(scene);
    ensureBuildingArt(scene);
    this.night = new Night(scene); // after Fx, which makes the 'px' texture
  }

  /** Redraw every tile and drop all sprites (after a reset). */
  rebuild(): void {
    for (const sp of this.forts.values()) sp.destroy(); this.forts.clear();
    for (const sp of this.bows.values()) sp.destroy(); this.bows.clear();
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.fx.clear();
    for (const b of this.buildings.values()) { b.body.destroy(); b.lit.destroy(); b.stock?.destroy(); b.banner?.destroy(); }
    this.buildings.clear();
    const w = this.scene.world;
    for (let i = 0; i < w.tiles.length; i++) w.dirty.add(i);
    this.drainDirty();
  }

  /** Per-frame: patch changed tiles, sync sprites, overlays. */
  sync(dt: number): void {
    this.t += dt;
    this.tint = this.night.sky.tint;
    this.paintBuildings();
    this.paintDefenses();
    this.growCrops(dt);
    this.drainDirty();
    this.tintTiles();
    this.syncSprites();
    for (const ev of this.scene.fx) {
      if (ev.kind === 'upgrade') { this.upgradePop(ev.building); continue; }
      if (ev.kind === 'hearts') { this.fx.hearts(ev.who.x, ev.who.y - 10); continue; }
      this.fx.handle(ev, this.sprites);
    }
    this.scene.fx.length = 0;
    this.fx.update(dt, this.sprites);
    this.drawOverlays();
    this.night.update(dt, this.buildings);
    this.drawRaidArrows();
  }

  // ---- tiles ---------------------------------------------------------------

  private paintDefenses(): void {
    const s = this.scene;
    for (const [id, d] of s.world.defenses) {
      let sp = this.forts.get(id);
      if (!sp) { sp = s.add.image(d.tx * TILE, (d.ty + 1) * TILE, 'fort', 0).setOrigin(0, 1); this.forts.set(id, sp); }
      const friendly = d.kind === 'gate' && s.agents.some(a => a instanceof Mover && !a.hostile && !a.elevated && !a.hidden && a.dist(World.center(d.tx, d.ty)) < 19);
      sp.setFrame(d.kind === 'stairs' ? 3 : d.kind === 'gate' ? d.open || friendly ? 2 : 1 : 0).setTint(s.posting ? 0x99dcff : this.tint);
      sp.setDepth(DEPTH.agents + ((d.ty + 1) * TILE) / 1000);
      sp.setAlpha(s.player.elevated ? 1 : s.player.y < (d.ty + 1) * TILE && s.player.y > (d.ty + 1) * TILE - WALL_HEIGHT && Math.abs(s.player.x - (d.tx + 0.5) * TILE) < 20 ? 0.5 : 1);
    }
    for (const [id, sp] of this.forts) if (!s.world.defenses.has(id)) { sp.destroy(); this.forts.delete(id); }
  }

  /**
   * Buildings are sprites drawn in one hand-made style; the frame is the level, so upgrades
   * change the building itself (chimneys, storeys, shields, a silo…). The supply buildings
   * carry a stock column beside them — logs at the woodyard, produce crates at the granary —
   * that climbs one row per ninth of the cap stored. Depth sorts with agents by the bottom edge.
   */
  private paintBuildings(): void {
    const s = this.scene;
    for (const b of s.world.buildings) {
      const f = BUILDINGS[b.kind];
      let e = this.buildings.get(b);
      if (!e) {
        const bottom = (b.ty + f.h) * TILE;
        const depth = DEPTH.agents + bottom / 1000 - 0.0005;
        e = {
          body: s.add.image(b.tx * TILE, (b.ty - 1) * TILE, BUILDING_TEXTURE[b.kind], 0).setOrigin(0, 0).setDepth(depth),
          lit: s.add.image(b.tx * TILE, (b.ty - 1) * TILE, LIT_TEXTURE[b.kind], 0).setOrigin(0, 0).setDepth(depth + 0.00005).setAlpha(0),
        };
        if (b.kind === 'granary' || b.kind === 'woodyard') {
          e.stock = s.add.image((b.tx + 2) * TILE, bottom - 1, b.kind === 'granary' ? 'cratestack' : 'logstack', 0).setOrigin(0, 1).setDepth(depth);
        }
        this.buildings.set(b, e);
      }
      e.body.setFrame(Math.min(2, b.level - 1)).setTint(this.tint);
      // the windows come on as night falls; they are never tinted
      e.lit.setFrame(Math.min(2, b.level - 1)).setAlpha(this.night.sky.night);
      e.stock?.setTint(this.tint);
      e.banner?.setTint(this.tint);
      // a house flies a banner for its calling: blue for the barracks, tan for the woodyard (farmers, the default, fly none)
      if (b.kind === 'house') {
        const calling = b.calling ?? 'farmer';
        if (calling !== 'farmer' && !e.banner) e.banner = s.add.image(e.body.x + 54, e.body.y + 6, 'banner').setOrigin(0, 0).setDepth(e.body.depth + 0.0001);
        else if (calling === 'farmer' && e.banner) { e.banner.destroy(); e.banner = undefined; }
        e.banner?.setTint(mulColor(calling === 'woodcutter' ? 0xd8b070 : 0xffffff, this.tint));
      }
      if (e.stock) {
        const amount = b.kind === 'granary' ? s.food : s.wood;
        const rows = amount <= 0 ? 0 : Math.min(STACK_ROWS, Math.max(1, Math.ceil((amount / CAPS[b.level]) * STACK_ROWS)));
        e.stock.setFrame(rows);
      }
    }
  }

  /** An upgrade lands: the building pops and a cloud puffs out of its door. */
  private upgradePop(b: Building): void {
    const e = this.buildings.get(b);
    if (!e) return;
    const body = e.body;
    body.setOrigin(0.5, 1).setPosition(body.x + body.width / 2, body.y + body.height);
    this.scene.tweens.add({
      targets: body, scaleX: 1.12, scaleY: 1.12, duration: 110, yoyo: true, ease: 'Quad.Out',
      onComplete: () => body.setOrigin(0, 0).setPosition(body.x - body.width / 2, body.y - body.height),
    });
    const d = doorstep(b);
    this.fx.celebrate((d.tx + 0.5) * TILE, d.ty * TILE);
  }

  /** Tiles carry the sky tint too (foliage goes cool at night); repainted only when it changes. */
  private tintTiles(): void {
    // quantise so steady day/night never repaints and transitions repaint a handful of times
    const q = ((this.tint >> 16) & 0xf0) << 16 | ((this.tint >> 8) & 0xf0) << 8 | (this.tint & 0xf0);
    if (q === this.tileTint) return;
    this.tileTint = q;
    const c = q === 0xf0f0f0 ? 0xffffff : q;
    this.ground.forEachTile((t) => { t.tint = c; });
    this.objects.forEachTile((t) => { t.tint = c; });
    this.canopy.forEachTile((t) => { t.tint = c; });
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
    const { ground, object, canopy } = tileFrames(t, this.scene.cropDays, this.scene.dayTime, this.scene.oldGrowthDays);
    this.ground.putTileAt(ground, tx, ty);
    this.objects.putTileAt(object, tx, ty);
    // a tall tree's crown-top lives in the tile above; anything else clears it
    if (ty > 0) this.canopy.putTileAt(canopy ?? EMPTY, tx, ty - 1);
  }

  /** Crops grow through the day, not just at midnight: repaint the ones whose phase moved. */
  private growCrops(dt: number): void {
    this.cropT += dt;
    if (this.cropT < 0.5) return;
    this.cropT = 0;
    const w = this.scene.world;
    for (const q of w.find((t) => t.kind === 'crop')) {
      const t = w.get(q.tx, q.ty)!;
      const phase = cropPhase(t, this.scene.cropDays, this.scene.dayTime);
      const shown = this.objects.getTileAt(q.tx, q.ty)?.index ?? EMPTY;
      const want = GID.flora + (t.v % 2 ? FLORA.crop2 : FLORA.crop)[phase];
      if (shown !== want) w.markDirty(q.tx, q.ty);
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
        if (!(m instanceof Bolt) && !(m instanceof Arrow)) sp.setInteractive({ useHandCursor: true });
        // selection is handled by the scene's pointerdown (right click on desktop, tap on touch)
        sp.on('pointerover', () => this.scene.hoverAgent(m));
        sp.on('pointerout', () => this.scene.hoverAgent(null));
        this.sprites.set(m.id, sp);
      }
      // looks change (kid -> adult, armor, dye), so re-check the texture cheaply; people get a two-frame gait
      const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
      const look = lookFor(m);
      const c = look ? { key: ensureCharacter(this.scene, look), frame: moving && Math.floor(this.t / 0.18 + m.id) % 2 === 1 ? 1 : 0 } : charFor(m);
      if (sp.texture.key !== c.key || (c.key !== 'px' && sp.frame.name !== String(c.frame))) sp.setTexture(c.key, c.frame);
      const hurt = m.hp < m.maxHp * 0.4;
      const bob = moving ? Math.abs(Math.sin(this.t * (hurt ? 9 : 14) + m.id)) * 1.5 : 0;
      const a = this.fx.anims.get(m.id);
      const base = m instanceof Villager && m.role === 'kid' ? 0.85 : m instanceof Raider ? ENEMY_SCALE[m.kind] : m instanceof Bolt ? 3 : 1;
      const height = m instanceof Arrow ? (m.elevated ? WALL_HEIGHT * Math.max(0, 1 - m.travelled / m.dropDistance) : 0) : m.elevated ? WALL_HEIGHT : 0;
      sp.setPosition(Math.round(m.x + (a?.ox ?? 0)), Math.round(m.y - height - bob + (a?.oy ?? 0)));
      sp.setFlipX(m.dir < 0);
      sp.setVisible(!m.hidden);
      sp.setScale(base * (a?.sx ?? 1), base * (a?.sy ?? 1));
      sp.setRotation(a?.rot ?? 0);
      sp.setDepth(DEPTH.agents + m.y / 1000);
      if (m.elevated) sp.setDepth(DEPTH.agents + (m.y + TILE) / 1000 + 0.001);
      if (m instanceof Arrow) sp.setRotation(Math.atan2(m.uy, m.ux)).setFlipX(false);
      const armed = (m instanceof Villager && m.role === 'soldier' && m.weapon === 'bow') || (m instanceof Player && m.tool === 'bow');
      let bow = this.bows.get(m.id);
      if (armed && !bow) { bow = this.scene.add.image(0, 0, 'bow'); this.bows.set(m.id, bow); }
      bow?.setPosition(sp.x + m.aim.x * 7, sp.y - 3 + m.aim.y * 7).setRotation(Math.atan2(m.aim.y, m.aim.x)).setScale(1, m.attackCd > 0.45 ? 0.8 : 1).setDepth(sp.depth + 0.01).setVisible(armed && !m.hidden).setTint(this.tint);
      if (m.hurtT < 0.15 && !m.blocked) sp.setTintFill(0xffffff);
      else if (m instanceof Raider) sp.setTint(mulColor(m.boss ? 0xff6a6a : m.kind === 'brute' ? 0xb07070 : 0xffd0d0, this.tint));
      else if (m instanceof Bolt) sp.setTint(0xb46bff);
      else if (hurt) sp.setTint(mulColor(0xffb0a0, this.tint));
      else sp.setTint(this.tint);
    }
    for (const [id, sp] of this.sprites) if (!seen.has(id)) { this.sprites.delete(id); this.fx.die(sp, sp.getData('agent') as Mover); }
    for (const [id, sp] of this.bows) if (!seen.has(id)) { sp.destroy(); this.bows.delete(id); }
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
    if (['wall', 'gate', 'stairs'].includes(s.player.tool)) {
      const q = s.defenseTarget();
      u.lineStyle(2, 0xffd578, 1); u.strokeRect(q.tx * TILE, q.ty * TILE, TILE, TILE);
      u.lineStyle(1, 0xffd578, 0.45); u.strokeRect(q.tx * TILE, q.ty * TILE - WALL_HEIGHT, TILE, TILE);
    }
    if (s.posting) {
      for (const d of s.world.defenses.values()) { u.fillStyle(0x78d8f0, 0.5); u.fillRect(d.tx * TILE + 2, d.ty * TILE - WALL_HEIGHT + 2, 12, 12); }
    }
    // target-tile cursor; in build mode the footprint preview, red when blocked
    const f = s.target;
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
        // the door tile, and a guide line from the player when the footprint sits ahead of them
        const dx = (a.tx + BUILDINGS[kind].door) * TILE, dy = (a.ty + h - 1) * TILE;
        u.fillStyle(ok ? 0xffe066 : 0xff4040, 0.5);
        u.fillRect(dx + 4, dy + 8, TILE - 8, TILE - 8);
        if (!s.cursorPlacing) {
          u.lineStyle(1, 0xffffff, 0.35);
          u.lineBetween(s.player.x, s.player.y, (a.tx + w / 2) * TILE, (a.ty + h / 2) * TILE);
        }
      } else {
        // gold when the held tool can act here ("E: …"), white otherwise; a dim box marks an out-of-reach hover
        const can = s.hint().startsWith('E:');
        u.lineStyle(2, can ? 0xffe066 : 0xffffff, can ? 0.95 : 0.55);
        u.strokeRect(f.tx * TILE + 1, f.ty * TILE + 1, TILE - 2, TILE - 2);
        const hv = s.hoverTile;
        if (hv && !s.cursorAiming && s.world.inBounds(hv.tx, hv.ty)) {
          u.lineStyle(1, 0xffffff, 0.2);
          u.strokeRect(hv.tx * TILE + 0.5, hv.ty * TILE + 0.5, TILE - 1, TILE - 1);
        }
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
      const bw = big ? 20 : 10, x = Math.round(m.x - bw / 2), y = Math.round(m.y - (m.elevated ? WALL_HEIGHT : 0) - (big ? 20 : 14));
      b.fillStyle(0x000000, 0.7); b.fillRect(x - 1, y - 1, bw + 2, 3);
      b.fillStyle(m.hp / m.maxHp > 0.4 ? 0x5fdc5f : 0xff4040, 1); b.fillRect(x, y, Math.max(1, Math.round(bw * m.hp / m.maxHp)), 1);
    }
    for (const d of s.world.defenses.values()) if (d.hp < d.maxHp) {
      b.fillStyle(0x1a1a25); b.fillRect(d.tx * TILE, d.ty * TILE - WALL_HEIGHT - 3, 16, 3);
      b.fillStyle(0xeab765); b.fillRect(d.tx * TILE, d.ty * TILE - WALL_HEIGHT - 3, 16 * d.hp / d.maxHp, 2);
    }
  }
}

/** Multiply two 0xRRGGBB colours channel by channel. */
function mulColor(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255, g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255, bl = ((a & 255) * (b & 255)) / 255;
  return (r << 16) | (g << 8) | bl;
}

/** Which of the five crop frames to show: growth runs continuously through the day. */
function cropPhase(t: Tile, cropDays: number, dayTime: number): number {
  if (t.stage >= cropDays) return 4;
  const g = (t.stage + Math.max(0, Math.min(1, (dayTime - 0.25) / 0.75))) / cropDays; // the day's growth happens from dawn on
  return Math.min(3, Math.floor(g * 4));
}

/** Ground + object gids for a tile (and the crown-top for the tile above, for tall trees). */
function tileFrames(t: Tile, cropDays: number, dayTime: number, oldDays: number): { ground: number; object: number; canopy?: number } {
  const grass = GID.town + TOWN.grass[t.v % TOWN.grass.length];
  const F = GID.flora;
  switch (t.kind) {
    case 'grass': return { ground: grass, object: EMPTY };
    case 'tree': {
      if (t.work >= 2) return { ground: grass, object: F + FLORA.bare };
      const old = t.stage >= oldDays;
      if (!old) return { ground: grass, object: F + (t.work === 1 ? FLORA.youngChopped : FLORA.young[t.v % 3]) };
      const pine = t.v % 3 === 1;
      return { ground: grass, object: F + (t.work === 1 ? FLORA.oakChopped : pine ? FLORA.pineTrunk : FLORA.oakTrunk), canopy: F + (pine ? FLORA.pineTop : FLORA.oakTop) };
    }
    case 'tilled': return { ground: F + FLORA.tilled, object: EMPTY };
    case 'crop': return { ground: F + FLORA.tilled, object: F + (t.v % 2 ? FLORA.crop2 : FLORA.crop)[cropPhase(t, cropDays, dayTime)] };
    case 'sapling': return { ground: grass, object: F + (t.stage < 2 ? FLORA.stump : t.stage === 2 ? FLORA.sprout : FLORA.sapling) };
    case 'house':
    case 'barracks':
    case 'granary':
    case 'woodyard': case 'tavern': case 'wall': case 'gate': case 'stairs': return { ground: grass, object: EMPTY }; // the building sprite sits on top
  }
}

const ENEMY_SCALE: Record<string, number> = { raider: 1, warlord: 1.5, rat: 0.8, snatcher: 0.9, brute: 1.3, shaman: 1 };

/** The layered look for an agent — role outfit, held tool, worn armor, dye — or null for things that aren't people. */
export function lookFor(m: Mover): Look | null {
  const seed = seedLook(m.id);
  const base = { ...seed, armor: m.armor, dye: m.dye, helmetStyle: m.helmetStyle, plume: m.plume };
  if (m instanceof Player) return { ...base, skin: 1, hair: 0, hairStyle: 0, body: 'adult', outfit: 'head', held: m.tool === 'sword' ? 'sword' : m.tool === 'bow' ? 'bow' : m.tool === 'axe' ? 'axe' : m.tool === 'hoe' ? 'hoe' : 'none' };
  if (m instanceof Villager) {
    if (m.role === 'kid') return { ...base, body: 'kid', outfit: 'kid', held: 'none' };
    const held = m.role === 'farmer' ? 'hoe' : m.role === 'woodcutter' ? 'axe' : m.weapon === 'bow' ? 'bow' : 'sword';
    return { ...base, body: 'adult', outfit: m.role, held };
  }
  if (m instanceof Raider) {
    const body = m.boss ? 'boss' : m.kind === 'brute' ? 'brute' : m.kind === 'rat' ? 'rat' : m.kind === 'snatcher' ? 'imp' : m.kind === 'shaman' ? 'shaman' : 'orc';
    return { ...base, body, outfit: 'none', held: body === 'orc' || body === 'boss' ? 'sword' : body === 'brute' ? 'axe' : 'none', armor: { helmet: 0, chest: 0, legs: 0, shield: 0 } };
  }
  return null;
}

function charFor(m: Mover): { key: string; frame: number } {
  if (m instanceof Arrow) return { key: 'arrow', frame: 0 };
  if (m instanceof Player) return CHAR.player;
  if (m instanceof Bolt) return { key: 'px', frame: 0 };
  if (m instanceof Raider) return CHAR[m.kind];
  if (m instanceof Villager) return CHAR[m.role];
  return CHAR.kid;
}
