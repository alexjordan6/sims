import Phaser from 'phaser';
import { Villager, Raider, Player, type Mover } from './agents';
import { COLS, ROWS, TILE } from './config';
import { LIGHTS, CHIMNEYS } from './pixelart';
import type { Building } from './world';
import type { VillageScene } from './main';

// The cozy part of the day/night cycle: a coloured sky wash (peach dawn, orange sunset, purple
// dusk, deep-blue night) drawn as a render texture with warm pools of light erased out of it
// around windows, lanterns, torches and the player; chimney smoke; fireflies near the trees.

interface Key { t: number; colour: number; alpha: number; tint: number }
/**
 * Sky keyframes over dayTime (0 = midnight, 0.5 = noon); wraps at 1. `colour`/`alpha` is the
 * multiply wash; `tint` is multiplied into every sprite and tile so the art itself changes.
 * Sunset is quick: clear at 0.73, full night by 0.88.
 */
const SKY: Key[] = [
  { t: 0.0, colour: 0x2a3670, alpha: 0.62, tint: 0x98a4d8 },
  { t: 0.22, colour: 0x2a3670, alpha: 0.6, tint: 0x98a4d8 },
  { t: 0.26, colour: 0xffb08a, alpha: 0.5, tint: 0xffc8b0 },
  { t: 0.31, colour: 0xffffff, alpha: 0, tint: 0xffffff },
  { t: 0.73, colour: 0xffffff, alpha: 0, tint: 0xffffff },
  { t: 0.76, colour: 0xffc070, alpha: 0.55, tint: 0xffe0c0 },
  { t: 0.80, colour: 0xff9a5a, alpha: 0.55, tint: 0xffc0a0 },
  { t: 0.84, colour: 0x5a3a8a, alpha: 0.6, tint: 0xbcaadc },
  { t: 0.88, colour: 0x2a3670, alpha: 0.62, tint: 0x98a4d8 },
  { t: 1.0, colour: 0x2a3670, alpha: 0.62, tint: 0x98a4d8 },
];

export interface Sky { r: number; g: number; b: number; alpha: number; /** 0 by day → 1 at deepest night */ night: number; /** colour to multiply into sprites and tiles */ tint: number }

/** The sky wash for a time of day. */
export function skyAt(dayTime: number): Sky {
  const t = ((dayTime % 1) + 1) % 1;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].t <= t) i++;
  const a = SKY[i], b = SKY[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  const ca = Phaser.Display.Color.IntegerToColor(a.colour), cb = Phaser.Display.Color.IntegerToColor(b.colour);
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 1, f);
  const alpha = a.alpha + (b.alpha - a.alpha) * f;
  const ta = Phaser.Display.Color.IntegerToColor(a.tint), tb = Phaser.Display.Color.IntegerToColor(b.tint);
  const tc = Phaser.Display.Color.Interpolate.ColorWithColor(ta, tb, 1, f);
  const tint = Phaser.Display.Color.GetColor(tc.r | 0, tc.g | 0, tc.b | 0);
  // "night" is how blue the tint has gone: 0 at white, 1 at the night tint
  const night = Math.max(0, Math.min(1, (255 - (tc.r | 0)) / (255 - 0x98)));
  return { r: c.r | 0, g: c.g | 0, b: c.b | 0, alpha, night, tint };
}

const DEPTH = { wash: 40, warm: 41, fireflies: 42, smoke: 11 } as const;

export class Night {
  private rt: Phaser.GameObjects.RenderTexture;
  private warm: Phaser.GameObjects.Image[] = [];
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireflies: Phaser.GameObjects.Particles.ParticleEmitter;
  private t = 0;
  private smokeT = 0;
  private flyT = 0;
  private frame = 0;
  sky: Sky = skyAt(0.5);

  constructor(private scene: VillageScene) {
    // sized to the camera view (not the world) and moved with it, so the fill stays cheap
    this.rt = scene.add.renderTexture(0, 0, 64, 64).setOrigin(0).setDepth(DEPTH.wash).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.smoke = scene.add.particles(0, 0, 'px', {
      emitting: false, lifespan: { min: 1400, max: 2200 }, speedY: { min: -14, max: -8 }, speedX: { min: -4, max: 4 },
      scale: { start: 0.7, end: 1.8 }, alpha: { start: 0.45, end: 0 }, tint: [0xc9c9d2, 0xb0b0ba],
    }).setDepth(DEPTH.smoke);
    this.fireflies = scene.add.particles(0, 0, 'px', {
      emitting: false, lifespan: { min: 2200, max: 3800 }, speed: { min: 3, max: 9 }, angle: { min: 0, max: 360 },
      scale: { start: 0.55, end: 0.55 }, alpha: { start: 0, end: 0, ease: (v: number) => Math.sin(v * Math.PI) ** 0.6 },
      tint: [0xd8ff6a, 0xfff08a, 0xbfff9a], blendMode: Phaser.BlendModes.ADD,
    }).setDepth(DEPTH.fireflies);
  }

  /** Per frame. `buildings` maps each building to its sprite so lights can sit on the art. */
  update(dt: number, buildings: Map<Building, { body: Phaser.GameObjects.Image }>): void {
    this.t += dt;
    const s = this.scene;
    const sky = (this.sky = skyAt(s.dayTime));
    const view = s.cameras.main.worldView;
    if (sky.alpha < 0.01) {
      this.rt.setVisible(false);
      for (const w of this.warm) w.setVisible(false);
    } else if (this.frame++ % 2 === 0) { // the wash redraws at half rate; nobody can tell
      this.rt.setVisible(true);
      // v4 rounds a Render Texture up to even dimensions, so an odd target would never match
      // what it stored and we would reallocate the framebuffer on every wash frame.
      const vw = (Math.ceil(view.width) + 5) & ~1, vh = (Math.ceil(view.height) + 5) & ~1;
      if (this.rt.width !== vw || this.rt.height !== vh) this.rt.resize(vw, vh);
      const ox = Math.floor(view.x) - 2, oy = Math.floor(view.y) - 2;
      this.rt.setPosition(ox, oy);
      this.rt.clear();
      this.rt.fill(Phaser.Display.Color.GetColor(sky.r, sky.g, sky.b), sky.alpha);
      let wi = 0;
      const light = (x: number, y: number, r: number, strength: number, warmth: number) => {
        // pools of light: erase a soft disc, then lay a warm glow over it
        if (x + r < ox || y + r < oy || x - r > ox + vw || y - r > oy + vh) return;
        // stamp() copies this config into the command buffer by value. A buffered erase(image)
        // would instead re-read one shared image at flush time, and every pool in the frame would
        // come out the size of the last light.
        this.rt.stamp('glow', undefined, x - ox, y - oy, { scale: (r * 2) / 64, alpha: Math.min(1, strength), blendMode: Phaser.BlendModes.ERASE });
        if (warmth > 0) {
          const w = this.warm[wi] ?? (this.warm[wi] = s.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.warm));
          w.setPosition(x, y).setScale((r * 2.2) / 64).setTint(0xff8a2a).setAlpha(warmth).setVisible(true);
          wi++;
        }
      };
      // windows, lanterns and torches come on as the night deepens; they flicker a little
      for (const [b, e] of buildings) {
        if (b.ruined || !b.warm) continue; // no lamps in a ruin or a cold house
        const lights = LIGHTS[b.kind][Math.min(3, b.level)] ?? [];
        lights.forEach((l, i) => {
          const flicker = 0.85 + 0.15 * Math.sin(this.t * 7 + i * 1.7 + b.tx);
          light(e.body.x + l.x, e.body.y + l.y, l.r, sky.night * flicker, sky.night * (l.warm ? 0.32 : 0.16) * flicker);
        });
      }
      // you carry a lantern; soldiers on watch carry torches
      for (const a of s.agents as Mover[]) {
        if (a.dead || a.hidden) continue;
        if (a instanceof Player) light(a.x, a.y, 44, 0.95, sky.night * 0.12);
        else if (a instanceof Villager && a.role === 'soldier') light(a.x, a.y, 22, 0.8, sky.night * 0.18);
        else if (a instanceof Raider && a.boss) light(a.x, a.y, 18, 0.5, sky.night * 0.25);
      }
      for (; wi < this.warm.length; wi++) this.warm[wi].setVisible(false);
      this.rt.render(); // v4 buffers every draw call; without this the wash never appears
    }

    // chimney smoke from dusk to mid-morning
    const smoky = s.dayTime < 0.42 || s.dayTime > 0.72;
    this.smokeT += dt;
    if (smoky && this.smokeT > 0.45) {
      this.smokeT = 0;
      for (const [b, e] of buildings) if (!b.ruined && b.warm) for (const c of CHIMNEYS[b.kind][Math.min(3, b.level)] ?? []) this.smoke.emitParticleAt(e.body.x + c.x, e.body.y + c.y, 1);
    }

    // fireflies drift up from the trees in view once it's properly dark
    this.flyT += dt;
    if (sky.night > 0.35 && this.flyT > 0.18 && this.fireflies.getAliveParticleCount() < 28) {
      this.flyT = 0;
      const v = s.cameras.main.worldView;
      const tx0 = Math.max(0, Math.floor(v.x / TILE)), ty0 = Math.max(0, Math.floor(v.y / TILE));
      const tx1 = Math.min(COLS - 1, Math.ceil(v.right / TILE)), ty1 = Math.min(ROWS - 1, Math.ceil(v.bottom / TILE));
      for (let tries = 0; tries < 6; tries++) {
        const tx = Phaser.Math.Between(tx0, tx1), ty = Phaser.Math.Between(ty0, ty1);
        const t = s.world.get(tx, ty);
        if (t && (t.kind === 'tree' || t.kind === 'sapling')) { this.fireflies.emitParticleAt((tx + Math.random()) * TILE, (ty + Math.random()) * TILE, 1); break; }
      }
    }
  }
}
