import * as THREE from 'three';
import { lambert } from './fow';
import { Mover, Villager, Player, Raider, type EnemyKind } from '../agents';

// Faceted, articulated figures shared by the live actors and instanced distant crowd.
// Elbows, wrists and knees are explicit joints; no character asset is needed at startup.

/** Every length is a fraction of the figure's own standing height; `buildFigure` returns what that came to. */
export interface Spec {
  /** head height (its width is a little narrower) */
  head: number;
  torsoH: number; torsoW: number; torsoD: number;
  /** shoulder to fingertips, the hand included */
  armLen: number; armW: number;
  /** hip to sole, the boot included */
  legLen: number; legW: number;
  /** a forward stoop on the torso, in radians (zombies, trolls) */
  hunch?: number;
  skin: number; coat: number; trouser: number; boot: number;
}

/** the gap between the shoulders and the chin */
const NECK = 0.02;
const ROUND = new THREE.SphereGeometry(0.5, 6, 4);
const LIMB = new THREE.CylinderGeometry(0.43, 0.5, 1, 6);
const CONE = new THREE.ConeGeometry(0.5, 1, 6);
const RING = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
/**
 * The metal ladder, read off the gear's own names: leather and bronze, iron, steel, and the blue stuff
 * that is only ever found. Index is the forged tier, so a piece's colour is its tier — which is the
 * whole point: you can tell what a soldier is wearing from across the field.
 */
export const ARMOUR_METAL = [0, 0x8a5a30, 0x4b4b4f, 0xa8b0b8, 0x3f5fc0];
export const WEAPON_METAL = [0x6a4a2a, 0xa9682f, 0x4b4b4f, 0xa8b0b8, 0x3f5fc0];

/** what a body is wearing: a tier per slot, as `Armor` carries them */
export interface Kit { helmet: number; chest: number; legs: number; shield: number }
export const NO_KIT: Kit = { helmet: 0, chest: 0, legs: 0, shield: 0 };
/** Is anything worn? (a bare body skips the gear entirely) */
export function wearing(k: Kit): boolean { return k.helmet > 0 || k.chest > 0 || k.legs > 0 || k.shield > 0; }

/** a soldier's rank, banded round its cap: none for a Recruit, then bronze, silver, gold, and gold with a plume */
const RANK_BAND = [0, 0, 0xb0703a, 0xc8ccd4, 0xe3b341, 0xe3b341];

/**
 * One faceted body volume. `y` is its base rather than its centre, so a limb hangs from a joint at the
 * origin by giving a negative base. (actors.ts has its own `piece` for world-space art; this one keeps
 * figure units and casts a shadow.)
 */
function slab(colour: number, w: number, h: number, d: number, x: number, y: number, z: number, g: THREE.BufferGeometry = ROUND): THREE.Mesh {
  const m = new THREE.Mesh(g, lambert({ color: colour, flatShading: true }));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

/**
 * The gnomes' red cap, cut to the head it sits on rather than to a fixed size, and a soldier's rank
 * banded round the brim. `tier` is 1 for anyone who is not a soldier.
 */
function cap(s: Spec, tier: number): THREE.Mesh[] {
  const brim = s.head * 0.84; // the band bites a little way down into the head
  const out = [slab(0xa02a22, s.head * 1.22, s.head * 1.45, s.head * 1.22, 0, brim, 0, CONE)];
  if (tier >= 2) out.push(slab(RANK_BAND[tier], s.head * 1.3, s.head * 0.17, s.head * 1.3, 0, brim, 0, RING));
  if (tier >= 5) out.push(slab(0xf4f0e6, s.head * 0.3, s.head * 1.1, s.head * 0.7, 0, brim + s.head * 1.3, -s.head * 0.25));
  return out;
}

/**
 * Build low-poly body volumes around a hierarchy of movable joints. Returns standing height;
 * callers scale the rig by `PERSON / height` before attaching world-sized equipment.
 */
export function buildFigure(rig: THREE.Object3D, s: Spec, wear: { cap?: number; circlet?: boolean; kit?: Kit } = {}): number {
  // A complete articulated rig is available immediately, even before any asset loads.
  rig.clear();
  delete rig.userData.joints;
  const joint = (name: string, parent: THREE.Object3D, x=0, y=0, z=0) => {
    const node = new THREE.Group(); node.name = name; node.position.set(x,y,z); parent.add(node); return node;
  };
  const root = joint('root', rig);
  const hip = s.legLen, height = hip + s.torsoH + NECK + s.head;
  const torso = joint('torso', root, 0, hip);
  const head = joint('head', torso, 0, s.torsoH + NECK);
  const kit = wear.kit ?? NO_KIT;
  torso.add(slab(s.coat, s.torsoW, s.torsoH * 1.16, s.torsoD * 1.22, 0, -s.torsoH * 0.05, 0));
  torso.add(slab(s.coat, s.torsoW * 0.85, s.torsoH * 0.35, s.torsoD * 1.08, 0, -s.torsoH * 0.2, 0));
  torso.add(slab(0x483528, s.torsoW * 0.89, 0.035, s.torsoD * 1.13, 0, 0.025, 0, RING));
  torso.add(slab(0xc7a46b, 0.036, 0.038, 0.015, 0, 0.023, s.torsoD * 0.57));
  torso.add(slab(s.skin, s.head * 0.4, NECK * 2, s.head * 0.42, 0, s.torsoH - NECK, 0));
  head.add(slab(s.skin, s.head * 0.86, s.head, s.head * 0.85, 0, 0, 0));
  head.add(slab(s.skin, s.head * 0.22, s.head * 0.24, s.head * 0.27, 0, s.head * 0.35, s.head * 0.4));
  for (const sign of [-1, 1]) {
    head.add(slab(s.skin, s.head * 0.17, s.head * 0.28, s.head * 0.18, sign * s.head * 0.42, s.head * 0.35, 0));
    head.add(slab(0x201c19, s.head * 0.085, s.head * 0.07, s.head * 0.045, sign * s.head * 0.19, s.head * 0.57, s.head * 0.385));
    head.add(slab(0x493322, s.head * 0.23, s.head * 0.045, s.head * 0.07, sign * s.head * 0.19, s.head * 0.68, s.head * 0.35));
  }
  head.add(slab(0x584332, s.head * 0.88, s.head * 0.4, s.head * 0.87, 0, s.head * 0.68, -s.head * 0.035));
  if (wear.cap) head.add(slab(0xc9baa0, s.head * 0.74, s.head * 0.53, s.head * 0.5, 0, -s.head * 0.06, s.head * 0.25));
  if (kit.helmet > 0) head.add(...helm(s, kit.helmet, wear.cap ?? 1));
  else if (wear.cap) head.add(...cap(s, wear.cap));
  if (wear.circlet) head.add(slab(0xc8a040, s.head * 0.96, s.head * 0.1, s.head * 0.94, 0, s.head * 0.76, 0, RING));
  if (kit.chest > 0) torso.add(...plate(s, kit.chest));
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    const upper = s.armLen * 0.51, lower = s.armLen * 0.49;
    const arm = joint('arm-' + side, torso, sign * (s.torsoW * 0.48 + s.armW * 0.28), s.torsoH * 0.88);
    arm.add(slab(s.coat, s.armW * 1.18, upper * 1.06, s.armW * 1.18, 0, -upper, 0, LIMB));
    const elbow = joint('elbow-' + side, arm, 0, -upper);
    elbow.add(slab(s.coat, s.armW * 0.84, s.armW * 0.84, s.armW * 0.84, 0, -s.armW * 0.42, 0));
    elbow.add(slab(s.coat, s.armW, lower * 0.8, s.armW, 0, -lower * 0.8, 0, LIMB));
    elbow.add(slab(0x493728, s.armW * 1.04, lower * 0.25, s.armW * 1.04, 0, -lower * 0.83, 0));
    const hand = joint('hand-' + side, elbow, 0, -lower * 0.94);
    hand.add(slab(s.skin, s.armW * 0.9, s.armW * 1.2, s.armW * 0.75, 0, -s.armW * 0.4, 0));
    if (kit.chest > 0) arm.add(slab(ARMOUR_METAL[kit.chest], s.armW * 1.65, s.armW * 1.2, s.armW * 1.5, 0, -s.armW * 0.55, 0));
    const thigh = s.legLen * 0.5, shin = s.legLen * 0.5;
    const leg = joint('leg-' + side, root, sign * s.legW * 0.78, hip);
    leg.add(slab(s.trouser, s.legW * 1.13, thigh * 1.05, s.legW * 1.15, 0, -thigh, 0, LIMB));
    const knee = joint('knee-' + side, leg, 0, -thigh);
    knee.add(slab(s.trouser, s.legW * 0.86, s.legW * 0.86, s.legW * 0.86, 0, -s.legW * 0.43, 0));
    knee.add(slab(s.trouser, s.legW * 0.9, shin * 0.78, s.legW * 0.92, 0, -shin * 0.78, 0, LIMB));
    knee.add(slab(s.boot, s.legW * 1.05, shin * 0.42, s.legW * 1.75, 0, -shin, s.legW * 0.3));
    if (kit.legs > 0) knee.add(slab(ARMOUR_METAL[kit.legs], s.legW * 1.12, shin * 0.7, s.legW * 1.12, 0, -shin * 0.68, s.legW * 0.1));
  }
  if (kit.shield > 0) rig.getObjectByName('elbow-left')!.add(...shieldOn({ ...s, armLen: s.armLen * 0.48 }, kit.shield));
  rig.userData.spec = s;
  return height;
}

/** A helm over the head, cut so the face still shows; the rank band rides round its brow as it did the cap. */
function helm(s: Spec, tier: number, rank: number): THREE.Mesh[] {
  const c = ARMOUR_METAL[tier], out: THREE.Mesh[] = [];
  out.push(slab(c, s.head * 0.96, s.head * 0.62, s.head * 0.9, 0, s.head * 0.42, 0));       // the skull of it
  out.push(slab(c, s.head * 1.04, s.head * 0.16, s.head * 0.98, 0, s.head * 0.34, 0));      // a brow ridge
  out.push(slab(c, s.head * 0.18, s.head * 0.42, s.head * 0.1, 0, s.head * 0.3, s.head * 0.44)); // the nasal
  if (rank >= 2) out.push(slab(RANK_BAND[rank], s.head * 1.1, s.head * 0.12, s.head * 1.04, 0, s.head * 0.2, 0));
  if (rank >= 5) out.push(slab(0xf4f0e6, s.head * 0.3, s.head * 0.9, s.head * 0.7, 0, s.head * 1.04, -s.head * 0.25));
  return out;
}

/** A platebody over the chest: a shell with a raised collar. (The pauldrons go on the arms, so they swing.) */
function plate(s: Spec, tier: number): THREE.Mesh[] {
  const c = ARMOUR_METAL[tier];
  return [
    slab(c, s.torsoW * 1.08, s.torsoH * 0.74, s.torsoD * 1.14, 0, s.torsoH * 0.2, 0),
    slab(c, s.torsoW * 0.66, s.torsoH * 0.12, s.torsoD * 1.2, 0, s.torsoH * 0.9, 0), // the collar
  ];
}

/** A kite shield on the off arm, held across the body; the found tower shield is a wall of a thing. */
function shieldOn(s: Spec, tier: number): THREE.Mesh[] {
  const c = ARMOUR_METAL[tier], tower = tier >= 4;
  const w = s.torsoW * (tower ? 0.78 : 0.62), h = s.torsoH * (tower ? 1.25 : 0.95), z = s.armW * 1.1;
  const out = [slab(c, w, h * 0.62, s.armW * 0.5, 0, -s.armLen * 0.72, z)];
  out.push(slab(c, w * 0.72, h * 0.42, s.armW * 0.5, 0, -s.armLen * 0.72 - h * 0.42, z)); // tapering to a point
  out.push(slab(0x3a2a1c, w * 0.2, h * 0.5, s.armW * 0.56, 0, -s.armLen * 0.72 + h * 0.1, z)); // a boss down the middle
  return out;
}

// ---- who is built how -------------------------------------------------------------------------------

const HUMAN: Spec = { head: 0.16, torsoH: 0.32, torsoW: 0.27, torsoD: 0.15, armLen: 0.39, armW: 0.075, legLen: 0.5, legW: 0.095, skin: 0xe0a878, coat: 0x3a5a9a, trouser: 0x4a3a2a, boot: 0x33261c };
/** a gnome is small folk, not a shrunk human: more head, less leg */
const GNOME: Spec = { ...HUMAN, head: 0.22, torsoH: 0.3, torsoW: 0.3, armLen: 0.3, legLen: 0.38, legW: 0.1, skin: 0xe8b888, coat: 0x4a7a3a, trouser: 0x6a4a2a };

const FOE_SPEC: Record<EnemyKind, Spec> = {
  raider: { ...HUMAN, head: 0.19, torsoW: 0.31, skin: 0x6f8f3f, coat: 0x7a4a2a, trouser: 0x5a3a22, boot: 0x3a2a1a }, // goblin green
  warlord: { ...HUMAN, head: 0.19, torsoW: 0.35, torsoD: 0.21, armW: 0.1, skin: 0x5f7a35, coat: 0x6a1f1f, trouser: 0x2e2126, boot: 0x241a16 },
  brute: { ...HUMAN, head: 0.17, torsoH: 0.33, torsoW: 0.38, torsoD: 0.23, armLen: 0.38, armW: 0.11, legLen: 0.4, legW: 0.12, hunch: 0.14, skin: 0x8a7a46, coat: 0x6b4a2c, trouser: 0x4a3420, boot: 0x33241a },
  ogre: { ...HUMAN, head: 0.18, torsoH: 0.34, torsoW: 0.4, torsoD: 0.24, armLen: 0.4, armW: 0.12, legLen: 0.4, legW: 0.13, hunch: 0.12, skin: 0x7d9158, coat: 0x6a5436, trouser: 0x4e3f28, boot: 0x33281c },
  troll: { ...HUMAN, head: 0.18, torsoH: 0.33, torsoW: 0.37, torsoD: 0.23, armLen: 0.39, armW: 0.11, legLen: 0.39, hunch: 0.16, skin: 0x5f7a54, coat: 0x4a5340, trouser: 0x3a4030, boot: 0x2b2f24 },
  snatcher: { ...HUMAN, head: 0.24, torsoH: 0.26, torsoW: 0.24, torsoD: 0.15, armLen: 0.32, armW: 0.07, legLen: 0.4, legW: 0.085, skin: 0x8a5a7a, coat: 0x3a3340, trouser: 0x2e2832, boot: 0x241f28 }, // an imp: all head and fingers
  shaman: { ...HUMAN, head: 0.19, torsoW: 0.29, skin: 0x6f8f3f, coat: 0x5a3a8a, trouser: 0x40296a, boot: 0x2a1c46 },
  wrecker: { ...HUMAN, head: 0.18, torsoH: 0.32, torsoW: 0.35, armLen: 0.37, armW: 0.1, skin: 0x7a6a3a, coat: 0x8a5420, trouser: 0x5a3a18, boot: 0x3a2610 },
  skulk: { ...HUMAN, head: 0.17, torsoW: 0.22, torsoD: 0.14, armW: 0.065, legW: 0.08, skin: 0x3a3a42, coat: 0x1a1a1e, trouser: 0x141418, boot: 0x0e0e12 },
  rat: HUMAN, boar: HUMAN, // four-legged: never built as figures (see makeActor)
};

/** every figure by name; the crowd bakes one set of poses per name it sees */
export const FIGURES: Record<string, Spec> = { head: HUMAN, gnome: GNOME, ...FOE_SPEC };

/** The figure `m` is built as, and the name it is baked under. */
export function specFor(m: Mover): { name: string; spec: Spec } | null {
  if (m instanceof Player) return { name: 'head', spec: HUMAN };
  if (m instanceof Villager) return { name: 'gnome', spec: GNOME };
  if (m instanceof Raider) return { name: m.kind, spec: FIGURES[m.kind] ?? HUMAN };
  return null;
}
