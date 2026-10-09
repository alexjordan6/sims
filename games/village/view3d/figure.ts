import * as THREE from 'three';
import { lambert } from './fow';
import { Mover, Villager, Player, Raider, type EnemyKind } from '../agents';

/**
 * Bodies in the old RuneScape manner: a handful of flat-shaded boxes on long rigid limbs, a small head,
 * and a silhouette you can read across a field.
 *
 * The packs' own characters are chibi — three heads tall, the head 60% of the body. What they do have is
 * a skeleton worth keeping: `root -> (leg-left, leg-right, torso)` and `torso -> (arm-left, arm-right,
 * head)`, seven nodes, shared by every folk and grave character. Every one of its 32 clips animates
 * rotation only (plus the root's step), so the rest positions are ours to rewrite: push the hips down,
 * the shoulders up and the head where a head belongs, and all 32 clips still play. One joint per limb is
 * rigid-segment articulation, which is how those old models moved anyway.
 *
 * So: keep the rigs and the animations, hide the geometry, hang boxes off the bones.
 */

/** Every length is a fraction of the figure's own standing height; `buildFigure` returns what that came to. */
export interface Spec {
  /** the head cube's height (its width is a little narrower) */
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
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(0.5, 1, 6);
const RING = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
/** a soldier's rank, banded round its cap: none for a Recruit, then bronze, silver, gold, and gold with a plume */
const RANK_BAND = [0, 0, 0xb0703a, 0xc8ccd4, 0xe3b341, 0xe3b341];

/**
 * One flat-shaded box. `y` is its base rather than its centre, so a limb hangs from a joint at the
 * origin by giving a negative base. (actors.ts has its own `piece` for world-space art; this one keeps
 * figure units and casts a shadow.)
 */
function slab(colour: number, w: number, h: number, d: number, x: number, y: number, z: number, g: THREE.BufferGeometry = BOX): THREE.Mesh {
  const m = new THREE.Mesh(g, lambert({ color: colour }));
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
 * Rebuild `rig` as a figure of `s`: the pack's meshes step aside, the bones move to where this body's
 * joints belong, and boxes hang off them. Returns the standing height, in the same units — the caller
 * scales the rig by `PERSON / height`. Returns 0 if this is not one of the pack rigs, leaving it alone.
 */
export function buildFigure(rig: THREE.Object3D, s: Spec, wear: { cap?: number; circlet?: boolean } = {}): number {
  const bone = (n: string) => rig.getObjectByName(n);
  const torso = bone('torso'), head = bone('head');
  const arms = [bone('arm-left'), bone('arm-right')], legs = [bone('leg-left'), bone('leg-right')];
  if (!torso || !head || arms.some((b) => !b) || legs.some((b) => !b)) return 0;

  // the pack's own body steps aside; `bake()` and the renderer both honour `visible`, so the crowd
  // and the full actors drop it alike
  rig.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.visible = false; });

  const hip = s.legLen, shoulder = hip + s.torsoH, height = shoulder + NECK + s.head;
  const hand = s.armLen * 0.26, sleeve = s.armLen - hand;
  const boot = s.legLen * 0.17, shank = s.legLen - boot;

  // ---- the joints, moved to where this body wants them (local to each bone's parent) ----
  torso.position.set(0, hip, 0);
  legs[0]!.position.set(s.legW * 0.85, hip, 0); // a stance wide enough to read two legs from overhead
  legs[1]!.position.set(-s.legW * 0.85, hip, 0);
  const armX = s.torsoW / 2 + s.armW / 2;
  arms[0]!.position.set(armX, s.torsoH - s.armW * 0.6, 0);
  arms[1]!.position.set(-armX, s.torsoH - s.armW * 0.6, 0);
  head.position.set(0, s.torsoH + NECK, 0);

  // ---- the body, hung off them ----
  const chest = slab(s.coat, s.torsoW, s.torsoH, s.torsoD, 0, 0, 0);
  if (s.hunch) chest.rotation.x = s.hunch; // on the mesh, not the bone: the clips drive the bone
  torso.add(chest);
  head.add(slab(s.skin, s.head * 0.86, s.head, s.head * 0.8, 0, 0, 0));
  if (wear.cap) head.add(...cap(s, wear.cap));
  if (wear.circlet) head.add(slab(0xc8a040, s.head * 0.95, s.head * 0.11, s.head * 0.9, 0, s.head * 0.8, 0));
  for (const a of arms) {
    a!.add(slab(s.coat, s.armW, sleeve, s.armW, 0, -sleeve, 0));
    a!.add(slab(s.skin, s.armW * 1.1, hand, s.armW * 1.1, 0, -s.armLen, 0)); // a mitten, as they all were
  }
  for (const l of legs) {
    l!.add(slab(s.trouser, s.legW, shank, s.legW, 0, -shank, 0));
    l!.add(slab(s.boot, s.legW * 1.1, boot, s.legW * 1.75, 0, -s.legLen, s.legW * 0.35)); // a flat foot, forward
  }
  return height;
}

// ---- who is built how -------------------------------------------------------------------------------

const HUMAN: Spec = { head: 0.17, torsoH: 0.3, torsoW: 0.32, torsoD: 0.18, armLen: 0.36, armW: 0.09, legLen: 0.48, legW: 0.11, skin: 0xe0a878, coat: 0x3a5a9a, trouser: 0x4a3a2a, boot: 0x33261c };
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
