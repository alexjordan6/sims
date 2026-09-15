import Phaser from 'phaser';
import { Villager, Raider, Player, type Mover } from './agents';
import { COLS, ROWS, TILE } from './config';
import { LIGHTS, CHIMNEYS } from './pixelart';
import type { Building } from './world';
import type { VillageScene } from './main';

// The cozy part of the day/night cycle: a coloured sky wash (peach dawn, orange sunset, purple
// dusk, deep-blue night) drawn as a render texture with warm pools of light erased out of it
// around windows, lanterns, torches and the player; chimney smoke; fireflies near the trees.

interface Key { t: number; colour: number; alpha: number }
/** Sky wash keyframes over dayTime (0 = midnight, 0.5 = noon); wraps at 1. */
const SKY: Key[] = [
  { t: 0.0, colour: 0x0d1436, alpha: 0.62 },
  { t: 0.2, colour: 0x141c48, alpha: 0.52 },
  { t: 0.28, colour: 0xff9a6a, alpha: 0.24 },
  { t: 0.36, colour: 0xfff0d0, alpha: 0 },
  { t: 0.7, colour: 0xfff0d0, alpha: 0 },
  { t: 0.78, colour: 0xff8a3a, alpha: 0.28 },
  { t: 0.86, colour: 0x4a2a6a, alpha: 0.46 },
  { t: 0.93, colour: 0x0d1436, alpha: 0.62 },
  { t: 1.0, colour: 0x0d1436, alpha: 0.62 },
];

export interface Sky { r: number; g: number; b: number; alpha: number; /** 0 by day → 1 at deepest night */ night: number }

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
  return { r: c.r | 0, g: c.g | 0, b: c.b | 0, alpha, night: Math.max(0, Math.min(1, (alpha - 0.2) / 0.42)) };
}

const DEPTH = { wash: 40, warm: 41, fireflies: 42, smoke: 11 } as const;

export class Night {
  private rt: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Image; // erased from the wash to make light pools
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
    this.rt = scene.add.renderTexture(0, 0, 64, 64).setOrigin(0).setDepth(DEPTH.wash);
    this.stamp = scene.make.image({ key: 'glow', add: false });
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
      const vw = Math.ceil(view.width) + 4, vh = Math.ceil(view.height) + 4;
      if (this.rt.width !== vw || this.rt.height !== vh) this.rt.resize(vw, vh);
      const ox = Math.floor(view.x) - 2, oy = Math.floor(view.y) - 2;
      this.rt.setPosition(ox, oy);
      this.rt.clear();
      this.rt.fill(Phaser.Display.Color.GetColor(sky.r, sky.g, sky.b), sky.alpha);
      let wi = 0;
      const light = (x: number, y: number, r: number, strength: number, warmth: number) => {
        // pools of light: erase a soft disc, then lay a warm glow over it
        if (x + r < ox || y + r < oy || x - r > ox + vw || y - r > oy + vh) return;
        this.stamp.setScale((r * 2) / 64).setAlpha(Math.min(1, strength));
        this.rt.erase(this.stamp, x - ox, y - oy);
        if (warmth > 0) {
          const w = this.warm[wi] ?? (this.warm[wi] = s.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.warm));
          w.setPosition(x, y).setScale((r * 2.2) / 64).setTint(0xff8a2a).setAlpha(warmth).setVisible(true);
          wi++;
        }
      };
      // windows, lanterns and torches come on as the night deepens; they flicker a little
      for (const [b, e] of buildings) {
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
    }

    // chimney smoke from dusk to mid-morning
    const smoky = s.dayTime < 0.42 || s.dayTime > 0.72;
    this.smokeT += dt;
    if (smoky && this.smokeT > 0.45) {
      this.smokeT = 0;
      for (const [b, e] of buildings) for (const c of CHIMNEYS[b.kind][Math.min(3, b.level)] ?? []) this.smoke.emitParticleAt(e.body.x + c.x, e.body.y + c.y, 1);
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
