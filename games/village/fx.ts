import Phaser from 'phaser';
import { Mover, Villager, Raider, Player, Arrow, COMBO } from './agents';
import { Bolt } from './enemies';
import { DUNGEON, TOWN } from './atlas';
import { TILE, OGRE, GNOME_HOME } from './config';
import { buildingCenter, BUILDINGS, type Building } from './world';
import { Sfx } from './sfx';
import type { VillageScene, FxEvent } from './main';

/** Per-sprite animation offsets, tweened by Fx and applied by the renderer on top of the sim position. */
export interface AnimState { ox: number; oy: number; sx: number; sy: number; rot: number }

const REST: AnimState = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };

const WEAPON = {
  sword: { key: 'dungeon', frame: DUNGEON.sword, scale: 1 },
  axe: { key: 'dungeon', frame: DUNGEON.axe, scale: 1 },
  bigAxe: { key: 'dungeon', frame: 119, scale: 1.5 },
  dagger: { key: 'dungeon', frame: 106, scale: 0.8 },
  hoe: { key: 'town', frame: TOWN.iconHoe, scale: 1 },
  woodAxe: { key: 'town', frame: TOWN.iconAxe, scale: 1 },
  hammer: { key: 'town', frame: TOWN.iconHammer, scale: 1 },
} as const;
type WeaponKind = keyof typeof WEAPON;

const DEPTH = { weapon: 11, numbers: 35, ghost: 12, particles: 34, swoosh: 33, star: 36 } as const;
const POWS = ['POW!', 'WHAM!', 'BONK!', 'THWACK!', 'SMACK!'];
const STREAKS = ['', '', 'DOUBLE!', 'TRIPLE!', 'RAMPAGE!'];

interface SwingRec {
  sprite: Phaser.GameObjects.Sprite;
  ux: number; uy: number;
  t: number; ttl: number;
  /** sweep: start angle, total angle (radians); the weapon and the swoosh follow it */
  a0: number; sweep: number;
  spin: boolean;
  swoosh: Phaser.GameObjects.Graphics;
  lastGhost: number;
}

/**
 * Procedural, cartoon-flavoured combat animation on top of single-frame sprites: squash & stretch,
 * weapon arcs with swooshes and afterimages, impact stars, word pops, bouncy numbers, launched
 * kills with poof clouds, telegraph poses, camera punch, and a tiny synth for sound.
 */
export class Fx {
  readonly anims = new Map<number, AnimState>();
  readonly sfx = new Sfx();
  private weapons = new Map<number, Phaser.GameObjects.Sprite>();
  private swings = new Map<number, SwingRec>();
  private numberPool: Phaser.GameObjects.Text[] = [];
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private blood: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private seeds: Phaser.GameObjects.Particles.ParticleEmitter;
  /** blades of long grass thrown up by the sword */
  private clippings: Phaser.GameObjects.Particles.ParticleEmitter;
  private gold: Phaser.GameObjects.Particles.ParticleEmitter;
  private magic: Phaser.GameObjects.Particles.ParticleEmitter;
  private puff: Phaser.GameObjects.Particles.ParticleEmitter;
  private heartsEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private wasPaused = false;
  /** sprites of the dead, kept alive until their tween ends */
  dying = new Set<Phaser.GameObjects.Sprite>();
  /** the eerie wind around the Ogre's lair: pale wisps and dead leaves circling it, a cold cast over the screen */
  private wisps: Phaser.GameObjects.Particles.ParticleEmitter;
  private leaves: Phaser.GameObjects.Particles.ParticleEmitter;
  private cold: Phaser.GameObjects.Image | null = null;
  private windAcc = 0;
  /** how strong the wind is where the player stands, 0..1 (smoothed) */
  windLevel = 0;
  private windWarned = false;
  /** the gnomes' glade: warm motes drifting in around their hidden cottage, and a soft chime that rises as you near it */
  private motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private warm: Phaser.GameObjects.Image | null = null;
  private gladeAcc = 0;
  gladeLevel = 0;
  private gladeWarned = false;
  private gladeHome: Building | null = null;
  /** how the player's last hit on each target went, so the death can launch them that way */
  private lastBlow = new Map<number, { ux: number; uy: number; push: number; crit: boolean }>();

  constructor(private scene: VillageScene) {
    if (!scene.textures.exists('px')) scene.make.graphics({ x: 0, y: 0 }, false).fillStyle(0xffffff).fillRect(0, 0, 2, 2).generateTexture('px', 2, 2);
    const mk = (tint: number | number[], extra: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {}) =>
      scene.add.particles(0, 0, 'px', { emitting: false, lifespan: 320, speed: { min: 18, max: 55 }, scale: { start: 1, end: 0 }, gravityY: 70, tint, ...extra }).setDepth(DEPTH.particles);
    this.sparks = mk([0xffffff, 0xffe066, 0xffcf5a]);
    this.heartsEmitter = mk([0xff7aa2, 0xffb0c8, 0xff5a8a], { lifespan: 900, speed: { min: 6, max: 18 }, gravityY: -30, scale: { start: 1.4, end: 0.4 } });
    this.blood = mk([0xd94a4a, 0x8a2020], { gravityY: 110, lifespan: 420 });
    this.dust = mk([0xb8a88e, 0x8a6a4a], { speed: { min: 8, max: 25 }, gravityY: 20, lifespan: 380 });
    this.seeds = mk([0x8fd35a, 0x3a6b2a], { speed: { min: 10, max: 30 }, gravityY: 90 });
    this.clippings = mk([0x7cc65a, 0x4f9a3c, 0xa8e07a], { speed: { min: 20, max: 60 }, gravityY: 60, lifespan: 420, rotate: { onEmit: () => Math.random() * 360 } });
    this.gold = mk([0xffcf5a, 0xfff2b0], { speed: { min: 30, max: 90 }, gravityY: -20, lifespan: 700 });
    this.magic = mk([0xb46bff, 0xe0b0ff, 0x7a3fd6], { speed: { min: 10, max: 40 }, gravityY: -30, lifespan: 380 });
    this.puff = mk([0xffffff, 0xe8e8e8, 0xc9c9c9], { speed: { min: 15, max: 45 }, gravityY: -25, lifespan: 500, scale: { start: 2.5, end: 0 } });
    // the wind: streaks that fade in and out as they circle the lair; the fog hides it like everything else
    if (!scene.textures.exists('wisp')) scene.make.graphics({ x: 0, y: 0 }, false).fillStyle(0xffffff).fillRect(0, 0, 16, 2).generateTexture('wisp', 16, 2);
    const fade = (v: number) => ({ onEmit: () => 0, onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => Math.sin(t * Math.PI) * v });
    this.wisps = scene.add.particles(0, 0, 'wisp', { emitting: false, lifespan: { min: 1400, max: 2400 }, tint: [0xd8d0f0, 0xb0b8d8, 0x9aa0c8], alpha: fade(0.85), scale: { start: 0.8, end: 1.8 } }).setDepth(43); // under the fog (45): the wind is only seen where the ground is
    this.leaves = scene.add.particles(0, 0, 'px', { emitting: false, lifespan: { min: 1600, max: 2600 }, tint: [0x4a3a50, 0x5a4a3a, 0x3a3a48], alpha: fade(0.9), rotate: { onEmit: () => Math.random() * 360, onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, _t: number, v: number) => v + 6 } }).setDepth(43);
    // the glade's motes: slow, warm, fading in and out as they drift
    this.motes = scene.add.particles(0, 0, 'px', { emitting: false, lifespan: { min: 1800, max: 3200 }, tint: [0xffe9a0, 0xd9f0a0, 0xfff6d0], alpha: fade(0.95), scale: { start: 0.8, end: 1.4 } }).setDepth(43);
  }

  /**
   * The eerie wind around the lair is a place, not an effect on the player: inside OGRE.windRadius
   * tiles of the lair, wisps and dead leaves stream clockwise around it — thickest at the cave
   * mouth, thinning to nothing at the edge — and the ground under it has a cold cast. Whatever
   * part of that circle the camera can see gets particles, whether or not you're standing in it.
   * Fog hides the wind like anything else, so you find it by walking into it. Only the sound
   * follows the player: a quiet moan that rises as you walk in.
   */
  private wind(dt: number): void {
    const s = this.scene, lair = s.world.lair;
    if (!lair) { this.sfx.wind(0); return; }
    const c = buildingCenter(lair), lx = c.tx * TILE, ly = c.ty * TILE, R = OGRE.windRadius * TILE;
    // the cold ground: a soft disc laid over the world once, centred on the lair
    if (!this.cold) {
      if (!s.textures.exists('coldring')) {
        const tex = s.textures.createCanvas('coldring', 256, 256)!, g = tex.context;
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(120,130,190,0.55)'); grad.addColorStop(0.6, 'rgba(120,130,190,0.3)'); grad.addColorStop(1, 'rgba(120,130,190,0)');
        g.fillStyle = grad; g.fillRect(0, 0, 256, 256); tex.refresh();
      }
      this.cold = s.add.image(lx, ly, 'coldring').setScale((R * 2) / 256).setDepth(44).setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
    // sound follows the player, softly
    const pd = s.interior.active ? Infinity : Math.hypot(s.player.x - lx, s.player.y - ly) / TILE;
    const target = Math.max(0, Math.min(1, 1 - pd / OGRE.windRadius));
    this.windLevel += (target - this.windLevel) * Math.min(1, dt * 2);
    this.sfx.wind(this.sfx.muted ? 0 : this.windLevel);
    if (target > 0.03 && !this.windWarned) { this.windWarned = true; s.event('info', 'A cold wind rises, circling something out in the woods.', true); }
    // particles: sample the part of the circle the camera can see; density falls off with distance from the lair
    const v = s.cameras.main.worldView;
    const x0 = Math.max(v.x - 24, lx - R), x1 = Math.min(v.right + 24, lx + R), y0 = Math.max(v.y - 24, ly - R), y1 = Math.min(v.bottom + 24, ly + R);
    if (x1 <= x0 || y1 <= y0) return;
    const area = (x1 - x0) * (y1 - y0) / (TILE * TILE); // tiles² in view that could hold wind
    this.windAcc += dt * area * 0.25; // spawn attempts per second per tile²
    while (this.windAcc >= 1) {
      this.windAcc -= 1;
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      const dx = x - lx, dy = y - ly, d = Math.hypot(dx, dy) || 1;
      const k = 1 - d / R; // 1 at the lair, 0 at the edge
      if (k <= 0 || Math.random() > Math.pow(k, 1.5)) continue; // thin at the edge, thick at the centre
      const spd = 30 + Math.random() * 40 + 50 * k;
      const tx = -dy / d, ty = dx / d; // clockwise around the lair
      const vx = (tx - dx / d * 0.25) * spd, vy = (ty - dy / d * 0.25) * spd;
      const leaf = Math.random() < 0.3;
      const em = leaf ? this.leaves : this.wisps;
      em.setParticleSpeed(vx, vy);
      if (!leaf) em.particleRotate = Phaser.Math.RadToDeg(Math.atan2(vy, vx));
      em.emitParticleAt(x, y, 1);
    }
  }

  /**
   * The gnomes' glade, the warm twin of the lair's wind: inside GNOME_HOME.ringRadius tiles of their
   * cottage, motes drift inward and up — thickest at the door, nothing at the edge — over a patch of
   * warm ground, with a soft chime that rises as the player walks in. The fog hides it like everything
   * else, so you find the cottage by walking into its light. It stays after the cottage is claimed.
   */
  private glade(dt: number): void {
    const s = this.scene;
    // pinned to the cottage that was wild at the start: building your own near the village must not move the glade
    const den = (this.gladeHome ??= s.world.wildGnomeHouse ?? null);
    if (!den) { this.sfx.glade(0); return; }
    const c = buildingCenter(den), gx = c.tx * TILE, gy = c.ty * TILE, R = GNOME_HOME.ringRadius * TILE;
    if (!this.warm) {
      if (!s.textures.exists('gladering')) {
        const tex = s.textures.createCanvas('gladering', 256, 256)!, g = tex.context;
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(255,215,120,0.30)'); grad.addColorStop(0.55, 'rgba(230,200,110,0.15)'); grad.addColorStop(1, 'rgba(255,215,120,0)');
        g.fillStyle = grad; g.fillRect(0, 0, 256, 256); tex.refresh();
      }
      this.warm = s.add.image(gx, gy, 'gladering').setScale((R * 2) / 256).setDepth(43).setBlendMode(Phaser.BlendModes.ADD);
    }
    const pd = s.interior.active ? Infinity : Math.hypot(s.player.x - gx, s.player.y - gy) / TILE;
    const target = Math.max(0, Math.min(1, 1 - pd / GNOME_HOME.ringRadius));
    this.gladeLevel += (target - this.gladeLevel) * Math.min(1, dt * 2);
    this.sfx.glade(this.sfx.muted ? 0 : this.gladeLevel);
    if (target > 0.03 && !this.gladeWarned) { this.gladeWarned = true; s.event('info', 'Warm motes drift on the air — something small and friendly keeps house out here.', true); }
    const v = s.cameras.main.worldView;
    const x0 = Math.max(v.x - 24, gx - R), x1 = Math.min(v.right + 24, gx + R), y0 = Math.max(v.y - 24, gy - R), y1 = Math.min(v.bottom + 24, gy + R);
    if (x1 <= x0 || y1 <= y0) return;
    const area = (x1 - x0) * (y1 - y0) / (TILE * TILE);
    this.gladeAcc += dt * area * 0.1; // far sparser than the wind: a glade, not a gale
    while (this.gladeAcc >= 1) {
      this.gladeAcc -= 1;
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      const dx = x - gx, dy = y - gy, d = Math.hypot(dx, dy) || 1;
      const k = 1 - d / R;
      if (k <= 0 || Math.random() > Math.pow(k, 1.5)) continue;
      const spd = 4 + Math.random() * 10; // barely moving: they hang in the air
      this.motes.setParticleSpeed(-dx / d * spd, -dy / d * spd - 8 - Math.random() * 10); // inward, and always up
      this.motes.emitParticleAt(x, y, 1);
    }
  }

  anim(id: number): AnimState {
    let a = this.anims.get(id);
    if (!a) this.anims.set(id, (a = { ...REST }));
    return a;
  }

  /** Called every frame by the renderer after sprites are positioned. */
  update(dt: number, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    if (this.scene.paused !== this.wasPaused) {
      this.wasPaused = this.scene.paused;
      if (this.wasPaused) this.scene.tweens.pauseAll(); else this.scene.tweens.resumeAll();
    }
    if (this.wasPaused) { this.sfx.wind(0); this.sfx.glade(0); return; }
    this.wind(dt);
    this.glade(dt);
    for (const [id, sw] of this.swings) {
      const owner = sprites.get(id);
      sw.t += dt;
      const p = Math.min(1, sw.t / (sw.ttl - 0.05));
      if (!owner || sw.t >= sw.ttl) { sw.sprite.setVisible(false); sw.swoosh.destroy(); this.swings.delete(id); continue; }
      // ease the sweep the same way the weapon tween does, so the swoosh and afterimages line up
      const e = Phaser.Math.Easing.Cubic.Out(p);
      const ang = sw.a0 + sw.sweep * e;
      const cx = owner.x, cy = owner.y - 5;
      if (sw.spin) {
        // the blade orbits the body
        const r = 11;
        sw.sprite.setPosition(cx + Math.cos(ang - Math.PI / 2) * r, cy + Math.sin(ang - Math.PI / 2) * r).setRotation(ang).setDepth(owner.depth + (Math.sin(ang - Math.PI / 2) < 0 ? -0.5 : 0.5));
      } else {
        sw.sprite.setPosition(cx + sw.ux * 9, cy + sw.uy * 9).setRotation(ang).setDepth(owner.depth + (sw.uy < 0 ? -0.5 : 0.5));
      }
      // swoosh: an arc from the start of the sweep to where the blade is now, fading as the swing ends
      const g = sw.swoosh;
      g.clear();
      const fade = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      const rad = sw.spin ? 16 : 14;
      g.lineStyle(sw.spin ? 4 : 3, 0xffffff, 0.75 * fade);
      const from = sw.a0 - Math.PI / 2, to = ang - Math.PI / 2;
      g.beginPath();
      g.arc(cx, cy, rad, Math.min(from, to), Math.max(from, to), false);
      g.strokePath();
      g.lineStyle(1, 0xffe9a0, 0.9 * fade);
      g.beginPath();
      g.arc(cx, cy, rad - 3, Math.min(from, to), Math.max(from, to), false);
      g.strokePath();
      // afterimages
      if (sw.t - sw.lastGhost > 0.03 && p < 0.8) {
        sw.lastGhost = sw.t;
        const gh = this.scene.add.sprite(sw.sprite.x, sw.sprite.y, sw.sprite.texture.key, sw.sprite.frame.name).setRotation(sw.sprite.rotation).setScale(sw.sprite.scaleX, sw.sprite.scaleY).setOrigin(sw.sprite.originX, sw.sprite.originY).setAlpha(0.45).setDepth(sw.sprite.depth - 0.1).setFlipX(sw.sprite.flipX).setTint(0xfff2b0);
        this.scene.tweens.add({ targets: gh, alpha: 0, duration: 130, onComplete: () => gh.destroy() });
      }
    }
  }

  handle(ev: FxEvent, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    switch (ev.kind) {
      case 'hit':
        if (ev.attacker instanceof Bolt) this.magic.explode(8, ev.target.x, ev.target.y - 4);
        this.hit(ev, sprites);
        break;
      case 'melee': this.swing(ev.who, ev, sprites, this.weaponFor(ev.who), ev.who instanceof Raider && ev.who.kind === 'brute' ? 240 : 150); this.sfx.swing(0); break;
      case 'arrow': this.sfx.swing(0); break;
      case 'swing': {
        const c = COMBO[ev.stage] ?? COMBO[0];
        this.swing(ev.who, { x: ev.who.x + ev.dx * 20, y: ev.who.y + ev.dy * 20 }, sprites, 'sword', c.dur * 1000, ev.stage);
        this.sfx.swing(ev.stage);
        break;
      }
      case 'telegraph': this.telegraph(ev.who, ev.ms); break;
      case 'miss': this.dust.explode(4, ev.who.x + ev.who.dir * 10, ev.who.y + 2); this.sfx.whiff(); break;
      case 'cast': this.magic.explode(10, ev.who.x, ev.who.y - 8); this.scene.tweens.add({ targets: this.anim(ev.who.id), sy: 1.15, sx: 0.9, duration: 120, yoyo: true }); this.sfx.bolt(); break;
      case 'impact': this.magic.explode(6, ev.x, ev.y); break;
      case 'tool': this.tool(ev.tool, ev.tx, ev.ty, sprites, ev.who); break;
      case 'boss': this.bossArrive(ev.who, sprites); this.sfx.horn(); break;
      case 'slowmo': this.zoomBump(0.08, 120, 420); break;
      case 'death': break; // handled by die() when the renderer hands over the sprite
      case 'deposit': this.dust.explode(6, ev.x, ev.y); this.word(ev.text, ev.x, ev.y - 10, ev.colour, 7, 0.9); this.sfx.dig(); break;
      case 'cut': this.clippings.explode(6, ev.x, ev.y - 2); break;
      case 'rustle': if (!this.scene.fog || this.scene.fog.visibleAt(ev.x, ev.y) > 0.35) this.clippings.explode(3, ev.x, ev.y - 3); break; // fog-gated: unexplored grass keeps its secrets
      case 'ruin': {
        // the roof comes down: a shudder, a thud, dust and smoke across the whole footprint
        const b = ev.building, f = BUILDINGS[b.kind], x0 = b.tx * TILE, y0 = b.ty * TILE, w = f.w * TILE, h = f.h * TILE;
        this.shake(250, 0.006);
        this.sfx.thud(1);
        for (let i = 0; i < 12; i++) { const x = x0 + Math.random() * w, y = y0 + Math.random() * h; this.dust.explode(4, x, y); this.puff.explode(2, x, y - 8); }
        this.word('RUINED', x0 + w / 2, y0 - 12, '#ff6a5a', 9, 1.6);
        break;
      }
      case 'demolish': {
        // taken down on purpose: a lighter shudder and dust, no alarm
        const b = ev.building, f = BUILDINGS[b.kind], x0 = b.tx * TILE, y0 = b.ty * TILE, w = f.w * TILE, h = f.h * TILE;
        this.shake(140, 0.003);
        this.sfx.thud(0.6);
        for (let i = 0; i < 8; i++) { const x = x0 + Math.random() * w, y = y0 + Math.random() * h; this.dust.explode(4, x, y); this.puff.explode(1, x, y - 6); }
        break;
      }
      case 'snore': if (this.scene.fog.visibleAt(ev.x, ev.y) > 0.35) this.word('z', ev.x + 6, ev.y, '#d8d0f0', 6, 1.6); break;
      case 'smash': {
        // the club comes down: he squashes into the blow, the ground jumps, dust rolls out in a ring
        const big = ev.r >= 40;
        this.scene.tweens.killTweensOf(this.anim(ev.who.id));
        this.scene.tweens.chain({ targets: this.anim(ev.who.id), tweens: [
          { ox: 0, rot: 0, sx: 1.3, sy: 0.7, duration: 70, ease: 'Quad.In' },
          { sx: 1, sy: 1, duration: 260, ease: 'Back.Out' },
        ] });
        this.shake(big ? 280 : 180, big ? 0.009 : 0.006);
        if (big) this.sfx.slam(); else this.sfx.thud(1);
        const n = big ? 18 : 10;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.dust.explode(3, ev.x + Math.cos(a) * ev.r * 0.8, ev.y + 4 + Math.sin(a) * ev.r * 0.4); }
        this.puff.explode(big ? 8 : 4, ev.x, ev.y);
        const ring = this.scene.add.graphics().setDepth(DEPTH.swoosh).setPosition(ev.x, ev.y + 4).setScale(0.2);
        ring.lineStyle(3, 0xd8c8a0, 0.9); ring.strokeEllipse(0, 0, ev.r * 2, ev.r);
        this.scene.tweens.add({ targets: ring, scaleX: 1.1, scaleY: 1.1, alpha: 0, duration: big ? 380 : 260, ease: 'Quad.Out', onComplete: () => ring.destroy() });
        if (big) this.word('SMASH!', ev.x, ev.y - 26, '#ff9a3c', 9, 1.0);
        break;
      }
      case 'charge': {
        // head down, a bellow, and a scuff of dust kicked back from the start line
        this.stretch(ev.who.id, ev.ux, ev.uy, 0.35, 260);
        this.sfx.roar();
        this.word('!!', ev.who.x, ev.who.y - 22, '#ff6a5a', 9, 0.7);
        for (let i = 0; i < 4; i++) this.dust.explode(3, ev.who.x - ev.ux * (6 + i * 5), ev.who.y + 6 - ev.uy * (6 + i * 5));
        break;
      }
      case 'thud': {
        // the Ogre's footsteps: felt within 30 tiles, louder and heavier the closer he is
        const d = Math.hypot(ev.who.x - this.scene.player.x, ev.who.y - this.scene.player.y) / TILE;
        if (d > 30) break;
        const near = 1 - d / 30;
        this.sfx.thud(0.25 + 0.75 * near);
        this.shake(70, 0.001 + 0.003 * near);
        this.dust.explode(3, ev.who.x + ev.who.dir * -8, ev.who.y + 6);
        break;
      }
    }
  }

  // ---- attacks ---------------------------------------------------------------

  private weaponFor(m: Mover): WeaponKind {
    if (m instanceof Raider) return m.boss || m.huge || m.kind === 'brute' ? 'bigAxe' : m.kind === 'snatcher' ? 'dagger' : 'axe'; // wreckers swing the plain axe too
    return 'sword';
  }

  private weaponSprite(id: number, kind: WeaponKind): Phaser.GameObjects.Sprite {
    const w = WEAPON[kind];
    let sp = this.weapons.get(id);
    if (!sp) { sp = this.scene.add.sprite(0, 0, w.key, w.frame).setOrigin(0.3, 0.9).setDepth(DEPTH.weapon); this.weapons.set(id, sp); }
    else sp.setTexture(w.key, w.frame);
    sp.setScale(w.scale).setVisible(true).setAlpha(1);
    return sp;
  }

  /** Stretch the body along a direction (cartoon anticipation), then snap back with a wobble. */
  private stretch(id: number, ux: number, uy: number, amount: number, ms: number): void {
    const a = this.anim(id);
    this.scene.tweens.killTweensOf(a);
    const horiz = Math.abs(ux) >= Math.abs(uy);
    this.scene.tweens.chain({
      targets: a,
      tweens: [
        { ox: ux * 5, oy: uy * 5, sx: horiz ? 1 + amount : 1 - amount * 0.6, sy: horiz ? 1 - amount * 0.6 : 1 + amount, duration: ms * 0.4, ease: 'Sine.Out' },
        { ox: 0, oy: 0, sx: 1, sy: 1, duration: ms * 0.6, ease: 'Back.Out' },
      ],
    });
  }

  /** Lunge + weapon arc from `who` toward `target`. Stage 1 sweeps the other way; stage 2 is a full spin. */
  private swing(who: Mover, target: { x: number; y: number }, sprites: Map<number, Phaser.GameObjects.Sprite>, kind = this.weaponFor(who), ms = 140, stage = 0): void {
    const dx = target.x - who.x, dy = target.y - who.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const spin = stage === 2;
    this.stretch(who.id, ux, uy, spin ? 0.35 : 0.3, ms);
    const w = this.weaponSprite(who.id, kind);
    const owner = sprites.get(who.id);
    const base = Math.atan2(uy, ux) + Math.PI / 2;
    const dir = (ux < 0 ? -1 : 1) * (stage === 1 ? -1 : 1);
    const sweep = spin ? Math.PI * 2 * (ux < 0 ? -1 : 1) : 2.4 * dir;
    const a0 = spin ? base : base - sweep / 2;
    if (owner) w.setPosition(owner.x + ux * 9, owner.y - 5 + uy * 9);
    this.scene.tweens.killTweensOf(w);
    w.setFlipX(ux < 0);
    w.setRotation(a0);
    if (!spin) this.scene.tweens.add({ targets: w, rotation: a0 + sweep, duration: ms, ease: 'Cubic.Out' });
    const old = this.swings.get(who.id);
    if (old) old.swoosh.destroy();
    const swoosh = this.scene.add.graphics().setDepth(DEPTH.swoosh);
    this.swings.set(who.id, { sprite: w, ux, uy, t: 0, ttl: ms / 1000 + 0.05, a0, sweep, spin, swoosh, lastGhost: 0 });
    if (who instanceof Raider && (who.boss || who.huge || who.kind === 'brute')) this.shake(who.huge ? 180 : who.boss ? 120 : 80, who.huge ? 0.009 : who.boss ? 0.006 : 0.004);
    if (spin) this.shake(120, 0.004);
  }

  /** Wind-up pose: lean back, grow a little, "!" overhead. Snaps forward when the strike lands (the swing). */
  private telegraph(who: Mover, ms: number): void {
    const a = this.anim(who.id);
    this.scene.tweens.killTweensOf(a);
    this.scene.tweens.add({ targets: a, ox: -who.dir * 3, rot: -who.dir * 0.28, sy: 1.12, sx: 0.92, duration: Math.max(60, ms * 0.6), ease: 'Sine.Out' });
    this.word('!', who.x, who.y - 16, '#ffe066', 8, 0.9);
    if (who instanceof Raider) this.sfx.grunt();
    if (who instanceof Raider && (who.boss || who.huge || who.kind === 'brute')) {
      const w = this.weaponSprite(who.id, this.weaponFor(who));
      w.setPosition(who.x - who.dir * 4, who.y - 14).setRotation(-who.dir * 2.6).setFlipX(who.dir < 0);
      this.scene.tweens.add({ targets: w, y: who.y - 17, duration: ms * 0.7, yoyo: true });
    }
  }

  private hit(ev: Extract<FxEvent, { kind: 'hit' }>, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    const { attacker, target, dmg, crit, killed } = ev;
    if (target.blocked) { // the shield took it
      this.word('BLOCK', target.x, target.y - 14, '#c9d3de', 7, 0.6);
      this.sparks.explode(6, target.x, target.y - 6);
      this.sfx.hit(false);
      void sprites;
      return;
    }
    const dx = target.x - attacker.x, dy = target.y - attacker.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = ev.ux ?? dx / d, uy = ev.uy ?? dy / d;
    const a = this.anim(target.id);
    this.scene.tweens.killTweensOf(a);
    const heavy = target instanceof Raider && target.heavy;
    const byPlayer = attacker instanceof Player;
    const toRaider = target instanceof Raider;
    // squash flat, then pop back with overshoot
    const sq = heavy ? 0.85 : crit ? 0.5 : 0.62;
    this.scene.tweens.chain({
      targets: a,
      tweens: [
        { ox: ux * (heavy ? 1 : 3), oy: uy * (heavy ? 1 : 3), sy: sq, sx: 2 - sq, rot: heavy ? 0 : ux * 0.15, duration: 70, ease: 'Quad.Out' },
        { ox: 0, oy: 0, sy: 1, sx: 1, rot: 0, duration: 260, ease: 'Back.Out' },
      ],
    });
    const cx = target.x + ux * 2, cy = target.y - 5 + uy * 2;
    (toRaider ? this.sparks : this.blood).explode(toRaider ? (crit ? 16 : 8) : 6, cx, cy);
    if (toRaider) this.star(cx, cy, crit ? 14 : 9, crit ? 0xff9a3c : 0xfff2b0);
    this.number(String(dmg), target.x + ux * 4, target.y - 14, toRaider ? (crit ? '#ff9a3c' : '#ffe066') : '#ff5a5a', crit ? 9 : attacker instanceof Raider && attacker.boss ? 8 : 6);
    if (byPlayer) {
      this.word(crit ? 'CRIT!' : POWS[Math.floor(Math.random() * POWS.length)], target.x - ux * 6, target.y - 22, crit ? '#ff9a3c' : '#ffffff', crit ? 8 : 7, 0.8);
      this.lastBlow.set(target.id, { ux, uy, push: ev.push ?? 40, crit });
      this.sfx.hit(crit);
      if (crit) this.zoomBump(0.06, 60, 160);
      this.shake(crit ? 120 : 60, Math.min(0.012, 0.002 + dmg * 0.0003));
      if (killed && (ev.streak ?? 0) >= 2) {
        this.scene.time.delayedCall(120, () => { this.word(STREAKS[Math.min(4, ev.streak!)], this.scene.player.x, this.scene.player.y - 24, '#ffcf5a', 9, 1.2); this.sfx.streak(ev.streak!); });
      }
    } else {
      if (target instanceof Player) { this.shake(90, 0.005); this.sfx.hurt(); }
      else if (attacker instanceof Villager) this.sfx.hit(false);
    }
    void sprites;
  }

  private tool(tool: 'hoe' | 'axe' | 'seed' | 'hammer', tx: number, ty: number, sprites: Map<number, Phaser.GameObjects.Sprite>, who?: Mover): void {
    const pl = who ?? this.scene.player;
    const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
    if (tool === 'seed') { this.seeds.explode(7, cx, cy - 2); this.scene.tweens.add({ targets: this.anim(pl.id), sy: 0.9, duration: 60, yoyo: true }); this.sfx.dig(); return; }
    this.swing(pl, { x: cx, y: cy }, sprites, tool === 'hoe' ? 'hoe' : tool === 'axe' ? 'woodAxe' : 'hammer', 160);
    this.scene.time.delayedCall(90, () => { this.dust.explode(tool === 'axe' ? 5 : 8, cx, cy + 2); if (tool === 'axe' || tool === 'hammer') this.sfx.chop(); else this.sfx.dig(); });
  }

  // ---- deaths ------------------------------------------------------------------

  /** Take over a sprite whose agent just died; destroy it when the animation ends. */
  die(sprite: Phaser.GameObjects.Sprite, who: Mover | undefined): void {
    this.dying.add(sprite);
    sprite.disableInteractive();
    const done = () => { this.dying.delete(sprite); sprite.destroy(); };
    if (who) { this.anims.delete(who.id); this.weapons.get(who.id)?.setVisible(false); const sw = this.swings.get(who.id); if (sw) { sw.swoosh.destroy(); this.swings.delete(who.id); } }
    if (who instanceof Bolt || who instanceof Arrow) { sprite.destroy(); this.dying.delete(sprite); return; }
    if (who instanceof Raider) {
      const boss = who.boss;
      const blow = this.lastBlow.get(who.id);
      this.lastBlow.delete(who.id);
      if (boss) {
        this.blood.explode(24, sprite.x, sprite.y - 4);
        this.gold.explode(30, sprite.x, sprite.y - 8);
        this.shake(400, 0.012);
        this.scene.slowMo();
        this.scene.tweens.add({ targets: sprite, scaleY: 0.15, scaleX: sprite.scaleX * 1.3, alpha: 0, y: sprite.y + 4, duration: 1000, ease: 'Quad.In', onComplete: () => { this.poof(sprite.x, sprite.y - 4, 2); done(); } });
        this.sfx.kill();
        return;
      }
      if (blow && !who.heavy) { this.launch(sprite, who, blow, done); return; }
      this.blood.explode(who.kind === 'rat' || who.kind === 'snatcher' ? 4 : 8, sprite.x, sprite.y - 4);
      this.scene.tweens.add({ targets: sprite, scaleY: 0.15, scaleX: sprite.scaleX * 1.3, alpha: 0, y: sprite.y + 4, duration: 350, ease: 'Quad.In', onComplete: () => { this.poof(sprite.x, sprite.y - 3, 1); done(); } });
      this.sfx.kill();
      return;
    }
    // villagers and the player: tip over and fade, ghost rises
    const side = sprite.flipX ? -1 : 1;
    this.scene.tweens.add({ targets: sprite, rotation: side * Math.PI / 2, y: sprite.y + 3, alpha: 0, duration: 500, ease: 'Quad.In', onComplete: done });
    const ghost = this.scene.add.sprite(sprite.x, sprite.y - 2, 'dungeon', DUNGEON.ghost).setAlpha(0.9).setDepth(DEPTH.ghost).setScale(sprite.scaleX < 0.9 ? 0.7 : 1);
    this.scene.tweens.add({ targets: ghost, y: ghost.y - 14, alpha: 0, duration: 900, ease: 'Sine.Out', onComplete: () => ghost.destroy() });
  }

  /** Killed by the player: fling away from the blow, spinning, bounce once, then poof. */
  private launch(sprite: Phaser.GameObjects.Sprite, who: Raider, blow: { ux: number; uy: number; push: number; crit: boolean }, done: () => void): void {
    const far = (who.kind === 'rat' ? 1.6 : 1) * (blow.crit ? 1.3 : 1) * blow.push * 1.4;
    const x1 = sprite.x + blow.ux * far, y1 = sprite.y + blow.uy * far;
    const hop = 18 + far * 0.15;
    sprite.setDepth(DEPTH.star);
    this.sfx.kill();
    this.scene.tweens.add({ targets: sprite, x: x1, duration: 420, ease: 'Sine.Out' });
    this.scene.tweens.add({ targets: sprite, rotation: (blow.ux < 0 ? -1 : 1) * Math.PI * 4, duration: 560, ease: 'Sine.Out' });
    this.scene.tweens.chain({
      targets: sprite,
      tweens: [
        { y: y1 - hop, duration: 200, ease: 'Quad.Out' },
        { y: y1, duration: 200, ease: 'Quad.In', onComplete: () => this.dust.explode(6, sprite.x, sprite.y + 2) },
        { y: y1 - hop * 0.3, x: x1 + blow.ux * 8, duration: 90, ease: 'Quad.Out' },
        { y: y1 + 2, duration: 90, ease: 'Quad.In' },
      ],
      onComplete: () => { this.poof(sprite.x, sprite.y - 3, who.kind === 'rat' ? 0.8 : 1.2); done(); },
    });
  }

  /** A moment with a child: a few pink hearts drift up. */
  hearts(x: number, y: number): void {
    this.heartsEmitter.explode(6, x, y);
    this.sfx.streak(3);
  }

  /** Something good happened here (an upgrade): a big puff and a ring of sparks. */
  celebrate(x: number, y: number): void {
    this.poof(x, y - 6, 1.6);
    this.sparks.explode(14, x, y - 8);
    this.zoomBump(0.04, 80, 260);
  }

  /** A white cartoon cloud that puffs out and dissolves. */
  private poof(x: number, y: number, size: number): void {
    this.puff.explode(Math.round(8 * size), x, y);
    const g = this.scene.add.graphics().setDepth(DEPTH.star).setPosition(x, y).setScale(0.2);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(Math.cos(ang) * 4 * size, Math.sin(ang) * 3 * size, 4.5 * size);
    }
    g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 4.5 * size);
    this.scene.tweens.add({ targets: g, scaleX: 1.15, scaleY: 1.15, alpha: 0, duration: 380, ease: 'Quad.Out', onComplete: () => g.destroy() });
    this.sfx.poof();
  }

  /** Comic impact star at the contact point. */
  private star(x: number, y: number, r: number, color: number): void {
    const g = this.scene.add.graphics().setDepth(DEPTH.star).setPosition(x, y).setScale(0.1).setRotation(Math.random() * Math.PI);
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < 16; i++) { const rr = i % 2 ? r * 0.42 : r; const ang = (i / 16) * Math.PI * 2; pts.push({ x: Math.cos(ang) * rr, y: Math.sin(ang) * rr }); }
    g.fillStyle(color, 1); g.fillPoints(pts, true);
    g.lineStyle(1, 0x000000, 0.8); g.strokePoints(pts, true);
    g.fillStyle(0xffffff, 0.9); g.fillCircle(0, 0, r * 0.3);
    this.scene.tweens.add({ targets: g, scaleX: 1.3, scaleY: 1.3, duration: 90, ease: 'Back.Out', onComplete: () => this.scene.tweens.add({ targets: g, alpha: 0, scaleX: 0.9, scaleY: 0.9, duration: 120, onComplete: () => g.destroy() }) });
  }

  // ---- boss --------------------------------------------------------------------

  private bossArrive(who: Mover, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    const a = this.anim(who.id);
    this.scene.tweens.add({ targets: a, sx: 1.3, sy: 1.3, duration: 220, yoyo: true, repeat: 1, ease: 'Sine.InOut' });
    this.blood.explode(16, who.x, who.y - 4);
    this.shake(300, 0.008);
    const sp = sprites.get(who.id);
    if (sp && this.scene.following) {
      const cam = this.scene.cameras.main;
      cam.pan(who.x, who.y, 500, Phaser.Math.Easing.Sine.InOut, false, (_c, progress) => {
        if (progress === 1) this.scene.time.delayedCall(500, () => cam.pan(this.scene.player.x, this.scene.player.y, 500, Phaser.Math.Easing.Sine.InOut));
      });
    }
  }

  // ---- helpers -----------------------------------------------------------------

  private shake(ms: number, intensity: number): void {
    if (this.reduced) return;
    this.scene.cameras.main.shake(ms, intensity);
  }

  /** Quick camera zoom-in and back, for crits and big kills. */
  /**
   * A quick zoom-in-and-back. Always measured from the scene's resting zoom (never from a zoom
   * that is itself mid-bump), so overlapping bumps can't leave the camera crept in.
   */
  private zoomBump(amount: number, inMs: number, outMs: number): void {
    if (this.reduced) return;
    const cam = this.scene.cameras.main;
    const base = this.scene.baseZoom;
    // the return leg must start after the zoom effect has finished, not inside its last update
    // (starting it there gets cancelled by the effect's own completion — the camera stayed zoomed in)
    cam.zoomEffect.reset();
    cam.off(Phaser.Cameras.Scene2D.Events.ZOOM_COMPLETE);
    cam.once(Phaser.Cameras.Scene2D.Events.ZOOM_COMPLETE, () => cam.zoomTo(this.scene.baseZoom, outMs, Phaser.Math.Easing.Quadratic.InOut, true));
    cam.zoomTo(base * (1 + amount), inMs, Phaser.Math.Easing.Quadratic.Out, true);
  }

  private textFromPool(): Phaser.GameObjects.Text | null {
    let t = this.numberPool.find((n) => !n.visible);
    if (!t) {
      if (this.numberPool.length >= 24) return null;
      t = this.scene.add.text(0, 0, '', { fontFamily: '"Press Start 2P", monospace', fontSize: '6px', resolution: 3 }).setOrigin(0.5).setDepth(DEPTH.numbers).setStroke('#000000', 3);
      this.numberPool.push(t);
    }
    return t;
  }

  /** Damage number: bounces in, drifts up, fades. */
  private number(text: string, x: number, y: number, color: string, size: number): void {
    const t = this.textFromPool();
    if (!t) return;
    t.setText(text).setColor(color).setFontSize(size).setPosition(Math.round(x), Math.round(y)).setAlpha(1).setVisible(true).setRotation((Math.random() - 0.5) * 0.3).setScale(1.6);
    this.scene.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 700, ease: 'Quad.Out', onComplete: () => t.setVisible(false) });
  }

  /** Word pop ("POW!", "!", "DOUBLE!"): slams in big, tilts, hangs, fades. */
  private word(text: string, x: number, y: number, color: string, size: number, seconds: number): void {
    const t = this.textFromPool();
    if (!t) return;
    t.setText(text).setColor(color).setFontSize(size).setPosition(Math.round(x), Math.round(y)).setAlpha(1).setVisible(true).setRotation((Math.random() - 0.5) * 0.35).setScale(2.2);
    this.scene.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 160, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, y: y - 6, duration: seconds * 1000, ease: 'Sine.Out' });
    this.scene.tweens.add({ targets: t, alpha: 0, duration: 250, delay: seconds * 1000 - 250, onComplete: () => t.setVisible(false) });
  }

  /** Clear everything after a reset. */
  clear(): void {
    this.windWarned = false; this.windLevel = 0; this.sfx.wind(0); this.cold?.destroy(); this.cold = null;
    this.gladeWarned = false; this.gladeLevel = 0; this.gladeAcc = 0; this.gladeHome = null; this.sfx.glade(0); this.warm?.destroy(); this.warm = null;
    this.scene.tweens.killAll();
    this.anims.clear();
    this.lastBlow.clear();
    for (const w of this.weapons.values()) w.destroy();
    this.weapons.clear();
    for (const sw of this.swings.values()) sw.swoosh.destroy();
    this.swings.clear();
    for (const s of this.dying) s.destroy();
    this.dying.clear();
    for (const n of this.numberPool) n.setVisible(false);
  }
}
