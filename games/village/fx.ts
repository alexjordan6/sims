import Phaser from 'phaser';
import { Mover, Villager, Raider, Player, COMBO } from './agents';
import { Bolt } from './enemies';
import { DUNGEON, TOWN } from './atlas';
import { TILE } from './config';
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
  private gold: Phaser.GameObjects.Particles.ParticleEmitter;
  private magic: Phaser.GameObjects.Particles.ParticleEmitter;
  private puff: Phaser.GameObjects.Particles.ParticleEmitter;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private wasPaused = false;
  /** sprites of the dead, kept alive until their tween ends */
  dying = new Set<Phaser.GameObjects.Sprite>();
  /** how the player's last hit on each target went, so the death can launch them that way */
  private lastBlow = new Map<number, { ux: number; uy: number; push: number; crit: boolean }>();

  constructor(private scene: VillageScene) {
    if (!scene.textures.exists('px')) scene.make.graphics({ x: 0, y: 0 }, false).fillStyle(0xffffff).fillRect(0, 0, 2, 2).generateTexture('px', 2, 2);
    const mk = (tint: number | number[], extra: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {}) =>
      scene.add.particles(0, 0, 'px', { emitting: false, lifespan: 320, speed: { min: 18, max: 55 }, scale: { start: 1, end: 0 }, gravityY: 70, tint, ...extra }).setDepth(DEPTH.particles);
    this.sparks = mk([0xffffff, 0xffe066, 0xffcf5a]);
    this.blood = mk([0xd94a4a, 0x8a2020], { gravityY: 110, lifespan: 420 });
    this.dust = mk([0xb8a88e, 0x8a6a4a], { speed: { min: 8, max: 25 }, gravityY: 20, lifespan: 380 });
    this.seeds = mk([0x8fd35a, 0x3a6b2a], { speed: { min: 10, max: 30 }, gravityY: 90 });
    this.gold = mk([0xffcf5a, 0xfff2b0], { speed: { min: 30, max: 90 }, gravityY: -20, lifespan: 700 });
    this.magic = mk([0xb46bff, 0xe0b0ff, 0x7a3fd6], { speed: { min: 10, max: 40 }, gravityY: -30, lifespan: 380 });
    this.puff = mk([0xffffff, 0xe8e8e8, 0xc9c9c9], { speed: { min: 15, max: 45 }, gravityY: -25, lifespan: 500, scale: { start: 2.5, end: 0 } });
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
    if (this.wasPaused) return;
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
        sw.sprite.setPosition(cx + sw.ux * 9, cy + sw.uy * 9).setDepth(owner.depth + (sw.uy < 0 ? -0.5 : 0.5));
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
        // NPC swings happen at the strike moment (their windup was the telegraph)
        if (ev.attacker instanceof Raider && ev.attacker.kind !== 'rat' && ev.attacker.kind !== 'shaman') this.swing(ev.attacker, ev.target, sprites);
        if (ev.attacker instanceof Villager) this.swing(ev.attacker, ev.target, sprites);
        this.hit(ev, sprites);
        break;
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
      case 'tool': this.tool(ev.tool, ev.tx, ev.ty, sprites); break;
      case 'boss': this.bossArrive(ev.who, sprites); this.sfx.horn(); break;
      case 'slowmo': this.zoomBump(0.08, 120, 420); break;
      case 'death': break; // handled by die() when the renderer hands over the sprite
    }
  }

  // ---- attacks ---------------------------------------------------------------

  private weaponFor(m: Mover): WeaponKind {
    if (m instanceof Raider) return m.boss || m.kind === 'brute' ? 'bigAxe' : m.kind === 'snatcher' ? 'dagger' : 'axe';
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
    if (who instanceof Raider && (who.boss || who.kind === 'brute')) this.shake(who.boss ? 120 : 80, who.boss ? 0.006 : 0.004);
    if (spin) this.shake(120, 0.004);
  }

  /** Wind-up pose: lean back, grow a little, "!" overhead. Snaps forward when the strike lands (the swing). */
  private telegraph(who: Mover, ms: number): void {
    const a = this.anim(who.id);
    this.scene.tweens.killTweensOf(a);
    this.scene.tweens.add({ targets: a, ox: -who.dir * 3, rot: -who.dir * 0.28, sy: 1.12, sx: 0.92, duration: Math.max(60, ms * 0.6), ease: 'Sine.Out' });
    this.word('!', who.x, who.y - 16, '#ffe066', 8, 0.9);
    if (who instanceof Raider) this.sfx.grunt();
    if (who instanceof Raider && (who.boss || who.kind === 'brute')) {
      const w = this.weaponSprite(who.id, this.weaponFor(who));
      w.setPosition(who.x - who.dir * 4, who.y - 14).setRotation(-who.dir * 2.6).setFlipX(who.dir < 0);
      this.scene.tweens.add({ targets: w, y: who.y - 17, duration: ms * 0.7, yoyo: true });
    }
  }

  private hit(ev: Extract<FxEvent, { kind: 'hit' }>, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    const { attacker, target, dmg, crit, killed } = ev;
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

  private tool(tool: 'hoe' | 'axe' | 'seed' | 'hammer', tx: number, ty: number, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    const pl = this.scene.player;
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
    if (who instanceof Bolt) { sprite.destroy(); this.dying.delete(sprite); return; }
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
  private zoomBump(amount: number, inMs: number, outMs: number): void {
    if (this.reduced) return;
    const cam = this.scene.cameras.main;
    const z = cam.zoom;
    cam.zoomTo(z * (1 + amount), inMs, Phaser.Math.Easing.Quadratic.Out, false, (_c, p) => { if (p === 1) cam.zoomTo(z, outMs, Phaser.Math.Easing.Quadratic.InOut); });
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
