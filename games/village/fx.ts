import Phaser from 'phaser';
import { Mover, Villager, Raider, Player } from './agents';
import { DUNGEON, TOWN } from './atlas';
import { TILE } from './config';
import type { VillageScene, FxEvent } from './main';

/** Per-sprite animation offsets, tweened by Fx and applied by the renderer on top of the sim position. */
export interface AnimState { ox: number; oy: number; sx: number; sy: number; rot: number }

const REST: AnimState = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };

const WEAPON = {
  sword: { key: 'dungeon', frame: DUNGEON.sword, scale: 1 },
  axe: { key: 'dungeon', frame: DUNGEON.axe, scale: 1 },
  bigAxe: { key: 'dungeon', frame: 119, scale: 1.5 },
  hoe: { key: 'town', frame: TOWN.iconHoe, scale: 1 },
  woodAxe: { key: 'town', frame: TOWN.iconAxe, scale: 1 },
  hammer: { key: 'town', frame: TOWN.iconHammer, scale: 1 },
} as const;
type WeaponKind = keyof typeof WEAPON;

const DEPTH = { weapon: 11, numbers: 35, ghost: 12, particles: 34 } as const;

/**
 * Procedural combat/tool animation on top of single-frame sprites: lunges, weapon swings,
 * knockback, sparks, floating damage numbers, deaths, camera shake.
 */
export class Fx {
  readonly anims = new Map<number, AnimState>();
  private weapons = new Map<number, Phaser.GameObjects.Sprite>();
  /** weapon follows its owner while a swing is running */
  private swings = new Map<number, { sprite: Phaser.GameObjects.Sprite; side: number; t: number; ttl: number; dy: number }>();
  private numberPool: Phaser.GameObjects.Text[] = [];
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private blood: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private seeds: Phaser.GameObjects.Particles.ParticleEmitter;
  private gold: Phaser.GameObjects.Particles.ParticleEmitter;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private wasPaused = false;
  /** sprites of the dead, kept alive until their tween ends */
  dying = new Set<Phaser.GameObjects.Sprite>();

  constructor(private scene: VillageScene) {
    if (!scene.textures.exists('px')) scene.make.graphics({ x: 0, y: 0 }, false).fillStyle(0xffffff).fillRect(0, 0, 2, 2).generateTexture('px', 2, 2);
    const mk = (tint: number | number[], extra: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {}) =>
      scene.add.particles(0, 0, 'px', { emitting: false, lifespan: 320, speed: { min: 18, max: 55 }, scale: { start: 1, end: 0 }, gravityY: 70, tint, ...extra }).setDepth(DEPTH.particles);
    this.sparks = mk([0xffffff, 0xffe066, 0xffcf5a]);
    this.blood = mk([0xd94a4a, 0x8a2020], { gravityY: 110, lifespan: 420 });
    this.dust = mk([0xb8a88e, 0x8a6a4a], { speed: { min: 8, max: 25 }, gravityY: 20, lifespan: 380 });
    this.seeds = mk([0x8fd35a, 0x3a6b2a], { speed: { min: 10, max: 30 }, gravityY: 90 });
    this.gold = mk([0xffcf5a, 0xfff2b0], { speed: { min: 30, max: 90 }, gravityY: -20, lifespan: 700 });
  }

  anim(id: number): AnimState {
    let a = this.anims.get(id);
    if (!a) this.anims.set(id, (a = { ...REST }));
    return a;
  }

  /** Called every frame by the renderer after sprites are positioned. */
  update(dt: number, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    // freeze animation with the sim
    if (this.scene.paused !== this.wasPaused) {
      this.wasPaused = this.scene.paused;
      if (this.wasPaused) this.scene.tweens.pauseAll(); else this.scene.tweens.resumeAll();
    }
    if (this.wasPaused) return;
    for (const [id, sw] of this.swings) {
      const owner = sprites.get(id);
      sw.t += dt;
      if (!owner || sw.t >= sw.ttl) { sw.sprite.setVisible(false); this.swings.delete(id); continue; }
      sw.sprite.setPosition(owner.x + sw.side * 5, owner.y - 6 + sw.dy).setDepth(owner.depth + 0.5).setFlipX(sw.side < 0);
    }
  }

  handle(ev: FxEvent, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    switch (ev.kind) {
      // the player's sword swing is its own event; NPC hits swing-and-hit together
      case 'hit': if (!(ev.attacker instanceof Player)) this.swing(ev.attacker, ev.target, sprites); this.hit(ev.attacker, ev.target, ev.dmg); break;
      case 'swing': this.swing(ev.who, { x: ev.who.x + ev.dx * 20, y: ev.who.y + ev.dy * 20 }, sprites, 'sword', 360); break;
      case 'tool': this.tool(ev.tool, ev.tx, ev.ty, sprites); break;
      case 'boss': this.bossArrive(ev.who, sprites); break;
      case 'death': break; // handled by die() when the renderer hands over the sprite
    }
  }

  // ---- attacks ---------------------------------------------------------------

  private weaponFor(m: Mover): WeaponKind {
    if (m instanceof Raider) return m.boss ? 'bigAxe' : 'axe';
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

  /** Lunge + weapon arc from `who` toward `target` (or a point). */
  private swing(who: Mover, target: { x: number; y: number }, sprites: Map<number, Phaser.GameObjects.Sprite>, kind = this.weaponFor(who), ms = 140): void {
    const side = target.x < who.x ? -1 : 1;
    const dx = target.x - who.x, dy = target.y - who.y;
    const d = Math.hypot(dx, dy) || 1;
    const a = this.anim(who.id);
    this.scene.tweens.killTweensOf(a);
    this.scene.tweens.chain({
      targets: a,
      tweens: [
        { ox: (dx / d) * 5, oy: (dy / d) * 5, sx: 1.15, sy: 0.85, duration: ms * 0.45, ease: 'Sine.Out' },
        { ox: 0, oy: 0, sx: 1, sy: 1, duration: ms * 0.55, ease: 'Sine.In' },
      ],
    });
    const w = this.weaponSprite(who.id, kind);
    const owner = sprites.get(who.id);
    if (owner) w.setPosition(owner.x + side * 5, owner.y - 6);
    this.scene.tweens.killTweensOf(w);
    w.setRotation(side * -1.2);
    this.scene.tweens.add({ targets: w, rotation: side * 1.2, duration: ms, ease: 'Cubic.Out' });
    this.swings.set(who.id, { sprite: w, side, t: 0, ttl: ms / 1000 + 0.05, dy: 0 });
    if (who instanceof Raider && who.boss) this.shake(120, 0.006);
  }

  private hit(attacker: Mover, target: Mover, dmg: number): void {
    const dx = target.x - attacker.x, dy = target.y - attacker.y;
    const d = Math.hypot(dx, dy) || 1;
    const a = this.anim(target.id);
    this.scene.tweens.killTweensOf(a);
    this.scene.tweens.chain({
      targets: a,
      tweens: [
        { ox: (dx / d) * 4, oy: (dy / d) * 4, sy: 0.8, sx: 1.1, duration: 60, ease: 'Quad.Out' },
        { ox: 0, oy: 0, sy: 1, sx: 1, duration: 110, ease: 'Sine.Out' },
      ],
    });
    const cx = target.x - (dx / d) * 3, cy = target.y - 4 - (dy / d) * 3;
    const toRaider = target instanceof Raider;
    (toRaider ? this.sparks : this.blood).explode(toRaider ? 8 : 6, cx, cy);
    this.number(String(dmg), target.x, target.y - 12, toRaider ? '#ffe066' : '#ff5a5a', attacker instanceof Raider && attacker.boss ? 8 : 6);
    if (target instanceof Player) this.shake(70, 0.003);
  }

  private tool(tool: 'hoe' | 'axe' | 'seed' | 'hammer', tx: number, ty: number, sprites: Map<number, Phaser.GameObjects.Sprite>): void {
    const pl = this.scene.player;
    const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
    if (tool === 'seed') { this.seeds.explode(7, cx, cy - 2); this.anim(pl.id); this.scene.tweens.add({ targets: this.anim(pl.id), sy: 0.9, duration: 60, yoyo: true }); return; }
    this.swing(pl, { x: cx, y: cy }, sprites, tool === 'hoe' ? 'hoe' : tool === 'axe' ? 'woodAxe' : 'hammer', 160);
    this.scene.time.delayedCall(90, () => this.dust.explode(tool === 'axe' ? 5 : 8, cx, cy + 2));
  }

  // ---- deaths ------------------------------------------------------------------

  /** Take over a sprite whose agent just died; destroy it when the animation ends. */
  die(sprite: Phaser.GameObjects.Sprite, who: Mover | undefined): void {
    this.dying.add(sprite);
    sprite.disableInteractive();
    const done = () => { this.dying.delete(sprite); sprite.destroy(); };
    if (who) { this.anims.delete(who.id); this.weapons.get(who.id)?.setVisible(false); this.swings.delete(who.id); }
    if (who instanceof Raider) {
      const boss = who.boss;
      this.blood.explode(boss ? 24 : 8, sprite.x, sprite.y - 4);
      if (boss) { this.gold.explode(30, sprite.x, sprite.y - 8); this.shake(400, 0.012); }
      this.scene.tweens.add({ targets: sprite, scaleY: 0.15, scaleX: sprite.scaleX * 1.3, alpha: 0, y: sprite.y + 4, duration: boss ? 1000 : 350, ease: 'Quad.In', onComplete: done });
      return;
    }
    // villagers and the player: tip over and fade, ghost rises
    const side = sprite.flipX ? -1 : 1;
    this.scene.tweens.add({ targets: sprite, rotation: side * Math.PI / 2, y: sprite.y + 3, alpha: 0, duration: 500, ease: 'Quad.In', onComplete: done });
    const ghost = this.scene.add.sprite(sprite.x, sprite.y - 2, 'dungeon', DUNGEON.ghost).setAlpha(0.9).setDepth(DEPTH.ghost).setScale(sprite.scaleX < 0.9 ? 0.7 : 1);
    this.scene.tweens.add({ targets: ghost, y: ghost.y - 14, alpha: 0, duration: 900, ease: 'Sine.Out', onComplete: () => ghost.destroy() });
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

  private number(text: string, x: number, y: number, color: string, size: number): void {
    let t = this.numberPool.find((n) => !n.visible);
    if (!t) {
      if (this.numberPool.length >= 14) return;
      t = this.scene.add.text(0, 0, '', { fontFamily: '"Press Start 2P", monospace', fontSize: '6px', resolution: 3 }).setOrigin(0.5).setDepth(DEPTH.numbers).setStroke('#000000', 2);
      this.numberPool.push(t);
    }
    t.setText(text).setColor(color).setFontSize(size).setPosition(Math.round(x), Math.round(y)).setAlpha(1).setVisible(true);
    this.scene.tweens.add({ targets: t, y: y - 12, alpha: 0, duration: 650, ease: 'Quad.Out', onComplete: () => t!.setVisible(false) });
  }

  /** Clear everything after a reset. */
  clear(): void {
    this.scene.tweens.killAll();
    this.anims.clear();
    for (const w of this.weapons.values()) w.destroy();
    this.weapons.clear();
    this.swings.clear();
    for (const s of this.dying) s.destroy();
    this.dying.clear();
    for (const n of this.numberPool) n.setVisible(false);
  }
}

/** Convenience for the renderer: which kind is a mover, for tints. */
export function isVillagerLike(m: Mover): boolean {
  return m instanceof Villager || m instanceof Player;
}
